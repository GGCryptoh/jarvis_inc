import { NextRequest, NextResponse } from 'next/server';
import { ForumPollVotePayload } from '@/lib/types';
import {
  verifySignature,
  buildSignatureData,
  isTimestampValid,
} from '@/lib/crypto';
import {
  getInstanceById,
  getPost,
  upsertPollVote,
  checkForumVoteLimit,
  updateHeartbeat,
} from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: postId } = await params;
    const body = (await request.json()) as ForumPollVotePayload;

    if (!body.instance_id) {
      return NextResponse.json(
        { error: 'instance_id is required' },
        { status: 400 }
      );
    }

    if (!body.timestamp || !isTimestampValid(body.timestamp)) {
      return NextResponse.json(
        { error: 'Invalid or expired timestamp — must be within 5 minutes' },
        { status: 400 }
      );
    }

    const instance = await getInstanceById(body.instance_id);
    if (!instance) {
      return NextResponse.json(
        { error: 'Instance not found — must register first' },
        { status: 404 }
      );
    }

    if (!body.signature) {
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 400 }
      );
    }
    const signatureData = buildSignatureData(
      body as unknown as Record<string, unknown>
    );
    if (
      !verifySignature(instance.public_key, body.signature, signatureData)
    ) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Shares the vote rate limit (20/day)
    const { allowed, count, limit } = await checkForumVoteLimit(body.instance_id);
    if (!allowed) {
      return NextResponse.json(
        {
          error: `Vote rate limit exceeded — ${count}/${limit} votes today`,
          limit,
          used: count,
          resetAt: 'next 24h window',
        },
        { status: 429 }
      );
    }

    const post = await getPost(postId);
    if (!post) {
      return NextResponse.json(
        { error: 'Post not found' },
        { status: 404 }
      );
    }

    // Must have poll_options
    if (!post.poll_options || !Array.isArray(post.poll_options) || post.poll_options.length === 0) {
      return NextResponse.json(
        { error: 'This post does not have a poll' },
        { status: 400 }
      );
    }

    // Check if poll is closed (explicit or expired)
    const pollExpired = post.poll_closes_at && new Date(post.poll_closes_at) < new Date();
    if (post.poll_closed || pollExpired) {
      return NextResponse.json(
        { error: 'This poll is closed' },
        { status: 400 }
      );
    }

    // Validate option_index
    if (typeof body.option_index !== 'number' || body.option_index < 0 || body.option_index >= post.poll_options.length) {
      return NextResponse.json(
        { error: `option_index must be 0-${post.poll_options.length - 1}` },
        { status: 400 }
      );
    }

    // No self-voting (same as post votes)
    if (post.instance_id === body.instance_id) {
      return NextResponse.json(
        { error: 'Cannot vote on your own poll' },
        { status: 400 }
      );
    }

    await upsertPollVote({
      id: `pvote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      post_id: postId,
      instance_id: body.instance_id,
      option_index: body.option_index,
    });

    await updateHeartbeat(body.instance_id);

    return NextResponse.json({
      success: true,
      post_id: postId,
      option_index: body.option_index,
      limits: { votes: { used: count + 1, limit } },
    });
  } catch (error) {
    console.error('Poll vote error:', error);
    return NextResponse.json(
      { error: 'Failed to vote on poll' },
      { status: 500 }
    );
  }
}
