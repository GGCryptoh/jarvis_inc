const SKILLS_REPO = 'GGCryptoh/jarvis_inc_skills';
const SKILLS_BRANCH = 'main';

/**
 * Fetch the skill manifest from GitHub
 */
export async function fetchSkillManifest() {
  const url = `https://raw.githubusercontent.com/${SKILLS_REPO}/${SKILLS_BRANCH}/manifest.json`;
  const res = await fetch(url, { next: { revalidate: 300 } }); // cache 5 min
  if (!res.ok) return null;
  return res.json();
}

/**
 * Fetch a single skill definition JSON from GitHub
 */
export async function fetchSkillJson(path: string) {
  // path like "Official/research/research_web.json" or "Official/research/dns-lookup"
  const jsonPath = path.endsWith('.json') ? path : `${path}/skill.json`;
  const url = `https://raw.githubusercontent.com/${SKILLS_REPO}/${SKILLS_BRANCH}/${jsonPath}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Fetch all skills with their definitions
 */
export async function fetchAllSkills() {
  const manifest = await fetchSkillManifest();
  if (!manifest?.skills) return [];

  const skills = await Promise.allSettled(
    manifest.skills.map(async (entry: { path: string; type: string }) => {
      const skill = await fetchSkillJson(entry.path);
      if (!skill) return null;
      return {
        ...skill,
        _path: entry.path,
        _type: entry.type,
      };
    })
  );

  return skills
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value)
    .map((r) => r.value);
}

/**
 * Fetch the README from the skills repo
 */
export async function fetchRepoReadme() {
  const url = `https://raw.githubusercontent.com/${SKILLS_REPO}/${SKILLS_BRANCH}/README.md`;
  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) return null;
  return res.text();
}
