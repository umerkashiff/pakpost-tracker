import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  getTrackedParcels,
  getPublicTrackedParcels,
  saveTrackedParcels,
  getDiscordWebhookUrl,
  saveDiscordWebhookUrl,
  getScheduleCron,
  saveScheduleCron,
  verifyOwnerPasscode,
  saveOwnerPasscode,
  getQStashScheduleId,
  saveQStashScheduleId,
  clearParcelTrackingState
} from '@/lib/config';
import { generateAlias } from '@/lib/crypto';
import {
  isQStashConfigured,
  resolveCronDestinationUrl,
  syncQStashSchedule
} from '@/lib/qstash';

export async function GET(request: NextRequest) {
  const authPasscode = request.nextUrl.searchParams.get('passcode') || '';
  const { valid: isOwner } = authPasscode
    ? await verifyOwnerPasscode(authPasscode)
    : { valid: false };

  // For public visitors: return strictly masked IDs and aliases
  // Only with valid passcode are raw IDs ever accessible
  const parcels = isOwner ? await getTrackedParcels() : await getPublicTrackedParcels();
  const webhookUrl = await getDiscordWebhookUrl();
  const hasDiscord = Boolean(webhookUrl && webhookUrl.trim());
  const schedule = await getScheduleCron();

  return NextResponse.json({
    parcels,
    hasDiscord,
    discordWebhookConfigured: hasDiscord,
    schedule,
    qstashConfigured: isQStashConfigured()
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, id, alias, label, passcode, newPasscode, webhookUrl, schedule } = body;

    const { valid, configured } = await verifyOwnerPasscode(passcode || '');
    if (!configured) {
      return NextResponse.json(
        { error: 'Server passcode not set. Configure SETTINGS_PASSCODE in environment variables.' },
        { status: 503 }
      );
    }
    if (!valid) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid passcode required to modify tracked parcels or settings.' },
        { status: 403 }
      );
    }

    if (action === 'settings') {
      let scheduleMessage: string | null = null;
      let qstashSynced = false;
      let scheduleMode: 'qstash' | 'static' = 'static';
      let passcodeUpdated = false;

      if (schedule) {
        const cleanSchedule = String(schedule).trim();
        await saveScheduleCron(cleanSchedule);

        try {
          const vercelPath = path.join(process.cwd(), 'vercel.json');
          const vercelConfig = {
            crons: [
              {
                path: '/api/cron',
                schedule: cleanSchedule
              }
            ]
          };
          fs.writeFileSync(vercelPath, JSON.stringify(vercelConfig, null, 2), 'utf8');
        } catch {
          // Read-only in serverless production
        }

        const prevId = await getQStashScheduleId();
        const destUrl = resolveCronDestinationUrl(request.nextUrl.origin);
        const syncResult = await syncQStashSchedule(cleanSchedule, destUrl, prevId);
        qstashSynced = syncResult.synced;
        scheduleMode = syncResult.mode;
        scheduleMessage = syncResult.message;

        if (syncResult.synced && syncResult.scheduleId) {
          await saveQStashScheduleId(syncResult.scheduleId);
        }
      }

      if (webhookUrl !== undefined) {
        const cleanWebhook = String(webhookUrl).trim();
        await saveDiscordWebhookUrl(cleanWebhook);
        process.env.DISCORD_WEBHOOK_URL = cleanWebhook;

        try {
          const envPath = path.join(process.cwd(), '.env.local');
          let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
          if (content.includes('DISCORD_WEBHOOK_URL=')) {
            content = content.replace(/DISCORD_WEBHOOK_URL=.*/g, `DISCORD_WEBHOOK_URL=${cleanWebhook}`);
          } else {
            content += `\nDISCORD_WEBHOOK_URL=${cleanWebhook}\n`;
          }
          fs.writeFileSync(envPath, content, 'utf8');
        } catch {
          // Read-only in serverless production
        }
      }

      if (typeof newPasscode === 'string' && newPasscode.trim().length > 0) {
        await saveOwnerPasscode(newPasscode);
        passcodeUpdated = true;
      }

      return NextResponse.json({
        success: true,
        qstashSynced,
        scheduleMode,
        passcodeUpdated,
        message: scheduleMessage || 'Settings saved.'
      });
    }

    const parcels = await getTrackedParcels();
    const cleanId = (id || '').trim().toUpperCase();

    if (action === 'add') {
      if (!cleanId) {
        return NextResponse.json({ error: 'Tracking ID is required' }, { status: 400 });
      }

      if (!parcels.some((p) => p.id === cleanId)) {
        parcels.push({ id: cleanId, label: label?.trim() || undefined, enabled: true });
      }
    } else if (action === 'remove') {
      const targetIdentifier = (alias || id || '').trim();
      const index = parcels.findIndex(
        (p) => generateAlias(p.id) === targetIdentifier || p.id.toUpperCase() === targetIdentifier.toUpperCase()
      );
      if (index !== -1) {
        const [removed] = parcels.splice(index, 1);
        await clearParcelTrackingState(removed.id);
      }
    }

    // Persist AES-256 encrypted to Upstash Redis
    await saveTrackedParcels(parcels);

    const publicParcels = await getPublicTrackedParcels();
    return NextResponse.json({ success: true, parcels: publicParcels });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update parcels' },
      { status: 400 }
    );
  }
}
