/**
 * Skill Resolver — Merges hardcoded definitions, seed repo JSON, and DB state
 * =============================================================================
 * Three-layer merge:
 *   1. Hardcoded (skillDefinitions.ts) — UI metadata: icons, descriptions, categories
 *   2. Seed repo JSON — execution metadata: commands, params, connection types
 *   3. DB skills table — runtime state: enabled, model, full definition JSONB
 *
 * The resolver produces FullSkillDefinition objects used by the skill executor
 * and test dialog.
 */

import { loadSkills, type SkillRow, seedSkill } from './database';
import { skills as hardcodedSkills, type SkillDefinition } from '../data/skillDefinitions';

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
  // From seed repo JSON / DB definition:
  commands?: SkillCommand[];
  connection?: Record<string, unknown>;
  prerequisites?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get icon name string from a hardcoded skill definition. */
function getIconName(skill: SkillDefinition): string {
  // Lucide icons are functions with a displayName property
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
 * DB wins for enabled/model/definition fields.
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

    results.push({
      id: hc.id,
      name: hc.name,
      description: hc.description,
      category: hc.category,
      icon: getIconName(hc),
      serviceType: hc.serviceType,
      fixedService: hc.fixedService,
      defaultModel: hc.defaultModel,
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
    });

    // Remove from map so we can detect DB-only skills
    dbMap.delete(hc.id);
  }

  // Include any DB-only skills (from seed/marketplace) that aren't hardcoded
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
 * Seed skills from the repo manifest into the DB.
 * Fetches /seed_skills_repo/real-manifest.json from the public directory,
 * then loads each skill JSON and upserts into the skills table.
 *
 * Returns the number of skills seeded.
 * If the manifest is not reachable (e.g., not served as a public asset), returns 0.
 */
export async function seedSkillsFromRepo(): Promise<number> {
  try {
    const manifestRes = await fetch('/seed_skills_repo/real-manifest.json');
    if (!manifestRes.ok) return 0;
    const manifest = await manifestRes.json();

    const skillEntries: Array<{ path: string; category: string }> = [];
    const categories = manifest.categories as Record<string, { skills: Array<{ path: string }> }> | undefined;
    if (categories) {
      for (const [cat, catData] of Object.entries(categories)) {
        if (Array.isArray(catData.skills)) {
          for (const entry of catData.skills) {
            skillEntries.push({ path: entry.path, category: cat });
          }
        }
      }
    }

    let seeded = 0;
    for (const entry of skillEntries) {
      try {
        const skillRes = await fetch(`/seed_skills_repo/${entry.path}`);
        if (!skillRes.ok) continue;
        const skillDef = await skillRes.json();
        const id = skillDef.id as string;
        if (!id) continue;
        await seedSkill(id, skillDef, entry.category);
        seeded++;
      } catch {
        // Skip individual skill errors
      }
    }

    return seeded;
  } catch {
    return 0;
  }
}
