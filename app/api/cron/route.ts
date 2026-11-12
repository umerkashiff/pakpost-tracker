import { NextRequest, NextResponse } from 'next/server';
import {
  getTrackedParcels,
  getLastParcelSignature,
  getParcelAlertState,
  saveParcelAlertState,
  getCachedTrackingResult,
  evaluateParcelProgression
} from '@/lib/config';
import { fetchPakistanPostTracking } from '@/lib/pakpost';
import { sendDiscordNotification } from '@/lib/discord';
import { safeCompare } from '@/lib/crypto';
import { TrackingResult } from '@/lib/types';

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current]);
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => runNext()));
  return results;
}

async function handleCheck(request: NextRequest) {
  // 1. Verify Authorization if CRON_SECRET is configured
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const authHeader = (request.headers.get('authorization') || '').trim();
    const querySecret = (request.nextUrl.searchParams.get('secret') || '').trim();
    const isAuthorized =
      (authHeader.startsWith('Bearer ') && safeCompare(authHeader.slice(7).trim(), cronSecret)) ||
      (querySecret.length > 0 && safeCompare(querySecret, cronSecret));

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

  // 3. Track parcels concurrently (pool size 4) with monotonic diff detection
  const checkedItems = await runWithConcurrency(parcels, 4, async (parcel) => {
    const [prevState, legacySig] = await Promise.all([
      getParcelAlertState(parcel.id),
      getLastParcelSignature(parcel.id)
    ]);

    // Terminal DELIVERED parcels no longer move; reuse cached snapshot without re-scraping
    if (prevState?.lastStatusCategory === 'DELIVERED' && !forcePush) {
      const cached = await getCachedTrackingResult(parcel.id);
      if (cached) {
        return { result: { ...cached, label: parcel.label ?? cached.label }, changed: false };
      }
    }

    const result = await fetchPakistanPostTracking(parcel.id, parcel.label, { bypassCache: true });
    const progression = evaluateParcelProgression(result, prevState, legacySig);
    const isChanged = forcePush || progression.shouldAlert;

    if (isChanged) {
      result.isUpdated = true;
    }

    if (progression.nextState && (progression.stateDirty || forcePush)) {
      await saveParcelAlertState(parcel.id, progression.nextState);
    }

    return { result, changed: isChanged };
  });

  const results: TrackingResult[] = checkedItems.map((item) => item.result);
  const changedResults: TrackingResult[] = checkedItems
    .filter((item) => item.changed)
    .map((item) => item.result);

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
