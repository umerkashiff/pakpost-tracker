import * as cheerio from 'cheerio';
import { TrackingResult, TrackingEvent, StatusCategory } from './types';
import { fetchUpstreamTracking } from './upstream';

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

  const url = `https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=${encodeURIComponent(trackingNo)}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

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

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Pakistan Post server returned HTTP ${res.status}`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const parsedTrackingNo = $('#LblArticleTrackingNo').text().trim() || trackingNo;
    const origin = $('#LblBookingOffice').text().trim() || 'N/A';
    const destination = $('#LblDeliveryOffice').text().trim() || 'N/A';

    const events: TrackingEvent[] = [];
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
          events.push({
            date: currentDate,
            time,
            location,
            status
          });
        }
      }
    });

    const hasEvents = events.length > 0;
    const validDestination = destination !== 'N/A' && destination !== '' && destination.toLowerCase() !== 'n/a';
    let found = hasEvents || validDestination;

    // Tag EMTTS events with Pakistan Post carrier and parse PKT timestamps
    const emttsEvents: TrackingEvent[] = events.map((ev) => ({
      ...ev,
      carrier: 'Pakistan Post',
      timestamp: parseEmttsTimestamp(ev.date, ev.time)
    }));

    // Fetch upstream multi-carrier handoff tracking
    let upstreamCarrier: string | undefined;
    let handoffStatus: 'UPSTREAM_TRANSIT' | 'HANDED_OFF_DOMESTIC' | 'DOMESTIC_ONLY' =
      trackingNo.endsWith('PK') ? 'DOMESTIC_ONLY' : 'UPSTREAM_TRANSIT';

    let mergedEvents = emttsEvents;
    let finalOrigin = origin === 'N/A' && !found ? 'Not Available' : origin;
    let finalDestination = destination === 'N/A' && !found ? 'Not Available' : destination;

    try {
      const upstream = await fetchUpstreamTracking(trackingNo, options);
      if (upstream && upstream.found && upstream.events.length > 0) {
        upstreamCarrier = upstream.carrierName;
        finalOrigin =
          finalOrigin === 'Not Available' || finalOrigin === 'N/A'
            ? upstream.originCountry
            : upstream.originCountry && !finalOrigin.toLowerCase().includes(upstream.originCountry.toLowerCase())
              ? `${upstream.originCountry} (${finalOrigin})`
              : finalOrigin;

        if (finalDestination === 'Not Available' || finalDestination === 'N/A') {
          finalDestination = 'Pakistan';
        }

        if (emttsEvents.length === 0) {
          // Pakistan Post hasn't scanned yet, display upstream international checkpoints
          mergedEvents = upstream.events;
          found = true;
          handoffStatus = 'UPSTREAM_TRANSIT';
        } else {
          // Intelligently combine & deduplicate upstream + Pakistan Post scans
          mergedEvents = mergeAndDeduplicateEvents(upstream.events, emttsEvents);
          // Check if any event represents physical domestic processing in Pakistan
          const hasDomesticScan = emttsEvents.some((e) => {
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
          handoffStatus = hasDomesticScan ? 'HANDED_OFF_DOMESTIC' : 'UPSTREAM_TRANSIT';
        }
      }
    } catch (err) {
      console.error('Error fetching upstream tracking:', err);
    }

    // The events are parsed in chronological order, so the last element is the latest checkpoint
    const latestEvent = mergedEvents.length > 0 ? mergedEvents[mergedEvents.length - 1] : null;
    const statusCategory = determineStatusCategory(latestEvent, found);

    return {
      trackingNo: parsedTrackingNo,
      label,
      origin: finalOrigin,
      destination: finalDestination,
      found,
      statusCategory,
      latestEvent,
      totalEvents: mergedEvents.length,
      events: mergedEvents,
      upstreamCarrier,
      handoffStatus,
      lastChecked: new Date().toISOString()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reach Pakistan Post server';

    // Even if Pakistan Post server fails or is unreachable, attempt upstream carrier directly
    try {
      const upstream = await fetchUpstreamTracking(trackingNo, options);
      if (upstream && upstream.found && upstream.events.length > 0) {
        return {
          trackingNo,
          label,
          origin: upstream.originCountry,
          destination: 'Pakistan',
          found: true,
          statusCategory: upstream.statusCategory,
          latestEvent: upstream.latestEvent,
          totalEvents: upstream.events.length,
          events: upstream.events,
          upstreamCarrier: upstream.carrierName,
          handoffStatus: 'UPSTREAM_TRANSIT',
          lastChecked: new Date().toISOString()
        };
      }
    } catch {
      // ignore
    }

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
      error: message
    };
  }
}

