import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const candidate = (body.passcode || '').trim();
    const serverPasscode = process.env.SETTINGS_PASSCODE || 'uwu123';

    if (candidate === serverPasscode) {
      return NextResponse.json({ valid: true });
    }

    return NextResponse.json({ valid: false, error: 'Incorrect passcode' }, { status: 401 });
  } catch {
    return NextResponse.json({ valid: false, error: 'Bad request' }, { status: 400 });
  }
}

