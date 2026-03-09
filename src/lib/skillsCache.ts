/**
 * Skills Cache — Synchronous in-memory lookup for skill metadata
 * ===============================================================
 * Replaces the old hardcoded skillDefinitions.ts. Populated from DB
 * on boot via refreshSkillsCache(), then available synchronously
 * for all React components that need skill name/icon/category lookups.
 */

import { resolveSkills, type FullSkillDefinition } from './skillResolver';

// ---------------------------------------------------------------------------
// Cache state
// ---------------------------------------------------------------------------

let cache: Map<string, FullSkillDefinition> = new Map();
let allSkills: FullSkillDefinition[] = [];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Refresh the cache from DB. Call on app boot and after skill sync.
 */
export async function refreshSkillsCache(): Promise<void> {
  const skills = await resolveSkills();
  const map = new Map<string, FullSkillDefinition>();
  for (const s of skills) {
    map.set(s.id, s);
  }
  cache = map;
  allSkills = skills;
}

/**
 * Get a skill by ID (synchronous). Returns undefined if not cached.
 */
export function getSkillById(id: string): FullSkillDefinition | undefined {
  return cache.get(id);
}

/**
 * Get skill name by ID. Returns the ID as fallback.
 */
export function getSkillName(id: string): string {
  return cache.get(id)?.name ?? id;
}

/**
 * Get skill icon string by ID. Returns 'Blocks' as fallback.
 */
export function getSkillIcon(id: string): string {
  return cache.get(id)?.icon ?? 'Blocks';
}

/**
 * Get all cached skills.
 */
export function getAllSkills(): FullSkillDefinition[] {
  return allSkills;
}

/**
 * Get all available (non-coming_soon) skill IDs.
 */
export function getAvailableSkillIds(): string[] {
  return allSkills
    .filter(s => s.status !== 'coming_soon')
    .map(s => s.id);
}

/**
 * Count skills by status.
 */
export function countSkills(): { total: number; available: number; enabled: number } {
  const available = allSkills.filter(s => s.status === 'available' || s.status === 'beta');
  return {
    total: allSkills.length,
    available: available.length,
    enabled: allSkills.filter(s => s.enabled).length,
  };
}
