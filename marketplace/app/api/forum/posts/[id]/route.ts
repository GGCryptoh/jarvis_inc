import { NextRequest, NextResponse } from 'next/server';
import { getPostWithReplies, getPost, deletePost, lockPost, getPollResults } from '@/lib/db';

function isAdmin(request: NextRequest): boolean {
  const adminKey = request.headers.get('x-admin-key') ||
    new URL(request.url).searchParams.get('admin_key');
  return !!adminKey && adminKey === process.env.ADMIN_PUBLIC_KEY;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await getPostWithReplies(id);

    if (!result) {
      return NextResponse.json(
        { error: 'Post not found' },
        { status: 404 }
      );
    }

    // Enrich post with poll results if it has a poll
    const post = result.post;
    if (post.poll_options && Array.isArray(post.poll_options) && post.poll_options.length > 0) {
      const voteRows = await getPollResults(id);
      const pollExpired = post.poll_closes_at && new Date(post.poll_closes_at) < new Date();
      post.poll_closed = post.poll_closed || !!pollExpired;
      post.poll_results = (post.poll_options as string[]).map((option: string, idx: number) => ({
        option,
        votes: voteRows.find(r => r.option_index === idx)?.votes ?? 0,
      }));
      post.poll_total_votes = post.poll_results.reduce((sum: number, r: { votes: number }) => sum + r.votes, 0);
    }

    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res;
  } catch (error) {
    console.error('Get post error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch post' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const post = await getPost(id);
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    await deletePost(id);
    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    console.error('Delete post error:', error);
    return NextResponse.json(
      { error: 'Failed to delete post' },
      { status: 500 }
    );
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

    const post = await getPost(id);
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    if (typeof body.locked === 'boolean') {
      await lockPost(id, body.locked);
      return NextResponse.json({ id, locked: body.locked });
    }

    return NextResponse.json({ error: 'No valid update fields' }, { status: 400 });
  } catch (error) {
    console.error('Update post error:', error);
    return NextResponse.json(
      { error: 'Failed to update post' },
      { status: 500 }
    );
  }
}
