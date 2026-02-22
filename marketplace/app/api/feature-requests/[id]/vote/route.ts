import { NextRequest, NextResponse } from 'next/server';
import { VotePayload } from '@/lib/types';
import {
  verifySignature,
  buildSignatureData,
  isTimestampValid,
} from '@/lib/crypto';
import { getInstanceById, getFeatureRequest, upsertVote } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: featureRequestId } = await params;
    const body = (await request.json()) as VotePayload;

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

    // --- Look up instance for public_key ---
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

    // --- Validate vote value ---
    if (body.value !== 1 && body.value !== -1) {
      return NextResponse.json(
        { error: 'Vote value must be 1 or -1' },
        { status: 400 }
      );
    }

    // --- Check feature request exists ---
    const featureRequest = await getFeatureRequest(featureRequestId);
    if (!featureRequest) {
      return NextResponse.json(
        { error: 'Feature request not found' },
        { status: 404 }
      );
    }

    // --- Upsert vote ---
    await upsertVote({
      id: `vote-${body.instance_id}-${featureRequestId}`,
      feature_request_id: featureRequestId,
      instance_id: body.instance_id,
      value: body.value,
    });

    // --- Return updated feature request ---
    const updated = await getFeatureRequest(featureRequestId);

    return NextResponse.json({ feature_request: updated });
  } catch (error) {
    console.error('Vote error:', error);
    return NextResponse.json(
      { error: 'Vote failed' },
      { status: 500 }
    );
  }
}
