import { NextRequest, NextResponse } from 'next/server';
import { getTrackedParcels } from '@/lib/config';
import { fetchPakistanPostTracking } from '@/lib/pakpost';
import { sendDiscordNotification } from '@/lib/discord';

async function handleCheck(request: NextRequest) {
  // 1. Verify Authorization if CRON_SECRET is configured
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    const querySecret = request.nextUrl.searchParams.get('secret');
    const isAuthorized =
      authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized. Provide valid Bearer token or ?secret= query param.' },
        { status: 401 }
      );
    }
  }

  // 2. Load configured parcels
  const parcels = getTrackedParcels();

  if (parcels.length === 0) {
    return NextResponse.json({
      status: 'skipped',
      message: 'No parcels configured in TRACKING_IDS environment variable or parcels.json',
      checkedAt: new Date().toISOString(),
      results: []
    });
  }

  // 3. Track each parcel with concurrency limit to avoid overwhelming server
  const results = [];
  for (const parcel of parcels) {
    const result = await fetchPakistanPostTracking(parcel.id, parcel.label);
    results.push(result);
    // 500ms delay between consecutive queries
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // 4. Send notification to Discord unless notify=false
  const shouldNotify = request.nextUrl.searchParams.get('notify') !== 'false';
  let discordResult: { success: boolean; error?: string; count: number } = {
    success: false,
    error: 'Notification skipped by param',
    count: 0
  };

  if (shouldNotify) {
    discordResult = await sendDiscordNotification(results);
  }

  const deliveredCount = results.filter((r) => r.statusCategory === 'DELIVERED').length;
  const inTransitCount = results.filter((r) => r.statusCategory === 'IN_TRANSIT').length;

  return NextResponse.json({
    status: 'success',
    checkedAt: new Date().toISOString(),
    totalParcels: results.length,
    deliveredCount,
    inTransitCount,
    discord: discordResult,
    results
  });
}

export async function GET(request: NextRequest) {
  return handleCheck(request);
}

export async function POST(request: NextRequest) {
  return handleCheck(request);
}
