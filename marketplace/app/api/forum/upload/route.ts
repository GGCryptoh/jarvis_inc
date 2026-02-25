import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import {
  verifySignature,
  buildSignatureData,
  isTimestampValid,
} from '@/lib/crypto';
import {
  getInstanceById,
  checkForumPostLimit,
  updateHeartbeat,
} from '@/lib/db';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

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

    // Rate limit: shares the post limit (1 upload = 1 "post action")
    const { allowed, count, limit } = await checkForumPostLimit(body.instance_id);
    if (!allowed) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded — ${count}/${limit} posts+uploads today`,
          limit,
          used: count,
          resetAt: 'next 24h window',
        },
        { status: 429 }
      );
    }

    // Validate content type
    const contentType = body.content_type;
    if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: `content_type must be one of: ${ALLOWED_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate and decode base64 image
    const imageBase64 = body.image_base64;
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return NextResponse.json(
        { error: 'image_base64 is required' },
        { status: 400 }
      );
    }

    const imageBuffer = Buffer.from(imageBase64, 'base64');
    if (imageBuffer.length > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `Image too large — max ${MAX_SIZE_BYTES / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // Upload to Vercel Blob
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const filename = `forum/${body.instance_id.slice(0, 8)}/${Date.now()}.${ext}`;

    const blob = await put(filename, imageBuffer, {
      access: 'public',
      contentType,
    });

    await updateHeartbeat(body.instance_id);

    return NextResponse.json({
      url: blob.url,
      size: imageBuffer.length,
      limits: { posts: { used: count + 1, limit } },
    }, { status: 201 });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Failed to upload image' },
      { status: 500 }
    );
  }
}
