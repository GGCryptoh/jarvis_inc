/**
 * Persistent rate limiter backed by Neon Postgres
 *
 * Survives Vercel cold starts — rate limit state lives in the DB.
 * Uses a simple rate_limits table with automatic cleanup.
 */

import { neon } from '@neondatabase/serverless';

function getSQL() {
  return neon(process.env.DATABASE_URL!);
}

/**
 * Check and increment rate limit for a given key.
 *
 * @param key - Rate limit bucket key (e.g. "register:abc123")
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Window duration in milliseconds
 */
export async function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const sql = getSQL();
  const windowSeconds = Math.ceil(windowMs / 1000);
  const now = Date.now();
  const resetAt = now + windowMs;

  // Clean old entries and count current window in one go
  await sql`
    DELETE FROM rate_limits
    WHERE expires_at < now()
  `;

  const countRows = await sql`
    SELECT COUNT(*) as count FROM rate_limits
    WHERE key = ${key}
    AND created_at > now() - make_interval(secs => ${windowSeconds})
  `;
  const currentCount = parseInt(countRows[0]?.count || '0', 10);

  if (currentCount >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt };
  }

  // Insert new entry
  await sql`
    INSERT INTO rate_limits (key, created_at, expires_at)
    VALUES (${key}, now(), now() + make_interval(secs => ${windowSeconds}))
  `;

  return {
    allowed: true,
    remaining: maxRequests - currentCount - 1,
    resetAt,
  };
}
