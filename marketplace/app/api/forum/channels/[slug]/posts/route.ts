import { NextRequest, NextResponse } from 'next/server';
import { listChannelPosts, getChannel } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const since = searchParams.get('since') || undefined;
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '20', 10), 1),
      100
    );
    const offset = Math.max(
      parseInt(searchParams.get('offset') || '0', 10),
      0
    );

    const channel = await getChannel(slug);
    if (!channel) {
      return NextResponse.json(
        { error: 'Channel not found' },
        { status: 404 }
      );
    }

    const posts = await listChannelPosts(slug, since, limit, offset);

    return NextResponse.json({ channel, posts });
  } catch (error) {
    console.error('List channel posts error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch posts' },
      { status: 500 }
    );
  }
}
