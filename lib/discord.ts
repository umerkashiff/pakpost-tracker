import { TrackingResult } from './types';
import { getDiscordWebhookUrl } from './config';
import {
  formatDiscordEmbed,
  formatDiscordTestEmbed,
  formatSlackMessage,
  formatSlackTestMessage,
  formatJsonWebhookPayload
} from './webhook-templates';

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
      const embeds = results.map(formatDiscordEmbed);
      const chunkSize = 10;
      for (let i = 0; i < embeds.length; i += chunkSize) {
        const chunk = embeds.slice(i, i + chunkSize);
        await postJson(webhookUrl, buildDiscordWebhookPayload(chunk, { ping: i === 0 }));
        if (i + chunkSize < embeds.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    } else if (provider === 'slack') {
      await postJson(webhookUrl, formatSlackMessage(results));
    } else {
      await postJson(webhookUrl, formatJsonWebhookPayload('parcel_update', results));
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
    await postJson(webhookUrl, buildDiscordWebhookPayload([formatDiscordTestEmbed()]));
  } else if (provider === 'slack') {
    await postJson(webhookUrl, formatSlackTestMessage());
  } else {
    await postJson(webhookUrl, formatJsonWebhookPayload('webhook_test', []));
  }

  return { provider };
}
