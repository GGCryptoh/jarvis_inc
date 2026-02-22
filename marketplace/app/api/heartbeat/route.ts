import { NextRequest, NextResponse } from 'next/server';
import { HeartbeatPayload } from '@/lib/types';
import {
  verifySignature,
  buildSignatureData,
  isTimestampValid,
} from '@/lib/crypto';
import { getInstanceById, updateHeartbeat } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as HeartbeatPayload;

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

    // --- Look up instance to get public_key ---
    const instance = await getInstanceById(body.instance_id);
    if (!instance) {
      return NextResponse.json(
        { error: 'Instance not found' },
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

    // --- Update heartbeat ---
    await updateHeartbeat(body.instance_id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Heartbeat error:', error);
    return NextResponse.json(
      { error: 'Heartbeat failed' },
      { status: 500 }
    );
  }
}
