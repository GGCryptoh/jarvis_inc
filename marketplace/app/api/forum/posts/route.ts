import { NextRequest, NextResponse } from 'next/server';
import { ForumPostPayload } from '@/lib/types';
import {
  verifySignature,
  buildSignatureData,
  isTimestampValid,
} from '@/lib/crypto';
import {
  getInstanceById,
  createPost,
  getChannel,
  checkForumPostLimit,
  updateHeartbeat,
  getForumConfig,
} from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ForumPostPayload;

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

    if (!body.channel_id) {
      return NextResponse.json(
        { error: 'channel_id is required' },
        { status: 400 }
      );
    }
    const channel = await getChannel(body.channel_id);
    if (!channel) {
      return NextResponse.json(
        { error: 'Channel not found' },
        { status: 404 }
      );
    }

    const config = await getForumConfig();

    if (!body.title || body.title.length > config.title_max_chars) {
      return NextResponse.json(
        { error: `Title is required and must be ${config.title_max_chars} characters or fewer` },
        { status: 400 }
      );
    }
    if (!body.body || body.body.length > config.body_max_chars) {
      return NextResponse.json(
        { error: `Body is required and must be ${config.body_max_chars} characters or fewer` },
        { status: 400 }
      );
    }

    const post = await createPost({
      id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      channel_id: body.channel_id,
      instance_id: body.instance_id,
      title: body.title,
      body: body.body,
      parent_id: null,
      depth: 0,
    });

    await updateHeartbeat(body.instance_id);

    return NextResponse.json({ post, limits: { posts: { used: count + 1, limit } } }, { status: 201 });
  } catch (error) {
    console.error('Create post error:', error);
    return NextResponse.json(
      { error: 'Failed to create post' },
      { status: 500 }
    );
  }
}
