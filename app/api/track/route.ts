import { NextRequest, NextResponse } from 'next/server';
import { fetchPakistanPostTracking } from '@/lib/pakpost';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const id = searchParams.get('id');
  const label = searchParams.get('label') || undefined;

  if (!id) {
    return NextResponse.json(
      { error: 'Query parameter "id" is required (e.g. /api/track?id=EP123456789PK)' },
      { status: 400 }
    );
  }

  const result = await fetchPakistanPostTracking(id, label);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.ids && Array.isArray(body.ids)) {
      const results = await Promise.all(
        body.ids.map(async (item: string | { id: string; label?: string }) => {
          if (typeof item === 'string') {
            return fetchPakistanPostTracking(item);
          }
          return fetchPakistanPostTracking(item.id, item.label);
        })
      );
      return NextResponse.json({ count: results.length, results });
    }

    if (body.id) {
      const result = await fetchPakistanPostTracking(body.id, body.label);
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: 'Please provide "id" or an array of "ids" in request body' },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request' },
      { status: 400 }
    );
  }
}
