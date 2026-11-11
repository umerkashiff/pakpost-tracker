import { NextResponse } from 'next/server';
import { getTrackedParcels } from '@/lib/config';

export async function GET() {
  const parcels = getTrackedParcels();
  const hasDiscord = Boolean(process.env.DISCORD_WEBHOOK_URL);
  const hasCronSecret = Boolean(process.env.CRON_SECRET);

  return NextResponse.json({
    parcels,
    hasDiscord,
    hasCronSecret,
    schedule: 'Daily at 04:00 UTC (09:00 AM PKT)'
  });
}
