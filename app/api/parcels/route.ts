import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getTrackedParcels } from '@/lib/config';
import { ParcelConfig } from '@/lib/types';

export async function GET() {
  const parcels = getTrackedParcels();
  const hasDiscord = Boolean(process.env.DISCORD_WEBHOOK_URL);

  return NextResponse.json({
    parcels,
    hasDiscord,
    discordWebhookConfigured: hasDiscord
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, id, label } = body;

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
