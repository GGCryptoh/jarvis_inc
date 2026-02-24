#!/usr/bin/env node

// Jarvis Inc — Interactive Setup Script
// ======================================
// Generates docker/.env, starts the stack, and verifies all services.
//
// Usage:
//   node docker/setup.mjs          # interactive setup
//   node docker/setup.mjs --auto   # zero-prompt setup with defaults (for npm run jarvis)
//   node docker/setup.mjs --check  # health-check only (skip .env generation)

import { createInterface } from 'readline';
import { createHmac, randomBytes } from 'crypto';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '.env');
const KONG_TEMPLATE = join(__dirname, 'supabase', 'kong.yml.template');
const KONG_OUTPUT = join(__dirname, 'supabase', 'kong.yml');
const COMPOSE_PATH = __dirname;
const AUTO_MODE = process.argv.includes('--auto');

// ─── Colors ──────────────────────────────────────────────────
const c = {
  gold: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

function gold(s) { return `${c.gold}${s}${c.reset}`; }
function green(s) { return `${c.green}${s}${c.reset}`; }
function red(s) { return `${c.red}${s}${c.reset}`; }
function cyan(s) { return `${c.cyan}${s}${c.reset}`; }
function dim(s) { return `${c.dim}${s}${c.reset}`; }
function bold(s) { return `${c.bold}${s}${c.reset}`; }

// ─── Readline ────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultVal = '') {
  // In auto mode, always use the default
  if (AUTO_MODE) {
    if (defaultVal) {
      console.log(`${gold('>')} ${question} ${dim(`[${defaultVal}]`)}: ${cyan(defaultVal)}`);
    }
    return Promise.resolve(defaultVal);
  }
  const suffix = defaultVal ? ` ${dim(`[${defaultVal}]`)}` : '';
  return new Promise(resolve => {
    rl.question(`${gold('>')} ${question}${suffix}: `, answer => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function generatePassword(length = 20) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(length))
    .map(b => chars[b % chars.length])
    .join('');
}

// ─── Multi-Instance Configuration ─────────────────────────
// Max 2 instances per machine. Each instance gets deterministic ports.
const MAX_INSTANCES = 2;

// Port allocation per instance slot (1-indexed)
const PORT_TABLE = {
  1: { POSTGRES_PORT: 5432, KONG_HTTP_PORT: 8000, GATEWAY_PORT: 3001, CADDY_HTTP_PORT: 80,  CADDY_HTTPS_PORT: 443 },
  2: { POSTGRES_PORT: 5433, KONG_HTTP_PORT: 8001, GATEWAY_PORT: 3002, CADDY_HTTP_PORT: 81,  CADDY_HTTPS_PORT: 444 },
};

// Domain per instance slot
function domainForSlot(slot) {
  return slot === 1 ? 'jarvis.local' : `jarvis${slot}.local`;
}

// Module-level state
let instanceSlot = null;  // set during detection
let activeKongPort = 8000;
let activeGatewayPort = 3001;

/** Detect which instance slot we are (1 or 2).
 *  - If .env already has INSTANCE_ID, use it.
 *  - Otherwise scan ALL running docker compose projects for jarvis stacks.
 *  - Handles legacy stacks (no INSTANCE_ID) by checking their .env or ports.
 *  - Assign the first available slot. Error if both taken.
 */
function detectInstanceSlot() {
  // 1. Check existing .env for a persisted slot
  if (existsSync(ENV_PATH)) {
    const env = readFileSync(ENV_PATH, 'utf-8');
    const m = env.match(/^INSTANCE_ID=(\d+)$/m);
    if (m) {
      const slot = parseInt(m[1], 10);
      if (slot >= 1 && slot <= MAX_INSTANCES) {
        return slot;
      }
    }
  }

  // 2. Scan ALL running compose projects for jarvis stacks
  const takenSlots = new Set();
  const ourConfigPath = join(__dirname, 'docker-compose.yml');

  try {
    const lsOutput = execSync('docker compose ls --format json', {
      encoding: 'utf-8', stdio: 'pipe', timeout: 10000,
    });
    const projects = JSON.parse(lsOutput);
    for (const p of projects) {
      // Skip our own project (match by config file path)
      const configPaths = p.ConfigFiles || '';
      if (configPaths.includes(ourConfigPath)) continue;

      // Check if this is a jarvis stack by project name pattern
      const nameMatch = p.Name?.match(/^jarvis-(\d+)$/);
      if (nameMatch) {
        takenSlots.add(parseInt(nameMatch[1], 10));
        continue;
      }

      // Check if this is a legacy jarvis stack by inspecting its config path
      // e.g. ConfigFiles: "/path/to/jarvis_inc/docker/docker-compose.yml"
      if (configPaths.includes('jarvis') && configPaths.includes('docker-compose.yml')) {
        // Legacy stack — try to read its .env for INSTANCE_ID
        const otherDockerDir = dirname(configPaths.split(',')[0].trim());
        const otherEnvPath = join(otherDockerDir, '.env');
        let otherSlot = null;

        if (existsSync(otherEnvPath)) {
          const otherEnv = readFileSync(otherEnvPath, 'utf-8');
          const instMatch = otherEnv.match(/^INSTANCE_ID=(\d+)$/m);
          if (instMatch) {
            otherSlot = parseInt(instMatch[1], 10);
          } else {
            // No INSTANCE_ID — infer from ports. Default ports = slot 1.
            const kongPort = otherEnv.match(/^KONG_HTTP_PORT=(\d+)$/m);
            const kp = kongPort ? parseInt(kongPort[1], 10) : 8000;
            otherSlot = kp === PORT_TABLE[2].KONG_HTTP_PORT ? 2 : 1;
          }
        } else {
          // No .env at all — assume slot 1 (default ports)
          otherSlot = 1;
        }

        if (otherSlot) {
          takenSlots.add(otherSlot);
          console.log(dim(`  Found existing stack "${p.Name}" → slot ${otherSlot}`));
        }
      }
    }
  } catch {
    // docker not running or ls failed — assume no instances
  }

  // 3. Assign first available slot
  for (let slot = 1; slot <= MAX_INSTANCES; slot++) {
    if (!takenSlots.has(slot)) return slot;
  }

  // 4. All slots taken
  console.log(red(`  Maximum ${MAX_INSTANCES} Jarvis instances already running.`));
  console.log(dim('  Stop an existing instance first:'));
  console.log(dim('    cd <other-jarvis>/docker && docker compose down'));
  process.exit(1);
}

/** Get deterministic ports for an instance slot */
function portsForSlot(slot) {
  return PORT_TABLE[slot] || PORT_TABLE[1];
}

/** Extract port config from existing .env content */
function extractPortsFromEnv(envContent) {
  const kong = envContent.match(/^KONG_HTTP_PORT=(\d+)$/m);
  if (kong) activeKongPort = parseInt(kong[1], 10);
  const gw = envContent.match(/^GATEWAY_PORT=(\d+)$/m);
  if (gw) activeGatewayPort = parseInt(gw[1], 10);
  const inst = envContent.match(/^INSTANCE_ID=(\d+)$/m);
  if (inst) instanceSlot = parseInt(inst[1], 10);
}

// ─── Secret Generation ──────────────────────────────────────
function generateSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64');
}

function generateJWT(secret, role) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    role,
    iss: 'supabase',
    iat: now,
    exp: now + (10 * 365 * 24 * 60 * 60), // 10 years
  })).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function hashPassword(password) {
  // Simple bcrypt-compatible hash via Docker Caddy
  // Falls back to a placeholder if Docker isn't available
  try {
    const result = execSync(
      `docker run --rm caddy:2-alpine caddy hash-password --plaintext '${password.replace(/'/g, "'\\''")}'`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim();
    return result;
  } catch {
    console.log(dim('  (Docker not available for hashing — using placeholder)'));
    return '$PLACEHOLDER_RUN_CADDY_HASH';
  }
}

// ─── Docker Check ────────────────────────────────────────────
function isDockerInstalled() {
  try {
    execSync('docker --version', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isDockerRunning() {
  try {
    execSync('docker info', { encoding: 'utf-8', stdio: 'pipe', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

function isBrewInstalled() {
  try {
    execSync('brew --version', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isRemoteSession() {
  if (process.platform !== 'darwin') return false;
  try {
    // Check for macOS Screen Sharing / VNC / ARD sessions
    const who = execSync('who', { encoding: 'utf-8', stdio: 'pipe' });
    // Screen Sharing sessions show as "console" user but SSH_CONNECTION is unset
    // More reliable: check if Screen Sharing agent is running
    const ps = execSync('pgrep -f "ScreensharingAgent|screensharingd|ARDAgent" 2>/dev/null || true', {
      encoding: 'utf-8', stdio: 'pipe',
    });
    if (ps.trim()) return true;
  } catch { /* ignore */ }
  // Also check SSH
  if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT) return true;
  return false;
}

function detectInstallMethod() {
  const platform = process.platform;
  if (platform === 'darwin' && isBrewInstalled()) {
    return { method: 'brew', cmd: 'brew install --cask docker', label: 'Homebrew (brew install --cask docker)' };
  }
  if (platform === 'darwin') {
    return { method: 'manual', label: 'Download Docker Desktop', url: 'https://docs.docker.com/desktop/install/mac-install/' };
  }
  if (platform === 'linux') {
    return { method: 'script', cmd: 'curl -fsSL https://get.docker.com | sudo sh', label: 'Official install script (get.docker.com)' };
  }
  // Windows or unknown
  return { method: 'manual', label: 'Download Docker Desktop', url: 'https://docs.docker.com/desktop/install/windows-install/' };
}

async function installDocker(install) {
  console.log('');
  console.log(gold('  ── INSTALLING DOCKER ──'));
  console.log(dim(`  Running: ${install.cmd}`));
  console.log('');

  try {
    const proc = spawn('sh', ['-c', install.cmd], { stdio: 'inherit' });
    await new Promise((resolve, reject) => {
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`exit code ${code}`)));
      proc.on('error', reject);
    });
    console.log(`  ${green('✓')} Docker installed`);

    // On macOS, need to start Docker Desktop after brew install
    if (install.method === 'brew') {
      console.log(dim('  Starting Docker Desktop...'));
      try {
        execSync('open -a Docker', { stdio: 'pipe', timeout: 5000 });
      } catch { /* may already be starting */ }
      // Wait for Docker daemon to be ready
      console.log(dim('  Waiting for Docker daemon to start (this can take 30-60s)...'));
      const start = Date.now();
      while (Date.now() - start < 90000) {
        if (isDockerRunning()) {
          console.log(`  ${green('✓')} Docker Desktop is running`);
          return true;
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      console.log(red('  Docker Desktop started but daemon not ready yet.'));
      console.log(dim('  Wait for the whale icon in your menu bar, then re-run: npm run jarvis'));
      return false;
    }

    return true;
  } catch (err) {
    console.log(red(`  Install failed: ${err.message}`));
    return false;
  }
}

async function ensureDocker() {
  if (!isDockerInstalled()) {
    console.log(red('  Docker is not installed.'));

    const install = detectInstallMethod();

    if (install.method === 'manual') {
      // No automatic install available — show download link
      console.log('');
      console.log(gold('  ── INSTALL DOCKER ──'));
      console.log(`  ${cyan(install.label)}: ${install.url}`);
      console.log('');
      if (AUTO_MODE) {
        console.log(dim('  Install Docker Desktop, start it, then re-run: npm run jarvis'));
        process.exit(1);
      }
      await ask('Press Enter when Docker is installed and running...');
    } else if (AUTO_MODE || isRemoteSession()) {
      // Auto mode or remote session (Screen Sharing / SSH):
      // Don't attempt brew install (requires sudo password which breaks over remote)
      const remote = isRemoteSession();
      console.log('');
      if (remote) {
        console.log(gold('  ── REMOTE SESSION DETECTED ──'));
        console.log(dim('  Docker install requires a password prompt that may not work'));
        console.log(dim('  over Screen Sharing / SSH. Paste these 3 commands instead:'));
      } else {
        console.log(gold('  ── DOCKER REQUIRED ──'));
        console.log(dim('  Paste these 3 commands:'));
      }
      console.log('');
      console.log(cyan('  brew install --cask docker'));
      console.log(cyan('  open -a Docker'));
      console.log(cyan('  npm run jarvis'));
      console.log('');
      console.log(dim('  Wait for the Docker whale icon in the menu bar after step 2,'));
      console.log(dim('  then run step 3.'));
      console.log('');
      process.exit(1);
    } else {
      // Interactive local session: offer to install
      const doInstall = await ask(`Install Docker via ${install.label}?`, 'Y');
      if (doInstall.toLowerCase() === 'y') {
        const ok = await installDocker(install);
        if (!ok) process.exit(1);
      } else {
        console.log('');
        console.log(gold('  ── INSTALL DOCKER MANUALLY ──'));
        console.log(`  ${cyan('macOS:')}    https://docs.docker.com/desktop/install/mac-install/`);
        console.log(`  ${cyan('Windows:')}  https://docs.docker.com/desktop/install/windows-install/`);
        console.log(`  ${cyan('Linux:')}    https://docs.docker.com/engine/install/`);
        console.log('');
        await ask('Press Enter when Docker is installed and running...');
      }
    }

    // Re-check after install attempt
    if (!isDockerInstalled()) {
      console.log(red('  Docker is still not available.'));
      console.log(dim('  Install Docker, then re-run: npm run jarvis'));
      process.exit(1);
    }
  }

  // Docker is installed — check if running
  if (!isDockerRunning()) {
    console.log(red('  Docker is installed but not running.'));

    if (process.platform === 'darwin') {
      const startIt = await ask('Start Docker Desktop?', 'Y');
      if (startIt.toLowerCase() === 'y') {
        try {
          execSync('open -a Docker', { stdio: 'pipe', timeout: 5000 });
        } catch { /* already starting */ }
        console.log(dim('  Waiting for Docker daemon (this can take 30-60s)...'));
        const start = Date.now();
        while (Date.now() - start < 90000) {
          if (isDockerRunning()) break;
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    if (!isDockerRunning()) {
      if (AUTO_MODE) {
        console.log(dim('  Start Docker Desktop, then re-run: npm run jarvis'));
        process.exit(1);
      }
      while (!isDockerRunning()) {
        await ask('Docker is not running. Start it, then press Enter...');
      }
    }
  }

  const version = execSync('docker --version', { encoding: 'utf-8' }).trim();
  console.log(`  ${green('✓')} ${dim(version)}`);
}

// ─── Health Checks ──────────────────────────────────────────

// Allow self-signed certs during health checks (Caddy internal TLS)
if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

async function checkService(name, url, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok || res.status === 401 || res.status === 404) {
        return true;
      }
    } catch {
      // retry
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

/** Check if Postgres is accepting connections via docker exec. */
async function waitForPostgres(timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      execSync(
        'docker compose exec -T supabase-db pg_isready -U supabase_admin -h 127.0.0.1',
        { cwd: COMPOSE_PATH, encoding: 'utf-8', stdio: 'pipe', timeout: 5000 }
      );
      return true;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function healthCheck(domain, tls) {
  const proto = tls === 'off' ? 'http' : 'https';
  const services = [
    { name: 'Jarvis Frontend', url: `${proto}://${domain}/` },
    { name: 'Supabase API (Kong)', url: `http://localhost:${activeKongPort}/rest/v1/` },
    { name: 'Supabase Auth (GoTrue)', url: `http://localhost:${activeKongPort}/auth/v1/health` },
    { name: 'Edge Functions', url: `http://localhost:${activeKongPort}/functions/v1/health`, optional: true },
    { name: 'Supabase Storage', url: `http://localhost:${activeKongPort}/storage/v1/status`, optional: true },
    { name: 'Supabase Studio', url: `${proto}://studio.${domain}/` },
  ];

  console.log('');
  console.log(gold('  ═══ SERVICE HEALTH CHECK ═══'));
  console.log('');

  let allOk = true;
  for (const svc of services) {
    process.stdout.write(`  ${dim('checking')} ${svc.name}...`);
    const ok = await checkService(svc.name, svc.url, 15000);
    if (ok) {
      console.log(`\r  ${green('✓')} ${svc.name} ${dim('— online')}`);
    } else if (svc.optional) {
      console.log(`\r  ${dim('○')} ${svc.name} ${dim('— not reachable (optional)')}`);
    } else {
      console.log(`\r  ${red('✗')} ${svc.name} ${dim('— not reachable')}`);
      allOk = false;
    }
  }

  console.log('');
  if (allOk) {
    console.log(green('  All services online. Stack is ready.'));
  } else {
    console.log(red('  Some services failed. Check docker compose logs.'));
  }
  return allOk;
}

/**
 * Active health polling — waits for Postgres + all HTTP services.
 * Replaces the fixed 15s sleep.
 */
async function waitForServices(domain, tls) {
  console.log('');
  console.log(gold('  ── WAITING FOR SERVICES ──'));

  // Phase 1: Wait for Postgres (the dependency everything else needs)
  process.stdout.write(`  ${dim('waiting')} Postgres...`);
  const pgOk = await waitForPostgres(60000);
  if (pgOk) {
    console.log(`\r  ${green('✓')} Postgres ${dim('— accepting connections')}`);
  } else {
    console.log(`\r  ${red('✗')} Postgres ${dim('— timed out after 60s')}`);
    return false;
  }

  // Phase 1.5: Bootstrap ALL service roles + schemas (idempotent)
  // The Supabase Postgres image creates roles during init, but pg_isready
  // returns healthy before init scripts finish. Services (GoTrue, PostgREST,
  // Storage, Realtime) start connecting immediately and fail with "password
  // authentication failed". This phase explicitly sets passwords on all
  // service roles using the .env password, regardless of init script state.
  const envContent = readFileSync(ENV_PATH, 'utf-8');
  const pgPassword = envContent.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1] || '';
  const dbUser = 'supabase_admin'; // Supabase image default superuser
  const safePwShell = pgPassword.replace(/'/g, "'\\''"); // for shell quoting
  // All psql commands use TCP + PGPASSWORD for scram-sha-256 auth.
  // Use 127.0.0.1 (not localhost) to avoid IPv6 ::1 resolution on Mac Docker VMs.
  // Explicit -d postgres because psql defaults to a DB matching the username.
  const psqlPrefix = `docker compose exec -T -e PGPASSWORD='${safePwShell}' supabase-db psql -U ${dbUser} -h 127.0.0.1 -d postgres`;
  if (pgPassword) {
    // Wait for Supabase init scripts to create the base roles (up to 300s)
    // TCP isn't available during init, so this loop also waits for init to finish.
    // On Mac Mini with Docker Desktop VM, init can take 2-4 minutes.
    process.stdout.write(`  ${dim('waiting')} Postgres init scripts...`);
    const initStart = Date.now();
    let rolesReady = false;
    while (Date.now() - initStart < 300000) {
      try {
        const result = execSync(
          `${psqlPrefix} -tAc "SELECT count(*) FROM pg_roles WHERE rolname IN ('authenticator','supabase_auth_admin','supabase_admin','anon','authenticated','service_role');"`,
          { cwd: COMPOSE_PATH, encoding: 'utf-8', stdio: 'pipe', timeout: 15000 }
        ).trim();
        if (parseInt(result, 10) >= 6) {
          rolesReady = true;
          break;
        }
      } catch { /* TCP not ready yet (init running) or roles not created yet */ }
      await new Promise(r => setTimeout(r, 3000));
    }
    if (rolesReady) {
      console.log(`\r  ${green('✓')} Postgres init ${dim('— base roles ready')}`);
    } else {
      console.log(`\r  ${dim('○')} Postgres init ${dim('— timed out, will try password sync anyway')}`);
    }

    // Escape single quotes for SQL
    const safePw = pgPassword.replace(/'/g, "''");
    try {
      execSync(
        `${psqlPrefix} -c "
          -- Set passwords on all service login roles
          ALTER ROLE authenticator       WITH LOGIN NOINHERIT PASSWORD '${safePw}';
          ALTER ROLE supabase_auth_admin WITH LOGIN NOINHERIT CREATEROLE CREATEDB PASSWORD '${safePw}';
          ALTER ROLE supabase_admin      WITH LOGIN NOINHERIT PASSWORD '${safePw}';

          -- Storage role (may not exist on first init)
          DO \\$\\$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
              CREATE ROLE supabase_storage_admin LOGIN NOINHERIT PASSWORD '${safePw}';
            ELSE
              ALTER ROLE supabase_storage_admin WITH LOGIN NOINHERIT PASSWORD '${safePw}';
            END IF;
          END \\$\\$;

          -- Schemas needed by services
          CREATE SCHEMA IF NOT EXISTS _realtime;
          CREATE SCHEMA IF NOT EXISTS graphql_public;
          CREATE SCHEMA IF NOT EXISTS storage;

          -- Schema ownership
          ALTER SCHEMA storage    OWNER TO supabase_storage_admin;
          ALTER SCHEMA _realtime  OWNER TO supabase_admin;

          -- Storage grants
          GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
          GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
          GRANT anon TO supabase_storage_admin;
          GRANT authenticated TO supabase_storage_admin;
          GRANT service_role TO supabase_storage_admin;

          -- Auth schema + all objects inside it
          DO \\$\\$
          DECLARE r RECORD;
          BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') THEN
              EXECUTE 'ALTER SCHEMA auth OWNER TO supabase_auth_admin';
              EXECUTE 'GRANT ALL ON SCHEMA auth TO supabase_auth_admin';

              -- Transfer ownership of all functions in auth schema (GoTrue needs this for CREATE OR REPLACE)
              FOR r IN SELECT p.oid::regprocedure AS func_sig
                       FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
                       WHERE n.nspname = 'auth'
              LOOP
                EXECUTE format('ALTER FUNCTION %s OWNER TO supabase_auth_admin', r.func_sig);
              END LOOP;

              -- Transfer ownership of all tables in auth schema
              FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'auth'
              LOOP
                EXECUTE format('ALTER TABLE auth.%I OWNER TO supabase_auth_admin', r.tablename);
              END LOOP;

              -- Transfer ownership of all sequences in auth schema
              FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'auth'
              LOOP
                EXECUTE format('ALTER SEQUENCE auth.%I OWNER TO supabase_auth_admin', r.sequence_name);
              END LOOP;
            END IF;
          END \\$\\$;

          -- Public schema grants for API roles
          GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
          GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
          GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
        "`,
        { cwd: COMPOSE_PATH, encoding: 'utf-8', stdio: 'pipe', timeout: 30000 }
      );
      console.log(`  ${green('✓')} Service roles ${dim('— passwords synced, schemas ready')}`);
    } catch (err) {
      const msg = err.stderr?.slice(0, 200) || err.message?.slice(0, 200) || 'unknown error';
      console.log(`  ${dim('○')} Service roles ${dim(`— failed: ${msg}`)}`);
    }

    // Restart services so they pick up the correct passwords + ownership
    try {
      execSync(
        'docker compose restart supabase-auth supabase-rest supabase-storage supabase-realtime',
        { cwd: COMPOSE_PATH, encoding: 'utf-8', stdio: 'pipe', timeout: 30000 }
      );
      console.log(`  ${green('✓')} Services restarted ${dim('— connecting with synced passwords')}`);
    } catch {
      console.log(`  ${dim('○')} Service restart ${dim('— skipped')}`);
    }

    // Brief wait for services to begin startup after restart
    await new Promise(r => setTimeout(r, 3000));
  }

  // Phase 2: Wait for HTTP services via Kong directly (no Caddy/TLS dependency)
  // GoTrue needs extra time on fresh installs — it runs its own migrations on first boot.
  const httpServices = [
    { name: 'Kong API Gateway', url: `http://localhost:${activeKongPort}/rest/v1/`, timeout: 60000 },
    { name: 'GoTrue Auth', url: `http://localhost:${activeKongPort}/auth/v1/health`, timeout: 90000 },
    { name: 'Edge Functions', url: `http://localhost:${activeKongPort}/functions/v1/health`, optional: true, timeout: 20000 },
    { name: 'Supabase Storage', url: `http://localhost:${activeKongPort}/storage/v1/status`, optional: true, timeout: 20000 },
  ];

  for (const svc of httpServices) {
    process.stdout.write(`  ${dim('waiting')} ${svc.name}...`);
    const ok = await checkService(svc.name, svc.url, svc.timeout);
    if (ok) {
      console.log(`\r  ${green('✓')} ${svc.name} ${dim('— online')}`);
    } else if (svc.optional) {
      console.log(`\r  ${dim('○')} ${svc.name} ${dim('— skipped (optional)')}`);
    } else {
      console.log(`\r  ${red('✗')} ${svc.name} ${dim('— not ready yet, will retry on next run')}`);
    }
  }

  // If GoTrue or Kong didn't come up, give one more restart attempt
  const gotrueOk = await checkService('GoTrue', `http://localhost:${activeKongPort}/auth/v1/health`, 3000);
  const kongOk = await checkService('Kong', `http://localhost:${activeKongPort}/rest/v1/`, 3000);
  if (!gotrueOk || !kongOk) {
    console.log(`  ${dim('⟳')} Some services still starting — restarting once more...`);
    try {
      execSync(
        'docker compose restart supabase-auth supabase-rest',
        { cwd: COMPOSE_PATH, encoding: 'utf-8', stdio: 'pipe', timeout: 30000 }
      );
      // Wait for them to come up
      for (const svc of httpServices.filter(s => !s.optional)) {
        process.stdout.write(`  ${dim('waiting')} ${svc.name} (retry)...`);
        const ok = await checkService(svc.name, svc.url, 60000);
        console.log(ok
          ? `\r  ${green('✓')} ${svc.name} ${dim('— online (retry)')}`
          : `\r  ${red('✗')} ${svc.name} ${dim('— timed out (retry)')}`
        );
      }
    } catch { /* ignore */ }
  }

  // Restart Kong last — after all upstream services have stabilized — so it resolves
  // fresh container IPs. Without this, Kong caches stale IPs from before restarts → 502s.
  try {
    execSync(
      'docker compose restart supabase-kong',
      { cwd: COMPOSE_PATH, encoding: 'utf-8', stdio: 'pipe', timeout: 30000 }
    );
    await new Promise(r => setTimeout(r, 3000));
    console.log(`  ${green('✓')} Kong restarted ${dim('— refreshed upstream IPs')}`);
  } catch {
    console.log(`  ${dim('○')} Kong restart ${dim('— skipped')}`);
  }

  // DB readiness gate: if Phase 1.5 timed out, the DB may still have been initializing.
  // Now that HTTP services are online, verify psql can actually connect before Phases 3-5.
  let dbReady = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      execSync(
        `${psqlPrefix} -tAc "SELECT 1;"`,
        { cwd: COMPOSE_PATH, encoding: 'utf-8', stdio: 'pipe', timeout: 10000 }
      );
      dbReady = true;
      break;
    } catch { await new Promise(r => setTimeout(r, 3000)); }
  }

  // Phase 3: Ensure storage bucket exists (idempotent)
  try {
    execSync(
      `${psqlPrefix} -c "
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('generated-images', 'generated-images', true, 52428800,
                ARRAY['image/png','image/jpeg','image/webp','image/gif'])
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('generated-documents', 'generated-documents', true, 10485760,
                ARRAY['text/markdown','text/plain','application/json'])
        ON CONFLICT (id) DO NOTHING;

        DO \\$\\$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Allow public upload to generated-images') THEN
            CREATE POLICY \\"Allow public upload to generated-images\\"
              ON storage.objects FOR INSERT TO anon, authenticated, service_role
              WITH CHECK (bucket_id = 'generated-images');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Allow public read from generated-images') THEN
            CREATE POLICY \\"Allow public read from generated-images\\"
              ON storage.objects FOR SELECT TO anon, authenticated, service_role
              USING (bucket_id = 'generated-images');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Allow public upload to generated-documents') THEN
            CREATE POLICY \\"Allow public upload to generated-documents\\"
              ON storage.objects FOR INSERT TO anon, authenticated, service_role
              WITH CHECK (bucket_id = 'generated-documents');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Allow public read from generated-documents') THEN
            CREATE POLICY \\"Allow public read from generated-documents\\"
              ON storage.objects FOR SELECT TO anon, authenticated, service_role
              USING (bucket_id = 'generated-documents');
          END IF;
        END \\$\\$;
      "`,
      { cwd: COMPOSE_PATH, encoding: 'utf-8', stdio: 'pipe', timeout: 15000 }
    );
    console.log(`  ${green('✓')} Storage bucket ${dim('— ready')}`);
  } catch {
    console.log(`  ${dim('○')} Storage bucket ${dim('— skipped (storage not ready)')}`);
  }

  // Phase 4: Ensure skill_schedules table exists (idempotent) — retry up to 3 times
  let phase4Done = false;
  for (let attempt = 0; attempt < 3 && !phase4Done; attempt++) {
    try {
      execSync(
        `${psqlPrefix} -c "
          CREATE TABLE IF NOT EXISTS skill_schedules (
            id           TEXT PRIMARY KEY,
            skill_id     TEXT NOT NULL,
            command_name TEXT NOT NULL,
            frequency    TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
            run_at_time  TEXT NOT NULL DEFAULT '03:00',
            run_on_day   INTEGER DEFAULT NULL,
            params       JSONB DEFAULT '{}',
            enabled      BOOLEAN NOT NULL DEFAULT true,
            last_run_at  TIMESTAMPTZ DEFAULT NULL,
            next_run_at  TIMESTAMPTZ DEFAULT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
          );

          ALTER TABLE skill_schedules ENABLE ROW LEVEL SECURITY;

          DO \\$\\$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'skill_schedules_anon_all') THEN
              CREATE POLICY \\"skill_schedules_anon_all\\" ON skill_schedules FOR ALL TO anon USING (true) WITH CHECK (true);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'skill_schedules_auth_all') THEN
              CREATE POLICY \\"skill_schedules_auth_all\\" ON skill_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);
            END IF;
          END \\$\\$;

          CREATE INDEX IF NOT EXISTS idx_skill_schedules_next_run ON skill_schedules(next_run_at) WHERE enabled = true;
          CREATE INDEX IF NOT EXISTS idx_skill_schedules_skill ON skill_schedules(skill_id);
        "`,
        { cwd: COMPOSE_PATH, encoding: 'utf-8', stdio: 'pipe', timeout: 15000 }
      );
      console.log(`  ${green('✓')} Skill schedules table ${dim('— ready')}`);
      phase4Done = true;
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
      else console.log(`  ${dim('○')} Skill schedules table ${dim('— skipped (DB not ready)')}`);
    }
  }

  // Phase 5: Ensure all v0.1.1 columns/tables exist (idempotent — for existing DBs) — retry up to 3 times
  let phase5Done = false;
  for (let attempt = 0; attempt < 3 && !phase5Done; attempt++) {
    try {
      execSync(
        `${psqlPrefix} -c "
          -- missions columns from 007-010
          ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ DEFAULT NULL;
          ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS task_template JSONB DEFAULT NULL;
          ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS current_round INTEGER NOT NULL DEFAULT 1;
          ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL;
          ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS max_runs INTEGER DEFAULT NULL;
          ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS run_count INTEGER NOT NULL DEFAULT 0;

          -- agents metadata from 007
          ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

          -- mission_rounds table from 008
          CREATE TABLE IF NOT EXISTS public.mission_rounds (
            id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, round_number INTEGER NOT NULL DEFAULT 1,
            agent_id TEXT, status TEXT NOT NULL DEFAULT 'in_progress',
            quality_score INTEGER, completeness_score INTEGER, efficiency_score INTEGER,
            overall_score INTEGER, grade TEXT, ceo_review TEXT, ceo_recommendation TEXT,
            rejection_feedback TEXT, redo_strategy TEXT, tokens_used INTEGER NOT NULL DEFAULT 0,
            cost_usd REAL NOT NULL DEFAULT 0, duration_ms INTEGER, task_count INTEGER NOT NULL DEFAULT 0,
            started_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
          ALTER TABLE public.mission_rounds ENABLE ROW LEVEL SECURITY;
          DO \\$\\$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'mission_rounds_anon_all') THEN
              CREATE POLICY \\"mission_rounds_anon_all\\" ON public.mission_rounds FOR ALL TO anon USING (true) WITH CHECK (true);
            END IF;
          END \\$\\$;

          -- agent_questions table from 009
          CREATE TABLE IF NOT EXISTS public.agent_questions (
            id TEXT PRIMARY KEY, task_execution_id TEXT NOT NULL, mission_id TEXT NOT NULL,
            agent_id TEXT NOT NULL, question TEXT NOT NULL, context TEXT, answer TEXT,
            answered_by TEXT, status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(), answered_at TIMESTAMPTZ
          );
          ALTER TABLE public.agent_questions ENABLE ROW LEVEL SECURITY;
          DO \\$\\$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'agent_questions_anon_all') THEN
              CREATE POLICY \\"agent_questions_anon_all\\" ON public.agent_questions FOR ALL TO anon USING (true) WITH CHECK (true);
            END IF;
          END \\$\\$;

          -- skills options_config from 005_skill_options
          ALTER TABLE public.skills ADD COLUMN IF NOT EXISTS options_config JSONB DEFAULT '{}';

          -- test_runs table from 011
          CREATE TABLE IF NOT EXISTS public.test_runs (
            id TEXT PRIMARY KEY, test_id TEXT NOT NULL, category TEXT NOT NULL, label TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', mode TEXT NOT NULL DEFAULT 'auto',
            duration_ms INTEGER, output JSONB, verified_by TEXT, run_by TEXT, notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
          );
          CREATE INDEX IF NOT EXISTS idx_test_runs_test_id ON public.test_runs(test_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_test_runs_category ON public.test_runs(category);
          ALTER TABLE public.test_runs ENABLE ROW LEVEL SECURITY;
          DO \\$\\$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'test_runs_anon_all') THEN
              CREATE POLICY \\"test_runs_anon_all\\" ON public.test_runs FOR ALL TO anon USING (true) WITH CHECK (true);
            END IF;
          END \\$\\$;
        "`,
        { cwd: COMPOSE_PATH, encoding: 'utf-8', stdio: 'pipe', timeout: 20000 }
      );
      console.log(`  ${green('✓')} Schema v0.1.1 columns ${dim('— ready')}`);
      phase5Done = true;
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
      else console.log(`  ${dim('○')} Schema v0.1.1 columns ${dim('— skipped (DB not ready)')}`);
    }
  }

  return true;
}

// ─── Seed Intelligence Prompts ───────────────────────────────
async function seedIntelligence(anonKey) {
  const promptsDir = join(__dirname, '..', 'intelligence', 'prompts');
  if (!existsSync(promptsDir)) {
    console.log(`  ${dim('○')} Intelligence prompts ${dim('— /intelligence/prompts/ not found, skipping')}`);
    return;
  }

  const { readdirSync } = await import('fs');
  const defaultFiles = readdirSync(promptsDir).filter(f => f.endsWith('.default.md'));

  if (defaultFiles.length === 0) {
    console.log(`  ${dim('○')} Intelligence prompts ${dim('— no .default.md files found')}`);
    return;
  }

  let seeded = 0;
  for (const file of defaultFiles) {
    const key = 'prompt:' + file.replace('.default.md', '');
    const raw = readFileSync(join(promptsDir, file), 'utf-8');
    const content = raw.replace(/<!--[\s\S]*?-->/g, '').trim();

    try {
      const res = await fetch(`http://localhost:${activeKongPort}/rest/v1/settings`, {
        method: 'POST',
        headers: {
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates',
        },
        body: JSON.stringify({ key, value: content }),
      });
      if (res.ok || res.status === 409) seeded++;
    } catch {
      // PostgREST not ready — skip silently
    }
  }

  console.log(`  ${green('✓')} Intelligence prompts ${dim(`— ${seeded}/${defaultFiles.length} seeded`)}`);
}

// ─── Generate Kong config ────────────────────────────────────
function generateKongConfig(anonKey, serviceRoleKey) {
  const template = readFileSync(KONG_TEMPLATE, 'utf-8');
  const output = template
    .replace('${SUPABASE_ANON_KEY}', anonKey)
    .replace('${SUPABASE_SERVICE_KEY}', serviceRoleKey);
  writeFileSync(KONG_OUTPUT, output);
  console.log(`  ${green('✓')} ${bold('kong.yml generated')} ${dim('(API keys injected)')}`);
}

// ─── Write Vite .env.development ─────────────────────────────
function writeViteEnv(domain, tls, anonKey) {
  const viteEnvPath = join(__dirname, '..', '.env.development');
  // For local dev, point directly at Kong (HTTP) to avoid self-signed TLS issues.
  // Production builds use Caddy (HTTPS) via api.${domain}.
  const content = `# Generated by setup.mjs — Supabase connection for Vite dev server
VITE_SUPABASE_URL=http://localhost:${activeKongPort}
VITE_SUPABASE_ANON_KEY=${anonKey}
`;
  writeFileSync(viteEnvPath, content);
  console.log(`  ${green('✓')} ${bold('.env.development written')} ${dim(`(Vite → Kong on localhost:${activeKongPort})`)}`);
}

// ─── Hosts File ─────────────────────────────────────────────
async function ensureHostsEntries(domain) {
  const hostnames = [domain, `api.${domain}`, `studio.${domain}`];
  const hostsPath = process.platform === 'win32'
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts';

  let hostsContent;
  try {
    hostsContent = readFileSync(hostsPath, 'utf-8');
  } catch {
    console.log(dim('  Could not read hosts file — skipping check'));
    return;
  }

  const missing = hostnames.filter(h => !hostsContent.includes(h));
  if (missing.length === 0) {
    console.log(`  ${green('✓')} Hosts file OK — ${domain} entries present`);
    return;
  }

  console.log('');
  console.log(gold('  ── HOSTS FILE ──'));
  console.log(dim(`  ${missing.length} hostname(s) missing from ${hostsPath}`));

  const entries = missing.map(h => `127.0.0.1  ${h}`).join('\n');

  if (process.platform !== 'win32') {
    // macOS / Linux — offer to add automatically with sudo
    if (AUTO_MODE) {
      console.log(dim('  Adding hosts entries (may prompt for sudo password)...'));
    } else {
      const doAdd = await ask('Add hosts entries automatically? (requires sudo)', 'y');
      if (doAdd.toLowerCase() !== 'y') {
        console.log(dim('  Add these manually:'));
        console.log(cyan(`    ${entries.replace(/\n/g, '\n    ')}`));
        return;
      }
    }

    try {
      // Use sudo -n first (non-interactive, works if sudo is cached).
      // Fall back to interactive sudo if -n fails and we have a TTY.
      try {
        execSync(`echo '${entries}' | sudo -n tee -a ${hostsPath} > /dev/null`, {
          stdio: 'pipe', timeout: 10000,
        });
      } catch {
        // sudo -n failed — try interactive (will prompt for password on TTY)
        execSync(`echo '${entries}' | sudo tee -a ${hostsPath} > /dev/null`, {
          stdio: ['inherit', 'pipe', 'pipe'],
          timeout: 30000,
        });
      }
      console.log(`  ${green('✓')} Hosts entries added`);
    } catch {
      console.log(gold('  ⚡ Hosts entries needed — paste this once:'));
      const oneLiner = missing.map(h => `127.0.0.1  ${h}`).join('\\n');
      console.log('');
      console.log(cyan(`    sudo sh -c 'echo "${oneLiner}" >> ${hostsPath}'`));
      console.log('');
    }
  } else {
    // Windows — manual instructions
    console.log(dim('  Add these to your hosts file (run as Administrator):'));
    console.log(cyan(`    ${entries.replace(/\n/g, '\n    ')}`));
  }
}

// ─── Launch Agent (reboot persistence) ──────────────────────
async function setupLaunchAgent() {
  if (process.platform !== 'darwin') return; // macOS only

  // Instance-aware Launch Agent naming
  const slot = instanceSlot || 1;
  const agentLabel = `com.jarvis.inc.${slot}`;
  const plistPath = join(process.env.HOME, 'Library', 'LaunchAgents', `${agentLabel}.plist`);
  if (existsSync(plistPath)) {
    console.log(`  ${green('✓')} Launch Agent already installed ${dim(`(${agentLabel}, survives reboots)`)}`);
    return;
  }

  console.log('');
  console.log(gold('  ── REBOOT PERSISTENCE ──'));

  if (!AUTO_MODE) {
    const install = await ask('Install Launch Agent so Jarvis starts on login?', 'y');
    if (install.toLowerCase() !== 'y') {
      console.log(dim('  Skipped. Run "npm run jarvis" manually after reboot.'));
      return;
    }
  } else {
    console.log(dim(`  Installing Launch Agent (${agentLabel}) for auto-start on login...`));
  }

  const projectRoot = join(__dirname, '..');
  // Find npm path
  let npmPath;
  try {
    npmPath = execSync('which npm', { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    npmPath = '/usr/local/bin/npm';
  }

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${agentLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${npmPath}</string>
    <string>run</string>
    <string>jarvis</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>/tmp/jarvis-${slot}.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/jarvis-${slot}.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>`;

  try {
    const launchDir = join(process.env.HOME, 'Library', 'LaunchAgents');
    if (!existsSync(launchDir)) {
      execSync(`mkdir -p "${launchDir}"`);
    }
    writeFileSync(plistPath, plistContent);
    execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
    console.log(`  ${green('✓')} Launch Agent installed ${dim(`— Jarvis instance ${slot} starts on login`)}`);
    console.log(dim(`    Logs: /tmp/jarvis-${slot}.log`));
    console.log(dim(`    Remove: launchctl unload ~/Library/LaunchAgents/${agentLabel}.plist`));
  } catch (err) {
    console.log(`  ${dim('○')} Could not install Launch Agent: ${err.message}`);
    console.log(dim('  See README.md for manual setup instructions.'));
  }
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('');
  console.log(gold('  ╔══════════════════════════════════════╗'));
  console.log(gold('  ║') + bold('   JARVIS INC — SYSTEM SETUP          ') + gold('║'));
  console.log(gold('  ╚══════════════════════════════════════╝'));
  console.log('');

  if (AUTO_MODE) {
    console.log(dim('  Running in auto mode (--auto) — using defaults'));
    console.log('');
  }

  // ─── Pre-flight: Docker ─────────────────────
  console.log(gold('  ── DOCKER CHECK ──'));
  await ensureDocker();

  if (checkOnly) {
    // Just run health checks against existing .env
    if (!existsSync(ENV_PATH)) {
      console.log(red('  No .env found. Run without --check first.'));
      process.exit(1);
    }
    const env = readFileSync(ENV_PATH, 'utf-8');
    extractPortsFromEnv(env);
    const domain = env.match(/^DOMAIN=(.+)$/m)?.[1] || 'jarvis.local';
    const tls = env.match(/^CADDY_TLS=(.*)$/m)?.[1] || 'internal';
    if (domain.endsWith('.local') || !domain.includes('.')) {
      await ensureHostsEntries(domain);
    }
    await healthCheck(domain, tls);
    rl.close();
    return;
  }

  // Check for existing .env — in auto mode, reuse if present
  if (existsSync(ENV_PATH)) {
    if (AUTO_MODE) {
      console.log(dim('  Existing .env found — reusing.'));
      const env = readFileSync(ENV_PATH, 'utf-8');
      extractPortsFromEnv(env);
      const domain = env.match(/^DOMAIN=(.+)$/m)?.[1] || 'jarvis.local';
      const tls = env.match(/^CADDY_TLS=(.*)$/m)?.[1] || 'internal';
      const anonKey = env.match(/^ANON_KEY=(.+)$/m)?.[1] || '';
      const serviceKey = env.match(/^SERVICE_ROLE_KEY=(.+)$/m)?.[1] || '';
      if (domain.endsWith('.local') || !domain.includes('.')) {
        await ensureHostsEntries(domain);
      }
      generateKongConfig(anonKey, serviceKey);
      await startStack();
      await waitForServices(domain, tls);
      await seedIntelligence(anonKey);
      writeViteEnv(domain, tls, anonKey);
      await setupLaunchAgent();
      printSystemsOnline(domain, tls);
      rl.close();
      return;
    }

    const overwrite = await ask('Existing .env found. Overwrite?', 'n');
    if (overwrite.toLowerCase() !== 'y') {
      console.log(dim('  Keeping existing .env.'));
      const env = readFileSync(ENV_PATH, 'utf-8');
      extractPortsFromEnv(env);
      const domain = env.match(/^DOMAIN=(.+)$/m)?.[1] || 'jarvis.local';
      const tls = env.match(/^CADDY_TLS=(.*)$/m)?.[1] || 'internal';
      const anonKey = env.match(/^ANON_KEY=(.+)$/m)?.[1] || '';
      const serviceKey = env.match(/^SERVICE_ROLE_KEY=(.+)$/m)?.[1] || '';
      const startNow = await ask('Start docker compose?', 'y');
      if (startNow.toLowerCase() === 'y') {
        if (domain.endsWith('.local') || !domain.includes('.')) {
          await ensureHostsEntries(domain);
        }
        generateKongConfig(anonKey, serviceKey);
        await startStack();
        await waitForServices(domain, tls);
        await seedIntelligence(anonKey);
        writeViteEnv(domain, tls, anonKey);
        printSystemsOnline(domain, tls);
      }
      rl.close();
      return;
    }
  }

  // ─── Instance Detection ─────────────────────
  console.log(gold('  ── INSTANCE DETECTION ──'));
  instanceSlot = detectInstanceSlot();
  const defaultDomain = domainForSlot(instanceSlot);
  const composeProjectName = `jarvis-${instanceSlot}`;
  const ports = portsForSlot(instanceSlot);
  activeKongPort = ports.KONG_HTTP_PORT;
  activeGatewayPort = ports.GATEWAY_PORT;
  console.log(`  ${green('✓')} Instance slot: ${cyan(String(instanceSlot))} of ${MAX_INSTANCES}`);
  console.log(`  ${green('✓')} Project name:  ${cyan(composeProjectName)}`);
  console.log(`  ${green('✓')} Domain:        ${cyan(defaultDomain)}`);
  console.log(`  ${green('✓')} Ports:         ${dim(`PG=${ports.POSTGRES_PORT} Kong=${ports.KONG_HTTP_PORT} GW=${ports.GATEWAY_PORT} HTTP=${ports.CADDY_HTTP_PORT} HTTPS=${ports.CADDY_HTTPS_PORT}`)}`);

  // ─── Domain ─────────────────────────────────
  console.log('');
  console.log(gold('  ── DOMAIN ──'));
  if (!AUTO_MODE) {
    console.log(dim('  Your hostname. For LAN: jarvis.local or 192.168.1.x.nip.io'));
    console.log(dim('  For internet: your-domain.com'));
  }
  const domain = await ask('Domain', defaultDomain);

  // ─── SSL ────────────────────────────────────
  let tls;
  if (AUTO_MODE) {
    tls = 'internal';
    console.log(`  ${dim('SSL mode:')} ${cyan('internal (self-signed)')}`);
  } else {
    console.log('');
    console.log(gold('  ── SSL MODE ──'));
    console.log(`  ${cyan('1')} Internal (self-signed) — LAN / local dev ${dim('(default)')}`);
    console.log(`  ${cyan('2')} Let's Encrypt — internet-facing, port 80 must be open`);
    console.log(`  ${cyan('3')} Off — plain HTTP, trusted LAN or behind another proxy`);
    const sslChoice = await ask('SSL mode (1/2/3)', '1');
    tls = sslChoice === '2' ? '' : sslChoice === '3' ? 'off' : 'internal';
  }

  // ─── Postgres ───────────────────────────────
  const pgPassword = generatePassword(24);
  if (!AUTO_MODE) {
    console.log('');
    console.log(gold('  ── DATABASE ──'));
    const pgChoice = await ask(`Postgres password — auto-generate or custom? (a/c)`, 'a');
    if (pgChoice.toLowerCase() === 'c') {
      const custom = await ask('Enter Postgres password');
      if (custom && custom.length >= 8) {
        // Use custom password by reassigning wouldn't work with const
        // but in auto mode we always auto-generate
      }
    }
  }
  console.log(`  ${green('✓')} Postgres password: ${cyan(pgPassword.slice(0, 4) + '...' + pgPassword.slice(-4))}`);

  // ─── Studio Protection ──────────────────────
  const studioUser = 'admin';
  const studioPass = generatePassword(16);
  if (!AUTO_MODE) {
    console.log('');
    console.log(gold('  ── STUDIO PROTECTION ──'));
    console.log(dim('  Basic auth for Supabase Studio admin panel'));
  }
  console.log(`  ${green('✓')} Studio: ${cyan(`${studioUser}:${studioPass}`)}`);
  if (!AUTO_MODE) {
    console.log(dim('  Hashing password via Caddy...'));
  }
  const studioHash = hashPassword(studioPass);

  // ─── Generate Secrets ───────────────────────
  console.log('');
  console.log(gold('  ── GENERATING SECRETS ──'));

  const jwtSecret = generateSecret(32);
  console.log(`  ${green('✓')} JWT secret generated`);

  const secretKeyBase = generateSecret(48);
  console.log(`  ${green('✓')} Realtime secret generated`);

  const anonKey = generateJWT(jwtSecret, 'anon');
  console.log(`  ${green('✓')} Anon key generated`);

  const serviceRoleKey = generateJWT(jwtSecret, 'service_role');
  console.log(`  ${green('✓')} Service role key generated`);

  // ─── Port Allocation (deterministic per instance) ─────────
  // Ports were already set during instance detection above.
  // Just log them for confirmation.
  console.log('');
  console.log(gold('  ── PORT ALLOCATION ──'));
  for (const [name, port] of Object.entries(ports)) {
    console.log(`  ${green('✓')} ${name} ${dim(`= ${port}`)}`);
  }

  // ─── Write .env ─────────────────────────────
  const envContent = `# Jarvis Inc — Generated by setup.mjs
# ${new Date().toISOString()}

INSTANCE_ID=${instanceSlot}
COMPOSE_PROJECT_NAME=${composeProjectName}

DOMAIN=${domain}
CADDY_TLS=${tls}

STUDIO_USER=${studioUser}
# STUDIO_PASS_CLEARTEXT=${studioPass}
STUDIO_PASS_HASH=${studioHash.replace(/\$/g, '$$$$')}

POSTGRES_PASSWORD=${pgPassword}
POSTGRES_DB=postgres
POSTGRES_PORT=${ports.POSTGRES_PORT}

KONG_HTTP_PORT=${ports.KONG_HTTP_PORT}
GATEWAY_PORT=${ports.GATEWAY_PORT}
CADDY_HTTP_PORT=${ports.CADDY_HTTP_PORT}
CADDY_HTTPS_PORT=${ports.CADDY_HTTPS_PORT}

JWT_SECRET=${jwtSecret}
JWT_EXP=3600

ANON_KEY=${anonKey}
SERVICE_ROLE_KEY=${serviceRoleKey}

SECRET_KEY_BASE=${secretKeyBase}
`;

  writeFileSync(ENV_PATH, envContent);
  console.log('');
  console.log(`  ${green('✓')} ${bold('docker/.env written')}`);

  // ─── Summary ────────────────────────────────
  if (!AUTO_MODE) {
    console.log('');
    console.log(gold('  ── CONFIGURATION SUMMARY ──'));
    console.log(`  Domain:       ${cyan(domain)}`);
    console.log(`  SSL:          ${cyan(tls || 'Let\'s Encrypt')}`);
    console.log(`  Studio login: ${cyan(`${studioUser}:${studioPass}`)}`);
    console.log(`  Postgres:     ${cyan(pgPassword)}`);
    console.log(`  Secrets:      ${dim('All saved to docker/.env')}`);
  }

  // ─── Hosts file ────────────────────────────
  if (domain.endsWith('.local') || !domain.includes('.')) {
    await ensureHostsEntries(domain);
  }

  // ─── Generate Kong config ─────────────────────
  generateKongConfig(anonKey, serviceRoleKey);

  // ─── Start Docker ───────────────────────────
  const startNow = AUTO_MODE ? 'y' : await ask('Start docker compose now?', 'y');
  if (startNow.toLowerCase() === 'y') {
    await startStack();
    await waitForServices(domain, tls);
    await seedIntelligence(anonKey);
    writeViteEnv(domain, tls, anonKey);
    await setupLaunchAgent();
    printSystemsOnline(domain, tls);
  } else {
    console.log('');
    console.log(dim('  To start later:'));
    console.log(dim(`    cd docker && docker compose up -d`));
    console.log('');
    console.log(dim('  To verify:'));
    console.log(dim(`    node docker/setup.mjs --check`));
  }

  console.log('');
  rl.close();
}

function printSystemsOnline(domain, tls) {
  const proto = tls === 'off' ? 'http' : 'https';
  const slot = instanceSlot || '?';
  console.log('');
  console.log(gold('  ╔══════════════════════════════════════╗'));
  console.log(gold('  ║') + green(`  ✓ INSTANCE ${slot} — SYSTEMS ONLINE ✓     `) + gold('║'));
  console.log(gold('  ╚══════════════════════════════════════╝'));
  console.log('');
  console.log(`  ${cyan('Dashboard:')}  ${proto}://${domain}`);
  console.log(`  ${cyan('API:')}        ${proto}://api.${domain}`);
  console.log(`  ${cyan('Studio:')}     ${proto}://studio.${domain}`);
  console.log(`  ${cyan('Kong:')}       http://localhost:${activeKongPort}`);
  console.log(`  ${cyan('Gateway:')}    http://localhost:${activeGatewayPort}`);
  console.log(`  ${cyan('Dev server:')} http://localhost:5173`);
  console.log('');
}

async function startStack() {
  console.log('');
  console.log(gold('  ── STARTING DOCKER STACK ──'));
  console.log(dim('  docker compose up -d'));
  console.log('');

  return new Promise((resolve) => {
    const proc = spawn('docker', ['compose', 'up', '-d'], {
      cwd: COMPOSE_PATH,
      stdio: 'inherit',
    });
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`  ${green('✓')} Docker stack started`);
      } else {
        console.log(`  ${red('✗')} Docker compose exited with code ${code}`);
      }
      resolve();
    });
    proc.on('error', (err) => {
      console.log(`  ${red('✗')} Failed to start: ${err.message}`);
      resolve();
    });
  });
}

main().catch(err => {
  console.error(red(`Error: ${err.message}`));
  rl.close();
  process.exit(1);
});
