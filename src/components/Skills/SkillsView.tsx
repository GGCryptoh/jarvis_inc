import { useState } from 'react';
import {
  Mail,
  Send,
  Image,
  Twitter,
  Globe,
  MessageCircle,
  FileText,
  Code,
  BarChart3,
  Calendar,
  Search,
  Rss,
} from 'lucide-react';

interface Skill {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  category: 'communication' | 'research' | 'creation' | 'analysis';
  status: 'available' | 'coming_soon';
}

const skills: Skill[] = [
  // Communication
  {
    id: 'read-email',
    name: 'Read Email',
    description: 'Read and parse incoming emails from connected accounts',
    icon: Mail,
    category: 'communication',
    status: 'available',
  },
  {
    id: 'write-email',
    name: 'Write Email',
    description: 'Compose and send emails on behalf of agents',
    icon: Send,
    category: 'communication',
    status: 'available',
  },
  {
    id: 'send-slack',
    name: 'Send Slack Message',
    description: 'Post messages and updates to Slack channels',
    icon: MessageCircle,
    category: 'communication',
    status: 'coming_soon',
  },
  {
    id: 'schedule-meeting',
    name: 'Schedule Meeting',
    description: 'Create and manage calendar events and invites',
    icon: Calendar,
    category: 'communication',
    status: 'coming_soon',
  },

  // Research
  {
    id: 'research-web',
    name: 'Research Web',
    description: 'Search and analyze web pages for information gathering',
    icon: Globe,
    category: 'research',
    status: 'available',
  },
  {
    id: 'read-tweets',
    name: 'Read X / Tweets',
    description: 'Monitor and analyze posts from X (Twitter) feeds',
    icon: Twitter,
    category: 'research',
    status: 'available',
  },
  {
    id: 'research-reddit',
    name: 'Research Reddit',
    description: 'Search subreddits and threads for insights and trends',
    icon: Rss,
    category: 'research',
    status: 'available',
  },
  {
    id: 'deep-search',
    name: 'Deep Search',
    description: 'Multi-source deep research across web, papers, and forums',
    icon: Search,
    category: 'research',
    status: 'coming_soon',
  },

  // Creation
  {
    id: 'create-images',
    name: 'Create Images',
    description: 'Generate images using AI image models (DALL-E, Midjourney)',
    icon: Image,
    category: 'creation',
    status: 'available',
  },
  {
    id: 'write-document',
    name: 'Write Document',
    description: 'Draft reports, memos, proposals, and other documents',
    icon: FileText,
    category: 'creation',
    status: 'available',
  },
  {
    id: 'generate-code',
    name: 'Generate Code',
    description: 'Write, review, and debug code in multiple languages',
    icon: Code,
    category: 'creation',
    status: 'available',
  },

  // Analysis
  {
    id: 'analyze-data',
    name: 'Analyze Data',
    description: 'Process datasets, generate charts, and extract insights',
    icon: BarChart3,
    category: 'analysis',
    status: 'coming_soon',
  },
];

const categoryLabels: Record<string, string> = {
  communication: 'COMMUNICATION',
  research: 'RESEARCH',
  creation: 'CREATION',
  analysis: 'ANALYSIS',
};

const categoryColors: Record<string, string> = {
  communication: '#8be9fd',
  research: '#50fa7b',
  creation: '#ff79c6',
  analysis: '#ffb86c',
};

export default function SkillsView() {
  const [enabledSkills, setEnabledSkills] = useState<Set<string>>(new Set());

  const toggleSkill = (id: string) => {
    setEnabledSkills(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const categories = ['communication', 'research', 'creation', 'analysis'] as const;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto no-scrollbar p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-pixel text-[14px] tracking-wider text-emerald-400 mb-2">
          AGENT SKILLS
        </h1>
        <p className="font-pixel text-[8px] tracking-wider text-zinc-500 leading-relaxed">
          CONFIGURE CAPABILITIES FOR YOUR AGENTS. SKILLS WILL BE SOURCED FROM A GITHUB REPOSITORY IN THE FUTURE.
        </p>
      </div>

      {/* Skill categories */}
      {categories.map(cat => {
        const catSkills = skills.filter(s => s.category === cat);
        const color = categoryColors[cat];
        return (
          <div key={cat} className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <h2
                className="font-pixel text-[10px] tracking-widest"
                style={{ color }}
              >
                {categoryLabels[cat]}
              </h2>
              <div className="flex-1 h-px bg-zinc-800" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {catSkills.map(skill => {
                const Icon = skill.icon;
                const isEnabled = enabledSkills.has(skill.id);
                const isComingSoon = skill.status === 'coming_soon';

                return (
                  <div
                    key={skill.id}
                    className={[
                      'relative rounded-lg border p-4 transition-all duration-200 cursor-pointer group',
                      isComingSoon
                        ? 'border-zinc-800 bg-zinc-900/30 opacity-60'
                        : isEnabled
                          ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
                          : 'border-zinc-700/50 bg-jarvis-surface hover:border-zinc-600',
                    ].join(' ')}
                    onClick={() => !isComingSoon && toggleSkill(skill.id)}
                  >
                    {/* Icon + Title row */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={[
                            'w-8 h-8 rounded-md flex items-center justify-center',
                            isEnabled
                              ? 'bg-emerald-500/20'
                              : 'bg-zinc-800',
                          ].join(' ')}
                        >
                          <Icon
                            size={16}
                            className={isEnabled ? 'text-emerald-400' : 'text-zinc-400'}
                          />
                        </div>
                        <div>
                          <div className="font-pixel text-[9px] tracking-wider text-zinc-200">
                            {skill.name}
                          </div>
                        </div>
                      </div>

                      {/* Toggle / Badge */}
                      {isComingSoon ? (
                        <span className="font-pixel text-[6px] tracking-widest text-zinc-600 border border-zinc-700/50 rounded px-2 py-0.5 bg-zinc-800/30">
                          SOON
                        </span>
                      ) : (
                        <div
                          className={[
                            'w-8 h-4 rounded-full transition-colors duration-200 flex items-center px-0.5',
                            isEnabled ? 'bg-emerald-500' : 'bg-zinc-700',
                          ].join(' ')}
                        >
                          <div
                            className={[
                              'w-3 h-3 rounded-full bg-white transition-transform duration-200',
                              isEnabled ? 'translate-x-3.5' : 'translate-x-0',
                            ].join(' ')}
                          />
                        </div>
                      )}
                    </div>

                    {/* Description */}
                    <p className="font-pixel text-[7px] tracking-wider text-zinc-500 leading-relaxed">
                      {skill.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Footer note */}
      <div className="mt-auto pt-6 border-t border-zinc-800">
        <p className="font-pixel text-[7px] tracking-wider text-zinc-600 leading-relaxed">
          SKILLS WILL LOAD FROM YOUR CONFIGURED GITHUB REPOSITORY IN A FUTURE UPDATE.
          <br />
          FOR NOW, TOGGLE SKILLS TO INDICATE WHICH CAPABILITIES YOUR AGENTS SHOULD HAVE.
        </p>
      </div>
    </div>
  );
}
