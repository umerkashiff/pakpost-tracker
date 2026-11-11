import { TrackingEvent, StatusCategory } from './types';
import { createTracker } from 'universal-parcel-scraper/node';

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

function parseTimestamp(raw?: string): { date: string; time: string; timestamp: number } {
  if (!raw) {
    return { date: 'N/A', time: '', timestamp: 0 };
  }

  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      return {
        date: `${year}-${month}-${day}`,
        time: `${hours}:${mins}`,
        timestamp: d.getTime()
      };
    }
  } catch {
    // fallback
  }

  const clean = raw.trim();
  const datePart = clean.slice(0, 10);
  const timePart = clean.length >= 16 ? clean.slice(11, 16) : '';
  return { date: datePart || 'N/A', time: timePart, timestamp: 0 };
}

function mapStageToCategory(stage?: string, text?: string): StatusCategory {
  const combined = `${stage || ''} ${text || ''}`.toLowerCase();
  if (combined.includes('deliver') && !combined.includes('undelivered')) {
    return 'DELIVERED';
  }
  if (combined.includes('fail') || combined.includes('missed') || combined.includes('exception')) {
    return 'ATTEMPT_FAILED';
  }
  if (combined.includes('transit') || combined.includes('transport') || combined.includes('center') || combined.includes('departure') || combined.includes('arrival')) {
    return 'IN_TRANSIT';
  }
  if (combined.includes('accept') || combined.includes('registered') || combined.includes('pre-advise') || combined.includes('warehouse')) {
    return 'BOOKED';
  }
  return 'IN_TRANSIT';
}

/**
 * Fetch tracking info from Cainiao Global endpoint (open JSON API for AliExpress/China)
 */
async function fetchCainiaoFallback(trackingNo: string): Promise<UpstreamTrackingResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`https://global.cainiao.com/global/detail.json?mailNos=${encodeURIComponent(trackingNo)}&lang=en-US`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const moduleItem = data?.module?.[0];
    const detailList = moduleItem?.detailList;

    if (Array.isArray(detailList) && detailList.length > 0) {
      const events: TrackingEvent[] = detailList.map((item: { time?: string; desc?: string; status?: string }) => {
        const { date, time, timestamp } = parseTimestamp(item.time);
        return {
          date,
          time,
          location: 'Origin / Transit Hub',
          status: item.desc || item.status || 'Active checkpoint',
          carrier: 'Cainiao Global (AliExpress)',
          timestamp
        };
      });

      // Sort chronological
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
    // ignore Cainiao fallback failure
  }
  return null;
}

/**
 * Fetch upstream tracking from universal-parcel-scraper or direct open APIs
 */
export async function fetchUpstreamTracking(rawId: string): Promise<UpstreamTrackingResult | null> {
  const cleanId = rawId.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleanId || cleanId.endsWith('PK')) {
    // Pure domestic Pakistan Post parcel
    return null;
  }

  // 1. Detect country from standard UPU S10 suffix (e.g. LT880952265NL -> NL)
  const isS10 = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(cleanId);
  const countryCode = isS10 ? cleanId.slice(-2) : undefined;
  const originCountry = countryCode ? (COUNTRY_NAMES[countryCode] || countryCode) : 'International';

  // 2. Query universal-parcel-scraper with multi-carrier providers (12s timeout)
  try {
    const tracker = createTracker({
      providers: ['UPU', 'Postal Ninja', 'Ship24', 'ParcelsApp']
    });

    const trackPromise = tracker.track({ number: cleanId });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Upstream carrier timeout')), 12000)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scrapeResult = (await Promise.race([trackPromise, timeoutPromise])) as any;

    if (scrapeResult && scrapeResult.result && Array.isArray(scrapeResult.result.events) && scrapeResult.result.events.length > 0) {
      const carrierId = scrapeResult.carrier || (countryCode === 'NL' ? 'spring-gds' : 'upstream');
      const carrierName = CARRIER_NAMES[carrierId] || scrapeResult.carrier || `${originCountry} Post`;

      // universal-parcel-scraper returns events with { time, location, description, stage }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: TrackingEvent[] = scrapeResult.result.events.map((ev: any) => {
        const { date, time, timestamp } = parseTimestamp(ev.time || ev.instant);
        return {
          date,
          time,
          location: ev.location || originCountry,
          status: ev.description || ev.stage || 'In Transit',
          carrier: carrierName,
          timestamp
        };
      });

      // Sort chronological (oldest first)
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
    // If universal-parcel-scraper fails or times out, try Cainiao fallback if relevant
    if (countryCode === 'CN' || cleanId.startsWith('LP')) {
      const cainiao = await fetchCainiaoFallback(cleanId);
      if (cainiao) return cainiao;
    }
  }

  // 3. Fallback for China/AliExpress
  if (countryCode === 'CN' || cleanId.startsWith('LP')) {
    const cainiao = await fetchCainiaoFallback(cleanId);
    if (cainiao) return cainiao;
  }

  return null;
}
