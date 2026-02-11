import { skills } from '../data/skillDefinitions';

/** Maps keyword patterns (regex alternation) to skill IDs. */
const KEYWORD_MAP: [RegExp, string[]][] = [
  // Images & Design
  [/logo|image|design|visual|graphic|art|photo|illustration|banner|brand/i, ['create-images', 'research-web']],
  // Email
  [/email|mail|inbox|outreach|newsletter/i, ['read-email', 'write-email']],
  // Social / Twitter
  [/tweet|twitter|x\.com|social\s*media/i, ['read-tweets', 'research-web']],
  // Reddit / Forums
  [/reddit|forum|community|subreddit/i, ['research-reddit', 'research-web']],
  // Writing
  [/write|document|report|content|blog|memo|article|copy|proposal/i, ['write-document', 'research-web']],
  // Code / Dev
  [/code|develop|program|software|app|build|website|api|automat/i, ['generate-code', 'research-web']],
  // Data / Analytics
  [/data|analytics|metric|dashboard|chart|insight/i, ['research-web']],
  // General Research (broad — keep last so more specific patterns match first)
  [/research|search|find|investigate|analyze|learn|explore/i, ['research-web']],
];

/** Available skill IDs (excludes coming_soon). */
const AVAILABLE_IDS = new Set(
  skills.filter(s => s.status !== 'coming_soon').map(s => s.id),
);

/**
 * Recommend skills based on free-text mission description.
 * Returns deduplicated list of skill IDs, always including at least 'research-web'.
 */
export function recommendSkills(missionText: string): string[] {
  const matched = new Set<string>();

  for (const [pattern, skillIds] of KEYWORD_MAP) {
    if (pattern.test(missionText)) {
      for (const id of skillIds) {
        if (AVAILABLE_IDS.has(id)) matched.add(id);
      }
    }
  }

  // Every mission benefits from research
  if (AVAILABLE_IDS.has('research-web')) {
    matched.add('research-web');
  }

  return Array.from(matched);
}
