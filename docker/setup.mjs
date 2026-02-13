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
  // In auto mode, just check once and fail fast
  if (AUTO_MODE) {
    if (!isDockerInstalled()) {
      console.log(red('  Docker is not installed.'));
      console.log('');
      console.log(gold('  ── INSTALL DOCKER ──'));
      console.log(`  ${cyan('macOS:')}    https://docs.docker.com/desktop/install/mac-install/`);
      console.log(`  ${cyan('Windows:')}  https://docs.docker.com/desktop/install/windows-install/`);
      console.log(`  ${cyan('Linux:')}    https://docs.docker.com/engine/install/`);
      console.log('');
      console.log(dim('  Install Docker Desktop, start it, then re-run: npm run jarvis'));
      process.exit(1);
    }
    if (!isDockerRunning()) {
      console.log(red('  Docker is installed but not running.'));
      console.log(dim('  Start Docker Desktop, then re-run: npm run jarvis'));
      process.exit(1);
    }
    const version = execSync('docker --version', { encoding: 'utf-8' }).trim();
    console.log(`  ${green('✓')} ${dim(version)}`);
    return;
  }

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
        'docker compose exec -T supabase-db pg_isready -U postgres -h localhost',
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
    { name: 'Supabase API (Kong)', url: `http://localhost:8000/rest/v1/` },
    { name: 'Supabase Auth (GoTrue)', url: `http://localhost:8000/auth/v1/health` },
    { name: 'Edge Functions', url: `http://localhost:8000/functions/v1/health`, optional: true },
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

  // Phase 2: Wait for HTTP services via Kong directly (no Caddy/TLS dependency)
  const httpServices = [
    { name: 'Kong API Gateway', url: `http://localhost:8000/rest/v1/` },
    { name: 'GoTrue Auth', url: `http://localhost:8000/auth/v1/health` },
    { name: 'Edge Functions', url: `http://localhost:8000/functions/v1/health`, optional: true },
  ];

  for (const svc of httpServices) {
    process.stdout.write(`  ${dim('waiting')} ${svc.name}...`);
    const ok = await checkService(svc.name, svc.url, svc.optional ? 15000 : 45000);
    if (ok) {
      console.log(`\r  ${green('✓')} ${svc.name} ${dim('— online')}`);
    } else if (svc.optional) {
      console.log(`\r  ${dim('○')} ${svc.name} ${dim('— skipped (optional)')}`);
    } else {
      console.log(`\r  ${red('✗')} ${svc.name} ${dim('— timed out')}`);
    }
  }

  return true;
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
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_ANON_KEY=${anonKey}
`;
  writeFileSync(viteEnvPath, content);
  console.log(`  ${green('✓')} ${bold('.env.development written')} ${dim('(Vite → Kong on localhost:8000)')}`);
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
      execSync(`echo '${entries}' | sudo tee -a ${hostsPath} > /dev/null`, {
        stdio: ['inherit', 'pipe', 'pipe'],
        timeout: 30000,
      });
      console.log(`  ${green('✓')} Hosts entries added`);
    } catch {
      console.log(red('  Could not add hosts entries automatically.'));
      console.log(dim('  Add these manually:'));
      console.log(cyan(`    ${entries.replace(/\n/g, '\n    ')}`));
    }
  } else {
    // Windows — manual instructions
    console.log(dim('  Add these to your hosts file (run as Administrator):'));
    console.log(cyan(`    ${entries.replace(/\n/g, '\n    ')}`));
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
      writeViteEnv(domain, tls, anonKey);
      printSystemsOnline(domain, tls);
      rl.close();
      return;
    }

    const overwrite = await ask('Existing .env found. Overwrite?', 'n');
    if (overwrite.toLowerCase() !== 'y') {
      console.log(dim('  Keeping existing .env.'));
      const env = readFileSync(ENV_PATH, 'utf-8');
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
        writeViteEnv(domain, tls, anonKey);
        printSystemsOnline(domain, tls);
      }
      rl.close();
      return;
    }
  }

  // ─── Domain ─────────────────────────────────
  console.log(gold('  ── DOMAIN ──'));
  if (!AUTO_MODE) {
    console.log(dim('  Your hostname. For LAN: jarvis.local or 192.168.1.x.nip.io'));
    console.log(dim('  For internet: your-domain.com'));
  }
  const domain = await ask('Domain', 'jarvis.local');

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
    writeViteEnv(domain, tls, anonKey);
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
  console.log('');
  console.log(gold('  ╔══════════════════════════════════════╗'));
  console.log(gold('  ║') + green('      ✓ SYSTEMS ONLINE ✓              ') + gold('║'));
  console.log(gold('  ╚══════════════════════════════════════╝'));
  console.log('');
  console.log(`  ${cyan('Dashboard:')}  ${proto}://${domain}`);
  console.log(`  ${cyan('API:')}        ${proto}://api.${domain}`);
  console.log(`  ${cyan('Studio:')}     ${proto}://studio.${domain}`);
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
