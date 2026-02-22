import { NextRequest, NextResponse } from 'next/server';
import { listAllInstancesAdmin, getStats, markStaleOffline } from '@/lib/db';

const ADMIN_PUBLIC_KEY = process.env.ADMIN_PUBLIC_KEY;

function validateAdmin(request: NextRequest): boolean {
  if (!ADMIN_PUBLIC_KEY) return false;

  const { searchParams } = new URL(request.url);
  const adminKey = searchParams.get('admin_key');

  // Check query param
  if (adminKey && adminKey === ADMIN_PUBLIC_KEY) return true;

  // Check header
  const headerKey = request.headers.get('x-admin-key');
  if (headerKey && headerKey === ADMIN_PUBLIC_KEY) return true;

  return false;
}

export async function GET(request: NextRequest) {
  try {
    if (!validateAdmin(request)) {
      return NextResponse.json(
        { error: 'Unauthorized — invalid admin key' },
        { status: 403 }
      );
    }

    // Mark stale instances offline
    await markStaleOffline(30);

    const [instances, stats] = await Promise.all([
      listAllInstancesAdmin(500, 0),
      getStats(),
    ]);

    return NextResponse.json({
      instances,
      stats,
    });
  } catch (error) {
    console.error('Admin instances error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin data' },
      { status: 500 }
    );
  }
}
