#!/usr/bin/env node

/**
 * Jarvis Inc Auto-Update Script
 *
 * Checks jarvisinc.app for latest version, pulls updates if available,
 * reinstalls dependencies, and restarts the Docker stack.
 *
 * Usage:
 *   node auto-update.mjs          # Run once
 *   node auto-update.mjs --force  # Force update even if versions match
 *   node auto-update.mjs --install-cron weekly   # Install weekly cron
 *   node auto-update.mjs --install-cron daily    # Install daily cron
 *   node auto-update.mjs --remove-cron           # Remove cron job
 *
 * Cron manual setup:
 *   crontab -e
 *   0 4 * * 0 cd /path/to/jarvis_inc && node auto-update.mjs >> logs/auto-update.log 2>&1
 */

import { execSync } from 'child_process';
import { readFileSync, mkdirSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs');
const LOG_FILE = join(LOG_DIR, 'auto-update.log');
const MARKETPLACE_URL = 'https://jarvisinc.app';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch { /* ignore log write failures */ }
}

function run(cmd, opts = {}) {
  log(`> ${cmd}`);
  try {
    const output = execSync(cmd, { cwd: __dirname, encoding: 'utf-8', timeout: 120000, ...opts });
    if (output.trim()) log(output.trim());
    return output.trim();
  } catch (err) {
    log(`ERROR: ${err.message}`);
    throw err;
  }
}

function getLocalVersion() {
  const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
  return pkg.version;
}

async function getRemoteVersion() {
  const res = await fetch(`${MARKETPLACE_URL}/api/version`);
  if (!res.ok) throw new Error(`Version check failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.latest_app_version;
}

function installCron(frequency) {
  const schedule = frequency === 'daily' ? '0 4 * * *' : '0 4 * * 0';
  const label = frequency === 'daily' ? 'daily at 4am' : 'weekly Sunday 4am';
  const cronLine = `${schedule} cd ${__dirname} && node auto-update.mjs >> logs/auto-update.log 2>&1`;
  const marker = '# jarvis-auto-update';

  // Check existing crontab
  let existing = '';
  try { existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' }); } catch { /* no crontab */ }

  // Remove old jarvis entry if present
  const lines = existing.split('\n').filter(l => !l.includes(marker) && !l.includes('auto-update.mjs'));
  lines.push(`${cronLine} ${marker}`);

  // Install
  const newCrontab = lines.filter(l => l.trim()).join('\n') + '\n';
  execSync(`echo '${newCrontab}' | crontab -`, { encoding: 'utf-8' });

  log(`Cron installed: ${label}`);
  log(`Line: ${cronLine}`);
  console.log(`\nAuto-update cron installed (${label})`);
  console.log(`View logs: tail -f ${LOG_FILE}`);
}

function removeCron() {
  let existing = '';
  try { existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' }); } catch { return; }

  const lines = existing.split('\n').filter(l => !l.includes('jarvis-auto-update') && !l.includes('auto-update.mjs'));
  const newCrontab = lines.filter(l => l.trim()).join('\n') + '\n';
  execSync(`echo '${newCrontab}' | crontab -`, { encoding: 'utf-8' });

  log('Cron removed');
  console.log('Auto-update cron removed.');
}

async function main() {
  const args = process.argv.slice(2);

  // Handle cron management
  if (args.includes('--install-cron')) {
    const freq = args[args.indexOf('--install-cron') + 1] || 'weekly';
    installCron(freq);
    return;
  }
  if (args.includes('--remove-cron')) {
    removeCron();
    return;
  }

  const force = args.includes('--force');

  log('=== Jarvis Auto-Update ===');

  // 1. Check versions
  const localVersion = getLocalVersion();
  log(`Local version: v${localVersion}`);

  let remoteVersion;
  try {
    remoteVersion = await getRemoteVersion();
    log(`Remote version: v${remoteVersion}`);
  } catch (err) {
    log(`Cannot reach marketplace: ${err.message}`);
    log('Update check skipped.');
    return;
  }

  if (remoteVersion === localVersion && !force) {
    log('Already up to date. No action needed.');
    return;
  }

  log(force ? 'Force update requested.' : `Update available: v${localVersion} → v${remoteVersion}`);

  // 2. Check for uncommitted changes
  const status = run('git status --porcelain');
  if (status) {
    log('WARNING: Uncommitted changes detected. Stashing...');
    run('git stash');
  }

  // 3. Pull latest
  log('Pulling latest from origin/main...');
  run('git pull origin main');

  // 4. Install dependencies
  log('Installing dependencies...');
  run('npm install');

  // 5. Rebuild frontend (before Docker so the image gets the new build)
  log('Building frontend...');
  run('npm run build', { timeout: 60000 });

  // 6. Restart Docker stack via setup (handles multi-instance ports, secrets, etc.)
  try {
    const containers = run('docker compose -f docker/docker-compose.yml ps -q', { timeout: 10000 });
    if (containers) {
      log('Restarting Docker stack via setup...');
      run('node docker/setup.mjs --auto', { timeout: 300000 });
      log('Docker stack restarted.');
    }
  } catch {
    log('Docker not running or not available. Skipping Docker restart.');
  }

  const newVersion = getLocalVersion();
  log(`Update complete: v${newVersion}`);
  log('=========================');
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
