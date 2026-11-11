import { NextRequest, NextResponse } from 'next/server';
import { getDiscordWebhookUrl } from '@/lib/config';
import { buildDiscordWebhookPayload, TRACKER_AVATAR_URL } from '@/lib/discord';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const webhookUrl = body.webhookUrl || (await getDiscordWebhookUrl());

    if (!webhookUrl) {
      return NextResponse.json(
        { error: 'No Discord Webhook URL provided or configured in DISCORD_WEBHOOK_URL' },
        { status: 400 }
      );
    }

    const payload = buildDiscordWebhookPayload([
      {
        title: '🔔 Discord Webhook Test Successful!',
        description:
          'Your Pakistan Post Tracker webhook is properly configured and receiving messages.\n\nWhenever the automated daily schedule runs, tracking updates will be posted here.',
        color: 0x10b981,
        fields: [
          {
            name: '⏰ Schedule',
            value: 'Daily automated check (09:00 AM PKT)',
            inline: true
          },
          {
            name: '🌐 Provider',
            value: 'Pakistan Post EMTTS (ep.gov.pk)',
            inline: true
          },
          {
            name: '☁️ Hosted On',
            value: 'Vercel Serverless',
            inline: true
          }
        ],
        footer: {
          text: 'Pakistan Post Tracker • Test Notification',
          icon_url: TRACKER_AVATAR_URL
        },
        timestamp: new Date().toISOString()
      }
    ]);

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json(
        { error: `Discord rejected webhook with status ${res.status}: ${errorText}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Test message sent to Discord successfully!'
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send Discord test message' },
      { status: 500 }
    );
  }
}
