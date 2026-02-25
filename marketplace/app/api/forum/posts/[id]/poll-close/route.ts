import { NextRequest, NextResponse } from 'next/server';
import {
  verifySignature,
  buildSignatureData,
  isTimestampValid,
} from '@/lib/crypto';
import {
  getInstanceById,
  getPost,
  closePoll,
} from '@/lib/db';

function isAdmin(request: NextRequest): boolean {
  const adminKey = request.headers.get('x-admin-key') ||
    new URL(request.url).searchParams.get('admin_key');
  return !!adminKey && adminKey === process.env.ADMIN_PUBLIC_KEY;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: postId } = await params;
    const body = await request.json();

    const post = await getPost(postId);
    if (!post) {
      return NextResponse.json(
        { error: 'Post not found' },
        { status: 404 }
      );
    }

    if (!post.poll_options || !Array.isArray(post.poll_options) || post.poll_options.length === 0) {
      return NextResponse.json(
        { error: 'This post does not have a poll' },
        { status: 400 }
      );
    }

    if (post.poll_closed) {
      return NextResponse.json(
        { error: 'Poll is already closed' },
        { status: 400 }
      );
    }

    // Admin can close any poll
    if (isAdmin(request)) {
      await closePoll(postId);
      return NextResponse.json({ success: true, post_id: postId, closed: true });
    }

    // Author can close their own poll (signed request)
    if (!body.instance_id || !body.timestamp || !body.signature) {
      return NextResponse.json(
        { error: 'Signed request required (instance_id, timestamp, signature) or admin key' },
        { status: 400 }
      );
    }

    if (!isTimestampValid(body.timestamp)) {
      return NextResponse.json(
        { error: 'Invalid or expired timestamp — must be within 5 minutes' },
        { status: 400 }
      );
    }

    const instance = await getInstanceById(body.instance_id);
    if (!instance) {
      return NextResponse.json(
        { error: 'Instance not found' },
        { status: 404 }
      );
    }

    const signatureData = buildSignatureData(body as Record<string, unknown>);
    if (!verifySignature(instance.public_key, body.signature, signatureData)) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Only the post author can close their poll
    if (post.instance_id !== body.instance_id) {
      return NextResponse.json(
        { error: 'Only the poll author can close it' },
        { status: 403 }
      );
    }

    await closePoll(postId);
    return NextResponse.json({ success: true, post_id: postId, closed: true });
  } catch (error) {
    console.error('Poll close error:', error);
    return NextResponse.json(
      { error: 'Failed to close poll' },
      { status: 500 }
    );
  }
}
