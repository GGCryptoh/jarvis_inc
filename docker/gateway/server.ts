import express from 'express';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, resolve, dirname, extname } from 'path';
import { spawn } from 'child_process';

const app = express();
const PORT = parseInt(process.env.GATEWAY_PORT ?? '3001', 10);
const WORKSPACE = process.env.WORKSPACE_PATH ?? '/workspace';

// Ensure workspace directories exist
for (const dir of ['apps', 'handlers', 'skills']) {
  const path = join(WORKSPACE, dir);
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

app.use(express.json());

// ─── CORS ──────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// ─── Health check ──────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', workspace: WORKSPACE });
});

// ─── App serving: static files per mission ─────────────────
app.use('/apps', express.static(join(WORKSPACE, 'apps'), {
  extensions: ['html', 'htm'],
  index: 'index.html',
}));

// ─── List apps ─────────────────────────────────────────────
app.get('/api/apps', (_req, res) => {
  const appsDir = join(WORKSPACE, 'apps');
  try {
    const entries = readdirSync(appsDir)
      .filter((f: string) => statSync(join(appsDir, f)).isDirectory())
      .map((name: string) => ({
        name,
        url: `/apps/${name}/`,
        created: statSync(join(appsDir, name)).birthtime,
      }));
    res.json(entries);
  } catch {
    res.json([]);
  }
});

// ─── Code execution: run handler by name ───────────────────
app.post('/exec/:handler', async (req, res) => {
  const handlerName = req.params.handler;

  // Security: validate handler name (alphanumeric + hyphens/underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(handlerName)) {
    res.status(400).json({ error: 'Invalid handler name' });
    return;
  }

  const handlerPath = join(WORKSPACE, 'handlers', `${handlerName}.ts`);
  const handlerPathJs = join(WORKSPACE, 'handlers', `${handlerName}.js`);
  const resolvedPath = existsSync(handlerPath) ? handlerPath : existsSync(handlerPathJs) ? handlerPathJs : null;

  if (!resolvedPath) {
    res.status(404).json({ error: `Handler not found: ${handlerName}` });
    return;
  }

  try {
    // Dynamic import of the handler
    const handler = await import(resolvedPath);
    if (typeof handler.default !== 'function') {
      res.status(500).json({ error: 'Handler has no default export function' });
      return;
    }
    const result = await handler.default(req.body);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── List handlers ─────────────────────────────────────────
app.get('/api/handlers', (_req, res) => {
  const dir = join(WORKSPACE, 'handlers');
  try {
    const handlers = readdirSync(dir)
      .filter((f: string) => f.endsWith('.ts') || f.endsWith('.js'))
      .map((f: string) => f.replace(/\.(ts|js)$/, ''));
    res.json(handlers);
  } catch {
    res.json([]);
  }
});

// ─── Write handler code to workspace ────────────────────────
app.put('/api/handlers/:name', (req, res) => {
  const name = req.params.name;

  // Validate handler name (alphanumeric + hyphens only)
  if (!/^[a-z0-9-]+$/i.test(name)) {
    res.status(400).json({ error: 'Invalid handler name. Use alphanumeric + hyphens only.' });
    return;
  }

  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing "code" field in request body.' });
    return;
  }

  // Size limit 100KB
  if (code.length > 100_000) {
    res.status(400).json({ error: 'Handler code exceeds 100KB limit.' });
    return;
  }

  const handlersDir = join(WORKSPACE, 'handlers');
  if (!existsSync(handlersDir)) {
    mkdirSync(handlersDir, { recursive: true });
  }

  const filePath = join(handlersDir, `${name}.ts`);
  writeFileSync(filePath, code, 'utf-8');

  res.json({ success: true, path: `/workspace/handlers/${name}.ts` });
});

// ─── Install skill package ────────────────────────────────
// POST /install-skill
// Body: { skillId: string, files: { path: string, content: string }[] }
app.post('/install-skill', (req, res) => {
  const { skillId, files } = req.body;
  if (!skillId || !Array.isArray(files) || !files.length) {
    res.status(400).json({ error: 'skillId and files[] required' });
    return;
  }

  // Validate skillId format (kebab-case)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillId)) {
    res.status(400).json({ error: 'Invalid skill ID format (use kebab-case)' });
    return;
  }

  const skillDir = join(WORKSPACE, 'skills', skillId);
  mkdirSync(skillDir, { recursive: true });

  const written: string[] = [];
  for (const file of files) {
    if (!file.path || typeof file.content !== 'string') continue;

    // Security: prevent path traversal
    const resolved = resolve(skillDir, file.path);
    if (!resolved.startsWith(skillDir)) {
      res.status(400).json({ error: `Invalid file path: ${file.path}` });
      return;
    }

    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, file.content, 'utf-8');
    written.push(file.path);
  }

  console.log(`[Gateway] Installed skill "${skillId}" (${written.length} files)`);
  res.json({ ok: true, skillId, path: skillDir, files: written });
});

// ─── Execute skill command ────────────────────────────────
// POST /exec-skill/:id/:cmd
// Body: { params: Record<string, any>, apiKey?: string }
app.post('/exec-skill/:id/:cmd', async (req, res) => {
  const { id, cmd } = req.params;
  const { params = {}, apiKey } = req.body;

  const skillDir = join(WORKSPACE, 'skills', id);
  const skillJsonPath = join(skillDir, 'skill.json');

  if (!existsSync(skillJsonPath)) {
    res.status(404).json({ error: `Skill not installed: ${id}` });
    return;
  }

  try {
    const skillJson = JSON.parse(readFileSync(skillJsonPath, 'utf-8'));
    const command = skillJson.commands?.find((c: any) => c.name === cmd);
    if (!command?.handler_file) {
      res.status(404).json({ error: `No handler_file for command "${cmd}" in skill "${id}"` });
      return;
    }

    const handlerPath = join(skillDir, command.handler_file);
    if (!existsSync(handlerPath)) {
      res.status(404).json({ error: `Handler file not found: ${command.handler_file}` });
      return;
    }

    const ext = extname(handlerPath);
    let result: any;

    if (ext === '.ts' || ext === '.js') {
      // TypeScript/JS: dynamic import
      const mod = await import(handlerPath);
      if (typeof mod.default !== 'function') {
        res.status(500).json({ error: 'Handler has no default export function' });
        return;
      }
      result = await mod.default({ ...params, _apiKey: apiKey });
    } else if (ext === '.py') {
      result = await execPython(handlerPath, { ...params, _apiKey: apiKey });
    } else if (ext === '.sh') {
      result = await execBash(handlerPath, params, apiKey);
    } else {
      res.status(400).json({ error: `Unsupported handler extension: ${ext}` });
      return;
    }

    res.json({ ok: true, result });
  } catch (err: any) {
    console.error(`[Gateway] exec-skill error (${id}/${cmd}):`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── List installed skills ────────────────────────────────
app.get('/list-skills', (_req, res) => {
  const skillsDir = join(WORKSPACE, 'skills');
  try {
    const dirs = readdirSync(skillsDir);
    const skills: any[] = [];
    for (const dir of dirs) {
      const jsonPath = join(skillsDir, dir, 'skill.json');
      try {
        const json = JSON.parse(readFileSync(jsonPath, 'utf-8'));
        skills.push({
          id: json.id,
          title: json.title,
          runtime: json.handler_runtime || null,
          commands: json.commands?.map((c: any) => ({
            name: c.name,
            handler_file: c.handler_file || null,
          })),
        });
      } catch { /* skip non-skill directories */ }
    }
    res.json({ skills });
  } catch {
    res.json({ skills: [] });
  }
});

// ─── Python handler execution ─────────────────────────────
function execPython(scriptPath: string, params: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [scriptPath], { timeout: 30_000 });
    let stdout = '';
    let stderr = '';
    proc.stdin.write(JSON.stringify(params));
    proc.stdin.end();
    proc.stdout.on('data', (d: Buffer) => { stdout += d; });
    proc.stderr.on('data', (d: Buffer) => { stderr += d; });
    proc.on('close', (code: number | null) => {
      if (code !== 0) return reject(new Error(stderr || `Python exit code ${code}`));
      try { resolve(JSON.parse(stdout)); } catch { resolve({ result: stdout.trim() }); }
    });
    proc.on('error', reject);
  });
}

// ─── Bash handler execution ──────────────────────────────
function execBash(scriptPath: string, params: Record<string, any>, apiKey?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    for (const [k, v] of Object.entries(params)) {
      env[`PARAM_${k.toUpperCase()}`] = String(v);
    }
    if (apiKey) env.API_KEY = apiKey;
    const proc = spawn('bash', [scriptPath], { env, timeout: 30_000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d; });
    proc.stderr.on('data', (d: Buffer) => { stderr += d; });
    proc.on('close', (code: number | null) => {
      if (code !== 0) return reject(new Error(stderr || `Bash exit code ${code}`));
      try { resolve(JSON.parse(stdout)); } catch { resolve({ result: stdout.trim() }); }
    });
    proc.on('error', reject);
  });
}

// ─── OAuth token exchange proxy ────────────────────────────
// Accepts { grant_type, code, client_id, client_secret, redirect_uri, token_url, ... }
// Strips `token_url` from body, POSTs remaining fields as x-www-form-urlencoded to the token endpoint.
app.post('/api/oauth/token', async (req, res) => {
  try {
    const body = { ...req.body };
    const tokenUrl = body.token_url || 'https://oauth2.googleapis.com/token';
    delete body.token_url;

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    const data = await resp.text();
    res.status(resp.status).type('json').send(data);
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? 'Token exchange failed' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Gateway] Listening on :${PORT}`);
  console.log(`[Gateway] Workspace: ${WORKSPACE}`);
  console.log(`[Gateway] Apps:       http://0.0.0.0:${PORT}/apps/`);
  console.log(`[Gateway] Exec:       POST http://0.0.0.0:${PORT}/exec/{handler}`);
  console.log(`[Gateway] Skills:     POST http://0.0.0.0:${PORT}/exec-skill/{id}/{cmd}`);
  console.log(`[Gateway] Install:    POST http://0.0.0.0:${PORT}/install-skill`);
});
