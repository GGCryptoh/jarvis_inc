import { NextRequest, NextResponse } from 'next/server';
import { ProfileUpdatePayload } from '@/lib/types';
import {
  verifySignature,
  buildSignatureData,
  isTimestampValid,
} from '@/lib/crypto';
import { getInstanceById, updateInstance, updateHeartbeat } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Instance ID is required' },
        { status: 400 }
      );
    }

    const instance = await getInstanceById(id);

    if (!instance) {
      return NextResponse.json(
        { error: 'Instance not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ instance });
  } catch (error) {
    console.error('Profile error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Instance ID is required' },
        { status: 400 }
      );
    }

    const body = (await request.json()) as ProfileUpdatePayload;

    // --- Validate timestamp (anti-replay) ---
    if (!body.timestamp || !isTimestampValid(body.timestamp)) {
      return NextResponse.json(
        { error: 'Invalid or expired timestamp — must be within 5 minutes' },
        { status: 400 }
      );
    }

    // --- Look up instance ---
    const instance = await getInstanceById(id);
    if (!instance) {
      return NextResponse.json(
        { error: 'Instance not found' },
        { status: 404 }
      );
    }

    // --- Verify public_key matches the stored key ---
    if (!body.public_key || body.public_key !== instance.public_key) {
      return NextResponse.json(
        { error: 'Public key does not match the registered instance' },
        { status: 403 }
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
    if (body.nickname !== undefined && (typeof body.nickname !== 'string' || body.nickname.length > 24)) {
      return NextResponse.json(
        { error: 'Nickname must be 24 characters or fewer' },
        { status: 400 }
      );
    }

    if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 500)) {
      return NextResponse.json(
        { error: 'Description must be 500 characters or fewer' },
        { status: 400 }
      );
    }

    // --- Build update object from provided fields ---
    const updates: Partial<{
      nickname: string;
      description: string;
      avatar_color: string;
      avatar_icon: string;
      avatar_border: string;
      featured_skills: string[];
      skills_writeup: string;
    }> = {};

    if (body.nickname !== undefined) updates.nickname = body.nickname;
    if (body.description !== undefined) updates.description = body.description;
    if (body.avatar_color !== undefined) updates.avatar_color = body.avatar_color;
    if (body.avatar_icon !== undefined) updates.avatar_icon = body.avatar_icon;
    if (body.avatar_border !== undefined) updates.avatar_border = body.avatar_border;
    if ((body as unknown as Record<string, unknown>).featured_skills !== undefined) updates.featured_skills = (body as unknown as Record<string, unknown>).featured_skills as string[];
    if ((body as unknown as Record<string, unknown>).skills_writeup !== undefined) updates.skills_writeup = String((body as unknown as Record<string, unknown>).skills_writeup).substring(0, 1000);

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const updated = await updateInstance(id, updates);
    await updateHeartbeat(id);

    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to update instance' },
        { status: 500 }
      );
    }

    return NextResponse.json({ instance: updated });
  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}

// Accept both POST and PUT for profile updates
// (signedMarketplacePost sends POST by default)
export const POST = PUT;
