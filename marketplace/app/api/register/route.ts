import { NextRequest, NextResponse } from 'next/server';
import { RegisterPayload } from '@/lib/types';
import {
  instanceIdFromKey,
  hashIP,
  verifySignature,
  buildSignatureData,
  isTimestampValid,
} from '@/lib/crypto';
import { upsertInstance } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

function getClientIP(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RegisterPayload;

    // --- Rate limit: 3 registrations per IP per day (persistent in DB) ---
    const clientIP = getClientIP(request);
    const ipHash = hashIP(clientIP);
    const { allowed, remaining, resetAt } = await rateLimit(
      `register:${ipHash}`,
      20, // Generous during dev — tighten to 3 for prod
      24 * 60 * 60 * 1000 // 24 hours
    );
    if (!allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded — max 3 registrations per day',
          resetAt,
        },
        { status: 429 }
      );
    }

    // --- Validate timestamp (anti-replay) ---
    if (!body.timestamp || !isTimestampValid(body.timestamp)) {
      return NextResponse.json(
        { error: 'Invalid or expired timestamp — must be within 5 minutes' },
        { status: 400 }
      );
    }

    // --- Verify Ed25519 signature ---
    if (!body.public_key || !body.signature) {
      return NextResponse.json(
        { error: 'Missing public_key or signature' },
        { status: 400 }
      );
    }
    const signatureData = buildSignatureData(body as unknown as Record<string, unknown>);
    if (!verifySignature(body.public_key, body.signature, signatureData)) {
      // Debug: include data lengths to diagnose mismatch
      const sigBytes = Buffer.from(body.signature, 'base64');
      const pubBytes = Buffer.from(body.public_key, 'base64');
      return NextResponse.json(
        {
          error: 'Invalid signature',
          debug: {
            signatureDataLength: signatureData.length,
            signatureDataPreview: signatureData.substring(0, 200),
            signatureBytesLength: sigBytes.length,
            publicKeyBytesLength: pubBytes.length,
            fieldsSigned: Object.keys(JSON.parse(signatureData)).join(', '),
          },
        },
        { status: 401 }
      );
    }

    // --- Validate fields ---
    if (!body.nickname || body.nickname.length > 24) {
      return NextResponse.json(
        { error: 'Nickname is required and must be 24 characters or fewer' },
        { status: 400 }
      );
    }

    if (body.description && body.description.length > 500) {
      return NextResponse.json(
        { error: 'Description must be 500 characters or fewer' },
        { status: 400 }
      );
    }

    // --- Generate instance ID from public key (unique per installation) ---
    const instanceId = instanceIdFromKey(body.public_key);

    const instance = await upsertInstance({
      id: instanceId,
      repo_url: body.repo_url || '',
      repo_type: body.repo_type || 'github',
      nickname: body.nickname,
      description: body.description || '',
      avatar_color: body.avatar_color || '#50fa7b',
      avatar_icon: body.avatar_icon || 'bot',
      avatar_border: body.avatar_border || '#ff79c6',
      featured_skills: body.featured_skills || [],
      skills_writeup: body.skills_writeup || '',
      public_key: body.public_key,
      ip_hash: ipHash,
      local_ports: body.local_ports || null,
      lan_hostname: body.lan_hostname || null,
    });

    return NextResponse.json(
      { instance, remaining },
      { status: 201 }
    );
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    );
  }
}
