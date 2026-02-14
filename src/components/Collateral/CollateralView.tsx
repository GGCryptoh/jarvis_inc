import { useState, useEffect, useCallback } from 'react';
import { Archive, Search, Layers, FileDown, BookOpen } from 'lucide-react';
import { getSupabase, hasSupabaseConfig } from '../../lib/supabase';
import { skills as skillDefinitions } from '../../data/skillDefinitions';
import RichResultCard, { detectRichContent } from '../Chat/RichResultCard';

function SimpleMarkdown({ text }: { text: string }) {
  // Convert markdown tables to HTML tables
  const lines = text.split('\n');
  const processed: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Detect table: line with pipes + next line is separator (|---|---|)
    if (line.includes('|') && i + 1 < lines.length && /^\|[\s-:|]+\|$/.test(lines[i + 1].trim())) {
      const headerCells = line.split('|').filter(c => c.trim()).map(c => c.trim());
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].split('|').filter(c => c.trim()).map(c => c.trim()));
        i++;
      }
      const thead = headerCells.map(h => `<th class="px-2 py-1 text-left text-zinc-200 font-semibold border-b border-zinc-700">${h}</th>`).join('');
      const tbody = rows.map(r =>
        '<tr>' + r.map(c => `<td class="px-2 py-1 border-b border-zinc-800/50">${c}</td>`).join('') + '</tr>'
      ).join('');
      processed.push(`<table class="w-full text-[9px] my-2 border-collapse"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`);
      continue;
    }
    processed.push(line);
    i++;
  }

  const html = processed.join('\n')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Restore our already-built HTML tags (tables)
    .replace(/&lt;(\/?(?:table|thead|tbody|tr|th|td)[^&]*?)&gt;/g, '<$1>')
    .replace(/^---+$/gm, '<hr class="border-zinc-700 my-3" />')
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-bold text-zinc-200 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-zinc-100 mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold text-white mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-zinc-200 font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-zinc-800 text-emerald-400 px-1 py-0.5 rounded text-[9px]">$1</code>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" class="text-emerald-400 underline hover:text-emerald-300">$1</a>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');

  return (
    <div
      className="font-pixel text-[10px] tracking-wider text-zinc-300 leading-relaxed prose-invert"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Combines SimpleMarkdown with auto-detected rich content (images, links, docs) */
function RichContent({ text }: { text: string }) {
  const detected = detectRichContent(text);

  if (detected.length === 0) {
    return <SimpleMarkdown text={text} />;
  }

  // Strip detected URLs from text, render remaining as markdown + cards
  let remaining = text;
  for (const item of detected) {
    remaining = remaining.replace(item.url, '');
  }
  remaining = remaining
    .replace(/\( *\)/g, '')
    .replace(/\[ *\]/g, '')
    .replace(/  +/g, ' ')
    .trim();

  return (
    <>
      {remaining && <SimpleMarkdown text={remaining} />}
      {detected.map((item, i) => (
        <RichResultCard key={`rich-${i}`} item={item} />
      ))}
    </>
  );
}

/** Strip markdown formatting to plain text for card previews */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .replace(/^#+\s/gm, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^- /gm, '')
    .replace(/^\d+\. /gm, '')
    .trim();
}

/** Convert a kebab-case skill ID to a readable name (e.g. "weather-cli" -> "Weather Cli") */
function formatSkillId(id: string): string {
  return id
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Get display name for a skill: prefer definition name, fall back to formatted ID */
function getSkillName(skillId: string): string {
  const skill = skillDefinitions.find(s => s.id === skillId);
  return skill?.name ?? formatSkillId(skillId);
}

/** Format command_name for display: capitalize first letter, rest lowercase */
function formatCommandName(name: string): string {
  if (!name) return '';
  const lower = name.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// ---------------------------------------------------------------------------
// Document export helpers (zero dependencies)
// ---------------------------------------------------------------------------

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportAsMarkdown(artifact: Artifact) {
  const skillName = getSkillName(artifact.skill_id);
  const header = `# ${skillName} — ${formatCommandName(artifact.command_name)}\n\n`;
  const meta = `> Cost: $${artifact.cost_usd?.toFixed(4)} | Tokens: ${artifact.tokens_used} | Date: ${artifact.completed_at ? new Date(artifact.completed_at).toLocaleDateString() : 'N/A'}\n\n`;
  const summary = artifact.result?.summary ? `## Summary\n\n${artifact.result.summary}\n\n---\n\n` : '';
  const body = artifact.result?.output ?? 'No output';
  const content = header + meta + summary + body;
  downloadBlob(new Blob([content], { type: 'text/markdown' }), `${skillName}-${artifact.command_name}.md`);
}

function exportAsPDF(artifact: Artifact) {
  const skillName = getSkillName(artifact.skill_id);
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const summary = artifact.result?.summary
    ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px;margin-bottom:16px">
        <div style="font-weight:bold;color:#16a34a;margin-bottom:4px;font-size:11px;text-transform:uppercase;letter-spacing:1px">Summary</div>
        <div style="color:#333;font-size:13px">${artifact.result.summary.replace(/\n/g, '<br/>')}</div>
      </div>`
    : '';

  const output = (artifact.result?.output ?? 'No output')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---+$/gm, '<hr/>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');

  printWindow.document.write(`<!DOCTYPE html><html><head><title>${skillName}</title>
    <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#222;font-size:14px;line-height:1.6}
    h1{font-size:22px;border-bottom:2px solid #10b981;padding-bottom:8px}h2{font-size:18px;margin-top:24px}h3{font-size:15px}
    hr{border:none;border-top:1px solid #ddd;margin:16px 0}li{margin-left:20px}
    .meta{color:#666;font-size:12px;margin-bottom:20px}table{border-collapse:collapse;width:100%}
    td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f5f5f5}
    @media print{body{margin:20px}}</style></head><body>
    <h1>${skillName} — ${formatCommandName(artifact.command_name)}</h1>
    <div class="meta">Cost: $${artifact.cost_usd?.toFixed(4)} | Tokens: ${artifact.tokens_used} | Date: ${artifact.completed_at ? new Date(artifact.completed_at).toLocaleDateString() : 'N/A'}</div>
    ${summary}${output}</body></html>`);
  printWindow.document.close();
  setTimeout(() => printWindow.print(), 300);
}

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
  const [groupBy, setGroupBy] = useState<'time' | 'skill'>('time');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [lastSeen, setLastSeen] = useState(() => localStorage.getItem('jarvis_collateral_last_seen') || '');
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());

  // Mark as seen after short delay (so user sees the highlights briefly)
  useEffect(() => {
    const timer = setTimeout(() => {
      const now = new Date().toISOString();
      localStorage.setItem('jarvis_collateral_last_seen', now);
      setLastSeen(now);
      window.dispatchEvent(new Event('task-executions-changed')); // update nav badge
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const isNew = (a: Artifact) => !viewedIds.has(a.id) && lastSeen && a.completed_at && a.completed_at > lastSeen;

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

  // Build grouped data when in skill mode
  const groupedBySkill = groupBy === 'skill'
    ? filtered.reduce<Record<string, Artifact[]>>((acc, a) => {
        const key = a.skill_id || 'unknown';
        if (!acc[key]) acc[key] = [];
        acc[key].push(a);
        return acc;
      }, {})
    : {};

  // Sort group keys by skill name for consistent ordering
  const sortedGroupKeys = Object.keys(groupedBySkill).sort((a, b) =>
    getSkillName(a).localeCompare(getSkillName(b))
  );

  /** Render a single artifact card (shared between time and skill views) */
  function ArtifactCard({ a }: { a: Artifact }) {
    const isSummary = a.skill_id === 'mission-summary';
    const skill = skillDefinitions.find(s => s.id === a.skill_id);
    const SkillIcon = isSummary ? BookOpen : (skill?.icon ?? Archive);
    const previewText = stripMarkdown(a.result?.summary ?? a.result?.output?.slice(0, 150) ?? '');

    return (
      <button
        key={a.id}
        onClick={() => { setViewedIds(prev => new Set(prev).add(a.id)); setSelectedArtifact(a); }}
        className={`text-left rounded-lg ${isSummary ? (isNew(a) ? 'border-2 border-yellow-400/60 bg-yellow-500/5' : 'border border-yellow-500/30 bg-yellow-500/[0.03]') : isNew(a) ? 'border-2 border-emerald-500/60 bg-emerald-500/5' : 'border border-zinc-800 bg-zinc-900/50'} p-3 hover:border-emerald-500/30 hover:bg-zinc-800/40 transition-all group`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <SkillIcon size={12} className={`${isSummary ? 'text-yellow-400' : 'text-emerald-400'} group-hover:text-emerald-300 transition-colors flex-shrink-0`} />
          <span className="font-pixel text-[9px] tracking-wider text-zinc-200 truncate">
            {isSummary ? 'Mission Report' : getSkillName(a.skill_id)}
          </span>
          {isSummary && (
            <span className="ml-auto font-pixel text-[7px] tracking-widest text-yellow-400 bg-yellow-500/15 px-1.5 py-0.5 rounded flex-shrink-0">REPORT</span>
          )}
          {!isSummary && isNew(a) && (
            <span className="ml-auto font-pixel text-[7px] tracking-widest text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded flex-shrink-0">NEW</span>
          )}
        </div>
        {a.command_name && (
          <div className="font-pixel text-[8px] tracking-wider text-zinc-500 mb-1">
            {formatCommandName(a.command_name)}
          </div>
        )}
        <div className="font-pixel text-[9px] text-zinc-500 line-clamp-2 leading-relaxed mb-2">
          {previewText}
        </div>
        <div className="flex items-center justify-between pt-1.5 border-t border-zinc-800/50">
          <span className="font-pixel text-[8px] text-zinc-600">
            {a.completed_at ? new Date(a.completed_at).toLocaleDateString() : ''}
          </span>
          <span className="font-pixel text-[8px] text-zinc-600">
            ${a.cost_usd?.toFixed(4) ?? '0.00'}
          </span>
        </div>
      </button>
    );
  }

  // Detail view when artifact is selected
  if (selectedArtifact) {
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
          <button onClick={() => setSelectedArtifact(null)} className="font-pixel text-[10px] text-zinc-500 hover:text-zinc-300 tracking-wider">
            &larr; BACK
          </button>
          <div className="font-pixel text-[11px] tracking-wider text-zinc-200 flex-1">
            {selectedArtifact.skill_id === 'mission-summary'
              ? 'Mission Report — Unified Summary'
              : `${getSkillName(selectedArtifact.skill_id)} — ${formatCommandName(selectedArtifact.command_name)}`}
          </div>
          <span className="font-pixel text-[9px] text-zinc-500">
            ${selectedArtifact.cost_usd?.toFixed(4)} &middot; {selectedArtifact.tokens_used} tokens
          </span>
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors font-pixel text-[8px] tracking-wider"
            >
              <FileDown size={12} />
              EXPORT
            </button>
            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-jarvis-surface border border-jarvis-border rounded-lg shadow-xl overflow-hidden min-w-[140px]">
                  <button
                    onClick={() => { exportAsPDF(selectedArtifact); setShowExportMenu(false); }}
                    className="w-full text-left px-3 py-2 font-pixel text-[9px] tracking-wider text-zinc-300 hover:bg-white/[0.04] hover:text-emerald-400 transition-colors"
                  >
                    Save as PDF
                  </button>
                  <button
                    onClick={() => { exportAsMarkdown(selectedArtifact); setShowExportMenu(false); }}
                    className="w-full text-left px-3 py-2 font-pixel text-[9px] tracking-wider text-zinc-300 hover:bg-white/[0.04] hover:text-emerald-400 transition-colors border-t border-zinc-800/50"
                  >
                    Save as Markdown
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {selectedArtifact.result?.summary && (
            <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <div className="font-pixel text-[9px] tracking-wider text-emerald-400 mb-1">SUMMARY</div>
              <SimpleMarkdown text={selectedArtifact.result.summary} />
            </div>
          )}
          <RichContent text={selectedArtifact.result?.output ?? 'No output'} />
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

          {/* Group-by-skill toggle */}
          <button
            onClick={() => setGroupBy(g => g === 'time' ? 'skill' : 'time')}
            className={`font-pixel text-[9px] tracking-wider px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
              groupBy === 'skill'
                ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
            }`}
            title={groupBy === 'skill' ? 'Switch to chronological view' : 'Group by skill'}
          >
            <Layers size={10} />
            {groupBy === 'skill' ? 'BY SKILL' : 'GROUP'}
          </button>

          {/* Skill filter */}
          <select
            value={skillFilter}
            onChange={e => setSkillFilter(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 font-pixel text-[9px] text-zinc-400 tracking-wider"
          >
            <option value="">ALL SKILLS</option>
            {uniqueSkills.map(id => (
              <option key={id} value={id}>{getSkillName(id)}</option>
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
        ) : groupBy === 'skill' ? (
          /* Grouped-by-skill view */
          <div className="space-y-6">
            {sortedGroupKeys.map(skillId => {
              const group = groupedBySkill[skillId];
              const skill = skillDefinitions.find(s => s.id === skillId);
              const SkillIcon = skill?.icon ?? Archive;
              return (
                <div key={skillId}>
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-zinc-800/60">
                    <SkillIcon size={14} className="text-emerald-400" />
                    <span className="font-pixel text-[10px] tracking-wider text-zinc-200">
                      {getSkillName(skillId)}
                    </span>
                    <span className="font-pixel text-[8px] tracking-wider text-zinc-600 ml-1">
                      ({group.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {group.map(a => (
                      <ArtifactCard key={a.id} a={a} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Chronological grid view */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map(a => (
              <ArtifactCard key={a.id} a={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
