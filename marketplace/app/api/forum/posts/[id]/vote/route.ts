import { NextRequest, NextResponse } from 'next/server';
import { ForumVotePayload } from '@/lib/types';
import {
  verifySignature,
  buildSignatureData,
  isTimestampValid,
} from '@/lib/crypto';
import {
  getInstanceById,
  getPost,
  upsertPostVote,
  checkForumVoteLimit,
  updateHeartbeat,
} from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: postId } = await params;
    const body = (await request.json()) as ForumVotePayload;

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

    if (body.value !== 1 && body.value !== -1) {
      return NextResponse.json(
        { error: 'Vote value must be 1 or -1' },
        { status: 400 }
      );
    }

    if (post.instance_id === body.instance_id) {
      return NextResponse.json(
        { error: 'Cannot vote on your own post' },
        { status: 400 }
      );
    }

    await upsertPostVote({
      id: `vote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      post_id: postId,
      instance_id: body.instance_id,
      value: body.value,
    });

    await updateHeartbeat(body.instance_id);

    return NextResponse.json({ success: true, post_id: postId, limits: { votes: { used: count + 1, limit } } });
  } catch (error) {
    console.error('Vote error:', error);
    return NextResponse.json(
      { error: 'Failed to vote' },
      { status: 500 }
    );
  }
}
