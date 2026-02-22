import { NextRequest, NextResponse } from 'next/server';
import { listChannels, createChannel, updateChannelVisibility, deleteChannel } from '@/lib/db';

const ADMIN_PUBLIC_KEY = process.env.ADMIN_PUBLIC_KEY;

function getAdminKey(request: NextRequest): string | null {
  const { searchParams } = new URL(request.url);
  return searchParams.get('admin_key') || request.headers.get('x-admin-key');
}

function isAdmin(request: NextRequest): boolean {
  if (!ADMIN_PUBLIC_KEY) return false;
  const key = getAdminKey(request);
  return !!key && key === ADMIN_PUBLIC_KEY;
}

export async function GET(request: NextRequest) {
  try {
    // Admin sees all channels including hidden
    const includeHidden = isAdmin(request);
    const channels = await listChannels(includeHidden);
    return NextResponse.json({ channels });
  } catch (error) {
    console.error('List channels error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch channels' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isAdmin(request)) {
      return NextResponse.json(
        { error: 'Unauthorized — invalid admin key' },
        { status: 403 }
      );
    }

    const body = await request.json();

    if (!body.id || !body.name) {
      return NextResponse.json(
        { error: 'id (slug) and name are required' },
        { status: 400 }
      );
    }

    if (!/^[a-z0-9-]+$/.test(body.id)) {
      return NextResponse.json(
        { error: 'id must be lowercase alphanumeric with hyphens only' },
        { status: 400 }
      );
    }

    const channel = await createChannel({
      id: body.id,
      name: body.name,
      description: body.description || '',
      created_by: getAdminKey(request) ?? undefined,
    });

    return NextResponse.json({ channel }, { status: 201 });
  } catch (error) {
    console.error('Create channel error:', error);
    return NextResponse.json(
      { error: 'Failed to create channel' },
      { status: 500 }
    );
  }
}

// PATCH — toggle visibility
export async function PATCH(request: NextRequest) {
  try {
    if (!isAdmin(request)) {
      return NextResponse.json(
        { error: 'Unauthorized — invalid admin key' },
        { status: 403 }
      );
    }

    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    if (typeof body.visible === 'boolean') {
      await updateChannelVisibility(body.id, body.visible);
      return NextResponse.json({ success: true, id: body.id, visible: body.visible });
    }

    return NextResponse.json({ error: 'visible (boolean) is required' }, { status: 400 });
  } catch (error) {
    console.error('Update channel error:', error);
    return NextResponse.json(
      { error: 'Failed to update channel' },
      { status: 500 }
    );
  }
}

// DELETE — remove channel + all its posts
export async function DELETE(request: NextRequest) {
  try {
    if (!isAdmin(request)) {
      return NextResponse.json(
        { error: 'Unauthorized — invalid admin key' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
    }

    await deleteChannel(id);
    return NextResponse.json({ success: true, deleted: id });
  } catch (error) {
    console.error('Delete channel error:', error);
    return NextResponse.json(
      { error: 'Failed to delete channel' },
      { status: 500 }
    );
  }
}
