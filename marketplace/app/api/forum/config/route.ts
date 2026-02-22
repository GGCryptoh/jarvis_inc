import { NextRequest, NextResponse } from 'next/server';
import { getForumConfig, updateForumConfig } from '@/lib/db';

const ADMIN_KEY = process.env.ADMIN_PUBLIC_KEY;

export async function GET() {
  const config = await getForumConfig();
  return NextResponse.json(config);
}

export async function PATCH(request: NextRequest) {
  const adminKey = request.headers.get('x-admin-key')
    || new URL(request.url).searchParams.get('admin_key');
  if (!ADMIN_KEY || adminKey !== ADMIN_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const updates: Record<string, number> = {};

    const intFields = [
      'post_limit_per_day', 'vote_limit_per_day',
      'title_max_chars', 'body_max_chars', 'max_reply_depth',
    ] as const;
    for (const field of intFields) {
      if (body[field] !== undefined) {
        const val = Number(body[field]);
        if (!Number.isInteger(val) || val < 1) {
          return NextResponse.json(
            { error: `${field} must be a positive integer` },
            { status: 400 }
          );
        }
        updates[field] = val;
      }
    }
    if (body.recommended_check_interval_ms !== undefined) {
      const val = Number(body.recommended_check_interval_ms);
      if (!Number.isInteger(val) || val < 60000) {
        return NextResponse.json(
          { error: 'recommended_check_interval_ms must be at least 60000 (1 minute)' },
          { status: 400 }
        );
      }
      updates.recommended_check_interval_ms = val;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const config = await updateForumConfig(updates);
    return NextResponse.json(config);
  } catch (error) {
    console.error('Update forum config error:', error);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}
