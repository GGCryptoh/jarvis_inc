/**
 * Skill Resolver — Merges hardcoded definitions, GitHub repo JSON, and DB state
 * ==============================================================================
 * Three-layer merge:
 *   1. Hardcoded (skillDefinitions.ts) — UI metadata: icons, descriptions, categories
 *   2. GitHub repo JSON — execution metadata: commands, params, defaults, models
 *   3. DB skills table — runtime state: enabled, model, full definition JSONB
 *
 * The resolver produces FullSkillDefinition objects used by the skill executor
 * and test dialog. The GitHub repo is the source of truth for command definitions
 * and default models.
 */

import { loadSkills, type SkillRow, upsertSkillDefinition, clearAllSkills } from './database';
import { getSupabase } from './supabase';
import { skills as hardcodedSkills, type SkillDefinition } from '../data/skillDefinitions';

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

export interface SkillCommand {
  name: string;
  description: string;
  parameters: SkillParameter[];
  prompt_template?: string;
  returns?: { type: string; description: string };
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
}

export interface SeedResult {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get icon name string from a hardcoded skill definition. */
function getIconName(skill: SkillDefinition): string {
  const icon = skill.icon as unknown as { displayName?: string; name?: string };
  if (typeof icon === 'function' || typeof icon === 'object') {
    if (icon.displayName) return icon.displayName;
    if (icon.name) return icon.name;
  }
  return skill.id;
}

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
    ...(cmd.prompt_template ? { prompt_template: String(cmd.prompt_template) } : {}),
    ...(cmd.returns ? { returns: cmd.returns as { type: string; description: string } } : {}),
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
  const dbMap = new Map<string, SkillRow>();
  for (const row of dbRows) {
    dbMap.set(row.id, row);
  }

  const results: FullSkillDefinition[] = [];

  for (const hc of hardcodedSkills) {
    const db = dbMap.get(hc.id);
    const definition = db?.definition ?? null;

    // DB definition (from GitHub) overrides hardcoded defaults
    const repoDefaultModel = (definition?.default_model as string) ?? undefined;

    results.push({
      id: hc.id,
      name: (definition?.title as string) ?? hc.name,
      description: (definition?.description as string) ?? hc.description,
      category: hc.category,
      icon: getIconName(hc),
      serviceType: (definition?.connection_type as string) ?? hc.serviceType,
      fixedService: (definition?.fixed_service as string) ?? hc.fixedService,
      defaultModel: repoDefaultModel ?? hc.defaultModel,
      status: db?.status ?? hc.status,
      enabled: db ? db.enabled : false,
      model: db?.model ?? null,
      source: db?.source ?? 'hardcoded',
      commands: extractCommands(definition),
      connection: definition?.connection_type
        ? { type: definition.connection_type }
        : undefined,
      prerequisites: Array.isArray(definition?.prerequisites)
        ? (definition.prerequisites as string[])
        : undefined,
      executionHandler: (definition?.execution_handler as string) ?? undefined,
    });

    dbMap.delete(hc.id);
  }

  // Include any DB-only skills (from repo/marketplace) that aren't hardcoded
  for (const [, db] of dbMap) {
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
  const result: SeedResult = { total: 0, created: 0, updated: 0, unchanged: 0, errors: 0 };

  try {
    // Fetch manifest from GitHub
    const manifestRes = await fetch(rawUrl('manifest.json'));
    if (!manifestRes.ok) {
      console.warn(`[SkillResolver] Failed to fetch manifest: ${manifestRes.status}`);
      return result;
    }
    const manifest = await manifestRes.json();

    // Parse skill entries — supports flat format: { skills: [{ path }] }
    const skillPaths: string[] = [];
    if (Array.isArray(manifest.skills)) {
      for (const entry of manifest.skills) {
        if (typeof entry.path === 'string') {
          skillPaths.push(entry.path);
        }
      }
    }

    result.total = skillPaths.length;
    const seededIds = new Set<string>();

    // Fetch and upsert each skill
    for (const path of skillPaths) {
      try {
        const skillRes = await fetch(rawUrl(path));
        if (!skillRes.ok) {
          result.errors++;
          continue;
        }
        const skillDef = await skillRes.json();
        const id = skillDef.id as string;
        if (!id) {
          result.errors++;
          continue;
        }

        seededIds.add(id);
        const category = (skillDef.category as string) ?? 'analysis';
        const action = await upsertSkillDefinition(id, skillDef, category, 'github');
        if (action === 'created') result.created++;
        else if (action === 'updated') result.updated++;
        else result.unchanged++;
      } catch {
        result.errors++;
      }
    }

    // Prune stale github-sourced DB entries that are no longer in the manifest or hardcoded list
    if (seededIds.size > 0) {
      try {
        const hardcodedIds = new Set(hardcodedSkills.map(s => s.id));
        const allDbSkills = await loadSkills();
        for (const row of allDbSkills) {
          if (row.source === 'github' && !seededIds.has(row.id) && !hardcodedIds.has(row.id)) {
            await getSupabase().from('skills').delete().eq('id', row.id);
          }
        }
      } catch { /* cleanup is best-effort */ }
    }

    // Fire event so UI can refresh
    if (result.created > 0 || result.updated > 0) {
      window.dispatchEvent(new Event('skills-changed'));
    }

    return result;
  } catch (err) {
    console.warn('[SkillResolver] seedSkillsFromRepo failed:', err);
    return result;
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

/** Repo info for display in the UI. */
export const SKILLS_REPO_INFO = {
  owner: SKILLS_REPO_OWNER,
  name: SKILLS_REPO_NAME,
  branch: SKILLS_REPO_BRANCH,
  url: `https://github.com/${SKILLS_REPO_OWNER}/${SKILLS_REPO_NAME}`,
};
