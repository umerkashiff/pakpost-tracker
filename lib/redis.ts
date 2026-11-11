import { Redis } from '@upstash/redis';

function getRedisCredentials() {
  // Check common Upstash / Vercel KV environment variables
  // Upstash integration often prefixes with STORAGE_, UPSTASH_REDIS_REST_, or KV_
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.STORAGE_REST_API_URL ||
    process.env.STORAGE_URL ||
    process.env.REDIS_URL;

  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN ||
    process.env.STORAGE_TOKEN;

  if (url && token) {
    return { url, token };
  }
  return null;
}

let redisInstance: Redis | null = null;

export function getRedis(): Redis | null {
  if (redisInstance) return redisInstance;

  const creds = getRedisCredentials();
  if (!creds) return null;

  try {
    redisInstance = new Redis({
      url: creds.url,
      token: creds.token
    });
    return redisInstance;
  } catch (err) {
    console.error('Failed to initialize Upstash Redis client:', err);
    return null;
  }
}
