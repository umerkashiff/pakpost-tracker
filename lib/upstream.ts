import { TrackingEvent, StatusCategory, ParcelRouteProfile, UpstreamProviderRoute } from './types';
import { createTracker, type Tracker } from 'universal-parcel-scraper/node';
import { getRedis } from './redis';
import {
  getParcelRoute,
  saveParcelRoute,
  isRouteInCooldown,
  markRouteCooldown
} from './config';

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
  'australia-post': 'Australia Post',
  'la-poste': 'La Poste (France)',
  'poste-italiane': 'Poste Italiane',
  'correos-spain': 'Correos Spain',
  'postnord': 'PostNord',
  'swiss-post': 'Swiss Post',
  'singapore-post': 'Singapore Post (SingPost)',
  'pos-malaysia': 'Pos Malaysia',
  'ptt': 'PTT Turkish Post',
  'saudi-post': 'Saudi Post (SPL)',
  'thailand-post': 'Thailand Post',
  'korea-post': 'Korea Post',
  'india-post': 'India Post',
  'bangladesh-post': 'Bangladesh Post',
  'sri-lanka-post': 'Sri Lanka Post'
};

// Deterministic ISO S10 country suffix -> universal-parcel-scraper carrier adapter ID
const S10_CARRIER_MAP: Record<string, string> = {
  NL: 'spring-gds',
  GB: 'royal-mail',
  DE: 'deutsche-post',
  FR: 'la-poste',
  IT: 'poste-italiane',
  ES: 'correos-spain',
  CH: 'swiss-post',
  SE: 'postnord',
  DK: 'postnord',
  SG: 'singapore-post',
  US: 'usps',
  CN: 'china-post',
  HK: 'hongkong-post',
  JP: 'japan-post',
  MY: 'pos-malaysia',
  CA: 'canada-post',
  AU: 'australia-post',
  AE: 'emirates-post',
  SA: 'saudi-post',
  TR: 'ptt',
  TH: 'thailand-post',
  KR: 'korea-post',
  IN: 'india-post',
  BD: 'bangladesh-post',
  LK: 'sri-lanka-post'
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
  upstreamRoute: UpstreamProviderRoute;
  events: TrackingEvent[];
  latestEvent: TrackingEvent | null;
  statusCategory: StatusCategory;
}

// Module-scoped singleton trackers preserve carrier session state (e.g. PostNL visitor token)
let directTrackerSingleton: Tracker | null = null;
let fallbackTrackerSingleton: Tracker | null = null;

function getTrackerForProvider(provider: 'UPU' | 'ParcelsApp'): Tracker {
  if (provider === 'ParcelsApp') {
    if (!fallbackTrackerSingleton) {
      fallbackTrackerSingleton = createTracker({ providers: ['ParcelsApp'] });
    }
    return fallbackTrackerSingleton;
  }
  if (!directTrackerSingleton) {
    directTrackerSingleton = createTracker({ providers: ['UPU'] });
  }
  return directTrackerSingleton;
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
      upstreamRoute: 'postnl-consumer',
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
    const timeout = setTimeout(() => controller.abort(), 8000);

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
        upstreamRoute: 'cainiao-direct',
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
 * Query a deterministic carrier adapter via a shared singleton universal-parcel-scraper instance.
 * Reusing the tracker preserves PostNL visitor tokens and skips 10s recognition when carrier is explicit.
 */
async function queryUniversalScraper(
  cleanId: string,
  originCountry: string,
  countryCode: string | undefined,
  options: {
    provider: 'UPU' | 'ParcelsApp';
    carrier?: string;
    budgetMs?: number;
    upstreamRoute?: UpstreamProviderRoute;
  }
): Promise<UpstreamTrackingResult | null> {
  const budgetMs = options.budgetMs ?? (options.provider === 'ParcelsApp' ? 20000 : 18000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), budgetMs + 1000);

  try {
    const tracker = getTrackerForProvider(options.provider);
    const detected = !options.carrier ? tracker.detect(cleanId) : null;
    const explicitCarrier =
      options.carrier ||
      (detected && detected.confidence === 'high' && detected.carrier !== 'unknown'
        ? detected.carrier
        : undefined);

    const scrapeResult = await tracker.track(
      {
        number: cleanId,
        ...(explicitCarrier ? { carrier: explicitCarrier } : {})
      },
      {
        signal: controller.signal,
        budgetMs
      }
    );

    if (
      scrapeResult &&
      scrapeResult.result &&
      Array.isArray(scrapeResult.result.events) &&
      scrapeResult.result.events.length > 0
    ) {
      const carrierId =
        scrapeResult.carrier && scrapeResult.carrier !== 'unknown'
          ? scrapeResult.carrier
          : explicitCarrier || (countryCode === 'NL' ? 'spring-gds' : 'upstream');
      const carrierName = CARRIER_NAMES[carrierId] || scrapeResult.carrier || `${originCountry} Post`;

      const events: TrackingEvent[] = [];
      for (const ev of scrapeResult.result.events) {
        const rawEvent = ev as Record<string, unknown>;
        const rawTime = [rawEvent.time, rawEvent.instant, rawEvent.local_time, rawEvent.provider_time_text].find(
          (val): val is string => typeof val === 'string' && val.trim().length > 0
        );
        const { date, time, timestamp } = parseTimestamp(rawTime);
        if (timestamp > 0 && date) {
          const location =
            typeof rawEvent.location === 'string' && rawEvent.location.trim()
              ? rawEvent.location.trim()
              : originCountry;
          const status =
            (typeof rawEvent.description === 'string' && rawEvent.description.trim()) ||
            (typeof rawEvent.stage === 'string' && rawEvent.stage.trim()) ||
            'In Transit';
          events.push({
            date,
            time,
            location,
            status,
            carrier: carrierName,
            timestamp
          });
        }
      }

      if (events.length === 0) return null;

      events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      const latest = events[events.length - 1] || null;
      const inferredRoute: UpstreamProviderRoute =
        options.upstreamRoute ||
        (carrierId === 'spring-gds'
          ? 'spring-gds'
          : options.provider === 'ParcelsApp'
            ? 'parcelsapp'
            : 'direct-upu');

      return {
        found: true,
        carrierId,
        carrierName,
        originCountry,
        upstreamRoute: inferredRoute,
        events,
        latestEvent: latest,
        statusCategory: mapStageToCategory(
          scrapeResult.result.current_stage || scrapeResult.result.status,
          latest?.status
        )
      };
    }
  } catch {
    // fallback handled by caller
  } finally {
    clearTimeout(timeoutId);
  }
  return null;
}

/**
 * Generic hedged execution with Redis circuit-breaker cooldown:
 * - If primary recently failed/rate-limited (cooldown), jumps straight to fallback immediately.
 * - Otherwise starts primary; if primary takes > hedgeDelayMs, starts fallback in parallel.
 */
async function fetchHedged(
  primaryCooldownKey: string,
  primaryFn: () => Promise<UpstreamTrackingResult | null>,
  fallbackFn: () => Promise<UpstreamTrackingResult | null>,
  hedgeDelayMs = 3500
): Promise<UpstreamTrackingResult | null> {
  if (await isRouteInCooldown(primaryCooldownKey)) {
    return fallbackFn();
  }

  let fallbackStarted = false;
  let fallbackPromise: Promise<UpstreamTrackingResult | null> | null = null;
  let hedgeTimer: ReturnType<typeof setTimeout> | null = null;

  const startFallback = () => {
    if (!fallbackStarted) {
      fallbackStarted = true;
      fallbackPromise = fallbackFn().catch(() => null);
    }
    return fallbackPromise!;
  };

  const primaryPromise = primaryFn()
    .then(async (res) => {
      if (res && res.found && res.events.length > 0) {
        return res;
      }
      await markRouteCooldown(primaryCooldownKey, 300);
      return null;
    })
    .catch(async () => {
      await markRouteCooldown(primaryCooldownKey, 300);
      return null;
    });

  const raceWinner = await new Promise<'primary' | 'hedge'>((resolve) => {
    hedgeTimer = setTimeout(() => {
      startFallback();
      resolve('hedge');
    }, hedgeDelayMs);

    primaryPromise.then((res) => {
      if (hedgeTimer) clearTimeout(hedgeTimer);
      if (res) {
        resolve('primary');
      } else {
        startFallback();
        resolve('hedge');
      }
    });
  });

  if (raceWinner === 'primary') {
    return primaryPromise;
  }

  // Allow primary a short grace window to beat fallback if both are in flight
  const [primaryRes, fallbackRes] = await Promise.all([
    Promise.race([primaryPromise, new Promise<null>((r) => setTimeout(() => r(null), 1500))]),
    startFallback()
  ]);

  return primaryRes || fallbackRes;
}

/**
 * Deterministic Upstream Tracking Waterfall with Redis Route Pinning + Hedged Fallbacks:
 * 1. Domestic (*PK) -> Skip upstream completely (EMTTS only)
 * 2. Parallelize Redis upstream cache + pinned route read
 * 3. Use hedged primary -> fallback execution with automatic 5-min cooldown on failing routes
 */
export async function fetchUpstreamTracking(
  rawId: string,
  options?: { bypassCache?: boolean }
): Promise<UpstreamTrackingResult | null> {
  const cleanId = rawId.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleanId || cleanId.endsWith('PK')) {
    return null;
  }

  const cacheKey = `pakpost:cache:v4:upstream:${cleanId}`;
  const redis = getRedis();

  // Parallelize Redis cache + pinned route lookup in one round-trip
  const [cached, pinned] = await Promise.all([
    redis && !options?.bypassCache
      ? redis.get<UpstreamTrackingResult>(cacheKey).catch(() => null)
      : Promise.resolve(null),
    getParcelRoute(cleanId)
  ]);

  if (cached && cached.found && Array.isArray(cached.events) && cached.events.length > 0) {
    return cached;
  }

  // Detect country from standard UPU S10 suffix (e.g. LT880952265NL -> NL)
  const isS10 = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(cleanId);
  const countryCode = isS10 ? cleanId.slice(-2) : undefined;
  const originCountry = countryCode ? (COUNTRY_NAMES[countryCode] || countryCode) : 'International';
  const mappedS10Carrier = countryCode ? S10_CARRIER_MAP[countryCode] : undefined;

  let result: UpstreamTrackingResult | null = null;

  if (countryCode === 'CN' || cleanId.startsWith('LP')) {
    if (pinned?.upstreamRoute === 'direct-upu') {
      result = await fetchHedged(
        `direct-upu:${pinned.carrierId || 'china-post'}`,
        () =>
          queryUniversalScraper(cleanId, originCountry, countryCode, {
            provider: 'UPU',
            carrier: pinned.carrierId !== 'upstream' ? pinned.carrierId : 'china-post',
            upstreamRoute: 'direct-upu'
          }),
        () => fetchCainiaoDirect(cleanId)
      );
    } else {
      result = await fetchHedged(
        'cainiao-direct:cainiao',
        () => fetchCainiaoDirect(cleanId),
        () =>
          queryUniversalScraper(cleanId, originCountry, countryCode, {
            provider: 'UPU',
            carrier: mappedS10Carrier || 'china-post',
            upstreamRoute: 'direct-upu'
          })
      );
    }
  } else if (countryCode === 'NL') {
    result = await fetchHedged(
      'spring-gds:spring-gds',
      () =>
        queryUniversalScraper(cleanId, originCountry, countryCode, {
          provider: 'UPU',
          carrier: 'spring-gds',
          budgetMs: 14000,
          upstreamRoute: 'spring-gds'
        }),
      () => fetchPostNLConsumerObservations(cleanId)
    );
  } else if (pinned && pinned.upstreamRoute !== 'postnl-consumer') {
    const pinnedProvider = pinned.upstreamRoute === 'parcelsapp' ? 'ParcelsApp' : 'UPU';
    const pinnedCarrier =
      pinned.carrierId && pinned.carrierId !== 'upstream' ? pinned.carrierId : mappedS10Carrier;

    if (pinnedProvider === 'UPU') {
      result = await fetchHedged(
        `${pinned.upstreamRoute}:${pinnedCarrier || 'generic'}`,
        () =>
          queryUniversalScraper(cleanId, pinned.originCountry || originCountry, countryCode, {
            provider: 'UPU',
            carrier: pinnedCarrier,
            budgetMs: 14000,
            upstreamRoute: pinned.upstreamRoute
          }),
        () =>
          queryUniversalScraper(cleanId, pinned.originCountry || originCountry, countryCode, {
            provider: 'ParcelsApp',
            carrier: pinnedCarrier,
            budgetMs: 16000,
            upstreamRoute: 'parcelsapp'
          })
      );
    } else {
      result = await queryUniversalScraper(
        cleanId,
        pinned.originCountry || originCountry,
        countryCode,
        {
          provider: 'ParcelsApp',
          carrier: pinnedCarrier,
          budgetMs: 16000,
          upstreamRoute: 'parcelsapp'
        }
      );
    }
  } else {
    result = await fetchHedged(
      `direct-upu:${mappedS10Carrier || 'generic'}`,
      () =>
        queryUniversalScraper(cleanId, originCountry, countryCode, {
          provider: 'UPU',
          carrier: mappedS10Carrier,
          budgetMs: 14000,
          upstreamRoute: 'direct-upu'
        }),
      () =>
        queryUniversalScraper(cleanId, originCountry, countryCode, {
          provider: 'ParcelsApp',
          carrier: mappedS10Carrier,
          budgetMs: 16000,
          upstreamRoute: 'parcelsapp'
        })
    );
  }

  // Persist route pin for non-degraded canonical routes + short-lived cache
  if (result && result.found && result.events.length > 0) {
    if (
      result.upstreamRoute !== 'postnl-consumer' &&
      (!pinned || pinned.upstreamRoute === 'postnl-consumer' || pinned.upstreamRoute !== result.upstreamRoute)
    ) {
      const profile: ParcelRouteProfile = {
        carrierId: result.carrierId,
        carrierName: result.carrierName,
        upstreamRoute: result.upstreamRoute,
        originCountry: result.originCountry,
        countryCode,
        pinnedAt: new Date().toISOString()
      };
      await saveParcelRoute(cleanId, profile);
    }

    if (redis) {
      try {
        await redis.set(cacheKey, result, { ex: 900 });
      } catch {
        // ignore cache write failure
      }
    }
  }

  return result;
}
