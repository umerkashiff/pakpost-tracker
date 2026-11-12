import * as cheerio from 'cheerio';
import {
  TrackingResult,
  TrackingEvent,
  StatusCategory,
  ParcelRouteProfile,
  ParcelSourceSnapshot,
  UpstreamProviderRoute
} from './types';
import { fetchUpstreamTracking, UpstreamTrackingResult } from './upstream';
import {
  getParcelSnapshot,
  saveParcelSnapshot,
  getCachedTrackingResult,
  saveCachedTrackingResult
} from './config';

function parseEmttsTimestamp(dateStr: string, timeStr: string): number {
  if (!dateStr) return 0;
  const parsed = new Date(`${dateStr} ${timeStr || '00:00'} GMT+0500`);
  if (!isNaN(parsed.getTime())) return parsed.getTime();
  const fallback = new Date(dateStr);
  return !isNaN(fallback.getTime()) ? fallback.getTime() : 0;
}

function normalizeStatus(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Intelligently merge upstream international checkpoints with Pakistan Post EMTTS records:
 * - Drops undated ("N/A") noise events from universal scrapers
 * - Deduplicates identical or synonymous export EDI records
 * - Sorts all events strictly chronologically (oldest first, newest last)
 */
function mergeAndDeduplicateEvents(
  upstreamEvents: TrackingEvent[],
  emttsEvents: TrackingEvent[]
): TrackingEvent[] {
  const result: TrackingEvent[] = [...emttsEvents];
  const seenEmttsStatuses = new Set<string>();
  const seenUpstreamDayKeys = new Set<string>();
  const emttsDispatchDates = new Set<string>();

  for (const ev of emttsEvents) {
    const norm = normalizeStatus(ev.status);
    seenEmttsStatuses.add(norm);
    if (norm.includes('senditemtodestinationcountry')) {
      emttsDispatchDates.add(ev.date.toLowerCase());
    }
  }

  for (const uEv of upstreamEvents) {
    // 1. Drop undated noise
    if (!uEv.date || uEv.date === 'N/A' || !uEv.timestamp || uEv.timestamp <= 0) {
      continue;
    }

    const norm = normalizeStatus(uEv.status);

    // 2. Drop exact status duplicates already tracked by EMTTS
    if (seenEmttsStatuses.has(norm)) {
      continue;
    }

    // 3. Deduplicate UPU outward dispatch synonym on the exact same calendar day
    if (
      (norm.includes('departurefromoutwardofficeofexchange') ||
        norm.includes('shipmentisreadyfortransporttothecountryofdestination')) &&
      emttsDispatchDates.has(uEv.date.toLowerCase())
    ) {
      continue;
    }

    // 4. Deduplicate within upstream on same day + status
    const dayKey = `${norm}__${uEv.date.toLowerCase()}`;
    if (seenUpstreamDayKeys.has(dayKey)) {
      continue;
    }

    seenUpstreamDayKeys.add(dayKey);
    result.push(uEv);
  }

  // Chronological sort (oldest first -> latest last)
  result.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return result;
}

function determineStatusCategory(latestEvent: TrackingEvent | null, found: boolean): StatusCategory {
  if (!found || !latestEvent) {
    return 'PENDING';
  }

  const text = `${latestEvent.status} ${latestEvent.location}`.toLowerCase();

  if (
    text.includes('deliver item in destination country') ||
    text.includes('item delivered') ||
    text.includes('delivered to addressee') ||
    text.includes('delivered')
  ) {
    return 'DELIVERED';
  }

  if (text.includes('unsuccessful') || text.includes('failed attempt') || text.includes('missed')) {
    return 'ATTEMPT_FAILED';
  }

  if (
    text.includes('origin country') ||
    text.includes('booking') ||
    text.includes('booked') ||
    text.includes('acceptance')
  ) {
    return 'BOOKED';
  }

  return 'IN_TRANSIT';
}

interface EmttsFetchResult {
  ok: boolean;
  parsedTrackingNo: string;
  origin: string;
  destination: string;
  foundOnEmtts: boolean;
  events: TrackingEvent[];
  error?: string;
}

async function fetchEmttsOnce(trackingNo: string, timeoutMs = 11000): Promise<EmttsFetchResult> {
  const url = `https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=${encodeURIComponent(trackingNo)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-cache'
      },
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`Pakistan Post server returned HTTP ${res.status}`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const parsedTrackingNo = $('#LblArticleTrackingNo').text().trim() || trackingNo;
    const origin = $('#LblBookingOffice').text().trim() || 'N/A';
    const destination = $('#LblDeliveryOffice').text().trim() || 'N/A';

    const rawEvents: TrackingEvent[] = [];
    let currentDate = '';

    $('#TrackDetailDiv tr').each((_, el) => {
      const dateEl = $(el).find('.date-heading');
      if (dateEl.length > 0) {
        currentDate = dateEl.text().replace(/\s+/g, ' ').trim();
        return;
      }

      const time = $(el).find('.time').text().replace(/\s+/g, ' ').trim();
      if (time) {
        const location = $(el).find('b').first().text().replace(/\s+/g, ' ').trim();
        const tds = $(el).find('td');
        const status = tds.length >= 4 ? $(tds[3]).text().replace(/\s+/g, ' ').trim() : '';

        if (status || location) {
          rawEvents.push({
            date: currentDate,
            time,
            location,
            status
          });
        }
      }
    });

    const events: TrackingEvent[] = rawEvents.map((ev) => ({
      ...ev,
      carrier: 'Pakistan Post',
      timestamp: parseEmttsTimestamp(ev.date, ev.time)
    }));

    const validDestination =
      destination !== 'N/A' && destination !== '' && destination.toLowerCase() !== 'n/a';

    return {
      ok: true,
      parsedTrackingNo,
      origin,
      destination,
      foundOnEmtts: events.length > 0 || validDestination,
      events
    };
  } catch (err) {
    return {
      ok: false,
      parsedTrackingNo: trackingNo,
      origin: 'N/A',
      destination: 'N/A',
      foundOnEmtts: false,
      events: [],
      error: err instanceof Error ? err.message : 'Failed to reach Pakistan Post server'
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchEmttsWithRetry(
  trackingNo: string,
  options?: { timeoutMs?: number; allowRetry?: boolean }
): Promise<EmttsFetchResult> {
  const timeoutMs = options?.timeoutMs ?? 11000;
  const first = await fetchEmttsOnce(trackingNo, timeoutMs);
  if (first.ok || options?.allowRetry === false) return first;
  await new Promise((resolve) => setTimeout(resolve, 500));
  return fetchEmttsOnce(trackingNo, timeoutMs);
}

/**
 * Union historical + live events from the same source so intermittent omissions never shrink history.
 */
function unionSourceEvents(previous: TrackingEvent[], incoming: TrackingEvent[]): TrackingEvent[] {
  if (previous.length === 0) return incoming;
  if (incoming.length === 0) return previous;

  const byKey = new Map<string, TrackingEvent>();
  const keyOf = (ev: TrackingEvent) =>
    `${normalizeStatus(ev.status)}__${(ev.date || '').trim().toLowerCase()}`;

  for (const ev of previous) {
    byKey.set(keyOf(ev), ev);
  }
  for (const ev of incoming) {
    byKey.set(keyOf(ev), ev);
  }

  return Array.from(byKey.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

function hasDomesticScanEvent(events: TrackingEvent[]): boolean {
  return events.some((e) => {
    const s = (e.status || '').toLowerCase();
    const loc = (e.location || '').toLowerCase();
    return (
      s.includes('receive item at office of exchange') ||
      s.includes('received at') ||
      s.includes('arrival at destination') ||
      s.includes('dispatched to') ||
      s.includes('delivered') ||
      loc.includes('karachi') ||
      loc.includes('lahore') ||
      loc.includes('islamabad') ||
      loc.includes('rawalpindi') ||
      loc.includes('peshawar') ||
      loc.includes('quetta') ||
      loc.includes('o.e.')
    );
  });
}

export async function fetchPakistanPostTracking(
  rawId: string,
  label?: string,
  options?: { bypassCache?: boolean }
): Promise<TrackingResult> {
  const trackingNo = rawId.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!trackingNo) {
    return {
      trackingNo: rawId,
      label,
      origin: 'N/A',
      destination: 'N/A',
      found: false,
      statusCategory: 'ERROR',
      latestEvent: null,
      totalEvents: 0,
      events: [],
      lastChecked: new Date().toISOString(),
      error: 'Invalid Tracking ID format'
    };
  }

  // Fast-path: check full-result Redis cache + prior snapshot concurrently
  const [cachedResult, prevSnapshot] = await Promise.all([
    !options?.bypassCache ? getCachedTrackingResult(trackingNo) : Promise.resolve(null),
    getParcelSnapshot(trackingNo)
  ]);

  if (cachedResult && cachedResult.found) {
    return {
      ...cachedResult,
      label: label ?? cachedResult.label
    };
  }

  // Skip origin upstream query once domestic leg is already active and origin events are preserved
  const originAlreadyHandedOff = Boolean(
    prevSnapshot?.emttsEvents?.length &&
      hasDomesticScanEvent(prevSnapshot.emttsEvents) &&
      prevSnapshot?.upstreamEvents?.length
  );

  const hasSavedEmtts = Boolean(prevSnapshot?.emttsEvents?.length);

  // Run destination + upstream lookups concurrently with adaptive timeouts
  const [emttsResult, upstream] = await Promise.all([
    fetchEmttsWithRetry(trackingNo, {
      timeoutMs: hasSavedEmtts ? 9000 : 11000,
      allowRetry: !hasSavedEmtts
    }),
    originAlreadyHandedOff
      ? Promise.resolve(null)
      : fetchUpstreamTracking(trackingNo, options).catch((err): UpstreamTrackingResult | null => {
          console.error('Error fetching upstream tracking:', err);
          return null;
        })
  ]);

  let usedCachedEmtts = false;
  let effectiveEmttsEvents = emttsResult.events;
  let origin = emttsResult.origin;
  let destination = emttsResult.destination;
  let found = emttsResult.foundOnEmtts;

  if (emttsResult.ok) {
    if (prevSnapshot?.emttsEvents?.length) {
      effectiveEmttsEvents = unionSourceEvents(prevSnapshot.emttsEvents, emttsResult.events);
      found = found || effectiveEmttsEvents.length > 0;
      if (origin === 'N/A' && prevSnapshot.emttsOrigin && prevSnapshot.emttsOrigin !== 'N/A') {
        origin = prevSnapshot.emttsOrigin;
      }
      if (
        destination === 'N/A' &&
        prevSnapshot.emttsDestination &&
        prevSnapshot.emttsDestination !== 'N/A'
      ) {
        destination = prevSnapshot.emttsDestination;
      }
    }
  } else if (prevSnapshot?.emttsEvents?.length) {
    // EMTTS had a transient outage: retain last confirmed Pakistan Post scans instead of dropping them
    effectiveEmttsEvents = prevSnapshot.emttsEvents;
    origin = prevSnapshot.emttsOrigin || origin;
    destination = prevSnapshot.emttsDestination || destination;
    found = true;
    usedCachedEmtts = true;
  }

  // Resolve effective upstream manifest while rejecting downgraded fallback overrides
  let usedCachedUpstream = false;
  let effectiveUpstreamEvents: TrackingEvent[] = [];
  let upstreamCarrierId: string | undefined;
  let upstreamCarrier: string | undefined;
  let upstreamOriginCountry: string | undefined;
  let upstreamRoute: UpstreamProviderRoute | undefined;

  const liveUpstreamValid = Boolean(upstream && upstream.found && upstream.events.length > 0);
  const downgradedOverSpringGds =
    liveUpstreamValid &&
    upstream?.upstreamRoute === 'postnl-consumer' &&
    prevSnapshot?.upstreamRoute === 'spring-gds' &&
    (prevSnapshot.upstreamEvents?.length || 0) > 0;

  if (liveUpstreamValid && upstream && !downgradedOverSpringGds) {
    const sameAuthoritativeRoute =
      prevSnapshot?.upstreamRoute === upstream.upstreamRoute &&
      (prevSnapshot.upstreamEvents?.length || 0) > 0;
    effectiveUpstreamEvents = sameAuthoritativeRoute && prevSnapshot
      ? unionSourceEvents(prevSnapshot.upstreamEvents, upstream.events)
      : upstream.events;
    upstreamCarrierId = upstream.carrierId;
    upstreamCarrier = upstream.carrierName;
    upstreamOriginCountry = upstream.originCountry;
    upstreamRoute = upstream.upstreamRoute;
  } else if (prevSnapshot?.upstreamEvents?.length) {
    effectiveUpstreamEvents = prevSnapshot.upstreamEvents;
    upstreamCarrierId = prevSnapshot.upstreamCarrierId;
    upstreamCarrier = prevSnapshot.upstreamCarrierName;
    upstreamOriginCountry = prevSnapshot.upstreamOriginCountry;
    upstreamRoute = prevSnapshot.upstreamRoute;
    usedCachedUpstream = true;
  }

  let handoffStatus: 'UPSTREAM_TRANSIT' | 'HANDED_OFF_DOMESTIC' | 'DOMESTIC_ONLY' =
    trackingNo.endsWith('PK') ? 'DOMESTIC_ONLY' : 'UPSTREAM_TRANSIT';

  let mergedEvents = effectiveEmttsEvents;
  let finalOrigin = origin === 'N/A' && !found ? 'Not Available' : origin;
  let finalDestination = destination === 'N/A' && !found ? 'Not Available' : destination;

  if (effectiveUpstreamEvents.length > 0) {
    finalOrigin =
      finalOrigin === 'Not Available' || finalOrigin === 'N/A'
        ? upstreamOriginCountry || 'International'
        : upstreamOriginCountry &&
            !finalOrigin.toLowerCase().includes(upstreamOriginCountry.toLowerCase())
          ? `${upstreamOriginCountry} (${finalOrigin})`
          : finalOrigin;

    if (finalDestination === 'Not Available' || finalDestination === 'N/A') {
      finalDestination = 'Pakistan';
    }

    if (effectiveEmttsEvents.length === 0) {
      mergedEvents = effectiveUpstreamEvents;
      found = true;
      handoffStatus = 'UPSTREAM_TRANSIT';
    } else {
      mergedEvents = mergeAndDeduplicateEvents(effectiveUpstreamEvents, effectiveEmttsEvents);
      found = true;
      handoffStatus = hasDomesticScanEvent(effectiveEmttsEvents)
        ? 'HANDED_OFF_DOMESTIC'
        : 'UPSTREAM_TRANSIT';
    }
  } else if (!emttsResult.ok && effectiveEmttsEvents.length === 0) {
    return {
      trackingNo,
      label,
      origin: 'N/A',
      destination: 'N/A',
      found: false,
      statusCategory: 'ERROR',
      latestEvent: null,
      totalEvents: 0,
      events: [],
      lastChecked: new Date().toISOString(),
      sourceHealth: {
        emttsOk: false,
        upstreamOk: false
      },
      error: emttsResult.error || 'Failed to reach Pakistan Post server'
    };
  }

  // Save updated monotonic snapshot whenever any live source succeeded
  if ((emttsResult.ok || liveUpstreamValid) && (effectiveEmttsEvents.length > 0 || effectiveUpstreamEvents.length > 0)) {
    const nowIso = new Date().toISOString();
    const updatedSnapshot: ParcelSourceSnapshot = {
      emttsEvents: effectiveEmttsEvents,
      emttsOrigin: emttsResult.ok ? emttsResult.origin : prevSnapshot?.emttsOrigin,
      emttsDestination: emttsResult.ok ? emttsResult.destination : prevSnapshot?.emttsDestination,
      emttsUpdatedAt: emttsResult.ok ? nowIso : prevSnapshot?.emttsUpdatedAt,
      upstreamEvents: effectiveUpstreamEvents,
      upstreamCarrierId,
      upstreamCarrierName: upstreamCarrier,
      upstreamOriginCountry,
      upstreamRoute,
      upstreamUpdatedAt: liveUpstreamValid && !downgradedOverSpringGds ? nowIso : prevSnapshot?.upstreamUpdatedAt
    };
    await saveParcelSnapshot(trackingNo, updatedSnapshot);
  }

  const latestEvent = mergedEvents.length > 0 ? mergedEvents[mergedEvents.length - 1] : null;
  const statusCategory = determineStatusCategory(latestEvent, found);

  const routeProfile: ParcelRouteProfile | undefined = upstreamRoute
    ? {
        carrierId: upstreamCarrierId || 'upstream',
        carrierName: upstreamCarrier || 'International',
        upstreamRoute,
        originCountry: upstreamOriginCountry,
        pinnedAt: new Date().toISOString()
      }
    : trackingNo.endsWith('PK')
      ? {
          carrierId: 'pakistan-post',
          carrierName: 'Pakistan Post',
          upstreamRoute: 'domestic-emtts',
          originCountry: 'Pakistan',
          countryCode: 'PK',
          pinnedAt: new Date().toISOString()
        }
      : undefined;

  const finalResult: TrackingResult = {
    trackingNo: emttsResult.parsedTrackingNo || trackingNo,
    label,
    origin: finalOrigin,
    destination: finalDestination,
    found,
    statusCategory,
    latestEvent,
    totalEvents: mergedEvents.length,
    events: mergedEvents,
    lastChecked: new Date().toISOString(),
    upstreamCarrier,
    handoffStatus,
    routeProfile,
    sourceHealth: {
      emttsOk: emttsResult.ok,
      upstreamOk: originAlreadyHandedOff || Boolean(upstream?.found && !downgradedOverSpringGds),
      usedCachedEmtts,
      usedCachedUpstream
    }
  };

  if (finalResult.found && finalResult.events.length > 0) {
    await saveCachedTrackingResult(trackingNo, finalResult);
  }

  return finalResult;
}

