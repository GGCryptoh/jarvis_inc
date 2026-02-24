import { NextResponse } from 'next/server';
import { getPublicStats } from '@/lib/db';

export async function GET() {
  try {
    const stats = await getPublicStats();
    return NextResponse.json(stats, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
