import { useState, useEffect, useCallback } from 'react';
import { Archive, Search } from 'lucide-react';
import { getSupabase, hasSupabaseConfig } from '../../lib/supabase';
import { skills as skillDefinitions } from '../../data/skillDefinitions';

interface Artifact {
  id: string;
  skill_id: string;
  command_name: string;
  result: { output?: string; summary?: string };
  mission_id: string;
  mission_title?: string;
  agent_id: string;
  cost_usd: number;
  tokens_used: number;
  completed_at: string;
}

export default function CollateralView() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [skillFilter, setSkillFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'all'>('all');

  const loadArtifacts = useCallback(async () => {
    if (!hasSupabaseConfig()) return;
    let query = getSupabase()
      .from('task_executions')
      .select('id, skill_id, command_name, result, mission_id, agent_id, cost_usd, tokens_used, completed_at')
      .eq('status', 'completed')
      .not('result', 'is', null)
      .order('completed_at', { ascending: false });

    // Date filter
    if (dateRange === 'today') {
      query = query.gte('completed_at', new Date(Date.now() - 86400000).toISOString());
    } else if (dateRange === 'week') {
      query = query.gte('completed_at', new Date(Date.now() - 7 * 86400000).toISOString());
    } else if (dateRange === 'month') {
      query = query.gte('completed_at', new Date(Date.now() - 30 * 86400000).toISOString());
    }

    const { data } = await query.limit(100);
    setArtifacts((data ?? []) as Artifact[]);
  }, [dateRange]);

  useEffect(() => {
    loadArtifacts();
    window.addEventListener('task-executions-changed', loadArtifacts);
    return () => window.removeEventListener('task-executions-changed', loadArtifacts);
  }, [loadArtifacts]);

  const filtered = artifacts
    .filter(a => !skillFilter || a.skill_id === skillFilter)
    .filter(a => !searchQuery || a.result?.output?.toLowerCase().includes(searchQuery.toLowerCase())
      || a.result?.summary?.toLowerCase().includes(searchQuery.toLowerCase())
      || a.command_name?.toLowerCase().includes(searchQuery.toLowerCase()));

  const uniqueSkills = [...new Set(artifacts.map(a => a.skill_id))];

  // Detail view when artifact is selected
  if (selectedArtifact) {
    const skill = skillDefinitions.find(s => s.id === selectedArtifact.skill_id);
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
          <button onClick={() => setSelectedArtifact(null)} className="font-pixel text-[10px] text-zinc-500 hover:text-zinc-300 tracking-wider">
            &larr; BACK
          </button>
          <div className="font-pixel text-[11px] tracking-wider text-zinc-200 flex-1">
            {skill?.name ?? selectedArtifact.skill_id} &mdash; {selectedArtifact.command_name}
          </div>
          <span className="font-pixel text-[9px] text-zinc-500">
            ${selectedArtifact.cost_usd?.toFixed(4)} &middot; {selectedArtifact.tokens_used} tokens
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {selectedArtifact.result?.summary && (
            <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <div className="font-pixel text-[9px] tracking-wider text-emerald-400 mb-1">SUMMARY</div>
              <div className="font-pixel text-[10px] tracking-wider text-zinc-300 leading-relaxed">
                {selectedArtifact.result.summary}
              </div>
            </div>
          )}
          <div className="font-pixel text-[10px] tracking-wider text-zinc-300 whitespace-pre-line leading-relaxed">
            {selectedArtifact.result?.output ?? 'No output'}
          </div>
        </div>
      </div>
    );
  }

  // Grid view
  return (
    <div className="min-h-screen bg-jarvis-bg p-6">
      {/* Header + Filters */}
      <div className="mb-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-600/15 border border-emerald-500/25">
            <Archive size={24} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-jarvis-text tracking-wide">COLLATERAL</h1>
            <p className="text-sm text-jarvis-muted">Completed Skill Execution Artifacts</p>
          </div>
          <div className="ml-auto font-pixel text-[9px] text-zinc-500 tracking-wider">
            {filtered.length} ARTIFACT{filtered.length !== 1 ? 'S' : ''}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Date chips */}
          {(['today', 'week', 'month', 'all'] as const).map(d => (
            <button
              key={d}
              onClick={() => setDateRange(d)}
              className={`font-pixel text-[9px] tracking-wider px-3 py-1.5 rounded-full border transition-colors ${
                dateRange === d
                  ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
              }`}
            >
              {d === 'today' ? 'TODAY' : d === 'week' ? 'THIS WEEK' : d === 'month' ? 'THIS MONTH' : 'ALL'}
            </button>
          ))}

          {/* Skill filter */}
          <select
            value={skillFilter}
            onChange={e => setSkillFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 font-pixel text-[9px] text-zinc-400 tracking-wider"
          >
            <option value="">ALL SKILLS</option>
            {uniqueSkills.map(id => (
              <option key={id} value={id}>{skillDefinitions.find(s => s.id === id)?.name ?? id}</option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search outputs..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 font-pixel text-[9px] text-zinc-300 placeholder-zinc-600 tracking-wider focus:outline-none focus:border-emerald-500/40"
            />
          </div>
        </div>
      </div>

      {/* Card Grid */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Archive size={32} className="mx-auto text-zinc-700 mb-3" />
            <div className="font-pixel text-[10px] text-zinc-600 tracking-wider">NO ARTIFACTS YET</div>
            <div className="font-pixel text-[9px] text-zinc-700 tracking-wider mt-1">
              Completed skill executions will appear here
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(a => {
              const skill = skillDefinitions.find(s => s.id === a.skill_id);
              const SkillIcon = skill?.icon ?? Archive;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedArtifact(a)}
                  className="text-left rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 hover:border-emerald-500/30 hover:bg-zinc-800/40 transition-all group"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <SkillIcon size={14} className="text-emerald-400 group-hover:text-emerald-300 transition-colors" />
                    <span className="font-pixel text-[10px] tracking-wider text-zinc-200 truncate">
                      {skill?.name ?? a.skill_id}
                    </span>
                  </div>
                  {a.command_name && (
                    <div className="font-pixel text-[8px] tracking-wider text-zinc-500 mb-1.5 uppercase">
                      {a.command_name}
                    </div>
                  )}
                  <div className="font-pixel text-[9px] text-zinc-500 line-clamp-3 leading-relaxed mb-3">
                    {a.result?.summary ?? a.result?.output?.slice(0, 150) ?? ''}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800/50">
                    <span className="font-pixel text-[8px] text-zinc-600">
                      {a.completed_at ? new Date(a.completed_at).toLocaleDateString() : ''}
                    </span>
                    <span className="font-pixel text-[8px] text-zinc-600">
                      ${a.cost_usd?.toFixed(4) ?? '0.00'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
