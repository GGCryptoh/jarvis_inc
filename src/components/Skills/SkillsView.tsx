import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  AlertTriangle,
  Shield,
  ClipboardCheck,
  Search,
  RefreshCw,
  FlaskConical,
  Trash2,
  // Lucide icons for skill rendering
  Mail,
  Send,
  Image,
  Globe,
  MessageCircle,
  FileText,
  Code,
  BarChart3,
  Calendar,
  Rss,
  Monitor,
  ScanSearch,
  Video,
  Eye,
  BookOpen,
  Languages,
  Blocks,
  CloudRain,
  Terminal,
  Twitter,
  Sparkles,
} from 'lucide-react';
import { loadSkills, saveSkill, loadApprovals, loadAllApprovals, saveApproval, updateApprovalStatus, getVaultEntryByService, loadVaultEntries, logAudit } from '../../lib/database';
import { MODEL_OPTIONS, getServiceForModel } from '../../lib/models';
import { resolveSkills, seedSkillsFromRepo, cleanSeedSkillsFromRepo, SKILLS_REPO_INFO, type FullSkillDefinition } from '../../lib/skillResolver';
import SkillTestDialog from './SkillTestDialog';

// ---------------------------------------------------------------------------
// Icon name → React component map (for rendering resolved skill icons)
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.ElementType> = {
  Mail, Send, Image, Sparkles, Globe, MessageCircle, FileText, Code, BarChart3,
  Calendar, Search, Rss, Monitor, ScanSearch, Video, Eye, BookOpen,
  Languages, Blocks, CloudRain, Terminal, Twitter,
};

function resolveIcon(iconName: string): React.ElementType {
  return ICON_MAP[iconName] ?? Blocks;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

interface SkillConfig {
  enabled: boolean;
  model: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRequiredService(skill: { serviceType: string; fixedService?: string }, model: string | null): string | null {
  if (skill.serviceType === 'fixed' || skill.serviceType === 'api_key') return skill.fixedService ?? null;
  if (skill.fixedService) return skill.fixedService;
  if (model) return getServiceForModel(model);
  return null;
}

async function hasApiKey(service: string): Promise<boolean> {
  return (await getVaultEntryByService(service)) !== null;
}

async function ensureApproval(service: string, skillName: string, model: string | null): Promise<void> {
  const pending = await loadApprovals();
  const alreadyRequested = pending.some(a => {
    try {
      const meta = (a.metadata ?? {}) as Record<string, unknown>;
      return meta.service === service;
    } catch { return false; }
  });
  if (!alreadyRequested) {
    await saveApproval({
      id: `approval-${Date.now()}`,
      type: 'api_key_request',
      title: `API Key Required: ${service}`,
      description: `Skill "${skillName}" requires a ${service} API key to function.`,
      status: 'pending',
      metadata: { service, skillId: skillName, model },
    });
  }
}

async function cleanupStaleApproval(oldService: string, allConfigs: Map<string, SkillConfig>, allSkills: FullSkillDefinition[]): Promise<void> {
  const stillNeeded = allSkills.some(s => {
    if (s.status === 'coming_soon') return false;
    const cfg = allConfigs.get(s.id);
    if (!cfg?.enabled) return false;
    const svc = getRequiredService(s, cfg.model);
    return svc === oldService;
  });
  if (stillNeeded) return;
  if (await hasApiKey(oldService)) return;

  const pending = await loadApprovals();
  for (const a of pending) {
    try {
      const meta = (a.metadata ?? {}) as Record<string, unknown>;
      if (meta.service === oldService) {
        await updateApprovalStatus(a.id, 'dismissed');
      }
    } catch { /* ignore */ }
  }
}

async function hasPendingApproval(service: string): Promise<boolean> {
  const pending = await loadApprovals();
  return pending.some(a => {
    try {
      const meta = (a.metadata ?? {}) as Record<string, unknown>;
      return meta.service === service;
    } catch { return false; }
  });
}

async function hasDismissedApproval(service: string): Promise<boolean> {
  const all = await loadAllApprovals();
  return all.some(a => {
    if (a.status !== 'dismissed') return false;
    try {
      const meta = (a.metadata ?? {}) as Record<string, unknown>;
      return meta.service === service;
    } catch { return false; }
  });
}

// ===========================================================================
// Main Component
// ===========================================================================

export default function SkillsView() {
  const navigate = useNavigate();
  const [skillConfigs, setSkillConfigs] = useState<Map<string, SkillConfig>>(new Map());

  // Resolved skills from DB — the single source of truth for the grid
  const [resolvedSkills, setResolvedSkills] = useState<FullSkillDefinition[]>([]);
  const [resolvedMap, setResolvedMap] = useState<Map<string, FullSkillDefinition>>(new Map());

  // Cache of services that have API keys in the vault
  const [vaultServices, setVaultServices] = useState<Set<string>>(new Set());

  // Reload function — shared between mount, event listener, and refresh
  const reloadSkills = useCallback(async () => {
    const [rows, all] = await Promise.all([loadSkills(), resolveSkills()]);

    const configMap = new Map<string, SkillConfig>();
    for (const row of rows) {
      configMap.set(row.id, { enabled: !!row.enabled, model: row.model });
    }
    setSkillConfigs(configMap);

    // Only show skills that have DB backing (synced from repo)
    // Fall back to all resolved skills if DB is empty (pre-sync state)
    const dbBacked = all.filter(s => configMap.has(s.id));
    const displaySkills = dbBacked.length > 0 ? dbBacked : all;
    setResolvedSkills(displaySkills);

    const map = new Map<string, FullSkillDefinition>();
    for (const s of all) map.set(s.id, s);
    setResolvedMap(map);
  }, []);

  useEffect(() => {
    // Auto-sync from GitHub repo on mount, then load skills + vault
    (async () => {
      await seedSkillsFromRepo();
      await reloadSkills();
      const entries = await loadVaultEntries();
      setVaultServices(new Set(entries.map(e => e.service)));
    })();
  }, [reloadSkills]);

  // Listen for skills-changed events (from auto-seed, CEO scheduler, etc.)
  useEffect(() => {
    const handler = () => reloadSkills();
    window.addEventListener('skills-changed', handler);
    return () => window.removeEventListener('skills-changed', handler);
  }, [reloadSkills]);

  const refreshVaultCache = useCallback(() => {
    loadVaultEntries().then(entries => {
      setVaultServices(new Set(entries.map(e => e.service)));
    });
  }, []);

  const hasApiKeyCached = useCallback((service: string): boolean => {
    return vaultServices.has(service);
  }, [vaultServices]);

  // Filter and search state
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Disable confirmation dialog state
  const [disableConfirm, setDisableConfirm] = useState<FullSkillDefinition | null>(null);

  // Clean sync dialog
  const [cleanConfirmOpen, setCleanConfirmOpen] = useState(false);

  // Skill test dialog state
  const [testSkill, setTestSkill] = useState<FullSkillDefinition | null>(null);

  // Skill refresh state
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'refreshing' | 'done' | 'error'>('idle');
  const [refreshMessage, setRefreshMessage] = useState('');

  // Filtered skills — from resolved (DB-backed) skills
  const filteredSkills = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return resolvedSkills.filter(s => {
      if (filter === 'enabled' && !s.enabled) return false;
      if (filter === 'disabled' && s.enabled) return false;
      if (q) {
        return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [filter, searchQuery, resolvedSkills]);

  const getConfig = (id: string): SkillConfig => skillConfigs.get(id) ?? { enabled: false, model: null };

  const doDisable = useCallback(async (skill: FullSkillDefinition) => {
    const current = getConfig(skill.id);
    await saveSkill(skill.id, false, current.model);
    setSkillConfigs(prev => {
      const next = new Map(prev);
      next.set(skill.id, { enabled: false, model: current.model });
      return next;
    });
    // Update the resolved skills list in-place for immediate UI feedback
    setResolvedSkills(prev => prev.map(s => s.id === skill.id ? { ...s, enabled: false } : s));
    setDisableConfirm(null);
    await logAudit(null, 'SKILL_OFF', `Disabled skill "${skill.name}"`, 'info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillConfigs]);

  const toggleSkill = useCallback(async (skill: FullSkillDefinition) => {
    const current = getConfig(skill.id);
    const newEnabled = !current.enabled;

    if (newEnabled) {
      let model = current.model;
      if (skill.serviceType === 'llm' && !model && skill.defaultModel) {
        model = skill.defaultModel;
      }

      await saveSkill(skill.id, true, model);

      const service = getRequiredService(skill, model);
      if (service && !(await hasApiKey(service))) {
        await ensureApproval(service, skill.name, model);
        window.dispatchEvent(new Event('approvals-changed'));
      }

      setSkillConfigs(prev => {
        const next = new Map(prev);
        next.set(skill.id, { enabled: true, model });
        return next;
      });
      setResolvedSkills(prev => prev.map(s => s.id === skill.id ? { ...s, enabled: true, model } : s));
      await logAudit(null, 'SKILL_ON', `Enabled skill "${skill.name}"${model ? ` with ${model}` : ''}`, 'info');
    } else {
      setDisableConfirm(skill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillConfigs]);

  const handleModelChange = useCallback(async (skill: FullSkillDefinition, newModel: string) => {
    const current = getConfig(skill.id);
    const enabled = current.enabled;
    const oldModel = current.model;
    const oldService = oldModel ? getServiceForModel(oldModel) : null;
    const newService = getServiceForModel(newModel);

    await saveSkill(skill.id, enabled, newModel);

    const updatedConfigs = new Map(skillConfigs);
    updatedConfigs.set(skill.id, { enabled, model: newModel });
    setSkillConfigs(updatedConfigs);
    setResolvedSkills(prev => prev.map(s => s.id === skill.id ? { ...s, model: newModel } : s));

    if (enabled) {
      if (oldService && oldService !== newService) {
        await cleanupStaleApproval(oldService, updatedConfigs, resolvedSkills);
      }
      if (!(await hasApiKey(newService))) {
        await ensureApproval(newService, skill.name, newModel);
      }
      window.dispatchEvent(new Event('approvals-changed'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillConfigs, resolvedSkills]);

  const handleOpenTest = useCallback((e: React.MouseEvent, skill: FullSkillDefinition) => {
    e.stopPropagation();
    const resolved = resolvedMap.get(skill.id);
    if (resolved) setTestSkill(resolved);
  }, [resolvedMap]);

  const handleSync = useCallback(async () => {
    setRefreshStatus('refreshing');
    setRefreshMessage('');
    try {
      const result = await seedSkillsFromRepo();
      if (result.total === 0) {
        setRefreshStatus('error');
        setRefreshMessage('NO SKILLS IN MANIFEST');
      } else {
        setRefreshStatus('done');
        setRefreshMessage(`${result.created} NEW, ${result.updated} UPDATED`);
        await reloadSkills();
      }
    } catch {
      setRefreshStatus('error');
      setRefreshMessage('FETCH FAILED');
    }
    setTimeout(() => { setRefreshStatus('idle'); setRefreshMessage(''); }, 4000);
  }, [reloadSkills]);

  const handleCleanSync = useCallback(async () => {
    setCleanConfirmOpen(false);
    setRefreshStatus('refreshing');
    setRefreshMessage('CLEAN SYNC...');
    try {
      const result = await cleanSeedSkillsFromRepo();
      setRefreshStatus('done');
      setRefreshMessage(`FRESH: ${result.created} SKILLS`);
      await reloadSkills();
    } catch {
      setRefreshStatus('error');
      setRefreshMessage('CLEAN SYNC FAILED');
    }
    setTimeout(() => { setRefreshStatus('idle'); setRefreshMessage(''); }, 4000);
  }, [reloadSkills]);

  const categories = ['communication', 'research', 'creation', 'analysis'] as const;
  void refreshVaultCache; // used by approval flow

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto no-scrollbar p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-pixel text-[14px] tracking-wider text-emerald-400 mb-2">
            AGENT SKILLS
          </h1>
          <p className="font-pixel text-[8px] tracking-wider text-zinc-500 leading-relaxed">
            CONFIGURE CAPABILITIES FOR YOUR AGENTS. TOGGLE SKILLS AND ASSIGN AI MODELS TO POWER THEM.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleSync}
            disabled={refreshStatus === 'refreshing'}
            className={`flex items-center gap-1.5 px-3 py-2 font-pixel text-[7px] tracking-wider border rounded-md transition-colors ${
              refreshStatus === 'refreshing'
                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                : refreshStatus === 'done'
                  ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                  : refreshStatus === 'error'
                    ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                    : 'border-zinc-700/50 text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-emerald-500/10'
            }`}
          >
            <RefreshCw size={10} className={refreshStatus === 'refreshing' ? 'animate-spin' : ''} />
            {refreshStatus === 'refreshing' ? 'SYNCING...' : refreshMessage || 'SYNC REPO'}
          </button>
          <button
            onClick={() => setCleanConfirmOpen(true)}
            disabled={refreshStatus === 'refreshing'}
            className="flex items-center gap-1 px-2 py-2 font-pixel text-[7px] tracking-wider border border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
            title="Clear all skills and re-sync fresh from repo"
          >
            <Trash2 size={9} />
            CLEAN
          </button>
        </div>
      </div>

      {/* Search + Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-0 w-full sm:max-w-xs">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search skills..."
            className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg pl-8 pr-3 py-2 font-pixel text-[8px] tracking-wider text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-colors"
          />
        </div>

        <div className="flex items-center rounded-lg border border-zinc-700/50 overflow-hidden flex-shrink-0">
          {(['all', 'enabled', 'disabled'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`font-pixel text-[7px] tracking-widest px-4 py-2 transition-colors ${
                filter === f
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-zinc-800/40 text-zinc-500 hover:text-zinc-300'
              } ${f !== 'all' ? 'border-l border-zinc-700/50' : ''}`}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Skill categories */}
      {categories.map(cat => {
        const catSkills = filteredSkills.filter(s => s.category === cat);
        if (catSkills.length === 0) return null;
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
                const Icon = resolveIcon(skill.icon);
                const isEnabled = skill.enabled;
                const isComingSoon = skill.status === 'coming_soon';

                // Determine status
                const service = isEnabled ? getRequiredService(skill, skill.model) : null;
                const keyPresent = service ? hasApiKeyCached(service) : false;
                const needsKey = isEnabled && service && !keyPresent;

                // Card color scheme
                const cardBorder = isComingSoon
                  ? 'border-zinc-800'
                  : needsKey
                    ? 'border-amber-500/30'
                    : isEnabled
                      ? 'border-emerald-500/40'
                      : 'border-zinc-700/50';
                const cardBg = isComingSoon
                  ? 'bg-zinc-900/30'
                  : needsKey
                    ? 'bg-amber-500/[0.04]'
                    : isEnabled
                      ? 'bg-emerald-500/[0.06]'
                      : 'bg-jarvis-surface';
                const iconBg = isComingSoon
                  ? 'bg-zinc-800'
                  : needsKey
                    ? 'bg-amber-500/20'
                    : isEnabled
                      ? 'bg-emerald-500/20'
                      : 'bg-zinc-800';
                const iconColor = isComingSoon
                  ? 'text-zinc-500'
                  : needsKey
                    ? 'text-amber-400'
                    : isEnabled
                      ? 'text-emerald-400'
                      : 'text-zinc-400';
                const toggleColor = needsKey ? 'bg-amber-500' : isEnabled ? 'bg-emerald-500' : 'bg-zinc-700';

                return (
                  <div
                    key={skill.id}
                    className={`relative rounded-lg border p-4 transition-all duration-200 ${isComingSoon ? 'opacity-60' : 'cursor-pointer'} group ${cardBorder} ${cardBg} ${!isComingSoon ? 'hover:border-zinc-600' : ''}`}
                    onClick={() => !isComingSoon && toggleSkill(skill)}
                  >
                    {/* Source badge */}
                    {skill.source === 'github' && (
                      <span className="absolute top-2 right-2 font-pixel text-[5px] tracking-widest text-cyan-500/60">
                        REPO
                      </span>
                    )}

                    {/* Icon + Title + Toggle row */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-md flex items-center justify-center ${iconBg}`}>
                          <Icon size={16} className={iconColor} />
                        </div>
                        <div className="font-pixel text-[9px] tracking-wider text-zinc-200">
                          {skill.name}
                        </div>
                      </div>

                      {isComingSoon ? (
                        <span className="font-pixel text-[6px] tracking-widest text-zinc-600 border border-zinc-700/50 rounded px-2 py-0.5 bg-zinc-800/30">
                          SOON
                        </span>
                      ) : (
                        <div className={`w-8 h-4 rounded-full transition-colors duration-200 flex items-center px-0.5 ${toggleColor}`}>
                          <div className={`w-3 h-3 rounded-full bg-white transition-transform duration-200 ${isEnabled ? 'translate-x-3.5' : 'translate-x-0'}`} />
                        </div>
                      )}
                    </div>

                    {/* Description */}
                    <p className="font-pixel text-[7px] tracking-wider text-zinc-500 leading-relaxed mb-3">
                      {skill.description}
                    </p>

                    {/* Bottom row: Model selector / Service badge + Status */}
                    {!isComingSoon && (
                      <div className="flex items-center justify-between gap-2 min-h-[20px]">
                        {isEnabled ? (
                          skill.serviceType === 'llm' ? (
                            <div className="relative" onClick={e => e.stopPropagation()}>
                              <select
                                value={skill.model ?? ''}
                                onChange={e => handleModelChange(skill, e.target.value)}
                                className="appearance-none font-pixel text-[7px] tracking-wider bg-zinc-900 border border-zinc-700 rounded px-2 py-1 pr-5 text-zinc-300 focus:outline-none focus:border-emerald-500/40 cursor-pointer"
                              >
                                <option value="" disabled>SELECT MODEL</option>
                                {MODEL_OPTIONS.map(m => (
                                  <option key={m} value={m}>{m}</option>
                                ))}
                              </select>
                              <ChevronDown size={8} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                            </div>
                          ) : skill.serviceType === 'cli' ? (
                            <span className="font-pixel text-[7px] tracking-wider px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-cyan-400">
                              CLI TOOL
                            </span>
                          ) : (
                            <span className="font-pixel text-[7px] tracking-wider px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
                              {skill.fixedService} API
                            </span>
                          )
                        ) : (
                          <span />
                        )}

                        {/* Status indicator + Test button */}
                        {isEnabled && (
                          <div className="flex items-center gap-1.5">
                            {skill.commands && skill.commands.length > 0 && (
                              <button
                                onClick={e => handleOpenTest(e, skill)}
                                className="font-pixel text-[6px] tracking-wider text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded px-1.5 py-0.5 transition-colors"
                                title="Test this skill"
                              >
                                <span className="flex items-center gap-1">
                                  <FlaskConical size={8} />
                                  TEST
                                </span>
                              </button>
                            )}
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${needsKey ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                            {needsKey ? (
                              <span className="font-pixel text-[6px] tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                                KEY NEEDED
                              </span>
                            ) : (
                              <span className="font-pixel text-[6px] tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
                                {skill.serviceType === 'llm' && skill.model ? getServiceForModel(skill.model) : skill.serviceType === 'cli' ? 'CLI' : skill.fixedService}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Empty state */}
      {filteredSkills.length === 0 && (
        <div className="flex-1 flex items-center justify-center py-16">
          <div className="text-center">
            <Search size={24} className="text-zinc-700 mx-auto mb-3" />
            <p className="font-pixel text-[9px] tracking-wider text-zinc-500 mb-1">
              {resolvedSkills.length === 0 ? 'NO SKILLS SYNCED' : 'NO SKILLS FOUND'}
            </p>
            <p className="font-pixel text-[7px] tracking-wider text-zinc-600">
              {resolvedSkills.length === 0
                ? 'Click SYNC REPO to load skills from GitHub'
                : searchQuery ? 'Try a different search term' : `No ${filter} skills`}
            </p>
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="mt-auto pt-6 border-t border-zinc-800">
        <p className="font-pixel text-[7px] tracking-wider text-zinc-600 leading-relaxed">
          {resolvedSkills.length} SKILL{resolvedSkills.length !== 1 ? 'S' : ''} FROM DB ({resolvedSkills.filter(s => s.enabled).length} ENABLED).
          <br />
          REPO: <span className="text-zinc-500">{SKILLS_REPO_INFO.owner}/{SKILLS_REPO_INFO.name}</span> ({SKILLS_REPO_INFO.branch}) — AUTO-SYNCED ON BOOT + CEO SCHEDULER.
        </p>
      </div>

      {/* Disable Confirmation Dialog */}
      {disableConfirm && <DisableSkillDialog
        skill={disableConfirm}
        onConfirm={() => doDisable(disableConfirm)}
        onCancel={() => setDisableConfirm(null)}
        onGoApprovals={() => { setDisableConfirm(null); navigate('/approvals'); }}
        onGoVault={() => { setDisableConfirm(null); navigate('/vault'); }}
      />}

      {/* Clean Sync Confirmation Dialog */}
      {cleanConfirmOpen && (
        <CleanSyncDialog
          onConfirm={handleCleanSync}
          onCancel={() => setCleanConfirmOpen(false)}
          skillCount={resolvedSkills.length}
        />
      )}

      {/* Skill Test Dialog */}
      {testSkill && (
        <SkillTestDialog
          skill={testSkill}
          open={true}
          onClose={() => setTestSkill(null)}
        />
      )}
    </div>
  );
}

// ===========================================================================
// Dialogs
// ===========================================================================

/** Themed dialog for confirming skill disable */
function DisableSkillDialog({
  skill, onConfirm, onCancel, onGoApprovals, onGoVault,
}: {
  skill: FullSkillDefinition;
  onConfirm: () => void;
  onCancel: () => void;
  onGoApprovals: () => void;
  onGoVault: () => void;
}) {
  const service = getRequiredService(skill, skill.model);
  const [keyPresent, setKeyPresent] = useState(true);
  const [pendingExists, setPendingExists] = useState(false);
  const [dismissedExists, setDismissedExists] = useState(false);

  useEffect(() => {
    if (service) {
      hasApiKey(service).then(setKeyPresent);
      hasPendingApproval(service).then(setPendingExists);
      hasDismissedApproval(service).then(setDismissedExists);
    }
  }, [service]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm mx-4">
        <div className="bg-jarvis-surface border border-zinc-600/40 rounded-lg shadow-lg overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 bg-zinc-500/10 border-b border-zinc-600/20">
            <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />
            <div>
              <h2 className="text-amber-300 font-semibold text-sm tracking-wide">DISABLE SKILL</h2>
              <p className="text-zinc-500 text-xs mt-0.5">{skill.name}</p>
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="text-jarvis-text text-sm leading-relaxed mb-4">
              Are you sure you want to disable <span className="text-amber-300 font-semibold">{skill.name}</span>?
            </p>

            {!keyPresent && service && (
              <div className="mb-4 p-3 rounded-lg bg-amber-500/[0.06] border border-amber-500/20">
                <p className="text-amber-300/80 text-xs mb-2">
                  This skill is missing its <span className="font-semibold">{service}</span> API key.
                </p>
                {pendingExists && (
                  <button
                    onClick={onGoApprovals}
                    className="flex items-center gap-2 text-xs text-emerald-400 hover:text-emerald-300 transition-colors mb-1"
                  >
                    <ClipboardCheck size={12} />
                    A pending approval exists — go provide the key
                  </button>
                )}
                {!pendingExists && dismissedExists && (
                  <button
                    onClick={onGoVault}
                    className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <Shield size={12} />
                    Add key directly in the Vault
                  </button>
                )}
                {!pendingExists && !dismissedExists && (
                  <button
                    onClick={onGoVault}
                    className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <Shield size={12} />
                    Add {service} key in the Vault
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-jarvis-border bg-jarvis-bg/50">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-xs text-jarvis-muted hover:text-jarvis-text border border-jarvis-border rounded transition-colors"
            >
              KEEP ENABLED
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-2 text-xs text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded transition-colors"
            >
              DISABLE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Themed dialog for confirming clean sync */
function CleanSyncDialog({
  onConfirm, onCancel, skillCount,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  skillCount: number;
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm mx-4">
        <div className="bg-jarvis-surface border border-red-500/30 rounded-lg shadow-lg overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 bg-red-500/[0.06] border-b border-red-500/20">
            <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
            <div>
              <h2 className="text-red-300 font-semibold text-sm tracking-wide">CLEAN SYNC</h2>
              <p className="text-zinc-500 text-xs mt-0.5">Wipe + re-sync from GitHub</p>
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="text-jarvis-text text-sm leading-relaxed mb-3">
              This will <span className="text-red-300 font-semibold">delete all {skillCount} skill configs</span> from the database and re-sync fresh from the GitHub repo.
            </p>
            <div className="p-3 rounded-lg bg-red-500/[0.06] border border-red-500/20">
              <p className="text-red-300/80 text-xs leading-relaxed">
                All enabled/disabled states and model selections will be reset. Only skills in the repo manifest will remain.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-jarvis-border bg-jarvis-bg/50">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-xs text-jarvis-muted hover:text-jarvis-text border border-jarvis-border rounded transition-colors"
            >
              CANCEL
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-2 text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded transition-colors"
            >
              WIPE + SYNC
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
