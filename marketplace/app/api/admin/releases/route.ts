import { NextRequest, NextResponse } from 'next/server';
import { getReleases, upsertRelease, deleteRelease } from '@/lib/db';

const ADMIN_KEY = process.env.ADMIN_PUBLIC_KEY;

function checkAdmin(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key')
    || new URL(request.url).searchParams.get('admin_key');
  return !!ADMIN_KEY && key === ADMIN_KEY;
}

export async function GET(request: NextRequest) {
  if (!checkAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const releases = await getReleases();
  return NextResponse.json(releases);
}

export async function POST(request: NextRequest) {
  if (!checkAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { version, changelog } = await request.json();
  if (!version || !changelog) {
    return NextResponse.json({ error: 'version and changelog required' }, { status: 400 });
  }
  await upsertRelease(version, changelog);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  if (!checkAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const version = new URL(request.url).searchParams.get('version');
  if (!version) {
    return NextResponse.json({ error: 'version query param required' }, { status: 400 });
  }
  await deleteRelease(version);
  return NextResponse.json({ success: true });
}
