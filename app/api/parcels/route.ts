import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getTrackedParcels } from '@/lib/config';

export async function GET() {
  const parcels = getTrackedParcels();
  const hasDiscord = Boolean(process.env.DISCORD_WEBHOOK_URL);

  let schedule = '0 4 * * *';
  try {
    const vercelPath = path.join(process.cwd(), 'vercel.json');
    if (fs.existsSync(vercelPath)) {
      const vercelJson = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
      if (vercelJson?.crons?.[0]?.schedule) {
        schedule = vercelJson.crons[0].schedule;
      }
    }
  } catch {
    // Fallback to default schedule
  }

  return NextResponse.json({
    parcels,
    hasDiscord,
    discordWebhookConfigured: hasDiscord,
    schedule
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, id, label, passcode, webhookUrl, schedule } = body;

    if (action === 'settings') {
      if (passcode !== 'uwu123') {
        return NextResponse.json({ error: 'Invalid passcode' }, { status: 403 });
      }

      if (schedule) {
        try {
          const vercelPath = path.join(process.cwd(), 'vercel.json');
          const vercelConfig = {
            crons: [
              {
                path: '/api/cron',
                schedule: schedule.trim()
              }
            ]
          };
          fs.writeFileSync(vercelPath, JSON.stringify(vercelConfig, null, 2), 'utf8');
        } catch {
          // Read-only in serverless production
        }
      }

      if (webhookUrl !== undefined) {
        process.env.DISCORD_WEBHOOK_URL = webhookUrl.trim();
        try {
          const envPath = path.join(process.cwd(), '.env.local');
          let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
          if (content.includes('DISCORD_WEBHOOK_URL=')) {
            content = content.replace(/DISCORD_WEBHOOK_URL=.*/g, `DISCORD_WEBHOOK_URL=${webhookUrl.trim()}`);
          } else {
            content += `\nDISCORD_WEBHOOK_URL=${webhookUrl.trim()}\n`;
          }
          fs.writeFileSync(envPath, content, 'utf8');
        } catch {
          // Read-only in serverless production
        }
      }

      return NextResponse.json({ success: true });
    }

    const parcels = getTrackedParcels();
    const cleanId = (id || '').trim().toUpperCase();

    if (action === 'add') {
      if (!cleanId) {
        return NextResponse.json({ error: 'Tracking ID is required' }, { status: 400 });
      }

      if (!parcels.some((p) => p.id === cleanId)) {
        parcels.push({ id: cleanId, label: label?.trim() || undefined, enabled: true });
      }
    } else if (action === 'remove') {
      const index = parcels.findIndex((p) => p.id === cleanId);
      if (index !== -1) {
        parcels.splice(index, 1);
      }
    }

    // Try persisting to parcels.json if filesystem is writable
    try {
      const configPath = path.join(process.cwd(), 'parcels.json');
      fs.writeFileSync(configPath, JSON.stringify(parcels, null, 2), 'utf8');
    } catch {
      // Serverless environments like Vercel have a read-only filesystem
    }

    return NextResponse.json({ success: true, parcels });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update parcels' },
      { status: 500 }
    );
  }
}
