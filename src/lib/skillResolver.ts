/**
 * Skill Resolver — Merges GitHub repo JSON and DB state
 * ======================================================
 * Two-layer merge:
 *   1. GitHub repo JSON — skill definitions: commands, params, defaults, models
 *   2. DB skills table — runtime state: enabled, model, full definition JSONB
 *
 * The resolver produces FullSkillDefinition objects used by the skill executor
 * and test dialog. The GitHub repo is the source of truth for command definitions
 * and default models. Skills are seeded from the repo into the DB.
 */

import { loadSkills, type SkillRow, upsertSkillDefinition, clearAllSkills, getSetting, setSetting } from './database';
import { getSupabase } from './supabase';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SKILLS_REPO_OWNER = 'GGCryptoh';
const SKILLS_REPO_NAME = 'jarvis_inc_skills';
const SKILLS_REPO_BRANCH = 'main';

function rawUrl(path: string): string {
  return `https://raw.githubusercontent.com/${SKILLS_REPO_OWNER}/${SKILLS_REPO_NAME}/${SKILLS_REPO_BRANCH}/${path}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: unknown;
}

export interface RequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  response_format?: 'json' | 'text' | 'binary';
  proxy?: boolean;
}

export interface ResponseConfig {
  passthrough?: boolean;
  passthrough_to_llm?: boolean;
  extract?: Record<string, string>;
  extract_raw?: string;
  error_path?: string;
  image_field?: string;
}

export interface PostProcessorDef {
  type: string;
  config?: Record<string, unknown>;
}

export interface MultiRequestConfig {
  iterate_over: string[];
  iterate_param: string;
  merge_strategy?: 'concat' | 'object' | 'array';
}

export interface CLICommandTemplate {
  url_template?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  response_type?: 'json' | 'text';
  gateway_exec?: boolean;
  command_template?: string;
  timeout?: number;
}

export interface SkillCommand {
  name: string;
  description: string;
  parameters: SkillParameter[];
  system_prompt?: string;
  prompt_template?: string;
  returns?: { type: string; description: string };
  request?: RequestConfig;
  response?: ResponseConfig;
  output_template?: string;
  post_processors?: PostProcessorDef[];
  multi_request?: MultiRequestConfig;
  cli_command_template?: CLICommandTemplate;
  /** Path to handler file relative to skill directory (e.g. 'handlers/query.ts') */
  handler_file?: string;
}

export interface FullSkillDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;              // icon component name (string, not React.ElementType)
  serviceType: string;       // 'llm' | 'fixed'
  fixedService?: string;
  defaultModel?: string;
  status: string;            // 'available', 'coming_soon', 'beta'
  enabled: boolean;          // from DB
  model: string | null;      // from DB
  source: string;            // 'seed', 'github', 'marketplace', 'hardcoded'
  // From repo JSON / DB definition:
  commands?: SkillCommand[];
  connection?: Record<string, unknown>;
  prerequisites?: string[];
  /** Named handler for direct API execution (e.g. 'openai_image_generation') */
  executionHandler?: string;
  /** Risk classification: 'safe' (default), 'moderate' (yellow warning), 'dangerous' (type-to-confirm) */
  riskLevel?: string;
  /** API configuration from skill JSON (base_url, auth_header, auth_prefix, vault_service, api_model, headers, auth_in_query) */
  apiConfig?: { base_url?: string; auth_header?: string; auth_prefix?: string; vault_service?: string; api_model?: string; headers?: Record<string, string>; auth_in_query?: string };
  /** Required permissions declared by skill */
  permissions?: string[];
  /** Semantic version from skill definition */
  version?: string;
  /** SHA-256 checksum from DB (validated against manifest) */
  checksum?: string;
  /** Repo path from manifest (e.g. 'Official/research/dns_lookup.json') */
  repoPath?: string;
  /** Runtime for handler files: 'typescript', 'python', 'bash', or null (declarative-only) */
  handlerRuntime?: 'typescript' | 'python' | 'bash' | null;
  /** List of files in skill package directory (for gateway installation) */
  files?: string[];
  /** Output type from skill JSON: 'text', 'image', 'code', etc. */
  outputType?: string;
  /** Whether results should be saved as downloadable artifacts */
  collateral?: boolean;
  /** OAuth config from skill JSON (provider, auth_url, token_url, scopes, pkce) */
  oauthConfig?: {
    provider: string;
    auth_url: string;
    token_url: string;
    scopes: string[];
    pkce?: boolean;
  };
  /** Skill settings schema from skill JSON (key → {type, default, description}) */
  settings?: Record<string, { type: string; default: unknown; description: string; options?: string[] }>;
}

export interface PendingUpgrade {
  skillId: string;
  skillName: string;
  currentVersion: string;
  newVersion: string;
  checksumValid: boolean;
  definition: Record<string, unknown>;
  category: string;
  checksum?: string;
}

export interface SeedResult {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
  checksumMismatches: Array<{ id: string; expected: string; actual: string }>;
  pendingUpgrades: PendingUpgrade[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute SHA-256 hash of a string using Web Crypto API. */
async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Compare semver strings: returns true if a > b. */
function semverGt(a: string, b: string): boolean {
  const [a1, a2, a3] = a.split('.').map(Number);
  const [b1, b2, b3] = b.split('.').map(Number);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

/** Get icon name string from a hardcoded skill definition. */
/** Extract commands array from a DB definition JSONB blob. */
function extractCommands(definition: Record<string, unknown> | null): SkillCommand[] | undefined {
  if (!definition) return undefined;
  const raw = definition.commands;
  if (!Array.isArray(raw)) return undefined;
  return raw.map((cmd: Record<string, unknown>) => ({
    name: String(cmd.name ?? ''),
    description: String(cmd.description ?? ''),
    parameters: Array.isArray(cmd.parameters)
      ? (cmd.parameters as Record<string, unknown>[]).map(p => ({
          name: String(p.name ?? ''),
          type: String(p.type ?? 'string'),
          required: !!p.required,
          description: String(p.description ?? ''),
          ...(p.default !== undefined ? { default: p.default } : {}),
        }))
      : [],
    ...(cmd.system_prompt ? { system_prompt: String(cmd.system_prompt) } : {}),
    ...(cmd.prompt_template ? { prompt_template: String(cmd.prompt_template) } : {}),
    ...(cmd.returns ? { returns: cmd.returns as { type: string; description: string } } : {}),
    ...(cmd.request ? { request: cmd.request as RequestConfig } : {}),
    ...(cmd.response ? { response: cmd.response as ResponseConfig } : {}),
    ...(cmd.output_template ? { output_template: String(cmd.output_template) } : {}),
    ...(cmd.post_processors ? { post_processors: cmd.post_processors as PostProcessorDef[] } : {}),
    ...(cmd.multi_request ? { multi_request: cmd.multi_request as MultiRequestConfig } : {}),
    ...(cmd.cli_command_template ? { cli_command_template: cmd.cli_command_template as CLICommandTemplate } : {}),
    ...(cmd.handler_file ? { handler_file: String(cmd.handler_file) } : {}),
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve all skills by merging hardcoded definitions with DB state.
 * DB definition (from GitHub repo) wins for commands, defaults.
 * DB enabled/model (user state) always preserved.
 */
export async function resolveSkills(): Promise<FullSkillDefinition[]> {
  const dbRows = await loadSkills();
  const results: FullSkillDefinition[] = [];

  for (const db of dbRows) {
    const definition = db.definition;
    results.push({
      id: db.id,
      name: (definition?.title as string) ?? db.id,
      description: (definition?.description as string) ?? '',
      category: db.category ?? 'analysis',
      icon: (definition?.icon as string) ?? 'Blocks',
      serviceType: (definition?.connection_type as string) ?? 'llm',
      fixedService: (definition?.fixed_service as string) ?? undefined,
      defaultModel: (definition?.default_model as string) ?? undefined,
      status: db.status,
      enabled: db.enabled,
      model: db.model,
      source: db.source,
      commands: extractCommands(definition as Record<string, unknown> | null),
      connection: definition?.connection_type
        ? { type: definition.connection_type }
        : undefined,
      prerequisites: Array.isArray(definition?.prerequisites)
        ? (definition.prerequisites as string[])
        : undefined,
      executionHandler: (definition?.execution_handler as string) ?? undefined,
      riskLevel: (definition?.risk_level as string) ?? (definition?.connection_type === 'cli' ? 'moderate' : 'safe'),
      apiConfig: definition?.api_config ? (definition.api_config as FullSkillDefinition['apiConfig']) : undefined,
      permissions: Array.isArray(definition?.permissions) ? (definition.permissions as string[]) : undefined,
      version: db.version ?? (definition?.version as string) ?? undefined,
      checksum: db.checksum ?? undefined,
      repoPath: (definition?._repo_path as string) ?? undefined,
      handlerRuntime: (definition?.handler_runtime as FullSkillDefinition['handlerRuntime']) ?? null,
      files: Array.isArray(definition?.files) ? (definition.files as string[]) : undefined,
      outputType: (definition?.output_type as string) ?? undefined,
      collateral: (definition?.collateral as boolean) ?? false,
      oauthConfig: definition?.oauth_config
        ? (definition.oauth_config as FullSkillDefinition['oauthConfig'])
        : undefined,
      settings: definition?.settings
        ? (definition.settings as FullSkillDefinition['settings'])
        : undefined,
    });
  }

  return results;
}

/**
 * Resolve a single skill by ID.
 */
export async function resolveSkill(skillId: string): Promise<FullSkillDefinition | null> {
  const all = await resolveSkills();
  return all.find(s => s.id === skillId) ?? null;
}

/**
 * Sync skills from the GitHub repo into the DB.
 *
 * Fetches manifest.json from GGCryptoh/jarvis_inc_skills, then loads
 * each skill JSON and upserts into the skills table. Preserves user
 * state (enabled, model) while updating definitions and defaults.
 *
 * Returns a SeedResult with counts.
 */
export async function seedSkillsFromRepo(): Promise<SeedResult> {
  const result: SeedResult = {
    total: 0, created: 0, updated: 0, unchanged: 0, errors: 0,
    checksumMismatches: [], pendingUpgrades: [],
  };

  try {
    // Fetch manifest from GitHub (bypass browser cache — raw.githubusercontent.com sets aggressive cache headers)
    const manifestRes = await fetch(rawUrl('manifest.json'), { cache: 'no-store' });
    if (!manifestRes.ok) {
      console.warn(`[SkillResolver] Failed to fetch manifest: ${manifestRes.status}`);
      return result;
    }
    const manifest = await manifestRes.json();

    // Parse skill entries — supports mixed format:
    // type: "file" → single JSON file (legacy)
    // type: "directory" → directory package with skill.json + handler files
    interface ManifestEntry {
      path: string;
      checksum?: string;
      type?: 'file' | 'directory';
      manifest_file?: string;
      files?: string[];
    }
    const skillEntries: ManifestEntry[] = [];
    if (Array.isArray(manifest.skills)) {
      for (const entry of manifest.skills) {
        if (typeof entry.path === 'string') {
          skillEntries.push({
            path: entry.path,
            checksum: entry.checksum,
            type: entry.type ?? 'file',
            manifest_file: entry.manifest_file,
            files: Array.isArray(entry.files) ? entry.files : undefined,
          });
        }
      }
    }

    result.total = skillEntries.length;
    const seededIds = new Set<string>();

    // Load existing DB skills for version comparison
    const existingRows = await loadSkills();
    const existingMap = new Map<string, SkillRow>();
    for (const row of existingRows) {
      existingMap.set(row.id, row);
    }

    // Phase 1: Fetch all skills, validate checksums, detect upgrades
    for (const entry of skillEntries) {
      try {
        // Determine skill.json URL based on manifest entry type
        const skillJsonUrl = entry.type === 'directory'
          ? rawUrl(`${entry.path}/${entry.manifest_file ?? 'skill.json'}`)
          : rawUrl(entry.path);

        const skillRes = await fetch(skillJsonUrl, { cache: 'no-store' });
        if (!skillRes.ok) {
          result.errors++;
          continue;
        }
        const rawText = await skillRes.text();
        const skillDef = JSON.parse(rawText);
        // Inject repo path for UI badges (Official vs Marketplace etc.)
        skillDef._repo_path = entry.path;
        const id = skillDef.id as string;
        if (!id) {
          result.errors++;
          continue;
        }

        seededIds.add(id);

        // Validate checksum
        let checksumValid = true;
        let computedChecksum: string | undefined;
        if (entry.checksum) {
          computedChecksum = await sha256(rawText);
          if (computedChecksum !== entry.checksum) {
            checksumValid = false;
            result.checksumMismatches.push({
              id,
              expected: entry.checksum,
              actual: computedChecksum,
            });
          }
        }

        const category = (skillDef.category as string) ?? 'analysis';
        const existing = existingMap.get(id);

        // Phase 2: Auto-apply new skills; detect upgrades for existing ones
        if (!existing) {
          // New skill — auto-apply
          await upsertSkillDefinition(id, skillDef, category, 'github', entry.checksum);
          result.created++;
          // Install directory-format skill files to gateway
          if (entry.type === 'directory' && entry.files?.length) {
            installDirectorySkill(id, entry.path, entry.files).catch(() => {});
          }
        } else {
          // Existing skill — check for version bump
          const currentVersion = existing.version ?? null;
          const newVersion = (skillDef.version as string) ?? null;

          if (currentVersion && newVersion && currentVersion === newVersion
              && (existing.checksum ?? null) === (entry.checksum ?? null)) {
            // Same version AND same checksum — skip
            result.unchanged++;
          } else if (currentVersion && newVersion && semverGt(newVersion, currentVersion)) {
            // Version upgrade detected — queue for user approval
            result.pendingUpgrades.push({
              skillId: id,
              skillName: (skillDef.title as string) ?? id,
              currentVersion,
              newVersion,
              checksumValid,
              definition: skillDef,
              category,
              checksum: entry.checksum,
            });
            result.unchanged++;
          } else if (currentVersion && newVersion && semverGt(currentVersion, newVersion)) {
            // DB version is NEWER than this manifest entry — skip (don't downgrade)
            // This happens when legacy file-format and new directory-format entries
            // co-exist in the manifest for the same skill ID.
            result.unchanged++;
          } else {
            // No tracked version, version mismatch, or first sync with versioning — auto-apply
            const action = await upsertSkillDefinition(id, skillDef, category, 'github', entry.checksum);
            if (action === 'created') result.created++;
            else if (action === 'updated') result.updated++;
            else result.unchanged++;
            // Re-install directory-format skill files on update
            if ((action === 'created' || action === 'updated') && entry.type === 'directory' && entry.files?.length) {
              installDirectorySkill(id, entry.path, entry.files).catch(() => {});
            }
          }
        }
      } catch (err) {
        console.error('[SkillResolver] Error processing skill:', err);
        result.errors++;
      }
    }

    // Prune stale DB entries that are no longer in the manifest (github + legacy seed)
    if (seededIds.size > 0) {
      try {
        const allDbSkills = await loadSkills();
        for (const row of allDbSkills) {
          if ((row.source === 'github' || row.source === 'seed') && !seededIds.has(row.id)) {
            await getSupabase().from('skills').delete().eq('id', row.id);
          }
        }
      } catch { /* cleanup is best-effort */ }
    }

    // Fire event so UI can refresh
    if (result.created > 0 || result.updated > 0) {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('skills-changed'));
    }

    return result;
  } catch (err) {
    console.warn('[SkillResolver] seedSkillsFromRepo failed:', err);
    return result;
  }
}

/**
 * Apply selected skill upgrades. Called by the UI after user picks which to upgrade.
 */
export async function applySkillUpgrades(upgrades: PendingUpgrade[]): Promise<void> {
  for (const upgrade of upgrades) {
    await upsertSkillDefinition(
      upgrade.skillId,
      upgrade.definition,
      upgrade.category,
      'github',
      upgrade.checksum,
    );
  }
  if (upgrades.length > 0) {
    window.dispatchEvent(new Event('skills-changed'));
  }
}

/**
 * Clean sync: wipe all skills from DB, then re-seed from GitHub repo.
 * Use this when you want to start fresh with only repo-backed skills.
 */
export async function cleanSeedSkillsFromRepo(): Promise<SeedResult> {
  await clearAllSkills();
  return seedSkillsFromRepo();
}

/**
 * Register a personal skill from a gateway handler.
 * If requiresApproval is true, creates a skill_enable approval instead
 * of directly registering.
 */
export async function registerPersonalSkill(opts: {
  id: string;
  name: string;
  description: string;
  category: string;
  handlerName: string;
  requiresApproval?: boolean;
}): Promise<void> {
  const sb = getSupabase();

  if (opts.requiresApproval) {
    await sb.from('approvals').insert({
      id: `approval-skill-${opts.id}`,
      type: 'skill_enable',
      title: `New personal skill: ${opts.name}`,
      description: opts.description,
      status: 'pending',
      metadata: {
        skillId: opts.id,
        source: 'personal',
        handler: `gateway:${opts.handlerName}`,
      },
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('approvals-changed'));
    }
    return;
  }

  await upsertSkillDefinition(opts.id, {
    title: opts.name,
    description: opts.description,
    execution_handler: `gateway:${opts.handlerName}`,
    connection_type: 'gateway',
    category: opts.category,
  }, opts.category, 'personal');

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('skills-changed'));
  }
}

// ---------------------------------------------------------------------------
// Skill Schema Cache — for CEO Skill Factory prompt injection
// ---------------------------------------------------------------------------

const SCHEMA_CACHE_KEY = 'skills_schema_cache';
const SCHEMA_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface SkillSchemaCache {
  schema: string;
  readme: string;
  fetched_at: string;
}

/**
 * Returns the cached skill schema + README from the GitHub repo.
 * Fetches fresh if cache is missing or >24h stale.
 */
export async function getSkillSchemaCache(): Promise<SkillSchemaCache | null> {
  try {
    const cached = await getSetting(SCHEMA_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as SkillSchemaCache;
      const age = Date.now() - new Date(parsed.fetched_at).getTime();
      if (age < SCHEMA_CACHE_TTL_MS) return parsed;
    }
  } catch { /* cache miss or parse error — refetch */ }

  // Fetch fresh from GitHub
  try {
    const [schemaResp, readmeResp] = await Promise.all([
      fetch(rawUrl('schema/skill.schema.json')),
      fetch(rawUrl('README.md')),
    ]);
    if (!schemaResp.ok || !readmeResp.ok) return null;

    const result: SkillSchemaCache = {
      schema: await schemaResp.text(),
      readme: await readmeResp.text(),
      fetched_at: new Date().toISOString(),
    };

    // Persist to settings table
    await setSetting(SCHEMA_CACHE_KEY, JSON.stringify(result));
    return result;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Directory Skill Installation (fetches files from GitHub → installs to gateway)
// ---------------------------------------------------------------------------

/**
 * Fetch all files for a directory-format skill from GitHub and install to gateway.
 * Called during seed/sync when a directory-type manifest entry is processed.
 */
async function installDirectorySkill(
  skillId: string,
  repoDir: string,
  files: string[],
): Promise<void> {
  const fileContents: { path: string; content: string }[] = [];
  for (const filePath of files) {
    try {
      const resp = await fetch(rawUrl(`${repoDir}/${filePath}`));
      if (resp.ok) {
        fileContents.push({ path: filePath, content: await resp.text() });
      }
    } catch {
      console.warn(`[SkillResolver] Failed to fetch ${repoDir}/${filePath}`);
    }
  }
  if (fileContents.length > 0) {
    const installed = await installSkillToGateway(skillId, fileContents);
    if (installed) {
      console.log(`[SkillResolver] Installed ${skillId} to gateway (${fileContents.length} files)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Gateway Skill Installation
// ---------------------------------------------------------------------------

/** Get gateway URL from Vite env. Returns null in SSR / non-browser contexts. */
function getGatewayUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return (import.meta as any).env?.VITE_GATEWAY_URL || 'http://localhost:3001';
}

/**
 * Install a skill package (directory of files) to the gateway workspace.
 * The gateway writes files to /workspace/skills/{skillId}/.
 * Returns true if successful, false otherwise.
 */
export async function installSkillToGateway(
  skillId: string,
  files: { path: string; content: string }[],
): Promise<boolean> {
  const gw = getGatewayUrl();
  if (!gw || !files.length) return false;
  try {
    const resp = await fetch(`${gw}/install-skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId, files }),
    });
    if (!resp.ok) {
      console.warn(`[SkillResolver] installSkillToGateway failed for ${skillId}:`, await resp.text());
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[SkillResolver] Gateway unreachable for skill install:`, err);
    return false;
  }
}

/** Repo info for display in the UI. */
export const SKILLS_REPO_INFO = {
  owner: SKILLS_REPO_OWNER,
  name: SKILLS_REPO_NAME,
  branch: SKILLS_REPO_BRANCH,
  url: `https://github.com/${SKILLS_REPO_OWNER}/${SKILLS_REPO_NAME}`,
};
