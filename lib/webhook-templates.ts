import { StatusCategory, TrackingResult } from './types';

/**
 * Edit this file to customize how tracking alerts look across Discord, Slack, and JSON webhooks.
 * Network delivery and provider detection live separately in lib/discord.ts.
 */

export const STATUS_STYLE: Record<StatusCategory, { color: number; label: string }> = {
  DELIVERED: { color: 0x10b981, label: 'Delivered' },
  IN_TRANSIT: { color: 0x3b82f6, label: 'In Transit' },
  BOOKED: { color: 0xf59e0b, label: 'Booked' },
  ATTEMPT_FAILED: { color: 0xef4444, label: 'Attempt Failed' },
  PENDING: { color: 0x64748b, label: 'Pending' },
  ERROR: { color: 0xdc2626, label: 'Error' }
};

function buildPortalUrl(trackingNo: string): string {
  return `https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=${encodeURIComponent(trackingNo)}`;
}

function buildRouteText(result: TrackingResult): string {
  const origin = result.origin && result.origin !== 'N/A' ? result.origin : null;
  const dest = result.destination && result.destination !== 'N/A' ? result.destination : null;

  if (origin && dest) return `${origin} -> ${dest}`;
  if (origin) return origin;
  if (dest) return `-> ${dest}`;
  return 'N/A';
}

function buildNetworkText(result: TrackingResult): string | null {
  if (!result.upstreamCarrier) return null;
  return result.handoffStatus === 'HANDED_OFF_DOMESTIC'
    ? `${result.upstreamCarrier} -> Pakistan Post`
    : result.upstreamCarrier;
}

/**
 * Clean, concise Discord embed for parcel updates.
 */
export function formatDiscordEmbed(result: TrackingResult): Record<string, unknown> {
  const style = STATUS_STYLE[result.statusCategory] || STATUS_STYLE.PENDING;
  const portalUrl = buildPortalUrl(result.trackingNo);
  const title = result.label ? `${result.trackingNo} - ${result.label}` : result.trackingNo;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  const network = buildNetworkText(result);

  if (result.found && result.latestEvent) {
    fields.push({
      name: 'Status',
      value: result.latestEvent.status || 'Active',
      inline: false
    });

    if (result.latestEvent.location) {
      fields.push({
        name: 'Location',
        value: result.latestEvent.location,
        inline: true
      });
    }

    fields.push({
      name: 'Updated',
      value: result.latestEvent.time
        ? `${result.latestEvent.date} (${result.latestEvent.time})`
        : result.latestEvent.date || 'N/A',
      inline: true
    });

    fields.push({
      name: 'Route',
      value: network ? `${buildRouteText(result)} (${network})` : buildRouteText(result),
      inline: true
    });

    if (result.events.length > 1) {
      const historyLines = [...result.events]
        .reverse()
        .slice(0, 4)
        .map((e) => {
          const when = e.time ? `${e.date} ${e.time}` : e.date;
          const loc = e.location ? ` - ${e.location}` : '';
          const carrier = e.carrier ? ` [${e.carrier}]` : '';
          return `- ${when}: ${e.status}${loc}${carrier}`;
        })
        .join('\n');

      fields.push({
        name: 'History',
        value: historyLines,
        inline: false
      });
    }
  } else if (result.error) {
    fields.push({ name: 'Error', value: result.error, inline: false });
  } else {
    fields.push({
      name: 'Status',
      value: 'No records found yet.',
      inline: false
    });
  }

  return {
    title,
    url: portalUrl,
    color: style.color,
    fields,
    footer: {
      text: result.isUpdated ? `${style.label} • Checkpoint updated` : style.label
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Discord embed dispatched by /api/notify-test.
 */
export function formatDiscordTestEmbed(): Record<string, unknown> {
  return {
    title: 'Webhook test OK',
    description: 'Notifications will be sent here whenever a tracked shipment changes.',
    color: 0x10b981,
    timestamp: new Date().toISOString()
  };
}

/**
 * Concise Slack message payload.
 */
export function formatSlackMessage(results: TrackingResult[]) {
  const lines = results.map((r) => {
    const label = r.label ? ` (${r.label})` : '';
    const status = r.latestEvent?.status || r.error || 'No records yet';
    const loc = r.latestEvent?.location ? ` - ${r.latestEvent.location}` : '';
    const when = r.latestEvent?.date
      ? ` [${r.latestEvent.date}${r.latestEvent.time ? ` ${r.latestEvent.time}` : ''}]`
      : '';
    return `• *${r.trackingNo}${label}*: ${status}${loc}${when}`;
  });

  return {
    text: `Pakistan Post Tracker (${results.length} update${results.length === 1 ? '' : 's'})\n${lines.join('\n')}`
  };
}

export function formatSlackTestMessage() {
  return {
    text: 'Pakistan Post Tracker: webhook test OK.'
  };
}

/**
 * Structured JSON body sent to generic webhooks (n8n, Telegram bridges, custom backends).
 */
export function formatJsonWebhookPayload(
  eventType: 'parcel_update' | 'webhook_test',
  results: TrackingResult[]
) {
  return {
    event: eventType,
    source: 'pakpost-tracker',
    checkedAt: new Date().toISOString(),
    updatedCount: results.length,
    parcels: results
  };
}
