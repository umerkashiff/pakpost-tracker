const DEFAULT_SCHEDULE_ID = 'pakpost-tracker-cron';

function getQStashSchedulesBaseUrl(): string {
  const base = (process.env.QSTASH_URL || 'https://qstash.upstash.io')
    .trim()
    .replace(/\/+$/, '');
  return `${base}/v2/schedules`;
}

export interface QStashSyncResult {
  synced: boolean;
  mode: 'qstash' | 'static';
  scheduleId?: string;
  message: string;
}

export function isQStashConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN && process.env.QSTASH_TOKEN.trim());
}

/**
 * Validate standard 5-field cron expressions with optional CRON_TZ=<tz> prefix.
 */
export function isValidCronExpression(expr: string): boolean {
  const trimmed = expr.trim().replace(/\s+/g, ' ');
  if (!trimmed) return false;

  const parts = trimmed.split(' ');
  if (parts[0].startsWith('CRON_TZ=')) {
    return parts[0].length > 'CRON_TZ='.length && parts.length === 6;
  }
  return parts.length === 5;
}

/**
 * Resolve public HTTPS /api/cron destination URL for QStash callbacks.
 */
export function resolveCronDestinationUrl(requestOrigin?: string): string | null {
  const explicit = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (explicit && /^https?:\/\//i.test(explicit)) {
    return `${explicit}/api/cron`;
  }

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) {
    const base = vercelProd.startsWith('http') ? vercelProd : `https://${vercelProd}`;
    return `${base.replace(/\/+$/, '')}/api/cron`;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    const base = vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`;
    return `${base.replace(/\/+$/, '')}/api/cron`;
  }

  if (requestOrigin && !/localhost|127\.0\.0\.1/i.test(requestOrigin)) {
    return `${requestOrigin.replace(/\/+$/, '')}/api/cron`;
  }

  return null;
}

/**
 * Create or replace the live Upstash QStash cron schedule for /api/cron.
 */
export async function syncQStashSchedule(
  cronExpression: string,
  destinationUrl: string | null,
  previousScheduleId?: string | null
): Promise<QStashSyncResult> {
  const token = process.env.QSTASH_TOKEN?.trim();
  if (!token) {
    return {
      synced: false,
      mode: 'static',
      message: 'Saved locally/Redis. Add QSTASH_TOKEN in env to update live cloud cron without redeploying.'
    };
  }

  if (!destinationUrl) {
    return {
      synced: false,
      mode: 'static',
      message: 'Schedule saved in Redis. QStash requires a public deployment URL (or APP_URL) rather than localhost.'
    };
  }

  const cleanCron = cronExpression.trim().replace(/\s+/g, ' ');
  if (!isValidCronExpression(cleanCron)) {
    throw new Error(
      'Invalid cron format. Use 5 fields (e.g. "0 4 * * *") or prefix with CRON_TZ=Asia/Karachi.'
    );
  }

  const schedulesBaseUrl = getQStashSchedulesBaseUrl();
  const idToDelete = previousScheduleId || DEFAULT_SCHEDULE_ID;
  await fetch(`${schedulesBaseUrl}/${encodeURIComponent(idToDelete)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  }).catch(() => null);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Upstash-Cron': cleanCron,
    'Upstash-Schedule-Id': DEFAULT_SCHEDULE_ID,
    'Upstash-Retries': '2'
  };

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    headers['Upstash-Forward-Authorization'] = `Bearer ${cronSecret}`;
  }

  const res = await fetch(`${schedulesBaseUrl}/${destinationUrl}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ trigger: 'qstash' })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`QStash rejected schedule (${res.status}): ${errText}`);
  }

  const data = (await res.json().catch(() => ({}))) as { scheduleId?: string };
  const scheduleId = data.scheduleId || DEFAULT_SCHEDULE_ID;

  return {
    synced: true,
    mode: 'qstash',
    scheduleId,
    message: `Live QStash schedule synced (${cleanCron}).`
  };
}

