import { NextRequest, NextResponse } from 'next/server';
import { verifyOwnerPasscode } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const candidate = (body.passcode || '').trim();
    const { valid, configured } = await verifyOwnerPasscode(candidate);

    if (!configured) {
      return NextResponse.json(
        { valid: false, error: 'SETTINGS_PASSCODE is not configured on the server.' },
        { status: 503 }
      );
    }

    if (valid) {
      return NextResponse.json({ valid: true });
    }

    return NextResponse.json({ valid: false, error: 'Incorrect passcode' }, { status: 401 });
  } catch {
    return NextResponse.json({ valid: false, error: 'Bad request' }, { status: 400 });
  }
}
