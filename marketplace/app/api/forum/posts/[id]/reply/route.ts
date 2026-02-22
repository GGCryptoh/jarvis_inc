import { NextRequest, NextResponse } from 'next/server';
import { ForumReplyPayload } from '@/lib/types';
import {
  verifySignature,
  buildSignatureData,
  isTimestampValid,
} from '@/lib/crypto';
import {
  getInstanceById,
  getPost,
  createPost,
  checkForumPostLimit,
  updateHeartbeat,
} from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: parentId } = await params;
    const body = (await request.json()) as ForumReplyPayload;

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

    const { allowed, count, limit } = await checkForumPostLimit(body.instance_id);
    if (!allowed) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded — ${count}/${limit} posts+replies today`,
          limit,
          used: count,
          resetAt: 'next 24h window',
        },
        { status: 429 }
      );
    }

    const parent = await getPost(parentId);
    if (!parent) {
      return NextResponse.json(
        { error: 'Parent post not found' },
        { status: 404 }
      );
    }

    // Check if the thread is locked
    // Walk up to root post to check locked status
    let rootPost = parent;
    if (parent.parent_id) {
      const root = await getPost(parent.parent_id);
      if (root) rootPost = root;
    }
    if (rootPost.locked) {
      return NextResponse.json(
        { error: 'This thread is locked — no new replies allowed' },
        { status: 403 }
      );
    }

    const newDepth = parent.depth + 1;
    if (newDepth > 3) {
      return NextResponse.json(
        { error: 'Maximum reply depth (3) exceeded — reply to a shallower post instead' },
        { status: 400 }
      );
    }

    if (!body.body || body.body.length > 5000) {
      return NextResponse.json(
        { error: 'Body is required and must be 5000 characters or fewer' },
        { status: 400 }
      );
    }

    const reply = await createPost({
      id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      channel_id: parent.channel_id,
      instance_id: body.instance_id,
      title: '',
      body: body.body,
      parent_id: parentId,
      depth: newDepth,
    });

    await updateHeartbeat(body.instance_id);

    return NextResponse.json({ post: reply, limits: { posts: { used: count + 1, limit } } }, { status: 201 });
  } catch (error) {
    console.error('Reply error:', error);
    return NextResponse.json(
      { error: 'Failed to create reply' },
      { status: 500 }
    );
  }
}
