#!/usr/bin/env node

// Jarvis Inc — Interactive Setup Script
// ======================================
// Generates docker/.env, starts the stack, and verifies all services.
//
// Usage:
//   node docker/setup.mjs          # interactive setup
//   node docker/setup.mjs --check  # health-check only (skip .env generation)

import { createInterface } from 'readline';
import { createHmac, randomBytes } from 'crypto';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '.env');
const COMPOSE_PATH = __dirname;

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

async function ensureDocker() {
  // Loop until Docker is installed and running
  while (true) {
    if (!isDockerInstalled()) {
      console.log('');
      console.log(red('  Docker is not installed (or not in PATH).'));
      console.log('');
      console.log(gold('  ── INSTALL DOCKER ──'));
      console.log(`  ${cyan('Windows:')}  https://docs.docker.com/desktop/install/windows-install/`);
      console.log(`  ${cyan('macOS:')}    https://docs.docker.com/desktop/install/mac-install/`);
      console.log(`  ${cyan('Linux:')}    https://docs.docker.com/engine/install/`);
      console.log('');
      console.log(dim('  After installing, make sure Docker Desktop is running.'));
      await ask('Press Enter when Docker is installed and running...');
      continue;
    }

    if (!isDockerRunning()) {
      console.log('');
      console.log(red('  Docker is installed but not running.'));
      console.log(dim('  Start Docker Desktop (or the Docker daemon) and try again.'));
      await ask('Press Enter when Docker is running...');
      continue;
    }

    // Both installed and running
    const version = execSync('docker --version', { encoding: 'utf-8' }).trim();
    console.log(`  ${green('✓')} ${dim(version)}`);
    return;
  }
}

// ─── Health Checks ──────────────────────────────────────────
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

async function healthCheck(domain, tls) {
  const proto = tls === 'off' ? 'http' : 'https';
  const services = [
    { name: 'Jarvis Frontend', url: `${proto}://${domain}/` },
    { name: 'Supabase API (Kong)', url: `${proto}://api.${domain}/rest/v1/` },
    { name: 'Supabase Auth (GoTrue)', url: `${proto}://api.${domain}/auth/v1/health` },
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

// ─── Main ────────────────────────────────────────────────────
async function main() {
  const checkOnly = process.argv.includes('--check');

  console.log('');
  console.log(gold('  ╔══════════════════════════════════════╗'));
  console.log(gold('  ║') + bold('   JARVIS INC — SYSTEM SETUP          ') + gold('║'));
  console.log(gold('  ╚══════════════════════════════════════╝'));
  console.log('');

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
    const domain = env.match(/^DOMAIN=(.+)$/m)?.[1] || 'jarvis.local';
    const tls = env.match(/^CADDY_TLS=(.*)$/m)?.[1] || 'internal';
    await healthCheck(domain, tls);
    rl.close();
    return;
  }

  // Check for existing .env
  if (existsSync(ENV_PATH)) {
    const overwrite = await ask('Existing .env found. Overwrite?', 'n');
    if (overwrite.toLowerCase() !== 'y') {
      console.log(dim('  Keeping existing .env.'));
      const env = readFileSync(ENV_PATH, 'utf-8');
      const domain = env.match(/^DOMAIN=(.+)$/m)?.[1] || 'jarvis.local';
      const tls = env.match(/^CADDY_TLS=(.*)$/m)?.[1] || 'internal';
      const startNow = await ask('Start docker compose?', 'y');
      if (startNow.toLowerCase() === 'y') {
        await startStack();
        await healthCheck(domain, tls);
      }
      rl.close();
      return;
    }
  }

  // ─── Domain ─────────────────────────────────
  console.log(gold('  ── DOMAIN ──'));
  console.log(dim('  Your hostname. For LAN: jarvis.local or 192.168.1.x.nip.io'));
  console.log(dim('  For internet: your-domain.com'));
  const domain = await ask('Domain', 'jarvis.local');

  // ─── SSL ────────────────────────────────────
  console.log('');
  console.log(gold('  ── SSL MODE ──'));
  console.log(`  ${cyan('1')} Internal (self-signed) — LAN / local dev ${dim('(default)')}`);
  console.log(`  ${cyan('2')} Let's Encrypt — internet-facing, port 80 must be open`);
  console.log(`  ${cyan('3')} Off — plain HTTP, trusted LAN or behind another proxy`);
  const sslChoice = await ask('SSL mode (1/2/3)', '1');
  const tls = sslChoice === '2' ? '' : sslChoice === '3' ? 'off' : 'internal';

  // ─── Postgres ───────────────────────────────
  console.log('');
  console.log(gold('  ── DATABASE ──'));
  const defaultPgPass = generatePassword(24);
  const pgChoice = await ask(`Postgres password — auto-generate or custom? (a/c)`, 'a');
  let pgPassword;
  if (pgChoice.toLowerCase() === 'c') {
    pgPassword = await ask('Enter Postgres password');
    if (!pgPassword || pgPassword.length < 8) {
      pgPassword = defaultPgPass;
      console.log(dim('  Too short — using generated password instead.'));
    }
  } else {
    pgPassword = defaultPgPass;
  }
  console.log(`  ${green('✓')} Postgres password: ${cyan(pgPassword.slice(0, 4) + '...' + pgPassword.slice(-4))}`);

  // ─── Studio Protection ──────────────────────
  console.log('');
  console.log(gold('  ── STUDIO PROTECTION ──'));
  console.log(dim('  Basic auth for Supabase Studio admin panel'));
  const studioUser = await ask('Studio username', 'admin');
  const defaultStudioPass = generatePassword(16);
  const studioChoice = await ask('Studio password — auto-generate or custom? (a/c)', 'a');
  let studioPass;
  if (studioChoice.toLowerCase() === 'c') {
    studioPass = await ask('Enter Studio password');
    if (!studioPass) {
      studioPass = defaultStudioPass;
    }
  } else {
    studioPass = defaultStudioPass;
  }
  console.log(`  ${green('✓')} Studio password: ${cyan(studioPass)}`);
  console.log(dim('  Hashing password via Caddy...'));
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

  // ─── Write .env ─────────────────────────────
  const envContent = `# Jarvis Inc — Generated by setup.mjs
# ${new Date().toISOString()}

DOMAIN=${domain}
CADDY_TLS=${tls}

STUDIO_USER=${studioUser}
STUDIO_PASS_HASH=${studioHash.replace(/\$/g, '$$$$')}

POSTGRES_PASSWORD=${pgPassword}
POSTGRES_DB=postgres
POSTGRES_PORT=5432

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
  console.log('');
  console.log(gold('  ── CONFIGURATION SUMMARY ──'));
  console.log(`  Domain:       ${cyan(domain)}`);
  console.log(`  SSL:          ${cyan(tls || 'Let\'s Encrypt')}`);
  console.log(`  Studio login: ${cyan(`${studioUser}:${studioPass}`)}`);
  console.log(`  Postgres:     ${cyan(pgPassword)}`);
  console.log(`  Secrets:      ${dim('All saved to docker/.env')}`);

  // ─── Start Docker ───────────────────────────
  console.log('');
  const startNow = await ask('Start docker compose now?', 'y');
  if (startNow.toLowerCase() === 'y') {
    await startStack();
    console.log('');
    console.log(dim('  Waiting 15s for services to initialize...'));
    await new Promise(r => setTimeout(r, 15000));
    await healthCheck(domain, tls);
  } else {
    console.log('');
    console.log(dim('  To start later:'));
    console.log(dim(`    cd docker && docker compose up -d`));
    console.log('');
    console.log(dim('  To verify:'));
    console.log(dim(`    node docker/setup.mjs --check`));
  }

  // ─── Hosts file reminder ────────────────────
  if (domain.endsWith('.local') || !domain.includes('.')) {
    console.log('');
    console.log(gold('  ── HOSTS FILE ──'));
    console.log(dim('  Add these to your hosts file (/etc/hosts or C:\\Windows\\System32\\drivers\\etc\\hosts):'));
    console.log('');
    console.log(cyan(`    127.0.0.1  ${domain}`));
    console.log(cyan(`    127.0.0.1  api.${domain}`));
    console.log(cyan(`    127.0.0.1  studio.${domain}`));
  }

  console.log('');
  console.log(gold('  Setup complete.'));
  console.log('');

  rl.close();
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
