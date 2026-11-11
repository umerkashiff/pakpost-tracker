import { TrackingResult, StatusCategory } from './types';
import { getDiscordWebhookUrl } from './config';

const TRACKER_BOT_NAME = 'Pakistan Post Tracker';
export const TRACKER_AVATAR_URL =
  'https://upload.wikimedia.org/wikipedia/en/thumb/d/d4/Pakistan_Post_logo.svg/512px-Pakistan_Post_logo.svg.png';

export type WebhookProvider = 'discord' | 'slack' | 'json';

/**
 * Resolve optional Discord user snowflake to ping from server env (DISCORD_PING_USER_ID).
 */
export function getDiscordPingUserId(): string | null {
  const raw = (process.env.DISCORD_PING_USER_ID || '').trim();
  return /^\d{17,20}$/.test(raw) ? raw : null;
}

/**
 * Infer webhook format from destination URL so Discord, Slack, and generic JSON endpoints all work.
 */
export function detectWebhookProvider(webhookUrl: string): WebhookProvider {
  try {
    const parsed = new URL(webhookUrl);
    const host = parsed.hostname.toLowerCase();
    if (
      (host === 'discord.com' || host === 'discordapp.com' || host.endsWith('.discord.com')) &&
      parsed.pathname.includes('/webhooks/')
    ) {
      return 'discord';
    }
    if (host === 'hooks.slack.com' || host.endsWith('.slack.com')) {
      return 'slack';
    }
  } catch {
    // Fallback to generic JSON webhook
  }
  return 'json';
}

export function buildDiscordWebhookPayload(
  embeds: Record<string, unknown>[],
  options?: { ping?: boolean }
) {
  const pingUserId = options?.ping !== false ? getDiscordPingUserId() : null;
  return {
    username: TRACKER_BOT_NAME,
    avatar_url: TRACKER_AVATAR_URL,
    ...(pingUserId
      ? {
          content: `<@${pingUserId}>`,
          allowed_mentions: { users: [pingUserId] }
        }
      : {}),
    embeds
  };
}

const STATUS_CONFIG: Record<StatusCategory, { color: number; emoji: string; label: string }> = {
  DELIVERED: {
    color: 0x10b981,
    emoji: '🟢',
    label: 'DELIVERED'
  },
  IN_TRANSIT: {
    color: 0x3b82f6,
    emoji: '🚚',
    label: 'IN TRANSIT'
  },
  BOOKED: {
    color: 0xf59e0b,
    emoji: '📦',
    label: 'BOOKED / PROCESSING'
  },
  ATTEMPT_FAILED: {
    color: 0xef4444,
    emoji: '⚠️',
    label: 'ATTEMPT FAILED'
  },
  PENDING: {
    color: 0x94a3b8,
    emoji: '⏳',
    label: 'AWAITING SCAN'
  },
  ERROR: {
    color: 0xdc2626,
    emoji: '❌',
    label: 'SERVER ERROR'
  }
};

function buildDiscordEmbed(result: TrackingResult): Record<string, unknown> {
  const config = STATUS_CONFIG[result.statusCategory] || STATUS_CONFIG.PENDING;
  const updatePrefix = result.isUpdated ? '🔔 [UPDATE] ' : '';
  const title = result.label
    ? `${updatePrefix}${config.emoji} ${result.trackingNo} • ${result.label}`
    : `${updatePrefix}${config.emoji} ${result.trackingNo}`;

  const portalUrl = `https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=${encodeURIComponent(result.trackingNo)}`;
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  if (result.upstreamCarrier) {
    fields.push({
      name: '🚚 Logistics Network',
      value: `**${result.upstreamCarrier}**${result.handoffStatus === 'HANDED_OFF_DOMESTIC' ? ' ➔ **Pakistan Post**' : ' *(Origin / Cross-Border)*'}`,
      inline: false
    });
  }

  if (result.found && result.latestEvent) {
    fields.push({
      name: '📍 Latest Status',
      value: `**${result.latestEvent.status || 'Active in network'}**`,
      inline: false
    });

    if (result.latestEvent.location) {
      fields.push({
        name: '🏢 Current Location',
        value: result.latestEvent.location,
        inline: true
      });
    }

    fields.push({
      name: '🕒 Checkpoint Timestamp',
      value: `${result.latestEvent.date || 'N/A'} ${result.latestEvent.time ? `• ${result.latestEvent.time}` : ''}`,
      inline: true
    });

    fields.push({
      name: '🛫 Route',
      value: `${result.origin || 'Pakistan'} ➔ ${result.destination || 'Pakistan'}`,
      inline: true
    });

    if (result.events.length > 1) {
      const recentHistory = [...result.events]
        .reverse()
        .slice(0, 4)
        .map((e, idx) => {
          const prefix = idx === 0 ? '▶' : '•';
          const carrierTag = e.carrier ? ` *[${e.carrier}]*` : '';
          return `${prefix} **${e.date} ${e.time ? `(${e.time})` : ''}**: ${e.status} — *${e.location}*${carrierTag}`;
        })
        .join('\n');

      fields.push({
        name: '📜 Recent Checkpoints',
        value: recentHistory,
        inline: false
      });
    }
  } else if (result.error) {
    fields.push({ name: '⚠️ Issue', value: result.error, inline: false });
  } else {
    fields.push({
      name: 'ℹ️ Information',
      value: 'Parcel not found or not yet scanned by Pakistan Post EMTTS.',
      inline: false
    });
  }

  fields.push({
    name: '🔗 Official EMTTS Portal',
    value: `[Open ep.gov.pk](${portalUrl})`,
    inline: false
  });

  return {
    title,
    url: portalUrl,
    color: config.color,
    fields,
    footer: {
      text: result.isUpdated
        ? `✨ Checkpoint Advanced • Pakistan Post Tracker • ${config.label}`
        : `Pakistan Post EMTTS Daily Tracker • Status: ${config.label}`,
      icon_url: TRACKER_AVATAR_URL
    },
    timestamp: new Date().toISOString()
  };
}

function buildSlackPayload(results: TrackingResult[]) {
  const lines = results.map((r) => {
    const config = STATUS_CONFIG[r.statusCategory] || STATUS_CONFIG.PENDING;
    const status = r.latestEvent?.status || r.error || 'Awaiting scan';
    const loc = r.latestEvent?.location ? ` (${r.latestEvent.location})` : '';
    const label = r.label ? ` • ${r.label}` : '';
    return `${config.emoji} *${r.trackingNo}${label}*: ${status}${loc}`;
  });
  return {
    text: `Pakistan Post Tracker (${results.length} update${results.length === 1 ? '' : 's'}):\n${lines.join('\n')}`
  };
}

function buildGenericJsonPayload(eventType: 'parcel_update' | 'webhook_test', results: TrackingResult[]) {
  return {
    event: eventType,
    source: 'pakpost-tracker',
    checkedAt: new Date().toISOString(),
    updatedCount: results.length,
    parcels: results
  };
}

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webhook returned HTTP ${response.status}: ${text}`);
  }
}

/**
 * Send tracking updates to Discord, Slack, or any generic JSON webhook endpoint.
 */
export async function sendDiscordNotification(
  results: TrackingResult[],
  customWebhookUrl?: string
): Promise<{ success: boolean; error?: string; count: number; provider?: WebhookProvider }> {
  const webhookUrl = customWebhookUrl || (await getDiscordWebhookUrl());

  if (!webhookUrl) {
    return {
      success: false,
      error: 'Webhook URL is not configured (DISCORD_WEBHOOK_URL or Settings)',
      count: 0
    };
  }

  if (results.length === 0) {
    return { success: true, count: 0 };
  }

  const provider = detectWebhookProvider(webhookUrl);

  try {
    if (provider === 'discord') {
      const embeds = results.map(buildDiscordEmbed);
      const chunkSize = 10;
      for (let i = 0; i < embeds.length; i += chunkSize) {
        const chunk = embeds.slice(i, i + chunkSize);
        await postJson(webhookUrl, buildDiscordWebhookPayload(chunk, { ping: i === 0 }));
        if (i + chunkSize < embeds.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    } else if (provider === 'slack') {
      await postJson(webhookUrl, buildSlackPayload(results));
    } else {
      await postJson(webhookUrl, buildGenericJsonPayload('parcel_update', results));
    }

    return { success: true, count: results.length, provider };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown webhook delivery error';
    return { success: false, error: message, count: 0, provider };
  }
}

/**
 * Send a test notification matching the target webhook provider format.
 */
export async function sendWebhookTest(webhookUrl: string): Promise<{ provider: WebhookProvider }> {
  const provider = detectWebhookProvider(webhookUrl);

  if (provider === 'discord') {
    await postJson(
      webhookUrl,
      buildDiscordWebhookPayload([
        {
          title: '🔔 Webhook Test Successful!',
          description:
            'Your Pakistan Post Tracker webhook is configured and receiving messages.\n\nWhenever the automated schedule sees a shipment change, updates will be posted here.',
          color: 0x10b981,
          fields: [
            { name: '⏰ Automation', value: 'Configured Cron Schedule', inline: true },
            { name: '🌐 Provider', value: 'Pakistan Post EMTTS + Upstream', inline: true },
            { name: '☁️ Hosting', value: 'Next.js Serverless', inline: true }
          ],
          footer: {
            text: 'Pakistan Post Tracker • Test Notification',
            icon_url: TRACKER_AVATAR_URL
          },
          timestamp: new Date().toISOString()
        }
      ])
    );
  } else if (provider === 'slack') {
    await postJson(webhookUrl, {
      text: '🔔 Pakistan Post Tracker test notification successful. Updates will appear here when a shipment moves.'
    });
  } else {
    await postJson(webhookUrl, buildGenericJsonPayload('webhook_test', []));
  }

  return { provider };
}
