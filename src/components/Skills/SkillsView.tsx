import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  AlertTriangle,
  Shield,
  ClipboardCheck,
  Search,
  RefreshCw,
} from 'lucide-react';
import { loadSkills, saveSkill, updateSkillModel, loadApprovals, loadAllApprovals, saveApproval, updateApprovalStatus, getVaultEntryByService, logAudit } from '../../lib/database';
import { MODEL_OPTIONS, getServiceForModel } from '../../lib/models';
import { skills, type SkillDefinition } from '../../data/skillDefinitions';

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

function getRequiredService(skill: SkillDefinition, model: string | null): string | null {
  if (skill.serviceType === 'fixed') return skill.fixedService ?? null;
  if (model) return getServiceForModel(model);
  return null;
}

function hasApiKey(service: string): boolean {
  return getVaultEntryByService(service) !== null;
}

function ensureApproval(service: string, skillName: string, model: string | null): void {
  const pending = loadApprovals();
  const alreadyRequested = pending.some(a => {
    try {
      const meta = JSON.parse(a.metadata ?? '{}');
      return meta.service === service;
    } catch { return false; }
  });
  if (!alreadyRequested) {
    saveApproval({
      id: `approval-${Date.now()}`,
      type: 'api_key_request',
      title: `API Key Required: ${service}`,
      description: `Skill "${skillName}" requires a ${service} API key to function.`,
      status: 'pending',
      metadata: JSON.stringify({ service, skillId: skillName, model }),
    });
  }
}

/** Check if a pending approval for a service is still needed by any enabled skill. If not, dismiss it. */
function cleanupStaleApproval(oldService: string, allConfigs: Map<string, SkillConfig>): void {
  // Check if any other enabled skill still needs this service
  const stillNeeded = skills.some(s => {
    if (s.status === 'coming_soon') return false;
    const cfg = allConfigs.get(s.id);
    if (!cfg?.enabled) return false;
    const svc = getRequiredService(s, cfg.model);
    return svc === oldService;
  });
  if (stillNeeded) return;

  // Also check if the key now exists (user may have provided it)
  if (hasApiKey(oldService)) return;

  // Find and dismiss the pending approval for this service
  const pending = loadApprovals();
  for (const a of pending) {
    try {
      const meta = JSON.parse(a.metadata ?? '{}');
      if (meta.service === oldService) {
        updateApprovalStatus(a.id, 'dismissed');
      }
    } catch { /* ignore */ }
  }
}

/** Check if a pending approval exists for a given service. */
function hasPendingApproval(service: string): boolean {
  const pending = loadApprovals();
  return pending.some(a => {
    try {
      const meta = JSON.parse(a.metadata ?? '{}');
      return meta.service === service;
    } catch { return false; }
  });
}

/** Check if a dismissed approval exists for a given service (key was never provided). */
function hasDismissedApproval(service: string): boolean {
  const all = loadAllApprovals();
  return all.some(a => {
    if (a.status !== 'dismissed') return false;
    try {
      const meta = JSON.parse(a.metadata ?? '{}');
      return meta.service === service;
    } catch { return false; }
  });
}

export default function SkillsView() {
  const navigate = useNavigate();
  const [skillConfigs, setSkillConfigs] = useState<Map<string, SkillConfig>>(() => {
    const rows = loadSkills();
    const map = new Map<string, SkillConfig>();
    for (const row of rows) {
      map.set(row.id, { enabled: row.enabled === 1, model: row.model });
    }
    return map;
  });

  // Filter and search state
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Disable confirmation dialog state
  const [disableConfirm, setDisableConfirm] = useState<SkillDefinition | null>(null);

  // Skill refresh state
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'refreshing' | 'done' | 'no_repo'>('idle');

  // Filtered skills
  const filteredSkills = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return skills.filter(s => {
      // Filter by status
      if (filter === 'enabled') {
        const cfg = skillConfigs.get(s.id);
        if (!cfg?.enabled) return false;
      } else if (filter === 'disabled') {
        const cfg = skillConfigs.get(s.id);
        if (cfg?.enabled) return false;
      }
      // Filter by search query (matches name or description)
      if (q) {
        return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [filter, searchQuery, skillConfigs]);

  const getConfig = (id: string): SkillConfig => skillConfigs.get(id) ?? { enabled: false, model: null };

  const doDisable = useCallback((skill: SkillDefinition) => {
    const current = getConfig(skill.id);
    saveSkill(skill.id, false, current.model);
    setSkillConfigs(prev => {
      const next = new Map(prev);
      next.set(skill.id, { enabled: false, model: current.model });
      return next;
    });
    setDisableConfirm(null);
    logAudit(null, 'SKILL_OFF', `Disabled skill "${skill.name}"`, 'info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillConfigs]);

  const toggleSkill = useCallback((skill: SkillDefinition) => {
    const current = getConfig(skill.id);
    const newEnabled = !current.enabled;

    if (newEnabled) {
      // Turning ON — set default model for LLM skills
      let model = current.model;
      if (skill.serviceType === 'llm' && !model && skill.defaultModel) {
        model = skill.defaultModel;
      }

      saveSkill(skill.id, true, model);

      // Check vault for required service
      const service = getRequiredService(skill, model);
      if (service && !hasApiKey(service)) {
        ensureApproval(service, skill.name, model);
        window.dispatchEvent(new Event('approvals-changed'));
      }

      setSkillConfigs(prev => {
        const next = new Map(prev);
        next.set(skill.id, { enabled: true, model });
        return next;
      });
      logAudit(null, 'SKILL_ON', `Enabled skill "${skill.name}"${model ? ` with ${model}` : ''}`, 'info');
    } else {
      // Turning OFF — show confirmation
      setDisableConfirm(skill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillConfigs]);

  const handleModelChange = useCallback((skill: SkillDefinition, newModel: string) => {
    const current = getConfig(skill.id);
    const enabled = current.enabled;
    const oldModel = current.model;
    const oldService = oldModel ? getServiceForModel(oldModel) : null;
    const newService = getServiceForModel(newModel);

    saveSkill(skill.id, enabled, newModel);

    // Update local state first so cleanup sees the new config
    const updatedConfigs = new Map(skillConfigs);
    updatedConfigs.set(skill.id, { enabled, model: newModel });
    setSkillConfigs(updatedConfigs);

    if (enabled) {
      // If the service changed, clean up old approval if no longer needed
      if (oldService && oldService !== newService) {
        cleanupStaleApproval(oldService, updatedConfigs);
      }

      // Ensure approval for new service if needed
      if (!hasApiKey(newService)) {
        ensureApproval(newService, skill.name, newModel);
      }

      window.dispatchEvent(new Event('approvals-changed'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillConfigs]);

  const categories = ['communication', 'research', 'creation', 'analysis'] as const;

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
        <button
          onClick={() => {
            setRefreshStatus('refreshing');
            // Simulate checking for a repo — no repo configured yet
            setTimeout(() => {
              setRefreshStatus('no_repo');
              setTimeout(() => setRefreshStatus('idle'), 3000);
            }, 1200);
          }}
          disabled={refreshStatus === 'refreshing'}
          className={`flex items-center gap-1.5 px-3 py-2 font-pixel text-[7px] tracking-wider border rounded-md transition-colors flex-shrink-0 ${
            refreshStatus === 'refreshing'
              ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
              : refreshStatus === 'no_repo'
                ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                : 'border-zinc-700/50 text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-emerald-500/10'
          }`}
        >
          <RefreshCw size={10} className={refreshStatus === 'refreshing' ? 'animate-spin' : ''} />
          {refreshStatus === 'refreshing' ? 'CHECKING...' : refreshStatus === 'no_repo' ? 'NO REPO CONFIGURED' : 'REFRESH FROM REPO'}
        </button>
      </div>

      {/* Search + Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        {/* Search */}
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

        {/* Filter Toggle */}
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
                const Icon = skill.icon;
                const config = getConfig(skill.id);
                const isEnabled = config.enabled;
                const isComingSoon = skill.status === 'coming_soon';

                // Determine status
                const service = isEnabled ? getRequiredService(skill, config.model) : null;
                const keyPresent = service ? hasApiKey(service) : false;
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
                        {/* Model dropdown or service badge */}
                        {isEnabled ? (
                          skill.serviceType === 'llm' ? (
                            <div className="relative" onClick={e => e.stopPropagation()}>
                              <select
                                value={config.model ?? ''}
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
                          ) : (
                            <span className="font-pixel text-[7px] tracking-wider px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
                              {skill.fixedService} API
                            </span>
                          )
                        ) : (
                          <span />
                        )}

                        {/* Status indicator */}
                        {isEnabled && (
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${needsKey ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                            {needsKey ? (
                              <span className="font-pixel text-[6px] tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                                KEY NEEDED
                              </span>
                            ) : (
                              <span className="font-pixel text-[6px] tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
                                {skill.serviceType === 'llm' && config.model ? getServiceForModel(config.model) : skill.fixedService}
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
              NO SKILLS FOUND
            </p>
            <p className="font-pixel text-[7px] tracking-wider text-zinc-600">
              {searchQuery ? 'Try a different search term' : `No ${filter} skills`}
            </p>
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="mt-auto pt-6 border-t border-zinc-800">
        <p className="font-pixel text-[7px] tracking-wider text-zinc-600 leading-relaxed">
          {skills.length} SKILLS LOADED ({skills.filter(s => s.status === 'available').length} AVAILABLE, {skills.filter(s => s.status === 'coming_soon').length} COMING SOON).
          <br />
          CONFIGURE A GITHUB REPO TO SYNC CUSTOM SKILLS VIA THE REFRESH BUTTON.
        </p>
      </div>

      {/* Disable Confirmation Dialog */}
      {disableConfirm && <DisableSkillDialog
        skill={disableConfirm}
        config={getConfig(disableConfirm.id)}
        onConfirm={() => doDisable(disableConfirm)}
        onCancel={() => setDisableConfirm(null)}
        onGoApprovals={() => { setDisableConfirm(null); navigate('/approvals'); }}
        onGoVault={() => { setDisableConfirm(null); navigate('/vault'); }}
      />}
    </div>
  );
}

/** Inline dialog for confirming skill disable */
function DisableSkillDialog({
  skill, config, onConfirm, onCancel, onGoApprovals, onGoVault,
}: {
  skill: SkillDefinition;
  config: SkillConfig;
  onConfirm: () => void;
  onCancel: () => void;
  onGoApprovals: () => void;
  onGoVault: () => void;
}) {
  const service = getRequiredService(skill, config.model);
  const keyPresent = service ? hasApiKey(service) : true;
  const pendingExists = service ? hasPendingApproval(service) : false;
  const dismissedExists = service ? hasDismissedApproval(service) : false;

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
