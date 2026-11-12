import fs from 'fs';
import path from 'path';
import {
  ParcelConfig,
  TrackingEvent,
  TrackingResult,
  StatusCategory,
  ParcelRouteProfile,
  ParcelSourceSnapshot,
  ParcelAlertState
} from './types';
import { getRedis } from './redis';
import { isValidCronExpression } from './qstash';
import {
  encrypt,
  decrypt,
  generateAlias,
  maskTrackingId,
  hashPasscode,
  verifyPasscodeHash,
  safeCompare
} from './crypto';

const REDIS_PARCELS_KEY = 'pakpost:enc:parcels';
const REDIS_WEBHOOK_KEY = 'pakpost:enc:webhook';
const REDIS_SCHEDULE_KEY = 'pakpost:enc:schedule';
const REDIS_PASSCODE_KEY = 'pakpost:enc:passcode';
const REDIS_QSTASH_ID_KEY = 'pakpost:enc:qstash_schedule_id';
const REDIS_ROUTES_KEY = 'pakpost:enc:routes';
const REDIS_SNAPSHOTS_KEY = 'pakpost:enc:snapshots';
const REDIS_ALERT_STATES_KEY = 'pakpost:enc:alert_states';

export interface PublicParcel {
  id: string; // Masked ID: e.g. "LT••••••NL"
  alias: string; // Opaque alias token
  label?: string;
}

export async function getTrackedParcels(): Promise<ParcelConfig[]> {
  // 1. Try Upstash Redis with AES-256 decryption
  const redis = getRedis();
  if (redis) {
    try {
      const stored = await redis.get<string | ParcelConfig[]>(REDIS_PARCELS_KEY);
      if (stored) {
        if (typeof stored === 'string') {
          const decrypted = decrypt(stored);
          const parsed = JSON.parse(decrypted);
          if (Array.isArray(parsed)) return parsed;
        } else if (Array.isArray(stored)) {
          return stored;
        }
      }

      // Check legacy unencrypted key if needed
      const legacy = await redis.get<ParcelConfig[]>('pakpost:parcels');
      if (Array.isArray(legacy)) {
        // Auto-migrate to encrypted
        await saveTrackedParcels(legacy);
        return legacy;
      }
    } catch (err) {
      console.error('Error fetching parcels from Redis:', err);
    }
  }

  // 2. Fallback to TRACKING_IDS environment variable and parcels.json
  const parcels: ParcelConfig[] = [];
  const seen = new Set<string>();

  const envIds = process.env.TRACKING_IDS;
  if (envIds) {
    const items = envIds.split(',').map((s) => s.trim()).filter(Boolean);
    for (const item of items) {
      const [id, ...labelParts] = item.split(':');
      const cleanId = id.trim().toUpperCase();
      const label = labelParts.join(':').trim() || undefined;
      if (cleanId && !seen.has(cleanId)) {
        seen.add(cleanId);
        parcels.push({ id: cleanId, label, enabled: true });
      }
    }
  }

  try {
    const configPath = path.join(process.cwd(), 'parcels.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const jsonList: Array<{ id: string; label?: string; enabled?: boolean }> = JSON.parse(raw);
      if (Array.isArray(jsonList)) {
        for (const item of jsonList) {
          const cleanId = (item.id || '').trim().toUpperCase();
          if (cleanId && !seen.has(cleanId) && item.enabled !== false) {
            seen.add(cleanId);
            parcels.push({
              id: cleanId,
              label: item.label,
              enabled: true
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to parse parcels.json:', err);
  }

  return parcels;
}

export async function getPublicTrackedParcels(): Promise<PublicParcel[]> {
  const parcels = await getTrackedParcels();
  return parcels.map((p) => ({
    id: maskTrackingId(p.id),
    alias: generateAlias(p.id),
    label: p.label
  }));
}

export async function getParcelByAliasOrId(identifier: string): Promise<ParcelConfig | undefined> {
  const parcels = await getTrackedParcels();
  const clean = identifier.trim().toUpperCase();
  return parcels.find((p) => generateAlias(p.id) === identifier.trim() || p.id.toUpperCase() === clean);
}

export async function saveTrackedParcels(parcels: ParcelConfig[]): Promise<boolean> {
  let saved = false;

  // 1. Save AES-256 encrypted payload to Redis
  const redis = getRedis();
  if (redis) {
    try {
      const cipher = encrypt(JSON.stringify(parcels));
      await redis.set(REDIS_PARCELS_KEY, cipher);
      saved = true;
    } catch (err) {
      console.error('Error saving parcels to Redis:', err);
    }
  }

  // 2. Attempt local file persist (for local development only)
  try {
    const configPath = path.join(process.cwd(), 'parcels.json');
    fs.writeFileSync(configPath, JSON.stringify(parcels, null, 2), 'utf8');
    saved = true;
  } catch {
    // Read-only filesystem in Vercel
  }

  return saved;
}

export async function getDiscordWebhookUrl(): Promise<string | undefined> {
  const redis = getRedis();
  if (redis) {
    try {
      const stored = await redis.get<string>(REDIS_WEBHOOK_KEY);
      if (stored && typeof stored === 'string') {
        const decrypted = decrypt(stored).trim();
        if (decrypted && /^https?:\/\//i.test(decrypted)) return decrypted;
      }

      // Check legacy unencrypted
      const legacy = await redis.get<string>('pakpost:webhook');
      if (legacy && typeof legacy === 'string') return legacy;
    } catch (err) {
      console.error('Error getting webhook from Redis:', err);
    }
  }
  return process.env.DISCORD_WEBHOOK_URL;
}

export async function saveDiscordWebhookUrl(url: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      const cipher = encrypt(url.trim());
      await redis.set(REDIS_WEBHOOK_KEY, cipher);
    } catch (err) {
      console.error('Error saving webhook to Redis:', err);
    }
  }
}

export async function getScheduleCron(): Promise<string> {
  const redis = getRedis();
  if (redis) {
    try {
      const stored = await redis.get<string>(REDIS_SCHEDULE_KEY);
      if (stored && typeof stored === 'string') {
        const decrypted = decrypt(stored).trim();
        if (decrypted && isValidCronExpression(decrypted)) return decrypted;
      }
    } catch (err) {
      console.error('Error getting schedule from Redis:', err);
    }
  }

  try {
    const vercelPath = path.join(process.cwd(), 'vercel.json');
    if (fs.existsSync(vercelPath)) {
      const vercelJson = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
      if (vercelJson?.crons?.[0]?.schedule) {
        return vercelJson.crons[0].schedule;
      }
    }
  } catch {
    // fallback
  }

  return '0 4 * * *';
}

export async function saveScheduleCron(schedule: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      const cipher = encrypt(schedule.trim());
      await redis.set(REDIS_SCHEDULE_KEY, cipher);
    } catch (err) {
      console.error('Error saving schedule to Redis:', err);
    }
  }
}

const REDIS_SIGNATURES_KEY = 'pakpost:enc:signatures';

const STATUS_CATEGORY_RANK: Record<StatusCategory, number> = {
  ERROR: 0,
  PENDING: 1,
  BOOKED: 2,
  IN_TRANSIT: 3,
  ATTEMPT_FAILED: 4,
  DELIVERED: 5
};

async function getEncryptedHashItem<T>(hashKey: string, field: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.hget<string>(hashKey, field.trim().toUpperCase());
    if (!raw || typeof raw !== 'string') return null;
    const decrypted = decrypt(raw);
    return JSON.parse(decrypted) as T;
  } catch (err) {
    console.error(`Error reading ${hashKey} from Redis:`, err);
    return null;
  }
}

async function setEncryptedHashItem<T>(hashKey: string, field: string, value: T): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const cipher = encrypt(JSON.stringify(value));
    await redis.hset(hashKey, {
      [field.trim().toUpperCase()]: cipher
    });
  } catch (err) {
    console.error(`Error writing ${hashKey} to Redis:`, err);
  }
}

export async function getParcelRoute(parcelId: string): Promise<ParcelRouteProfile | null> {
  return getEncryptedHashItem<ParcelRouteProfile>(REDIS_ROUTES_KEY, parcelId);
}

export async function saveParcelRoute(parcelId: string, route: ParcelRouteProfile): Promise<void> {
  return setEncryptedHashItem(REDIS_ROUTES_KEY, parcelId, route);
}

export async function getParcelSnapshot(parcelId: string): Promise<ParcelSourceSnapshot | null> {
  return getEncryptedHashItem<ParcelSourceSnapshot>(REDIS_SNAPSHOTS_KEY, parcelId);
}

export async function saveParcelSnapshot(parcelId: string, snapshot: ParcelSourceSnapshot): Promise<void> {
  return setEncryptedHashItem(REDIS_SNAPSHOTS_KEY, parcelId, snapshot);
}

export async function getParcelAlertState(parcelId: string): Promise<ParcelAlertState | null> {
  return getEncryptedHashItem<ParcelAlertState>(REDIS_ALERT_STATES_KEY, parcelId);
}

export async function saveParcelAlertState(parcelId: string, state: ParcelAlertState): Promise<void> {
  const cappedState: ParcelAlertState = {
    ...state,
    seenCheckpoints: state.seenCheckpoints.slice(-150)
  };
  await setEncryptedHashItem(REDIS_ALERT_STATES_KEY, parcelId, cappedState);
  await saveLastParcelSignature(parcelId, cappedState.signature);
}

export async function getCachedTrackingResult(parcelId: string): Promise<TrackingResult | null> {
  const redis = getRedis();
  if (!redis) return null;
  const cleanId = parcelId.trim().toUpperCase();
  if (!cleanId) return null;
  try {
    const raw = await redis.get<string>(`pakpost:cache:v4:result:${cleanId}`);
    if (!raw || typeof raw !== 'string') return null;
    return JSON.parse(decrypt(raw)) as TrackingResult;
  } catch {
    return null;
  }
}

export async function saveCachedTrackingResult(parcelId: string, result: TrackingResult): Promise<void> {
  const redis = getRedis();
  if (!redis || !result.found) return;
  const cleanId = parcelId.trim().toUpperCase();
  if (!cleanId) return;
  try {
    const ttlSeconds = result.statusCategory === 'DELIVERED' ? 60 * 60 * 24 * 7 : 300;
    await redis.set(`pakpost:cache:v4:result:${cleanId}`, encrypt(JSON.stringify(result)), {
      ex: ttlSeconds
    });
  } catch {
    // non-fatal cache write failure
  }
}

export async function isRouteInCooldown(routeKey: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis || !routeKey) return false;
  try {
    const flag = await redis.get<string>(`pakpost:cooldown:${routeKey}`);
    return Boolean(flag);
  } catch {
    return false;
  }
}

export async function markRouteCooldown(routeKey: string, ttlSeconds = 300): Promise<void> {
  const redis = getRedis();
  if (!redis || !routeKey) return;
  try {
    await redis.set(`pakpost:cooldown:${routeKey}`, '1', { ex: ttlSeconds });
  } catch {
    // non-fatal cooldown write failure
  }
}

export async function clearParcelTrackingState(parcelId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const cleanId = parcelId.trim().toUpperCase();
  if (!cleanId) return;
  try {
    await Promise.all([
      redis.hdel(REDIS_ROUTES_KEY, cleanId),
      redis.hdel(REDIS_SNAPSHOTS_KEY, cleanId),
      redis.hdel(REDIS_ALERT_STATES_KEY, cleanId),
      redis.hdel(REDIS_SIGNATURES_KEY, cleanId),
      redis.del(`pakpost:cache:v3:upstream:${cleanId}`),
      redis.del(`pakpost:cache:v4:upstream:${cleanId}`),
      redis.del(`pakpost:cache:v4:result:${cleanId}`)
    ]);
  } catch (err) {
    console.error('Error clearing parcel tracking state:', err);
  }
}

export function normalizeCheckpointKey(ev: TrackingEvent): string {
  const normStatus = (ev.status || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normDate = (ev.date || '').trim().toLowerCase();
  return `${normStatus}__${normDate}`;
}

/**
 * Evaluate whether a parcel shows genuine forward checkpoint progress.
 * Prevents false alerts when a degraded source drops out, falls back, or restores older scans.
 */
export function evaluateParcelProgression(
  result: TrackingResult,
  prevState: ParcelAlertState | null,
  legacySignature?: string | null
): {
  shouldAlert: boolean;
  reason: string;
  nextState: ParcelAlertState | null;
  stateDirty: boolean;
} {
  const validEvents = result.events.filter(
    (ev) => Boolean(ev.date && ev.date !== 'N/A' && ev.timestamp && ev.timestamp > 0)
  );
  const currentSig = computeTrackingSignature(result);

  if (!result.found || validEvents.length === 0) {
    return {
      shouldAlert: false,
      reason: 'No valid checkpoints available',
      nextState: prevState,
      stateDirty: false
    };
  }

  const checkpointSet = new Set<string>();
  let maxTimestamp = 0;
  for (const ev of validEvents) {
    checkpointSet.add(normalizeCheckpointKey(ev));
    if (ev.timestamp && ev.timestamp > maxTimestamp) {
      maxTimestamp = ev.timestamp;
    }
  }
  const currentKeys = Array.from(checkpointSet);

  // Seamless migration from legacy v1 signature if v2 alert state doesn't exist yet
  if (!prevState) {
    const matchesLegacy = Boolean(legacySignature && legacySignature === currentSig);
    const baselineState: ParcelAlertState = {
      highestTimestamp: maxTimestamp,
      lastStatusCategory: result.statusCategory,
      seenCheckpoints: currentKeys,
      signature: currentSig,
      updatedAt: new Date().toISOString()
    };
    return {
      shouldAlert: !matchesLegacy,
      reason: matchesLegacy ? 'Migrated legacy signature cleanly' : 'Initial parcel baseline',
      nextState: baselineState,
      stateDirty: true
    };
  }

  const prevSeen = new Set(prevState.seenCheckpoints);
  const unseenEvents = validEvents.filter((ev) => !prevSeen.has(normalizeCheckpointKey(ev)));
  const hasForwardTimestamp = unseenEvents.some((ev) => (ev.timestamp || 0) > prevState.highestTimestamp);
  const statusStrictlyAdvanced =
    STATUS_CATEGORY_RANK[result.statusCategory] > STATUS_CATEGORY_RANK[prevState.lastStatusCategory];

  const shouldAlert = hasForwardTimestamp || (statusStrictlyAdvanced && unseenEvents.length > 0);

  const mergedSeen = Array.from(new Set([...prevState.seenCheckpoints, ...currentKeys]));
  const monotonicRank = Math.max(
    STATUS_CATEGORY_RANK[result.statusCategory],
    STATUS_CATEGORY_RANK[prevState.lastStatusCategory]
  );
  const preservedCategory =
    STATUS_CATEGORY_RANK[result.statusCategory] >= STATUS_CATEGORY_RANK[prevState.lastStatusCategory]
      ? result.statusCategory
      : prevState.lastStatusCategory;

  const nextState: ParcelAlertState = {
    highestTimestamp: Math.max(prevState.highestTimestamp, maxTimestamp),
    lastStatusCategory:
      monotonicRank === STATUS_CATEGORY_RANK[preservedCategory]
        ? preservedCategory
        : prevState.lastStatusCategory,
    seenCheckpoints: mergedSeen,
    signature: shouldAlert ? currentSig : prevState.signature,
    updatedAt: new Date().toISOString()
  };

  const stateDirty =
    shouldAlert ||
    nextState.highestTimestamp !== prevState.highestTimestamp ||
    mergedSeen.length !== prevState.seenCheckpoints.length;

  const reason = hasForwardTimestamp
    ? 'New forward checkpoint detected'
    : statusStrictlyAdvanced && unseenEvents.length > 0
      ? 'Parcel status strictly advanced'
      : unseenEvents.length > 0
        ? 'Historical/fallback events absorbed without forward timestamp change'
        : 'No new checkpoints';

  return { shouldAlert, reason, nextState, stateDirty };
}

/**
 * Compute an authoritative signature of a parcel's latest tracking state.
 * Any change in statusCategory, event count, latest timestamp, location, or status
 * produces a differing signature.
 */
export function computeTrackingSignature(result: TrackingResult): string {
  const latest = result.latestEvent;
  const latestDesc = latest
    ? `${latest.date}_${latest.time}_${latest.status}_${latest.location}`.replace(/\s+/g, ' ').trim()
    : 'NO_EVENT';
  return `${result.statusCategory}:${result.totalEvents}:${latestDesc}`;
}

/**
 * Retrieve the last recorded event signature for a parcel
 */
export async function getLastParcelSignature(parcelId: string): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.hget<string>(REDIS_SIGNATURES_KEY, parcelId.trim().toUpperCase());
    return raw || null;
  } catch (err) {
    console.error('Error getting parcel signature from Redis:', err);
    return null;
  }
}

/**
 * Save the latest event signature for a parcel to prevent duplicate alerts
 */
export async function saveLastParcelSignature(parcelId: string, signature: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.hset(REDIS_SIGNATURES_KEY, {
      [parcelId.trim().toUpperCase()]: signature
    });
  } catch (err) {
    console.error('Error saving parcel signature to Redis:', err);
  }
}

/**
 * Verify owner passcode against Redis salted scrypt hash first, then SETTINGS_PASSCODE env var.
 * Never falls back to a public hardcoded passcode.
 */
export async function verifyOwnerPasscode(
  candidate: string
): Promise<{ valid: boolean; configured: boolean }> {
  const cleanCandidate = (candidate || '').trim();

  const redis = getRedis();
  if (redis) {
    try {
      const stored = await redis.get<string>(REDIS_PASSCODE_KEY);
      if (stored && typeof stored === 'string') {
        const decryptedHash = decrypt(stored);
        if (decryptedHash.includes(':')) {
          return {
            valid: cleanCandidate.length > 0 && verifyPasscodeHash(cleanCandidate, decryptedHash),
            configured: true
          };
        }
      }
    } catch (err) {
      console.error('Error reading passcode from Redis:', err);
    }
  }

  const envPasscode = process.env.SETTINGS_PASSCODE?.trim();
  if (!envPasscode) {
    return { valid: false, configured: false };
  }

  return {
    valid: cleanCandidate.length > 0 && safeCompare(cleanCandidate, envPasscode),
    configured: true
  };
}

/**
 * Persist a salted scrypt hash of a new owner passcode into encrypted Redis storage.
 */
export async function saveOwnerPasscode(newPasscode: string): Promise<boolean> {
  const clean = newPasscode.trim();
  if (clean.length < 4) {
    throw new Error('Passcode must be at least 4 characters.');
  }

  const redis = getRedis();
  if (!redis) {
    throw new Error('Redis is required to update the passcode from the UI.');
  }

  const cipher = encrypt(hashPasscode(clean));
  await redis.set(REDIS_PASSCODE_KEY, cipher);
  return true;
}

export async function getQStashScheduleId(): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const stored = await redis.get<string>(REDIS_QSTASH_ID_KEY);
    if (stored && typeof stored === 'string') {
      const decrypted = decrypt(stored).trim();
      return decrypted || null;
    }
  } catch (err) {
    console.error('Error reading QStash schedule ID:', err);
  }
  return null;
}

export async function saveQStashScheduleId(scheduleId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(REDIS_QSTASH_ID_KEY, encrypt(scheduleId.trim()));
  } catch (err) {
    console.error('Error saving QStash schedule ID:', err);
  }
}

