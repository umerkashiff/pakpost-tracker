import { NextRequest, NextResponse } from 'next/server';
import { fetchPakistanPostTracking } from '@/lib/pakpost';
import { getParcelByAliasOrId, getTrackedParcels } from '@/lib/config';
import { maskTrackingId } from '@/lib/crypto';
import { TrackingResult } from '@/lib/types';

function sanitizeResult(result: TrackingResult, realId: string, isTrackedParcel: boolean): TrackingResult {
  if (!isTrackedParcel) return result;

  const masked = maskTrackingId(realId);
  const regex = new RegExp(realId, 'gi');

  return {
    ...result,
    trackingNo: masked,
    events: result.events.map((ev) => ({
      ...ev,
      status: ev.status.replace(regex, masked),
      location: ev.location.replace(regex, masked)
    }))
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const alias = searchParams.get('alias');
  const id = searchParams.get('id');
  const label = searchParams.get('label') || undefined;

  let targetId = (id || '').trim().toUpperCase();
  let targetLabel = label;
  let isTracked = false;

  // 1. If alias is passed, look up secure parcel
  if (alias) {
    const parcel = await getParcelByAliasOrId(alias);
    if (parcel) {
      targetId = parcel.id;
      targetLabel = parcel.label || targetLabel;
      isTracked = true;
    }
  }

  if (!targetId) {
    return NextResponse.json(
      { error: 'Tracking ID or alias is required' },
      { status: 400 }
    );
  }

  // 2. Check if target ID belongs to owner's private tracked list
  if (!isTracked) {
    const allTracked = await getTrackedParcels();
    if (allTracked.some((p) => p.id.toUpperCase() === targetId)) {
      isTracked = true;
    }
  }

  const rawResult = await fetchPakistanPostTracking(targetId, targetLabel);
  const sanitized = sanitizeResult(rawResult, targetId, isTracked);

  return NextResponse.json(sanitized);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const alias = body.alias;
    let targetId = (body.id || '').trim().toUpperCase();
    let targetLabel = body.label;
    let isTracked = false;

    if (alias) {
      const parcel = await getParcelByAliasOrId(alias);
      if (parcel) {
        targetId = parcel.id;
        targetLabel = parcel.label || targetLabel;
        isTracked = true;
      }
    }

    if (!targetId) {
      return NextResponse.json(
        { error: 'Please provide "id" or "alias" in request body' },
        { status: 400 }
      );
    }

    if (!isTracked) {
      const allTracked = await getTrackedParcels();
      if (allTracked.some((p) => p.id.toUpperCase() === targetId)) {
        isTracked = true;
      }
    }

    const rawResult = await fetchPakistanPostTracking(targetId, targetLabel);
    const sanitized = sanitizeResult(rawResult, targetId, isTracked);

    return NextResponse.json(sanitized);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request' },
      { status: 400 }
    );
  }
}
