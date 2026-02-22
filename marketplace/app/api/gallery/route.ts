import { NextRequest, NextResponse } from 'next/server';
import { listInstances, markStaleOffline } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '100', 10), 1),
      500
    );
    const offset = Math.max(
      parseInt(searchParams.get('offset') || '0', 10),
      0
    );

    // Mark instances with no heartbeat in 30 minutes as offline
    await markStaleOffline(30);

    const instances = await listInstances(limit, offset);

    return NextResponse.json({ instances });
  } catch (error) {
    console.error('Gallery error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch gallery' },
      { status: 500 }
    );
  }
}
