import { NextRequest, NextResponse } from 'next/server';
import {
  getTrackedParcels,
  computeTrackingSignature,
  getLastParcelSignature,
  saveLastParcelSignature
} from '@/lib/config';
import { fetchPakistanPostTracking } from '@/lib/pakpost';
import { sendDiscordNotification } from '@/lib/discord';
import { TrackingResult } from '@/lib/types';

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
  const parcels = await getTrackedParcels();

  if (parcels.length === 0) {
    return NextResponse.json({
      status: 'skipped',
      message: 'No parcels configured in TRACKING_IDS environment variable or parcels.json',
      checkedAt: new Date().toISOString(),
      results: []
    });
  }

  const forcePush = request.nextUrl.searchParams.get('force') === 'true';
  const shouldNotify = request.nextUrl.searchParams.get('notify') !== 'false';

  // 3. Track each parcel with diff detection
  const results: TrackingResult[] = [];
  const changedResults: TrackingResult[] = [];

  for (const parcel of parcels) {
    const result = await fetchPakistanPostTracking(parcel.id, parcel.label);
    results.push(result);

    const currentSig = computeTrackingSignature(result);
    const lastSig = await getLastParcelSignature(parcel.id);

    const isChanged = forcePush || !lastSig || lastSig !== currentSig;
    if (isChanged) {
      result.isUpdated = true;
      changedResults.push(result);
      // Persist the updated signature so future runs only trigger on new events
      await saveLastParcelSignature(parcel.id, currentSig);
    }

    // 500ms delay between consecutive queries
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // 4. Send notification to Discord ONLY for parcels that actually changed
  let discordResult: { success: boolean; error?: string; count: number; message?: string } = {
    success: false,
    count: 0,
    message: 'Notification skipped'
  };

  if (shouldNotify) {
    if (changedResults.length > 0) {
      const res = await sendDiscordNotification(changedResults);
      discordResult = {
        success: res.success,
        error: res.error,
        count: res.count,
        message: res.success
          ? `Dispatched alert for ${res.count} updated parcel(s)`
          : res.error || 'Failed to dispatch alert'
      };
    } else {
      discordResult = {
        success: true,
        count: 0,
        message: 'Diff detection: 0 parcels advanced. Discord notification suppressed.'
      };
    }
  }

  const deliveredCount = results.filter((r) => r.statusCategory === 'DELIVERED').length;
  const inTransitCount = results.filter((r) => r.statusCategory === 'IN_TRANSIT').length;

  return NextResponse.json({
    status: 'success',
    checkedAt: new Date().toISOString(),
    totalParcels: results.length,
    changedParcelsCount: changedResults.length,
    diffDetection: {
      enabled: true,
      forced: forcePush,
      suppressed: changedResults.length === 0 && shouldNotify
    },
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
