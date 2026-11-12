import { NextRequest, NextResponse } from 'next/server';
import { fetchPakistanPostTracking } from '@/lib/pakpost';
import { getParcelByAliasOrId, getTrackedParcels } from '@/lib/config';
import { maskTrackingId } from '@/lib/crypto';
import { TrackingResult } from '@/lib/types';

function sanitizeResult(result: TrackingResult, realId: string, isTrackedParcel: boolean): TrackingResult {
  if (!isTrackedParcel) return result;

  const masked = maskTrackingId(realId);
  const regex = new RegExp(realId, 'gi');

  const sanitizedLatest = result.latestEvent
    ? {
        ...result.latestEvent,
        status: result.latestEvent.status.replace(regex, masked),
        location: result.latestEvent.location.replace(regex, masked)
      }
    : null;

  return {
    ...result,
    trackingNo: masked,
    latestEvent: sanitizedLatest,
    events: result.events.map((ev) => ({
      ...ev,
      status: ev.status.replace(regex, masked),
      location: ev.location.replace(regex, masked)
    }))
  };
}

async function resolveAndTrack(params: {
  alias?: string | null;
  id?: string | null;
  label?: string;
  refresh?: boolean;
}): Promise<{ status: number; body: TrackingResult | { error: string } }> {
  let targetId = (params.id || '').trim().toUpperCase();
  let targetLabel = params.label;
  let isTracked = false;

  if (params.alias) {
    const parcel = await getParcelByAliasOrId(params.alias);
    if (parcel) {
      targetId = parcel.id;
      targetLabel = parcel.label || targetLabel;
      isTracked = true;
    }
  }

  if (!targetId) {
    return { status: 400, body: { error: 'Tracking ID or alias is required' } };
  }

  // Run watchlist check + tracking lookup concurrently
  const [allTracked, rawResult] = await Promise.all([
    isTracked ? Promise.resolve(null) : getTrackedParcels(),
    fetchPakistanPostTracking(targetId, targetLabel, { bypassCache: Boolean(params.refresh) })
  ]);

  if (!isTracked && allTracked?.some((p) => p.id.toUpperCase() === targetId)) {
    isTracked = true;
  }

  return { status: 200, body: sanitizeResult(rawResult, targetId, isTracked) };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const { status, body } = await resolveAndTrack({
    alias: searchParams.get('alias'),
    id: searchParams.get('id'),
    label: searchParams.get('label') || undefined,
    refresh: searchParams.get('refresh') === 'true'
  });

  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  try {
    const reqBody = await request.json();
    const { status, body } = await resolveAndTrack({
      alias: reqBody.alias,
      id: reqBody.id,
      label: reqBody.label,
      refresh: reqBody.refresh === true
    });

    return NextResponse.json(body, { status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request' },
      { status: 400 }
    );
  }
}
