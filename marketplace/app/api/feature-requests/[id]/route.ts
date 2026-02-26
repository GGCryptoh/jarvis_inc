import { NextRequest, NextResponse } from 'next/server';
import { getFeatureRequest, updateFeatureRequestStatus } from '@/lib/db';

function isAdmin(request: NextRequest): boolean {
  const adminKey = request.headers.get('x-admin-key') ||
    new URL(request.url).searchParams.get('admin_key');
  return !!adminKey && adminKey === process.env.ADMIN_PUBLIC_KEY;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const feature = await getFeatureRequest(id);
    if (!feature) {
      return NextResponse.json({ error: 'Feature request not found' }, { status: 404 });
    }
    return NextResponse.json({ feature_request: feature });
  } catch (error) {
    console.error('Get feature request error:', error);
    return NextResponse.json({ error: 'Failed to fetch feature request' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const feature = await getFeatureRequest(id);
    if (!feature) {
      return NextResponse.json({ error: 'Feature request not found' }, { status: 404 });
    }

    if (typeof body.status === 'string') {
      await updateFeatureRequestStatus(id, body.status);
      return NextResponse.json({ id, status: body.status });
    }

    return NextResponse.json({ error: 'No valid update fields' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update feature request';
    console.error('Update feature request error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
