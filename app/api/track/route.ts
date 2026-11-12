import { NextRequest, NextResponse } from 'next/server';
import { fetchPakistanPostTracking } from '@/lib/pakpost';
import { getParcelByAliasOrId, getTrackedParcels, checkRateLimit } from '@/lib/config';
import { maskTrackingId } from '@/lib/crypto';
import { TrackingResult } from '@/lib/types';

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

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

async function resolveAndTrack(
  request: NextRequest,
  params: {
    alias?: string | null;
    id?: string | null;
    label?: string;
    refresh?: boolean;
  }
): Promise<{
  status: number;
  body: TrackingResult | { error: string; retryAfter?: number };
  headers: Record<string, string>;
}> {
  const clientIp = getClientIp(request);
  const isRefresh = Boolean(params.refresh);

  // Enforce stricter limit on live cache-bypassing refreshes (10/min), generous limit on reads (60/min)
  const [readLimit, refreshLimit] = await Promise.all([
    checkRateLimit('track_read', clientIp, 60, 60),
    isRefresh ? checkRateLimit('track_refresh', clientIp, 10, 60) : Promise.resolve(null)
  ]);

  const blocked =
    refreshLimit && !refreshLimit.allowed
      ? refreshLimit
      : !readLimit.allowed
        ? readLimit
        : null;

  if (blocked) {
    return {
      status: 429,
      body: {
        error: `Rate limit exceeded. Try again in ${blocked.retryAfter}s.`,
        retryAfter: blocked.retryAfter
      },
      headers: {
        'Retry-After': String(blocked.retryAfter),
        'X-RateLimit-Limit': String(blocked.limit),
        'X-RateLimit-Remaining': '0'
      }
    };
  }

  const activeLimit = refreshLimit || readLimit;
  const rateHeaders = {
    'X-RateLimit-Limit': String(activeLimit.limit),
    'X-RateLimit-Remaining': String(activeLimit.remaining)
  };

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
    return {
      status: 400,
      body: { error: 'Tracking ID or alias is required' },
      headers: rateHeaders
    };
  }

  // Run watchlist check + tracking lookup concurrently
  const [allTracked, rawResult] = await Promise.all([
    isTracked ? Promise.resolve(null) : getTrackedParcels(),
    fetchPakistanPostTracking(targetId, targetLabel, { bypassCache: isRefresh })
  ]);

  if (!isTracked && allTracked?.some((p) => p.id.toUpperCase() === targetId)) {
    isTracked = true;
  }

  return { status: 200, body: sanitizeResult(rawResult, targetId, isTracked), headers: rateHeaders };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const { status, body, headers } = await resolveAndTrack(request, {
    alias: searchParams.get('alias'),
    id: searchParams.get('id'),
    label: searchParams.get('label') || undefined,
    refresh: searchParams.get('refresh') === 'true'
  });

  return NextResponse.json(body, { status, headers });
}

export async function POST(request: NextRequest) {
  try {
    const reqBody = await request.json();
    const { status, body, headers } = await resolveAndTrack(request, {
      alias: reqBody.alias,
      id: reqBody.id,
      label: reqBody.label,
      refresh: reqBody.refresh === true
    });

    return NextResponse.json(body, { status, headers });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request' },
      { status: 400 }
    );
  }
}
