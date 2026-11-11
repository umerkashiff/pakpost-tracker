import { TrackingEvent, StatusCategory } from './types';
import { createTracker } from 'universal-parcel-scraper/node';
import { getRedis } from './redis';

// Friendly carrier name map
const CARRIER_NAMES: Record<string, string> = {
  'spring-gds': 'PostNL (Spring GDS)',
  'postnl': 'PostNL International',
  'cainiao': 'Cainiao Global (AliExpress)',
  'china-post': 'China Post',
  'singpost': 'Singapore Post (SingPost)',
  'usps': 'United States Postal Service (USPS)',
  'royal-mail': 'Royal Mail (UK)',
  'deutsche-post': 'Deutsche Post (DHL Group)',
  'dhl': 'DHL Express / eCommerce',
  'fedex': 'FedEx International',
  'ups': 'UPS International',
  'emirates-post': 'Emirates Post',
  'ptt-post': 'PTT Turkish Post',
  'japan-post': 'Japan Post',
  'hongkong-post': 'Hong Kong Post',
  'malaysia-post': 'Pos Malaysia',
  'canada-post': 'Canada Post',
  'australia-post': 'Australia Post'
};

// ISO country suffix to origin country name
const COUNTRY_NAMES: Record<string, string> = {
  NL: 'Netherlands',
  CN: 'China',
  SG: 'Singapore',
  US: 'United States',
  GB: 'United Kingdom',
  DE: 'Germany',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  TR: 'Turkey',
  JP: 'Japan',
  HK: 'Hong Kong',
  MY: 'Malaysia',
  CA: 'Canada',
  AU: 'Australia',
  FR: 'France',
  IT: 'Italy',
  ES: 'Spain',
  SE: 'Sweden',
  CH: 'Switzerland',
  TH: 'Thailand',
  KR: 'South Korea'
};

export interface UpstreamTrackingResult {
  found: boolean;
  carrierId: string;
  carrierName: string;
  originCountry: string;
  events: TrackingEvent[];
  latestEvent: TrackingEvent | null;
  statusCategory: StatusCategory;
}

/**
 * Format any valid ISO/timestamp into consistent PKT readable date & time matching EMTTS
 */
function parseTimestamp(raw?: string): { date: string; time: string; timestamp: number } {
  if (!raw || !raw.trim() || raw.trim().toUpperCase() === 'N/A') {
    return { date: '', time: '', timestamp: 0 };
  }

  try {
    const d = new Date(raw.trim());
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      const date = d.toLocaleDateString('en-US', {
        timeZone: 'Asia/Karachi',
        month: 'long',
        day: '2-digit',
        year: 'numeric'
      });
      const time = d.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Karachi',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      return {
        date,
        time,
        timestamp: d.getTime()
      };
    }
  } catch {
    // fallback
  }

  return { date: '', time: '', timestamp: 0 };
}

function mapStageToCategory(stage?: string, text?: string): StatusCategory {
  const combined = `${stage || ''} ${text || ''}`.toLowerCase();
  if (combined.includes('deliver') && !combined.includes('undelivered')) {
    return 'DELIVERED';
  }
  if (combined.includes('fail') || combined.includes('missed') || combined.includes('exception')) {
    return 'ATTEMPT_FAILED';
  }
  if (
    combined.includes('transit') ||
    combined.includes('transport') ||
    combined.includes('center') ||
    combined.includes('departure') ||
    combined.includes('arrival') ||
    combined.includes('crossed the border')
  ) {
    return 'IN_TRANSIT';
  }
  if (
    combined.includes('accept') ||
    combined.includes('registered') ||
    combined.includes('pre-advise') ||
    combined.includes('warehouse') ||
    combined.includes('received by')
  ) {
    return 'BOOKED';
  }
  return 'IN_TRANSIT';
}

/**
 * PostNL Official Consumer API (non-PII observations only).
 * Used cleanly if postnl.post hits shared-IP quota limits.
 */
async function fetchPostNLConsumerObservations(trackingNo: string): Promise<UpstreamTrackingResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(
      `https://jouw.postnl.nl/track-and-trace/api/trackAndTrace/${encodeURIComponent(trackingNo)}-PK?language=en`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        signal: controller.signal
      }
    );
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const shipment = data?.colli?.[trackingNo];
    const observations = shipment?.observations;

    const events: TrackingEvent[] = [];
    if (Array.isArray(observations)) {
      for (const obs of observations) {
        const { date, time, timestamp } = parseTimestamp(obs?.observationDate);
        if (timestamp > 0 && obs?.description) {
          events.push({
            date,
            time,
            location: 'Netherlands (PostNL)',
            status: String(obs.description).trim(),
            carrier: 'PostNL (Spring GDS)',
            timestamp
          });
        }
      }
    }

    if (events.length === 0) return null;

    events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const latest = events[events.length - 1] || null;

    return {
      found: true,
      carrierId: 'spring-gds',
      carrierName: 'PostNL (Spring GDS)',
      originCountry: 'Netherlands',
      events,
      latestEvent: latest,
      statusCategory: mapStageToCategory(undefined, latest?.status)
    };
  } catch {
    return null;
  }
}

/**
 * Direct Cainiao Global JSON API for China / AliExpress shipments
 */
async function fetchCainiaoDirect(trackingNo: string): Promise<UpstreamTrackingResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(
      `https://global.cainiao.com/global/detail.json?mailNos=${encodeURIComponent(trackingNo)}&lang=en-US`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        signal: controller.signal
      }
    );
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const moduleItem = data?.module?.[0];
    const detailList = moduleItem?.detailList;

    if (Array.isArray(detailList) && detailList.length > 0) {
      const events: TrackingEvent[] = [];
      for (const item of detailList) {
        const { date, time, timestamp } = parseTimestamp(item.time);
        if (timestamp > 0) {
          events.push({
            date,
            time,
            location: 'Origin / Transit Hub',
            status: item.desc || item.status || 'Active checkpoint',
            carrier: 'Cainiao Global (AliExpress)',
            timestamp
          });
        }
      }

      if (events.length === 0) return null;

      events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      const latest = events[events.length - 1] || null;

      return {
        found: true,
        carrierId: 'cainiao',
        carrierName: 'Cainiao Global (AliExpress)',
        originCountry: 'China',
        events,
        latestEvent: latest,
        statusCategory: mapStageToCategory(undefined, latest?.status)
      };
    }
  } catch {
    // ignore Cainiao failure
  }
  return null;
}

/**
 * Query a deterministic carrier adapter via universal-parcel-scraper
 * (Defaulting to direct carrier adapter + UPU only; avoiding random 3rd-party flapping)
 */
async function queryUniversalScraper(
  cleanId: string,
  originCountry: string,
  countryCode: string | undefined,
  providers: ('UPU' | 'ParcelsApp')[]
): Promise<UpstreamTrackingResult | null> {
  try {
    const tracker = createTracker({ providers });

    const trackPromise = tracker.track({ number: cleanId });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Upstream carrier timeout')), 9000)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scrapeResult = (await Promise.race([trackPromise, timeoutPromise])) as any;

    if (scrapeResult && scrapeResult.result && Array.isArray(scrapeResult.result.events) && scrapeResult.result.events.length > 0) {
      const carrierId = scrapeResult.carrier || (countryCode === 'NL' ? 'spring-gds' : 'upstream');
      const carrierName = CARRIER_NAMES[carrierId] || scrapeResult.carrier || `${originCountry} Post`;

      const events: TrackingEvent[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const ev of scrapeResult.result.events) {
        const rawTime = ev.time || ev.instant || ev.local_time || ev.provider_time_text;
        const { date, time, timestamp } = parseTimestamp(rawTime);
        if (timestamp > 0 && date) {
          events.push({
            date,
            time,
            location: ev.location || originCountry,
            status: ev.description || ev.stage || 'In Transit',
            carrier: carrierName,
            timestamp
          });
        }
      }

      if (events.length === 0) return null;

      events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      const latest = events[events.length - 1] || null;

      return {
        found: true,
        carrierId,
        carrierName,
        originCountry,
        events,
        latestEvent: latest,
        statusCategory: mapStageToCategory(scrapeResult.result.current_stage || scrapeResult.result.status, latest?.status)
      };
    }
  } catch {
    // fallback handled by caller
  }
  return null;
}

/**
 * Deterministic Upstream Tracking Waterfall:
 * 1. Domestic (*PK) -> Skip upstream completely (EMTTS only)
 * 2. China / AliExpress (*CN / LP*) -> Cainiao Direct -> Direct/UPU adapter
 * 3. Netherlands (*NL) -> PostNL/Spring-GDS Direct -> PostNL Consumer API (no random flapping)
 * 4. Other International -> Direct Origin Carrier Adapter (+ UPU) -> ParcelsApp fallback only if empty
 */
export async function fetchUpstreamTracking(
  rawId: string,
  options?: { bypassCache?: boolean }
): Promise<UpstreamTrackingResult | null> {
  const cleanId = rawId.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleanId || cleanId.endsWith('PK')) {
    // Pure domestic Pakistan Post parcel
    return null;
  }

  // Check Redis cache (15 min TTL) for consistent manifest delivery & zero 429 rate-limits
  const cacheKey = `pakpost:cache:v3:upstream:${cleanId}`;
  const redis = getRedis();
  if (redis && !options?.bypassCache) {
    try {
      const cached = await redis.get<UpstreamTrackingResult>(cacheKey);
      if (cached && cached.found && Array.isArray(cached.events) && cached.events.length > 0) {
        return cached;
      }
    } catch {
      // non-fatal cache miss
    }
  }

  // Detect country from standard UPU S10 suffix (e.g. LT880952265NL -> NL)
  const isS10 = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(cleanId);
  const countryCode = isS10 ? cleanId.slice(-2) : undefined;
  const originCountry = countryCode ? (COUNTRY_NAMES[countryCode] || countryCode) : 'International';

  let result: UpstreamTrackingResult | null = null;

  if (countryCode === 'CN' || cleanId.startsWith('LP')) {
    // Stream 1: China / AliExpress -> Official Cainiao endpoint first
    result = await fetchCainiaoDirect(cleanId);
    if (!result) {
      result = await queryUniversalScraper(cleanId, originCountry, countryCode, ['UPU']);
    }
  } else if (countryCode === 'NL') {
    // Stream 2: Netherlands -> Direct Spring GDS / PostNL adapter first
    const directRes = await queryUniversalScraper(cleanId, originCountry, countryCode, ['UPU']);
    // If direct Spring GDS worked fully (> 3 events), use it cleanly
    if (directRes && directRes.events.length > 3) {
      result = directRes;
    } else {
      // Otherwise fallback deterministically to PostNL's official consumer observations API
      const consumerRes = await fetchPostNLConsumerObservations(cleanId);
      if (consumerRes && consumerRes.events.length > 0) {
        const merged = [...(directRes?.events || []), ...consumerRes.events];
        merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        result = {
          ...consumerRes,
          events: merged,
          latestEvent: merged[merged.length - 1] || consumerRes.latestEvent
        };
      } else {
        result = directRes;
      }
    }
  } else {
    // Stream 3: Other global postal networks (SG, US, GB, DE, AE, TR, etc.)
    // Use Direct Origin Carrier + UPU first; only fall back to ParcelsApp if completely empty
    result = await queryUniversalScraper(cleanId, originCountry, countryCode, ['UPU']);
    if (!result) {
      result = await queryUniversalScraper(cleanId, originCountry, countryCode, ['ParcelsApp']);
    }
  }

  // Persist authoritative manifest in Redis for 15 minutes
  if (result && result.found && result.events.length > 0 && redis) {
    try {
      await redis.set(cacheKey, result, { ex: 900 });
    } catch {
      // ignore cache write failure
    }
  }

  return result;
}
