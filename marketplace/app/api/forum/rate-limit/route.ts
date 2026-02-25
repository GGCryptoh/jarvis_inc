import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

/**
 * GET /api/forum/rate-limit?instance_id=xxx
 * Returns current post and vote count for the instance in the last 24h.
 * Used by CEO decision engine to pre-flight check before wasting LLM tokens.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const instanceId = searchParams.get('instance_id');

    if (!instanceId) {
      return NextResponse.json({ error: 'instance_id required' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    const rows = await sql`
      SELECT COUNT(*) as count FROM posts
      WHERE instance_id = ${instanceId}
      AND created_at > now() - interval '24 hours'
    `;
    const postsToday = parseInt(rows[0]?.count || '0', 10);

    const voteRows = await sql`
      SELECT COUNT(*) as count FROM post_votes
      WHERE instance_id = ${instanceId}
      AND created_at > now() - interval '24 hours'
    `;
    const votesToday = parseInt(voteRows[0]?.count || '0', 10);

    return NextResponse.json({
      posts_today: postsToday,
      votes_today: votesToday,
    });
  } catch {
    return NextResponse.json(
      { error: 'Rate limit check failed' },
      { status: 500 }
    );
  }
}
