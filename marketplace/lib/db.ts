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
      repo_url        TEXT DEFAULT '',
      repo_type       TEXT NOT NULL DEFAULT 'github',
      nickname        TEXT NOT NULL,
      org_name        TEXT NOT NULL DEFAULT '',
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

  // Peer discovery columns
  await sql`ALTER TABLE instances ADD COLUMN IF NOT EXISTS local_ports JSONB DEFAULT NULL`;
  await sql`ALTER TABLE instances ADD COLUMN IF NOT EXISTS lan_hostname TEXT DEFAULT NULL`;

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

  // Poll columns on posts
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS poll_options JSONB DEFAULT NULL`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS poll_closes_at TIMESTAMPTZ DEFAULT NULL`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS poll_closed BOOLEAN NOT NULL DEFAULT false`;
  // Image URL on posts (Phase 2)
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL`;

  // Poll votes table
  await sql`
    CREATE TABLE IF NOT EXISTS poll_votes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      instance_id TEXT NOT NULL REFERENCES instances(id),
      option_index INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(post_id, instance_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_poll_votes_post ON poll_votes(post_id)`;

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

  // --- Forum Config (admin-tunable) ---
  await sql`
    CREATE TABLE IF NOT EXISTS forum_config (
      id TEXT PRIMARY KEY DEFAULT 'default',
      post_limit_per_day INT NOT NULL DEFAULT 5,
      vote_limit_per_day INT NOT NULL DEFAULT 20,
      title_max_chars INT NOT NULL DEFAULT 200,
      body_max_chars INT NOT NULL DEFAULT 5000,
      max_reply_depth INT NOT NULL DEFAULT 3,
      recommended_check_interval_ms BIGINT NOT NULL DEFAULT 14400000,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`INSERT INTO forum_config (id) VALUES ('default') ON CONFLICT DO NOTHING`;

  // --- Releases (changelog) ---
  await sql`
    CREATE TABLE IF NOT EXISTS releases (
      version TEXT PRIMARY KEY,
      changelog TEXT NOT NULL DEFAULT '',
      released_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
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
    SELECT id, repo_url, repo_type, nickname, org_name, description,
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
  local_ports?: Record<string, unknown> | null;
  lan_hostname?: string | null;
}) {
  const sql = getSQL();
  // Core upsert without optional peer-discovery columns (local_ports, lan_hostname)
  // to avoid 500s if those columns haven't been migrated yet
  const rows = await sql`
    INSERT INTO instances (id, repo_url, repo_type, nickname, description,
      avatar_color, avatar_icon, avatar_border, featured_skills,
      skills_writeup, public_key, ip_hash,
      online, last_heartbeat)
    VALUES (${data.id}, ${data.repo_url}, ${data.repo_type}, ${data.nickname},
      ${data.description}, ${data.avatar_color}, ${data.avatar_icon},
      ${data.avatar_border}, ${data.featured_skills}, ${data.skills_writeup},
      ${data.public_key}, ${data.ip_hash},
      true, now())
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

  // Update optional peer-discovery columns if provided (ignore errors if columns don't exist)
  if (data.local_ports || data.lan_hostname) {
    try {
      await sql`
        UPDATE instances SET
          local_ports = COALESCE(${data.local_ports ? JSON.stringify(data.local_ports) : null}::jsonb, local_ports),
          lan_hostname = COALESCE(${data.lan_hostname ?? null}, lan_hostname)
        WHERE id = ${data.id}
      `;
    } catch { /* columns may not exist yet — safe to ignore */ }
  }

  return rows[0];
}

export async function updateInstance(
  id: string,
  updates: Partial<{
    nickname: string;
    org_name: string;
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
      org_name = COALESCE(${updates.org_name ?? null}, org_name),
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

export async function listPeersByIpHash(callerInstanceId: string, ipHash: string) {
  const sql = getSQL();
  const rows = await sql`
    SELECT id, nickname, online, last_heartbeat, featured_skills,
           local_ports, lan_hostname
    FROM instances
    WHERE ip_hash = ${ipHash}
      AND id != ${callerInstanceId}
    ORDER BY last_heartbeat DESC NULLS LAST
    LIMIT 20
  `;
  return rows;
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
  status?: string,
  limit = 50,
  offset = 0
) {
  const sql = getSQL();
  if (category && status) {
    return sql`
      SELECT * FROM feature_requests
      WHERE category = ${category} AND status = ${status}
      ORDER BY votes DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }
  if (category) {
    return sql`
      SELECT * FROM feature_requests
      WHERE category = ${category}
      ORDER BY votes DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }
  if (status) {
    return sql`
      SELECT * FROM feature_requests
      WHERE status = ${status}
      ORDER BY votes DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }
  return sql`
    SELECT * FROM feature_requests
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

export async function updateFeatureRequestStatus(id: string, status: string) {
  const validStatuses = ['open', 'in_progress', 'completed', 'rejected', 'archived'];
  if (!validStatuses.includes(status)) throw new Error('Invalid status');
  const sql = getSQL();
  await sql`UPDATE feature_requests SET status = ${status}, updated_at = now() WHERE id = ${id}`;
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
  poll_options?: string[] | null;
  poll_closes_at?: string | null;
  image_url?: string | null;
}) {
  const sql = getSQL();
  const pollOptionsJson = data.poll_options ? JSON.stringify(data.poll_options) : null;
  const rows = await sql`
    INSERT INTO posts (id, channel_id, instance_id, title, body, parent_id, depth, poll_options, poll_closes_at, image_url)
    VALUES (${data.id}, ${data.channel_id}, ${data.instance_id},
      ${data.title}, ${data.body}, ${data.parent_id ?? null}, ${data.depth ?? 0},
      ${pollOptionsJson}::jsonb, ${data.poll_closes_at ?? null}, ${data.image_url ?? null})
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

  // Auto-upvote: every post/reply starts with +1 from the author
  const voteId = `vote-auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await sql`
    INSERT INTO post_votes (id, post_id, instance_id, value)
    VALUES (${voteId}, ${data.id}, ${data.instance_id}, 1)
    ON CONFLICT (post_id, instance_id) DO NOTHING
  `;
  await sql`
    UPDATE posts SET upvotes = 1 WHERE id = ${data.id}
  `;

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

// --- Forum: Poll Votes ---

export async function upsertPollVote(data: {
  id: string;
  post_id: string;
  instance_id: string;
  option_index: number;
}) {
  const sql = getSQL();
  await sql`
    INSERT INTO poll_votes (id, post_id, instance_id, option_index)
    VALUES (${data.id}, ${data.post_id}, ${data.instance_id}, ${data.option_index})
    ON CONFLICT (post_id, instance_id) DO UPDATE SET
      option_index = EXCLUDED.option_index
  `;
}

export async function getPollResults(postId: string): Promise<{ option_index: number; votes: number }[]> {
  const sql = getSQL();
  const rows = await sql`
    SELECT option_index, COUNT(*)::int as votes
    FROM poll_votes
    WHERE post_id = ${postId}
    GROUP BY option_index
    ORDER BY option_index
  `;
  return rows as unknown as { option_index: number; votes: number }[];
}

export async function closePoll(postId: string) {
  const sql = getSQL();
  await sql`UPDATE posts SET poll_closed = true WHERE id = ${postId}`;
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

// --- Forum: Rate Limits (driven by forum_config) ---

export async function checkForumPostLimit(instanceId: string): Promise<{ allowed: boolean; count: number; limit: number }> {
  const config = await getForumConfig();
  const sql = getSQL();
  const rows = await sql`
    SELECT COUNT(*) as count FROM posts
    WHERE instance_id = ${instanceId}
    AND created_at > now() - interval '24 hours'
  `;
  const count = parseInt(rows[0]?.count || '0', 10);
  return { allowed: count < config.post_limit_per_day, count, limit: config.post_limit_per_day };
}

export async function checkForumVoteLimit(instanceId: string): Promise<{ allowed: boolean; count: number; limit: number }> {
  const config = await getForumConfig();
  const sql = getSQL();
  const rows = await sql`
    SELECT COUNT(*) as count FROM post_votes
    WHERE instance_id = ${instanceId}
    AND created_at > now() - interval '24 hours'
  `;
  const count = parseInt(rows[0]?.count || '0', 10);
  return { allowed: count < config.vote_limit_per_day, count, limit: config.vote_limit_per_day };
}

// --- Forum Config (admin-tunable) ---

export interface ForumConfig {
  post_limit_per_day: number;
  vote_limit_per_day: number;
  title_max_chars: number;
  body_max_chars: number;
  max_reply_depth: number;
  recommended_check_interval_ms: number;
  updated_at: string;
}

const DEFAULT_FORUM_CONFIG: ForumConfig = {
  post_limit_per_day: 5,
  vote_limit_per_day: 20,
  title_max_chars: 200,
  body_max_chars: 5000,
  max_reply_depth: 3,
  recommended_check_interval_ms: 14400000,
  updated_at: new Date().toISOString(),
};

let forumConfigCache: { config: ForumConfig; fetchedAt: number } | null = null;
const FORUM_CONFIG_CACHE_TTL = 60_000; // 1 minute

export async function getForumConfig(): Promise<ForumConfig> {
  if (forumConfigCache && Date.now() - forumConfigCache.fetchedAt < FORUM_CONFIG_CACHE_TTL) {
    return forumConfigCache.config;
  }
  const sql = getSQL();
  const rows = await sql`SELECT * FROM forum_config WHERE id = 'default'`;
  if (rows.length === 0) return DEFAULT_FORUM_CONFIG;
  const row = rows[0];
  const config: ForumConfig = {
    post_limit_per_day: row.post_limit_per_day,
    vote_limit_per_day: row.vote_limit_per_day,
    title_max_chars: row.title_max_chars,
    body_max_chars: row.body_max_chars,
    max_reply_depth: row.max_reply_depth,
    recommended_check_interval_ms: Number(row.recommended_check_interval_ms),
    updated_at: row.updated_at,
  };
  forumConfigCache = { config, fetchedAt: Date.now() };
  return config;
}

export async function updateForumConfig(updates: Partial<Omit<ForumConfig, 'updated_at'>>): Promise<ForumConfig> {
  const sql = getSQL();
  const current = await getForumConfig();
  const merged = { ...current, ...updates };
  await sql`
    UPDATE forum_config SET
      post_limit_per_day = ${merged.post_limit_per_day},
      vote_limit_per_day = ${merged.vote_limit_per_day},
      title_max_chars = ${merged.title_max_chars},
      body_max_chars = ${merged.body_max_chars},
      max_reply_depth = ${merged.max_reply_depth},
      recommended_check_interval_ms = ${merged.recommended_check_interval_ms},
      updated_at = now()
    WHERE id = 'default'
  `;
  forumConfigCache = null;
  return getForumConfig();
}

// --- Releases (changelog) ---

export interface Release {
  version: string;
  changelog: string;
  released_at: string;
}

export async function getReleases(): Promise<Release[]> {
  const sql = getSQL();
  const rows = await sql`SELECT * FROM releases ORDER BY released_at DESC`;
  return rows as unknown as Release[];
}

export async function getLatestRelease(): Promise<Release | null> {
  const sql = getSQL();
  const rows = await sql`SELECT * FROM releases ORDER BY released_at DESC LIMIT 1`;
  return (rows[0] as unknown as Release) ?? null;
}

export async function upsertRelease(version: string, changelog: string): Promise<void> {
  const sql = getSQL();
  await sql`
    INSERT INTO releases (version, changelog, released_at)
    VALUES (${version}, ${changelog}, now())
    ON CONFLICT (version) DO UPDATE SET
      changelog = EXCLUDED.changelog,
      released_at = now()
  `;
}

export async function deleteRelease(version: string): Promise<void> {
  const sql = getSQL();
  await sql`DELETE FROM releases WHERE version = ${version}`;
}
