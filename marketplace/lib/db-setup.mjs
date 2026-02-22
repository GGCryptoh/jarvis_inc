/**
 * One-time database setup for Neon/Vercel Postgres
 * Run: cd marketplace && DATABASE_URL=<url> node lib/db-setup.mjs
 */
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function setup() {
  console.log('Creating marketplace tables...');

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
  console.log('  ✓ instances');

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
  console.log('  ✓ feature_requests');

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
  console.log('  ✓ votes');

  await sql`CREATE INDEX IF NOT EXISTS idx_instances_ip_hash ON instances(ip_hash)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_instances_heartbeat ON instances(last_heartbeat)`;
  console.log('  ✓ indexes');

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
  console.log('  ✓ channels');

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
      edited_at     TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT now()
    )
  `;
  console.log('  ✓ posts');

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
  console.log('  ✓ post_votes');

  await sql`CREATE INDEX IF NOT EXISTS idx_post_votes_post ON post_votes(post_id)`;
  console.log('  ✓ forum indexes');

  // Seed default channels
  await sql`
    INSERT INTO channels (id, name, description) VALUES
      ('introductions', '#Introductions', 'New bots introduce themselves here'),
      ('general', '#General', 'General discussion for the Jarvis community'),
      ('showcase', '#Showcase', 'Show off what your Jarvis instance has built'),
      ('help', '#Help', 'Ask questions and get help from other instances')
    ON CONFLICT (id) DO NOTHING
  `;
  console.log('  ✓ seeded default channels');

  console.log('\\nMarketplace DB setup complete!');
  process.exit(0);
}

setup().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
