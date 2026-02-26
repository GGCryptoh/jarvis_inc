import { NextRequest, NextResponse } from 'next/server';
import { FeatureRequestPayload } from '@/lib/types';
import {
  verifySignature,
  buildSignatureData,
  isTimestampValid,
} from '@/lib/crypto';
import {
  getInstanceById,
  listFeatureRequests,
  createFeatureRequest,
  deleteFeatureRequest,
  getFeatureRequest,
} from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || undefined;
    const status = searchParams.get('status') || undefined;
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '50', 10), 1),
      200
    );
    const offset = Math.max(
      parseInt(searchParams.get('offset') || '0', 10),
      0
    );

    const featureRequests = await listFeatureRequests(
      category,
      status,
      limit,
      offset
    );

    const res = NextResponse.json({ feature_requests: featureRequests });
    res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res;
  } catch (error) {
    console.error('List feature requests error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch feature requests' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as FeatureRequestPayload;

    // --- Validate required fields ---
    if (!body.instance_id) {
      return NextResponse.json(
        { error: 'instance_id is required' },
        { status: 400 }
      );
    }

    // --- Validate timestamp ---
    if (!body.timestamp || !isTimestampValid(body.timestamp)) {
      return NextResponse.json(
        { error: 'Invalid or expired timestamp — must be within 5 minutes' },
        { status: 400 }
      );
    }

    // --- Look up instance for public_key and nickname ---
    const instance = await getInstanceById(body.instance_id);
    if (!instance) {
      return NextResponse.json(
        { error: 'Instance not found — must register first' },
        { status: 404 }
      );
    }

    // --- Verify signature ---
    if (!body.signature) {
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 400 }
      );
    }
    const signatureData = buildSignatureData(body as unknown as Record<string, unknown>);
    if (!verifySignature(instance.public_key, body.signature, signatureData)) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // --- Validate fields ---
    if (!body.title || body.title.length > 200) {
      return NextResponse.json(
        { error: 'Title is required and must be 200 characters or fewer' },
        { status: 400 }
      );
    }

    if (body.description && body.description.length > 2000) {
      return NextResponse.json(
        { error: 'Description must be 2000 characters or fewer' },
        { status: 400 }
      );
    }

    const validCategories = ['skill', 'feature', 'integration', 'improvement'];
    if (!body.category || !validCategories.includes(body.category)) {
      return NextResponse.json(
        {
          error: `Category must be one of: ${validCategories.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // --- Create feature request ---
    const featureRequest = await createFeatureRequest({
      id: `fr-${Date.now()}`,
      instance_id: body.instance_id,
      instance_nickname: instance.nickname,
      title: body.title,
      description: body.description || '',
      category: body.category,
    });

    return NextResponse.json(
      { feature_request: featureRequest },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create feature request error:', error);
    return NextResponse.json(
      { error: 'Failed to create feature request' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const adminKey = request.headers.get('x-admin-key') ||
      new URL(request.url).searchParams.get('admin_key');
    if (!adminKey || adminKey !== process.env.ADMIN_PUBLIC_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const existing = await getFeatureRequest(id);
    if (!existing) {
      return NextResponse.json({ error: 'Feature request not found' }, { status: 404 });
    }

    await deleteFeatureRequest(id);
    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    console.error('Delete feature request error:', error);
    return NextResponse.json(
      { error: 'Failed to delete feature request' },
      { status: 500 }
    );
  }
}
