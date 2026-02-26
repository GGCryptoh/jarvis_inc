import { Blocks, ExternalLink } from 'lucide-react';
import { fetchAllSkills } from '@/lib/github';

export const dynamic = 'force-dynamic';

const RISK_COLORS: Record<string, string> = {
  safe: 'text-pixel-green border-pixel-green/20 bg-pixel-green/5',
  moderate: 'text-pixel-orange border-pixel-orange/20 bg-pixel-orange/5',
  dangerous: 'text-pixel-red border-pixel-red/20 bg-pixel-red/5',
};

const RISK_LABELS: Record<string, string> = {
  safe: 'SAFE',
  moderate: 'CAUTION',
  dangerous: 'RISKY',
};

const CATEGORY_COLORS: Record<string, string> = {
  research: 'text-pixel-cyan',
  communication: 'text-pixel-pink',
  creation: 'text-pixel-purple',
  analysis: 'text-pixel-orange',
};

export default async function SkillsPage() {
  let skills: any[] = [];
  let loadError = false;

  try {
    skills = await fetchAllSkills();
  } catch {
    loadError = true;
  }

  // Group by category
  const grouped: Record<string, any[]> = {};
  for (const skill of skills) {
    const cat = skill.category || skill._type || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(skill);
  }

  const categories = Object.keys(grouped).sort();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-pixel text-sm sm:text-base text-pixel-cyan glow-cyan">
          SKILL CATALOG
        </h1>
        <p className="font-mono text-xs text-jarvis-muted mt-2">
          Canonical skills from the{' '}
          <a
            href="https://github.com/GGCryptoh/jarvis_inc_skills"
            target="_blank"
            rel="noopener noreferrer"
            className="text-pixel-green hover:underline inline-flex items-center gap-1"
          >
            skills repository
            <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </div>

      {loadError || skills.length === 0 ? (
        <div className="text-center py-20">
          <Blocks className="w-10 h-10 text-jarvis-muted mx-auto mb-4" />
          <p className="font-pixel text-xs text-jarvis-muted">
            {loadError
              ? 'FAILED TO LOAD SKILLS'
              : 'SKILL CATALOG'}
          </p>
          <p className="font-mono text-xs text-jarvis-muted mt-3">
            {loadError
              ? 'Could not fetch from GitHub. Try again later.'
              : 'Loading from GitHub...'}
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {categories.map((category) => (
            <section key={category}>
              <h2
                className={`font-pixel text-sm uppercase tracking-wider mb-5 ${
                  CATEGORY_COLORS[category] || 'text-jarvis-text'
                }`}
              >
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {grouped[category].map((skill: any) => (
                  <div key={skill.id || skill.name} className="retro-card p-3.5">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <h3 className="font-pixel text-[10px] text-pixel-green leading-snug">
                        {skill.title || skill.name || skill.id}
                      </h3>
                      <span
                        className={`inline-block px-1.5 py-0.5 text-[8px] font-pixel uppercase rounded border flex-shrink-0 ${
                          RISK_COLORS[skill.risk_level] || RISK_COLORS.safe
                        }`}
                      >
                        {RISK_LABELS[skill.risk_level] || 'SAFE'}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-jarvis-muted leading-relaxed line-clamp-2">
                      {skill.description}
                    </p>
                    {skill.commands && skill.commands.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-jarvis-border">
                        <div className="flex flex-wrap gap-1">
                          {skill.commands.map((cmd: any) => (
                            <span
                              key={cmd.name}
                              className="skill-pill"
                              title={cmd.description}
                            >
                              {cmd.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}

          <p className="font-mono text-[10px] text-jarvis-muted text-center pt-4 border-t border-jarvis-border">
            {skills.length} skills loaded from GitHub
          </p>
        </div>
      )}
    </div>
  );
}
