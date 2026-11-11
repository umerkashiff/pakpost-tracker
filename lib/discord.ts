import { TrackingResult, StatusCategory } from './types';
import { getDiscordWebhookUrl } from './config';

const STATUS_CONFIG: Record<StatusCategory, { color: number; emoji: string; label: string }> = {
  DELIVERED: {
    color: 0x10b981, // Emerald Green
    emoji: '🟢',
    label: 'DELIVERED'
  },
  IN_TRANSIT: {
    color: 0x3b82f6, // Royal Blue
    emoji: '🚚',
    label: 'IN TRANSIT'
  },
  BOOKED: {
    color: 0xf59e0b, // Amber
    emoji: '📦',
    label: 'BOOKED / PROCESSING'
  },
  ATTEMPT_FAILED: {
    color: 0xef4444, // Red
    emoji: '⚠️',
    label: 'ATTEMPT FAILED'
  },
  PENDING: {
    color: 0x94a3b8, // Slate
    emoji: '⏳',
    label: 'AWAITING SCAN'
  },
  ERROR: {
    color: 0xdc2626, // Crimson
    emoji: '❌',
    label: 'SERVER ERROR'
  }
};

export async function sendDiscordNotification(
  results: TrackingResult[],
  customWebhookUrl?: string
): Promise<{ success: boolean; error?: string; count: number }> {
  const webhookUrl = customWebhookUrl || (await getDiscordWebhookUrl());

  if (!webhookUrl) {
    return {
      success: false,
      error: 'DISCORD_WEBHOOK_URL is not configured',
      count: 0
    };
  }

  if (results.length === 0) {
    return {
      success: true,
      count: 0
    };
  }

  const embeds = results.map((result) => {
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

      // Add recent history if more than 1 checkpoint exists
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
      fields.push({
        name: '⚠️ Issue',
        value: result.error,
        inline: false
      });
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
        icon_url: 'https://upload.wikimedia.org/wikipedia/en/thumb/d/d4/Pakistan_Post_logo.svg/512px-Pakistan_Post_logo.svg.png'
      },
      timestamp: new Date().toISOString()
    };
  });

  try {
    // Discord allows up to 10 embeds per message. Chunk into chunks of 10.
    const chunkSize = 10;
    for (let i = 0; i < embeds.length; i += chunkSize) {
      const chunk = embeds.slice(i, i + chunkSize);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: 'Pakistan Post Tracker',
          avatar_url: 'https://upload.wikimedia.org/wikipedia/en/thumb/d/d4/Pakistan_Post_logo.svg/512px-Pakistan_Post_logo.svg.png',
          embeds: chunk
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Discord returned HTTP ${response.status}: ${text}`);
      }

      // Small pause if sending multiple chunks to respect rate limits
      if (i + chunkSize < embeds.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return {
      success: true,
      count: results.length
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Discord delivery error';
    return {
      success: false,
      error: message,
      count: 0
    };
  }
}

