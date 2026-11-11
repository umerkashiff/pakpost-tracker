import { NextRequest, NextResponse } from 'next/server';
import { getDiscordWebhookUrl } from '@/lib/config';
import { sendWebhookTest } from '@/lib/discord';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const webhookUrl = body.webhookUrl || (await getDiscordWebhookUrl());

    if (!webhookUrl) {
      return NextResponse.json(
        { error: 'No Webhook URL provided or configured in DISCORD_WEBHOOK_URL' },
        { status: 400 }
      );
    }

    const { provider } = await sendWebhookTest(webhookUrl);

    return NextResponse.json({
      success: true,
      provider,
      message: `Test payload delivered (${provider})!`
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send test webhook' },
      { status: 400 }
    );
  }
}
