import fs from 'fs';
import path from 'path';
import { ParcelConfig, TrackingResult } from './types';
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

