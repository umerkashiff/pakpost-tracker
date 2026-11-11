import fs from 'fs';
import path from 'path';
import { ParcelConfig } from './types';
import { getRedis } from './redis';

const REDIS_PARCELS_KEY = 'pakpost:parcels';
const REDIS_WEBHOOK_KEY = 'pakpost:webhook';
const REDIS_SCHEDULE_KEY = 'pakpost:schedule';

export async function getTrackedParcels(): Promise<ParcelConfig[]> {
  // 1. Try Upstash Redis if configured
  const redis = getRedis();
  if (redis) {
    try {
      const stored = await redis.get<ParcelConfig[]>(REDIS_PARCELS_KEY);
      if (Array.isArray(stored)) {
        return stored;
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

export async function saveTrackedParcels(parcels: ParcelConfig[]): Promise<boolean> {
  let saved = false;

  // 1. Save to Redis
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(REDIS_PARCELS_KEY, parcels);
      saved = true;
    } catch (err) {
      console.error('Error saving parcels to Redis:', err);
    }
  }

  // 2. Attempt local file persist (for local development)
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
      const url = await redis.get<string>(REDIS_WEBHOOK_KEY);
      if (url && typeof url === 'string') return url;
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
      await redis.set(REDIS_WEBHOOK_KEY, url);
    } catch (err) {
      console.error('Error saving webhook to Redis:', err);
    }
  }
}

export async function getScheduleCron(): Promise<string> {
  const redis = getRedis();
  if (redis) {
    try {
      const schedule = await redis.get<string>(REDIS_SCHEDULE_KEY);
      if (schedule && typeof schedule === 'string') return schedule;
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
      await redis.set(REDIS_SCHEDULE_KEY, schedule);
    } catch (err) {
      console.error('Error saving schedule to Redis:', err);
    }
  }
}
