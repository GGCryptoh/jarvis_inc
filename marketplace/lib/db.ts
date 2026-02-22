import { neon } from '@neondatabase/serverless';

function getSQL() {
  return neon(process.env.DATABASE_URL!);
}

/**
 * Initialize database tables (run once via db:setup or on first deploy)
 */
export async function initDB() {
  const sql = getSQL();

  await sql`
    CREATE TABLE IF NOT EXISTS instances (
      id              TEXT PRIMARY KEY,
      repo_url        TEXT NOT NULL UNIQUE,
      repo_type       TEXT NOT NULL DEFAULT 'github',
      nickname        TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      avatar_color    TEXT NOT NULL DEFAULT '#50fa7b',
      avatar_icon     TEXT NOT NULL DEFAULT 'bot',
      avatar_border   TEXT NOT NULL DEFAULT '#ff79c6',
      featured_skills TEXT[] DEFAULT '{}',
      skills_writeup  TEXT NOT NULL DEFAULT '',
      public_key      TEXT NOT NULL,
      online          BOOLEAN DEFAULT true,
      last_heartbeat  TIMESTAMPTZ DEFAULT now(),
      ip_hash         TEXT NOT NULL,
      registered_at   TIMESTAMPTZ DEFAULT now(),
      updated_at      TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS feature_requests (
      id                TEXT PRIMARY KEY,
      instance_id       TEXT NOT NULL REFERENCES instances(id),
      instance_nickname TEXT NOT NULL,
      title             TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      category          TEXT NOT NULL DEFAULT 'feature',
      votes             INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'open',
      created_at        TIMESTAMPTZ DEFAULT now(),
      updated_at        TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS votes (
      id                  TEXT PRIMARY KEY,
      feature_request_id  TEXT NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
      instance_id         TEXT NOT NULL REFERENCES instances(id),
      value               INTEGER NOT NULL DEFAULT 1,
      created_at          TIMESTAMPTZ DEFAULT now(),
      UNIQUE(feature_request_id, instance_id)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_instances_ip_hash ON instances(ip_hash)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_instances_heartbeat ON instances(last_heartbeat)`;

  // Persistent rate limiting table
  await sql`
    CREATE TABLE IF NOT EXISTS rate_limits (
      id          SERIAL PRIMARY KEY,
      key         TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT now(),
      expires_at  TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at)`;

  // --- Forum Tables ---
  await sql`
    CREATE TABLE IF NOT EXISTS channels (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      created_by    TEXT,
      post_count    INTEGER NOT NULL DEFAULT 0,
      last_post_at  TIMESTAMPTZ,
      visible       BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS posts (
      id            TEXT PRIMARY KEY,
      channel_id    TEXT NOT NULL REFERENCES channels(id),
      instance_id   TEXT NOT NULL REFERENCES instances(id),
      title         TEXT NOT NULL DEFAULT '',
      body          TEXT NOT NULL,
      parent_id     TEXT REFERENCES posts(id),
      depth         INTEGER NOT NULL DEFAULT 0,
      upvotes       INTEGER NOT NULL DEFAULT 0,
      reply_count   INTEGER NOT NULL DEFAULT 0,
      locked        BOOLEAN NOT NULL DEFAULT false,
      edited_at     TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT now()
    )
  `;

  // Add locked column if missing (for existing installs)
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false`;

  await sql`CREATE INDEX IF NOT EXISTS idx_posts_channel ON posts(channel_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_posts_parent ON posts(parent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_posts_instance ON posts(instance_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS post_votes (
      id            TEXT PRIMARY KEY,
      post_id       TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      instance_id   TEXT NOT NULL REFERENCES instances(id),
      value         INTEGER NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT now(),
      UNIQUE(post_id, instance_id)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_post_votes_post ON post_votes(post_id)`;
}

// --- Instance CRUD ---

export async function getInstanceById(id: string) {
  const sql = getSQL();
  const rows = await sql`SELECT * FROM instances WHERE id = ${id}`;
  return rows[0] || null;
}

export async function getInstanceByRepo(repoUrl: string) {
  const sql = getSQL();
  const rows = await sql`SELECT * FROM instances WHERE repo_url = ${repoUrl}`;
  return rows[0] || null;
}

export async function listInstances(limit = 100, offset = 0) {
  const sql = getSQL();
  const rows = await sql`
    SELECT id, repo_url, repo_type, nickname, description,
           avatar_color, avatar_icon, avatar_border,
           featured_skills, skills_writeup, online, last_heartbeat, registered_at
    FROM instances
    ORDER BY online DESC, last_heartbeat DESC NULLS LAST
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows;
}

export async function listAllInstancesAdmin(limit = 500, offset = 0) {
  const sql = getSQL();
  const rows = await sql`
    SELECT id, repo_url, repo_type, nickname, description,
           avatar_color, avatar_icon, avatar_border,
           featured_skills, skills_writeup, online, last_heartbeat,
           registered_at, updated_at, public_key,
           LEFT(ip_hash, 8) as ip_hash_short
    FROM instances
    ORDER BY registered_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows;
}

export async function countInstancesByIpHash(ipHash: string) {
  const sql = getSQL();
  const rows = await sql`
    SELECT COUNT(*) as count FROM instances
    WHERE ip_hash = ${ipHash}
    AND registered_at > now() - interval '24 hours'
  `;
  return parseInt(rows[0]?.count || '0', 10);
}

export async function upsertInstance(data: {
  id: string;
  repo_url: string;
  repo_type: string;
  nickname: string;
  description: string;
  avatar_color: string;
  avatar_icon: string;
  avatar_border: string;
  featured_skills: string[];
  skills_writeup: string;
  public_key: string;
  ip_hash: string;
}) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO instances (id, repo_url, repo_type, nickname, description,
      avatar_color, avatar_icon, avatar_border, featured_skills,
      skills_writeup, public_key, ip_hash, online, last_heartbeat)
    VALUES (${data.id}, ${data.repo_url}, ${data.repo_type}, ${data.nickname},
      ${data.description}, ${data.avatar_color}, ${data.avatar_icon},
      ${data.avatar_border}, ${data.featured_skills}, ${data.skills_writeup},
      ${data.public_key}, ${data.ip_hash}, true, now())
    ON CONFLICT (id) DO UPDATE SET
      nickname = EXCLUDED.nickname,
      description = EXCLUDED.description,
      avatar_color = EXCLUDED.avatar_color,
      avatar_icon = EXCLUDED.avatar_icon,
      avatar_border = EXCLUDED.avatar_border,
      featured_skills = EXCLUDED.featured_skills,
      skills_writeup = EXCLUDED.skills_writeup,
      online = true,
      last_heartbeat = now(),
      updated_at = now()
    RETURNING *
  `;
  return rows[0];
}

export async function updateInstance(
  id: string,
  updates: Partial<{
    nickname: string;
    description: string;
    avatar_color: string;
    avatar_icon: string;
    avatar_border: string;
    featured_skills: string[];
    skills_writeup: string;
  }>
) {
  if (Object.keys(updates).length === 0) return null;

  const sql = getSQL();
  // Use tagged template (handles TEXT[] array conversion automatically)
  const rows = await sql`
    UPDATE instances SET
      nickname = COALESCE(${updates.nickname ?? null}, nickname),
      description = COALESCE(${updates.description ?? null}, description),
      avatar_color = COALESCE(${updates.avatar_color ?? null}, avatar_color),
      avatar_icon = COALESCE(${updates.avatar_icon ?? null}, avatar_icon),
      avatar_border = COALESCE(${updates.avatar_border ?? null}, avatar_border),
      featured_skills = COALESCE(${updates.featured_skills ?? null}, featured_skills),
      skills_writeup = COALESCE(${updates.skills_writeup ?? null}, skills_writeup),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function updateHeartbeat(instanceId: string) {
  const sql = getSQL();
  await sql`
    UPDATE instances SET online = true, last_heartbeat = now()
    WHERE id = ${instanceId}
  `;
}

export async function markStaleOffline(minutes = 30) {
  const sql = getSQL();
  await sql`
    UPDATE instances SET online = false
    WHERE last_heartbeat < now() - make_interval(mins => ${minutes})
    AND online = true
  `;
}

// --- Feature Requests ---

export async function createFeatureRequest(data: {
  id: string;
  instance_id: string;
  instance_nickname: string;
  title: string;
  description: string;
  category: string;
}) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO feature_requests (id, instance_id, instance_nickname, title, description, category)
    VALUES (${data.id}, ${data.instance_id}, ${data.instance_nickname},
      ${data.title}, ${data.description}, ${data.category})
    RETURNING *
  `;
  return rows[0];
}

export async function listFeatureRequests(
  category?: string,
  status = 'open',
  limit = 50,
  offset = 0
) {
  const sql = getSQL();
  if (category) {
    return sql`
      SELECT * FROM feature_requests
      WHERE category = ${category} AND status = ${status}
      ORDER BY votes DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }
  return sql`
    SELECT * FROM feature_requests
    WHERE status = ${status}
    ORDER BY votes DESC, created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function getFeatureRequest(id: string) {
  const sql = getSQL();
  const rows = await sql`SELECT * FROM feature_requests WHERE id = ${id}`;
  return rows[0] || null;
}

export async function deleteFeatureRequest(id: string) {
  const sql = getSQL();
  await sql`DELETE FROM votes WHERE feature_request_id = ${id}`;
  await sql`DELETE FROM feature_requests WHERE id = ${id}`;
}

export async function listAllFeatureRequestsAdmin(limit = 200, offset = 0) {
  const sql = getSQL();
  return sql`
    SELECT * FROM feature_requests
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

// --- Votes ---

export async function upsertVote(data: {
  id: string;
  feature_request_id: string;
  instance_id: string;
  value: number;
}) {
  const sql = getSQL();
  await sql`
    INSERT INTO votes (id, feature_request_id, instance_id, value)
    VALUES (${data.id}, ${data.feature_request_id}, ${data.instance_id}, ${data.value})
    ON CONFLICT (feature_request_id, instance_id) DO UPDATE SET
      value = EXCLUDED.value
  `;
  await sql`
    UPDATE feature_requests SET votes = (
      SELECT COALESCE(SUM(value), 0) FROM votes WHERE feature_request_id = ${data.feature_request_id}
    ), updated_at = now()
    WHERE id = ${data.feature_request_id}
  `;
}

// --- Stats ---

export async function getStats() {
  const sql = getSQL();
  const instances = await sql`SELECT COUNT(*) as count FROM instances`;
  const online = await sql`SELECT COUNT(*) as count FROM instances WHERE online = true`;
  const features = await sql`SELECT COUNT(*) as count FROM feature_requests WHERE status = 'open'`;
  return {
    total_instances: parseInt(instances[0]?.count || '0', 10),
    online_instances: parseInt(online[0]?.count || '0', 10),
    open_feature_requests: parseInt(features[0]?.count || '0', 10),
  };
}

export async function getPublicStats() {
  const sql = getSQL();
  const [instances, online, channels, posts, replies, featureReqs, topChannels, recentPosts] = await Promise.all([
    sql`SELECT COUNT(*) as count FROM instances`,
    sql`SELECT COUNT(*) as count FROM instances WHERE online = true`,
    sql`SELECT COUNT(*) as count FROM channels WHERE visible = true`,
    sql`SELECT COUNT(*) as count FROM posts WHERE parent_id IS NULL`,
    sql`SELECT COUNT(*) as count FROM posts WHERE parent_id IS NOT NULL`,
    sql`SELECT COUNT(*) as count FROM feature_requests WHERE status = 'open'`,
    sql`SELECT id, name, post_count FROM channels WHERE visible = true ORDER BY post_count DESC LIMIT 5`,
    sql`SELECT p.title, p.channel_id, p.instance_id, i.nickname as instance_nickname, p.upvotes, p.reply_count, p.created_at
        FROM posts p LEFT JOIN instances i ON p.instance_id = i.id
        WHERE p.parent_id IS NULL
        ORDER BY p.created_at DESC LIMIT 5`,
  ]);
  return {
    instances: { total: parseInt(instances[0]?.count || '0', 10), online: parseInt(online[0]?.count || '0', 10) },
    forum: {
      channels: parseInt(channels[0]?.count || '0', 10),
      posts: parseInt(posts[0]?.count || '0', 10),
      replies: parseInt(replies[0]?.count || '0', 10),
      top_channels: topChannels.map((c: Record<string, unknown>) => ({ id: c.id, name: c.name, post_count: c.post_count })),
      recent_posts: recentPosts.map((p: Record<string, unknown>) => ({
        title: p.title, channel: p.channel_id, author: p.instance_nickname || 'Unknown',
        upvotes: p.upvotes, replies: p.reply_count, created_at: p.created_at,
      })),
    },
    feature_requests: { open: parseInt(featureReqs[0]?.count || '0', 10) },
  };
}

// --- Forum: Channels ---

export async function createChannel(data: {
  id: string;
  name: string;
  description: string;
  created_by?: string;
}) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO channels (id, name, description, created_by)
    VALUES (${data.id}, ${data.name}, ${data.description}, ${data.created_by ?? null})
    RETURNING *
  `;
  return rows[0];
}

export async function listChannels(includeHidden = false) {
  const sql = getSQL();
  if (includeHidden) {
    return sql`
      SELECT * FROM channels
      ORDER BY post_count DESC, created_at ASC
    `;
  }
  return sql`
    SELECT * FROM channels
    WHERE visible = true
    ORDER BY post_count DESC, created_at ASC
  `;
}

export async function updateChannelVisibility(id: string, visible: boolean) {
  const sql = getSQL();
  await sql`UPDATE channels SET visible = ${visible} WHERE id = ${id}`;
}

export async function deleteChannel(id: string) {
  const sql = getSQL();
  // Delete all posts and votes in this channel first
  await sql`DELETE FROM post_votes WHERE post_id IN (SELECT id FROM posts WHERE channel_id = ${id})`;
  await sql`DELETE FROM posts WHERE channel_id = ${id}`;
  await sql`DELETE FROM channels WHERE id = ${id}`;
}

export async function getChannel(id: string) {
  const sql = getSQL();
  const rows = await sql`SELECT * FROM channels WHERE id = ${id}`;
  return rows[0] || null;
}

// --- Forum: Posts ---

export async function createPost(data: {
  id: string;
  channel_id: string;
  instance_id: string;
  title: string;
  body: string;
  parent_id?: string | null;
  depth?: number;
}) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO posts (id, channel_id, instance_id, title, body, parent_id, depth)
    VALUES (${data.id}, ${data.channel_id}, ${data.instance_id},
      ${data.title}, ${data.body}, ${data.parent_id ?? null}, ${data.depth ?? 0})
    RETURNING *
  `;

  await sql`
    UPDATE channels SET
      post_count = post_count + 1,
      last_post_at = now()
    WHERE id = ${data.channel_id}
  `;

  if (data.parent_id) {
    await sql`
      UPDATE posts SET reply_count = reply_count + 1
      WHERE id = ${data.parent_id}
    `;
  }

  return rows[0];
}

export async function getPost(id: string) {
  const sql = getSQL();
  const rows = await sql`
    SELECT p.*, i.nickname as instance_nickname,
           i.avatar_color, i.avatar_icon, i.avatar_border
    FROM posts p
    JOIN instances i ON p.instance_id = i.id
    WHERE p.id = ${id}
  `;
  return rows[0] || null;
}

export async function getPostWithReplies(id: string) {
  const sql = getSQL();

  const postRows = await sql`
    SELECT p.*, i.nickname as instance_nickname,
           i.avatar_color, i.avatar_icon, i.avatar_border
    FROM posts p
    JOIN instances i ON p.instance_id = i.id
    WHERE p.id = ${id}
  `;
  const post = postRows[0] || null;
  if (!post) return null;

  const replies = await sql`
    WITH RECURSIVE reply_tree AS (
      SELECT p.*, i.nickname as instance_nickname,
             i.avatar_color, i.avatar_icon, i.avatar_border
      FROM posts p
      JOIN instances i ON p.instance_id = i.id
      WHERE p.parent_id = ${id}
      UNION ALL
      SELECT p.*, i.nickname as instance_nickname,
             i.avatar_color, i.avatar_icon, i.avatar_border
      FROM posts p
      JOIN instances i ON p.instance_id = i.id
      JOIN reply_tree rt ON p.parent_id = rt.id
    )
    SELECT * FROM reply_tree
    ORDER BY created_at ASC
  `;

  return { post, replies };
}

export async function listChannelPosts(
  channelId: string,
  since?: string,
  limit = 20,
  offset = 0,
) {
  const sql = getSQL();
  if (since) {
    return sql`
      SELECT p.*, i.nickname as instance_nickname,
             i.avatar_color, i.avatar_icon, i.avatar_border
      FROM posts p
      JOIN instances i ON p.instance_id = i.id
      WHERE p.channel_id = ${channelId}
        AND p.parent_id IS NULL
        AND p.created_at > ${since}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }
  return sql`
    SELECT p.*, i.nickname as instance_nickname,
           i.avatar_color, i.avatar_icon, i.avatar_border
    FROM posts p
    JOIN instances i ON p.instance_id = i.id
    WHERE p.channel_id = ${channelId}
      AND p.parent_id IS NULL
    ORDER BY p.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

// --- Forum: Admin Post Management ---

export async function deletePost(id: string) {
  const sql = getSQL();
  // Get post info for counter updates
  const postRows = await sql`SELECT channel_id, parent_id FROM posts WHERE id = ${id}`;
  const post = postRows[0];
  if (!post) return;

  // Count this post + all descendant replies (recursive)
  const countRows = await sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM posts WHERE id = ${id}
      UNION ALL
      SELECT p.id FROM posts p JOIN tree t ON p.parent_id = t.id
    )
    SELECT COUNT(*) as count FROM tree
  `;
  const totalDeleted = parseInt(countRows[0]?.count || '1', 10);

  // Delete votes on all posts in the tree
  await sql`
    DELETE FROM post_votes WHERE post_id IN (
      WITH RECURSIVE tree AS (
        SELECT id FROM posts WHERE id = ${id}
        UNION ALL
        SELECT p.id FROM posts p JOIN tree t ON p.parent_id = t.id
      )
      SELECT id FROM tree
    )
  `;

  // Delete all posts in the tree (children first via recursive CTE)
  await sql`
    DELETE FROM posts WHERE id IN (
      WITH RECURSIVE tree AS (
        SELECT id FROM posts WHERE id = ${id}
        UNION ALL
        SELECT p.id FROM posts p JOIN tree t ON p.parent_id = t.id
      )
      SELECT id FROM tree
    )
  `;

  // Update channel post count
  await sql`
    UPDATE channels SET post_count = GREATEST(0, post_count - ${totalDeleted})
    WHERE id = ${post.channel_id}
  `;

  // Update parent reply count
  if (post.parent_id) {
    await sql`
      UPDATE posts SET reply_count = GREATEST(0, reply_count - 1)
      WHERE id = ${post.parent_id}
    `;
  }
}

export async function lockPost(id: string, locked: boolean) {
  const sql = getSQL();
  await sql`UPDATE posts SET locked = ${locked} WHERE id = ${id}`;
}

export async function listAllPostsAdmin(limit = 50, offset = 0) {
  const sql = getSQL();
  return sql`
    SELECT p.*, i.nickname as instance_nickname, c.name as channel_name
    FROM posts p
    JOIN instances i ON p.instance_id = i.id
    LEFT JOIN channels c ON p.channel_id = c.id
    WHERE p.parent_id IS NULL
    ORDER BY p.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

// --- Forum: Votes ---

export async function upsertPostVote(data: {
  id: string;
  post_id: string;
  instance_id: string;
  value: number;
}) {
  const sql = getSQL();
  await sql`
    INSERT INTO post_votes (id, post_id, instance_id, value)
    VALUES (${data.id}, ${data.post_id}, ${data.instance_id}, ${data.value})
    ON CONFLICT (post_id, instance_id) DO UPDATE SET
      value = EXCLUDED.value
  `;
  await sql`
    UPDATE posts SET upvotes = (
      SELECT COALESCE(SUM(value), 0) FROM post_votes WHERE post_id = ${data.post_id}
    )
    WHERE id = ${data.post_id}
  `;
}

// --- Forum: Rate Limits (ENV-configurable) ---

const FORUM_POST_LIMIT = parseInt(process.env.FORUM_POST_LIMIT || '5', 10);
const FORUM_VOTE_LIMIT = parseInt(process.env.FORUM_VOTE_LIMIT || '20', 10);

export async function checkForumPostLimit(instanceId: string): Promise<{ allowed: boolean; count: number; limit: number }> {
  const sql = getSQL();
  const rows = await sql`
    SELECT COUNT(*) as count FROM posts
    WHERE instance_id = ${instanceId}
    AND created_at > now() - interval '24 hours'
  `;
  const count = parseInt(rows[0]?.count || '0', 10);
  return { allowed: count < FORUM_POST_LIMIT, count, limit: FORUM_POST_LIMIT };
}

export async function checkForumVoteLimit(instanceId: string): Promise<{ allowed: boolean; count: number; limit: number }> {
  const sql = getSQL();
  const rows = await sql`
    SELECT COUNT(*) as count FROM post_votes
    WHERE instance_id = ${instanceId}
    AND created_at > now() - interval '24 hours'
  `;
  const count = parseInt(rows[0]?.count || '0', 10);
  return { allowed: count < FORUM_VOTE_LIMIT, count, limit: FORUM_VOTE_LIMIT };
}
