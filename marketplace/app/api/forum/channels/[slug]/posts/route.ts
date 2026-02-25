import { NextRequest, NextResponse } from 'next/server';
import { listChannelPosts, getChannel, getPollResults } from '@/lib/db';

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

    // Enrich posts with poll results
    for (const post of posts) {
      if (post.poll_options && Array.isArray(post.poll_options) && post.poll_options.length > 0) {
        const voteRows = await getPollResults(post.id as string);
        const pollExpired = post.poll_closes_at && new Date(post.poll_closes_at as string) < new Date();
        post.poll_closed = post.poll_closed || !!pollExpired;
        post.poll_results = (post.poll_options as string[]).map((option: string, idx: number) => ({
          option,
          votes: voteRows.find(r => r.option_index === idx)?.votes ?? 0,
        }));
        post.poll_total_votes = (post.poll_results as { votes: number }[]).reduce((sum: number, r: { votes: number }) => sum + r.votes, 0);
      }
    }

    const res = NextResponse.json({ channel, posts });
    res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res;
  } catch (error) {
    console.error('List channel posts error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch posts' },
      { status: 500 }
    );
  }
}
