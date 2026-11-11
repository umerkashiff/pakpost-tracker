import * as cheerio from 'cheerio';
import { TrackingResult, TrackingEvent, StatusCategory } from './types';

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
  label?: string
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
    const found = hasEvents || validDestination;

    // The events are parsed in chronological order, so the last element is the latest checkpoint
    const latestEvent = hasEvents ? events[events.length - 1] : null;
    const statusCategory = determineStatusCategory(latestEvent, found);

    return {
      trackingNo: parsedTrackingNo,
      label,
      origin: origin === 'N/A' && !found ? 'Not Available' : origin,
      destination: destination === 'N/A' && !found ? 'Not Available' : destination,
      found,
      statusCategory,
      latestEvent,
      totalEvents: events.length,
      events,
      lastChecked: new Date().toISOString()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reach Pakistan Post server';
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

