import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ChevronDown,
  AlertTriangle,
  Shield,
  ClipboardCheck,
  Search,
  RefreshCw,
  FlaskConical,
  Trash2,
  Clock,
  Settings2,
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
  ExternalLink,
} from 'lucide-react';
import { loadSkills, saveSkill, loadApprovals, loadAllApprovals, saveApproval, updateApprovalStatus, getVaultEntryByService, loadVaultEntries, logAudit, saveSkillOptions, getSkillOptions, type SkillScheduleRow, loadSkillSchedules, saveSkillSchedule, deleteSkillSchedule } from '../../lib/database';
import { getSupabase } from '../../lib/supabase';
import { MODEL_OPTIONS, getServiceForModel } from '../../lib/models';
import { resolveSkills, seedSkillsFromRepo, cleanSeedSkillsFromRepo, applySkillUpgrades, SKILLS_REPO_INFO, type FullSkillDefinition, type PendingUpgrade } from '../../lib/skillResolver';
import { hasInstanceKey } from '../../lib/jarvisKey';
import { getMarketplaceStatus, type MarketplaceStatus } from '../../lib/marketplaceClient';
import SkillTestDialog from './SkillTestDialog';
import SkillDetailPanel from './SkillDetailPanel';
import SkillUpgradeDialog from './SkillUpgradeDialog';
import GoogleOAuthWizard from '../Vault/GoogleOAuthWizard';

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

// ---------------------------------------------------------------------------
// Risk level helpers
// ---------------------------------------------------------------------------

const DANGEROUS_PERMISSIONS = ['shell_exec', 'sudo', 'docker_exec'];
const MODERATE_PERMISSIONS = ['filesystem_write', 'network'];

function isDangerous(skill: FullSkillDefinition): boolean {
  if (skill.riskLevel === 'dangerous') return true;
  return skill.permissions?.some(p => DANGEROUS_PERMISSIONS.includes(p)) ?? false;
}

function isModerateRisk(skill: FullSkillDefinition): boolean {
  if (isDangerous(skill)) return false; // dangerous takes precedence
  if (skill.riskLevel === 'moderate') return true;
  return skill.permissions?.some(p => MODERATE_PERMISSIONS.includes(p)) ?? false;
}

interface SkillConfig {
  enabled: boolean;
  model: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRequiredService(skill: { serviceType: string; fixedService?: string }, model: string | null): string | null {
  if (skill.serviceType === 'none') return null;
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

  // Marketplace registration status
  const [marketplaceRegistered, setMarketplaceRegistered] = useState<boolean | null>(null);

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
      const seedResult = await seedSkillsFromRepo();
      if (seedResult.pendingUpgrades.length > 0) {
        setPendingUpgrades(seedResult.pendingUpgrades);
        setShowUpgradeDialog(true);
      }
      await reloadSkills();
      const entries = await loadVaultEntries();
      setVaultServices(new Set(entries.map(e => e.service)));
      // Load skill schedules (grouped by skill_id — multiple per skill)
      loadSkillSchedules().then(rows => {
        const map: Record<string, SkillScheduleRow[]> = {};
        for (const row of rows) {
          if (!map[row.skill_id]) map[row.skill_id] = [];
          map[row.skill_id].push(row);
        }
        setSchedules(map);
      });
      // Load skill options for all skills that have options[] definitions
      loadSkills().then(rows => {
        const optsMap = new Map<string, Record<string, unknown>>();
        for (const row of rows) {
          const oc = (row as unknown as Record<string, unknown>).options_config;
          if (oc && typeof oc === 'object') optsMap.set(row.id, oc as Record<string, unknown>);
        }
        setSkillOptionsMap(optsMap);
      });
    })();
    // Mark skills as "seen" — clears the nav badge
    localStorage.setItem('jarvis_skills_last_seen', new Date().toISOString());
    window.dispatchEvent(new Event('skills-seen'));
  }, [reloadSkills]);

  // Listen for skills-changed events (from auto-seed, CEO scheduler, etc.)
  useEffect(() => {
    const handler = () => reloadSkills();
    window.addEventListener('skills-changed', handler);
    return () => window.removeEventListener('skills-changed', handler);
  }, [reloadSkills]);

  // Check marketplace registration status on mount and after sync
  useEffect(() => {
    const status = getMarketplaceStatus();
    setMarketplaceRegistered(status.registered || status.hasKey);
  }, []);

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
  const [sourceFilter, setSourceFilter] = useState<'all' | 'official' | 'marketplace' | 'personal'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Disable confirmation dialog state
  const [disableConfirm, setDisableConfirm] = useState<FullSkillDefinition | null>(null);

  // Clean sync dialog
  const [cleanConfirmOpen, setCleanConfirmOpen] = useState(false);

  // Skill detail panel state
  const [detailSkill, setDetailSkill] = useState<FullSkillDefinition | null>(null);

  // Skill test dialog state
  const [testSkill, setTestSkill] = useState<FullSkillDefinition | null>(null);

  // Pending upgrades state — dialog visible vs available (skipped but still pending)
  const [pendingUpgrades, setPendingUpgrades] = useState<PendingUpgrade[]>([]);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);

  // OAuth wizard state
  const [oauthWizardSkill, setOauthWizardSkill] = useState<FullSkillDefinition | null>(null);

  // Skill schedule state — multiple schedules per skill (one per command)
  const [schedules, setSchedules] = useState<Record<string, SkillScheduleRow[]>>({});
  const [schedulePopover, setSchedulePopover] = useState<string | null>(null); // skill_id or null

  // Skill options state — per-skill config (e.g. approval_notifications, ceo_alerts)
  const [optionsPopover, setOptionsPopover] = useState<string | null>(null);
  const [skillOptionsMap, setSkillOptionsMap] = useState<Map<string, Record<string, unknown>>>(new Map());

  // Count of personal skills for the badge on Personal filter button
  const personalSkillCount = useMemo(() => resolvedSkills.filter(s => s.source === 'personal').length, [resolvedSkills]);

  // Skill refresh state
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'refreshing' | 'done' | 'error'>('idle');
  const [refreshMessage, setRefreshMessage] = useState('');

  // Filtered skills — from resolved (DB-backed) skills
  const filteredSkills = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return resolvedSkills.filter(s => {
      if (filter === 'enabled' && !s.enabled) return false;
      if (filter === 'disabled' && s.enabled) return false;
      if (sourceFilter === 'official' && !(s.repoPath?.startsWith('Official/') || s.source === 'seed')) return false;
      if (sourceFilter === 'marketplace' && !s.repoPath?.startsWith('Marketplace/')) return false;
      if (sourceFilter === 'personal' && s.source !== 'personal') return false;
      if (q) {
        return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [filter, sourceFilter, searchQuery, resolvedSkills]);

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
      // Confirm before enabling dangerous skills
      if (isDangerous(skill)) {
        const dangerousPerms = skill.permissions?.filter(p => DANGEROUS_PERMISSIONS.includes(p)) ?? [];
        const permList = dangerousPerms.length > 0 ? dangerousPerms.join(', ') : 'elevated access';
        const confirmed = window.confirm(
          `\u26a0\ufe0f This skill has elevated permissions (${permList}). It runs inside the Docker container. Enable?`
        );
        if (!confirmed) return;
      }

      let model = current.model;
      if (skill.serviceType === 'llm' && !model && skill.defaultModel) {
        model = skill.defaultModel;
      }

      await saveSkill(skill.id, true, model);

      // Only create api_key_request approvals for non-OAuth skills
      // OAuth skills use the CONNECT button on the card instead
      const service = getRequiredService(skill, model);
      if (service && !skill.oauthConfig && !(await hasApiKey(service))) {
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

  const openSkillDetail = useCallback((skill: FullSkillDefinition) => {
    setDetailSkill(skill);
  }, []);

  const handleOpenTest = useCallback((e: React.MouseEvent, skill: FullSkillDefinition) => {
    e.stopPropagation();
    setTestSkill(skill);
  }, []);

  const handleSync = useCallback(async () => {
    setRefreshStatus('refreshing');
    setRefreshMessage('');
    try {
      const result = await seedSkillsFromRepo();
      if (result.total === 0) {
        setRefreshStatus('error');
        setRefreshMessage('NO SKILLS IN MANIFEST');
      } else {
        const upgCount = result.pendingUpgrades.length;
        setRefreshStatus('done');
        setRefreshMessage(`${result.created} NEW, ${result.updated} UPD${upgCount ? `, ${upgCount} UPGRADE${upgCount > 1 ? 'S' : ''}` : ''}`);
        if (upgCount > 0) {
          setPendingUpgrades(result.pendingUpgrades);
          setShowUpgradeDialog(true);
        }
        await reloadSkills();
      }
      // Re-check marketplace status after sync
      const status = getMarketplaceStatus();
      setMarketplaceRegistered(status.registered || status.hasKey);
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

  const handleApplyUpgrades = useCallback(async (selected: PendingUpgrade[]) => {
    await applySkillUpgrades(selected);
    // Remove applied upgrades from pending; keep any unselected ones
    const appliedIds = new Set(selected.map(u => u.skillId));
    setPendingUpgrades(prev => prev.filter(u => !appliedIds.has(u.skillId)));
    setShowUpgradeDialog(false);
    await reloadSkills();
  }, [reloadSkills]);

  // ---------------------------------------------------------------------------
  // Schedule helpers
  // ---------------------------------------------------------------------------

  function computeNextRun(frequency: string, runAtTime: string, runOnDay: number | null): Date {
    const next = new Date();

    if (frequency === 'hourly') {
      // Next hour, at :00
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      return next;
    }

    if (frequency === 'every_4h') {
      // Next 4-hour mark
      const currentHour = next.getHours();
      const nextSlot = Math.ceil((currentHour + 1) / 4) * 4;
      next.setHours(nextSlot, 0, 0, 0);
      if (next <= new Date()) next.setHours(next.getHours() + 4);
      return next;
    }

    const [hours, minutes] = runAtTime.split(':').map(Number);
    next.setHours(hours, minutes, 0, 0);

    if (frequency === 'daily') {
      if (next <= new Date()) next.setDate(next.getDate() + 1);
    } else if (frequency === 'weekly') {
      const targetDay = runOnDay ?? 1;
      const currentDay = next.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0 && next <= new Date()) daysUntil = 7;
      next.setDate(next.getDate() + daysUntil);
    } else if (frequency === 'monthly') {
      const targetDate = runOnDay ?? 1;
      next.setDate(targetDate);
      if (next <= new Date()) {
        next.setMonth(next.getMonth() + 1);
        next.setDate(targetDate);
      }
    }
    return next;
  }

  async function handleSetSchedule(skillId: string, frequency: string, runAtTime: string, runOnDay: number | null, commandName: string) {
    const schedId = `sched-${skillId}-${commandName}`;
    if (frequency === 'off') {
      await deleteSkillSchedule(schedId);
      setSchedules(prev => {
        const existing = (prev[skillId] ?? []).filter(s => s.command_name !== commandName);
        if (existing.length === 0) { const n = { ...prev }; delete n[skillId]; return n; }
        return { ...prev, [skillId]: existing };
      });
      return;
    }
    const nextRun = computeNextRun(frequency, runAtTime, runOnDay);
    const schedule = {
      id: schedId,
      skill_id: skillId,
      command_name: commandName,
      frequency: frequency as 'hourly' | 'every_4h' | 'daily' | 'weekly' | 'monthly',
      run_at_time: runAtTime,
      run_on_day: runOnDay,
      params: {},
      enabled: true,
      next_run_at: nextRun.toISOString(),
    };
    await saveSkillSchedule(schedule);
    const newRow = { ...schedule, last_run_at: null, created_at: new Date().toISOString() } as SkillScheduleRow;
    setSchedules(prev => {
      const existing = (prev[skillId] ?? []).filter(s => s.command_name !== commandName);
      return { ...prev, [skillId]: [...existing, newRow] };
    });
  }

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
          {/* Show upgrade count button when skipped upgrades are available */}
          {pendingUpgrades.length > 0 && !showUpgradeDialog && refreshStatus === 'idle' && (
            <button
              onClick={() => setShowUpgradeDialog(true)}
              className="flex items-center gap-1.5 px-3 py-2 font-pixel text-[7px] tracking-wider border border-cyan-500/40 text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 rounded-md transition-colors"
            >
              <RefreshCw size={10} />
              {pendingUpgrades.length} UPGRADE{pendingUpgrades.length !== 1 ? 'S' : ''}
            </button>
          )}
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
      {/* Marketplace sync notice when not registered */}
      {marketplaceRegistered === false && (
        <div className="mb-2 -mt-4">
          <p className="font-pixel text-[6px] tracking-wider text-amber-400/60 text-right">
            Register on the marketplace to sync skills from other instances
          </p>
        </div>
      )}

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

        <div className="flex items-center rounded-lg border border-zinc-700/50 overflow-hidden flex-shrink-0">
          {(['all', 'official', 'marketplace', 'personal'] as const).map(f => (
            <button
              key={f}
              onClick={() => setSourceFilter(f)}
              className={`relative font-pixel text-[7px] tracking-widest px-4 py-2 transition-colors ${
                sourceFilter === f
                  ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                  : 'bg-zinc-800/40 text-zinc-500 hover:text-zinc-300'
              } ${f !== 'all' ? 'border-l border-zinc-700/50' : ''}`}
            >
              {f.toUpperCase()}
              {f === 'personal' && personalSkillCount > 0 && (
                <span className="absolute -top-1.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-emerald-500 text-[7px] font-bold text-black px-0.5">
                  {personalSkillCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Marketplace status banner */}
      {marketplaceRegistered === false && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-pixel text-[9px] tracking-widest text-amber-400 mb-1">
                  MARKETPLACE: NOT REGISTERED
                </h3>
                <p className="font-mono text-[11px] text-amber-300/70 leading-relaxed">
                  Generate your identity key to register on the Jarvis Marketplace and sync skills.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link
                to="/key"
                className="font-pixel text-[7px] tracking-wider px-3 py-1.5 rounded border border-amber-500/40 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
              >
                SET UP KEY
              </Link>
              <a
                href="https://jarvisinc.app"
                target="_blank"
                rel="noopener noreferrer"
                className="font-pixel text-[7px] tracking-wider px-3 py-1.5 rounded border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors flex items-center gap-1"
              >
                VISIT MARKETPLACE
                <ExternalLink size={8} />
              </a>
            </div>
          </div>
        </div>
      )}
      {marketplaceRegistered === true && (
        <div className="mb-6 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <span className="font-pixel text-[8px] tracking-widest text-emerald-400/80">
                MARKETPLACE: CONNECTED
              </span>
            </div>
            <a
              href="https://jarvisinc.app"
              target="_blank"
              rel="noopener noreferrer"
              className="font-pixel text-[7px] tracking-wider text-zinc-500 hover:text-emerald-400 transition-colors flex items-center gap-1"
            >
              VISIT MARKETPLACE
              <ExternalLink size={8} />
            </a>
          </div>
        </div>
      )}

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

                // Risk level classification
                const dangerous = isDangerous(skill);
                const moderate = isModerateRisk(skill);

                // Card color scheme — risk level overrides when enabled
                const cardBorder = isComingSoon
                  ? 'border-zinc-800'
                  : dangerous
                    ? 'border-red-500/50'
                    : moderate
                      ? 'border-amber-500/50'
                      : needsKey
                        ? 'border-amber-500/30'
                        : isEnabled
                          ? 'border-emerald-500/40'
                          : 'border-zinc-700/50';
                const cardBg = isComingSoon
                  ? 'bg-zinc-900/30'
                  : dangerous
                    ? 'bg-red-500/[0.04]'
                    : moderate
                      ? 'bg-amber-500/[0.04]'
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
                    onClick={() => !isComingSoon && openSkillDetail(skill)}
                  >
                    {/* Source badge */}
                    {skill.source === 'personal' ? (
                      <span className="absolute top-2 right-2 font-pixel text-[6px] tracking-widest px-1.5 py-0.5 rounded text-emerald-400 bg-emerald-500/15">
                        PERSONAL
                      </span>
                    ) : skill.repoPath?.startsWith('Official/') ? (
                      <span className="absolute top-2 right-2 font-pixel text-[5px] tracking-widest text-emerald-500/60">
                        OFFICIAL
                      </span>
                    ) : skill.repoPath?.startsWith('Marketplace/') ? (
                      <span className="absolute top-2 right-2 font-pixel text-[5px] tracking-widest text-amber-400/60">
                        MARKETPLACE
                      </span>
                    ) : skill.source === 'github' ? (
                      <span className="absolute top-2 right-2 font-pixel text-[5px] tracking-widest text-cyan-500/60">
                        REPO
                      </span>
                    ) : null}

                    {/* Risk level badge */}
                    {dangerous && (
                      <span className="absolute top-2 left-2 font-pixel text-[5px] tracking-widest px-1.5 py-0.5 rounded text-red-400 bg-red-500/15 border border-red-500/30">
                        DANGEROUS
                      </span>
                    )}
                    {moderate && (
                      <span className="absolute top-2 left-2 font-pixel text-[5px] tracking-widest px-1.5 py-0.5 rounded text-amber-400 bg-amber-500/15 border border-amber-500/30">
                        CAUTION
                      </span>
                    )}

                    {/* Icon + Title + Toggle row */}
                    <div className={`flex items-start justify-between mb-2 ${dangerous || moderate ? 'mt-4' : ''}`}>
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
                        <div className="flex items-center gap-1.5">
                          {skill.source === 'personal' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Delete personal skill "${skill.name}"? This cannot be undone.`)) {
                                  getSupabase().from('skills').delete().eq('id', skill.id).then(() => {
                                    window.dispatchEvent(new Event('skills-changed'));
                                  });
                                }
                              }}
                              className="p-1 rounded hover:bg-red-500/20 text-zinc-600 hover:text-red-400 transition-colors"
                              title="Delete personal skill"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleSkill(skill); }}
                            className={`w-8 h-4 rounded-full transition-colors duration-200 flex items-center px-0.5 ${toggleColor}`}
                          >
                            <div className={`w-3 h-3 rounded-full bg-white transition-transform duration-200 ${isEnabled ? 'translate-x-3.5' : 'translate-x-0'}`} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Description */}
                    <p className="font-pixel text-[7px] tracking-wider text-zinc-500 leading-relaxed mb-3">
                      {skill.description}
                    </p>

                    {/* Permissions list for risky skills */}
                    {(dangerous || moderate) && skill.permissions && skill.permissions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {skill.permissions.map(p => (
                          <span
                            key={p}
                            className={`font-pixel text-[5px] tracking-wider px-1.5 py-0.5 rounded ${
                              DANGEROUS_PERMISSIONS.includes(p)
                                ? 'text-red-400 bg-red-500/10 border border-red-500/20'
                                : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                            }`}
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    )}

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
                          ) : skill.serviceType === 'none' ? (
                            <span className="font-pixel text-[7px] tracking-wider px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-emerald-400/70">
                              FREE
                            </span>
                          ) : skill.oauthConfig ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); setOauthWizardSkill(skill); }}
                              className={`font-pixel text-[7px] tracking-wider px-2 py-1 rounded border transition-colors ${
                                hasApiKeyCached(skill.apiConfig?.vault_service ?? '')
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                              }`}
                            >
                              {hasApiKeyCached(skill.apiConfig?.vault_service ?? '') ? 'CONNECTED' : 'CONNECT'}
                            </button>
                          ) : (
                            <span className="font-pixel text-[7px] tracking-wider px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
                              {skill.fixedService} API
                            </span>
                          )
                        ) : (
                          <span />
                        )}

                        {/* Status indicator + Test + Schedule buttons */}
                        {isEnabled && (
                          <div className="flex items-center gap-1.5">
                            {skill.commands && skill.commands.length > 0 && (
                              <>
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
                                <button
                                  onClick={e => { e.stopPropagation(); setSchedulePopover(schedulePopover === skill.id ? null : skill.id); }}
                                  className={`p-1 rounded transition-colors ${
                                    schedules[skill.id]?.length
                                      ? 'text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20'
                                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/40'
                                  }`}
                                  title="Schedule this skill"
                                >
                                  <Clock size={10} />
                                </button>
                              </>
                            )}
                            {skill.options && skill.options.length > 0 && (
                              <button
                                onClick={e => { e.stopPropagation(); setOptionsPopover(optionsPopover === skill.id ? null : skill.id); }}
                                className={`p-1 rounded transition-colors ${
                                  Object.keys(skillOptionsMap.get(skill.id) ?? {}).length > 0
                                    ? 'text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
                                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/40'
                                }`}
                                title="Skill options"
                              >
                                <Settings2 size={10} />
                              </button>
                            )}
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${needsKey ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                            {needsKey ? (
                              <span className="font-pixel text-[6px] tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                                KEY NEEDED
                              </span>
                            ) : (
                              <span className="font-pixel text-[6px] tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
                                {skill.serviceType === 'llm' && skill.model ? getServiceForModel(skill.model) : skill.serviceType === 'cli' ? 'CLI' : skill.serviceType === 'none' ? 'READY' : skill.fixedService}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Schedule badges — one per scheduled command */}
                    {schedules[skill.id] && schedules[skill.id].length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {schedules[skill.id].map(sched => (
                          <span key={sched.id} className="font-pixel text-[6px] tracking-wider text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded px-1.5 py-0.5">
                            <Clock size={7} className="inline -mt-0.5 mr-0.5" />
                            {sched.command_name}: {sched.frequency === 'every_4h' ? 'EVERY 4H' : sched.frequency.toUpperCase()}{sched.frequency !== 'hourly' && sched.frequency !== 'every_4h' ? ` \u00b7 ${sched.run_at_time}` : ''}
                            {sched.frequency === 'weekly' && sched.run_on_day != null && ` ${['SUN','MON','TUE','WED','THU','FRI','SAT'][sched.run_on_day!]}`}
                            {sched.frequency === 'monthly' && sched.run_on_day != null && ` D${sched.run_on_day}`}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Schedule popover */}
                    {schedulePopover === skill.id && (
                      <SchedulePopover
                        skill={skill}
                        existingSchedules={schedules[skill.id] ?? []}
                        onSave={handleSetSchedule}
                        onClose={() => setSchedulePopover(null)}
                      />
                    )}

                    {/* Options popover */}
                    {optionsPopover === skill.id && skill.options && (
                      <OptionsPopover
                        skill={skill}
                        currentValues={skillOptionsMap.get(skill.id) ?? {}}
                        onSave={async (values) => {
                          await saveSkillOptions(skill.id, values);
                          setSkillOptionsMap(prev => {
                            const next = new Map(prev);
                            next.set(skill.id, values);
                            return next;
                          });
                        }}
                        onClose={() => setOptionsPopover(null)}
                      />
                    )}

                    {/* Version badge bottom-right */}
                    {skill.version && (
                      <span className={`absolute ${schedules[skill.id]?.length ? 'bottom-6' : 'bottom-2'} right-2 font-pixel text-[5px] tracking-wider text-emerald-500/40`}>
                        v{skill.version}
                      </span>
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

      {/* Skill Upgrade Dialog */}
      {showUpgradeDialog && pendingUpgrades.length > 0 && (
        <SkillUpgradeDialog
          upgrades={pendingUpgrades}
          onApply={handleApplyUpgrades}
          onSkip={() => setShowUpgradeDialog(false)}
        />
      )}

      {/* Skill Detail Panel */}
      {detailSkill && (
        <SkillDetailPanel
          skill={detailSkill}
          onClose={() => setDetailSkill(null)}
          onToggle={(s) => { toggleSkill(s); setDetailSkill(prev => prev ? { ...prev, enabled: !prev.enabled } : null); }}
          onModelChange={(s, m) => { handleModelChange(s, m); setDetailSkill(prev => prev ? { ...prev, model: m } : null); }}
          onTest={(s) => { setDetailSkill(null); setTestSkill(s); }}
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

      {/* Google OAuth Wizard */}
      {oauthWizardSkill?.oauthConfig && (
        <GoogleOAuthWizard
          skillId={oauthWizardSkill.id}
          skillName={oauthWizardSkill.name}
          vaultService={oauthWizardSkill.apiConfig?.vault_service ?? oauthWizardSkill.fixedService ?? 'Google'}
          oauthConfig={oauthWizardSkill.oauthConfig}
          onComplete={() => { setOauthWizardSkill(null); reloadSkills(); refreshVaultCache(); }}
          onClose={() => setOauthWizardSkill(null)}
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

// ===========================================================================
// Schedule Popover
// ===========================================================================

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function SchedulePopover({
  skill,
  existingSchedules,
  onSave,
  onClose,
}: {
  skill: FullSkillDefinition;
  existingSchedules: SkillScheduleRow[];
  onSave: (skillId: string, frequency: string, runAtTime: string, runOnDay: number | null, commandName: string) => void;
  onClose: () => void;
}) {
  const commands = skill.commands ?? [];
  // Commands that already have a schedule
  const scheduledCommands = new Set(existingSchedules.map(s => s.command_name));
  // Commands available for new schedules
  const unscheduledCommands = commands.filter(c => !scheduledCommands.has(c.name));

  const [addingNew, setAddingNew] = useState(existingSchedules.length === 0);
  const [commandName, setCommandName] = useState(unscheduledCommands[0]?.name ?? commands[0]?.name ?? 'default');
  const [frequency, setFrequency] = useState<string>('daily');
  const [runAtTime, setRunAtTime] = useState('09:00');
  const [runOnDay, setRunOnDay] = useState<number | null>(null);

  // When editing an existing schedule
  const [editingCommand, setEditingCommand] = useState<string | null>(null);

  function startEdit(sched: SkillScheduleRow) {
    setEditingCommand(sched.command_name);
    setCommandName(sched.command_name);
    setFrequency(sched.frequency);
    setRunAtTime(sched.run_at_time);
    setRunOnDay(sched.run_on_day);
    setAddingNew(false);
  }

  function startAddNew() {
    setEditingCommand(null);
    setCommandName(unscheduledCommands[0]?.name ?? commands[0]?.name ?? 'default');
    setFrequency('daily');
    setRunAtTime('09:00');
    setRunOnDay(null);
    setAddingNew(true);
  }

  return (
    <div
      className="absolute right-0 bottom-full mb-1 z-50 w-72 bg-jarvis-surface border border-jarvis-border rounded-lg shadow-xl overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-jarvis-border bg-zinc-800/60">
        <span className="font-pixel text-[7px] tracking-widest text-cyan-400">SCHEDULES</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors text-xs leading-none">&times;</button>
      </div>

      <div className="p-3 space-y-2">
        {/* Existing schedules list */}
        {existingSchedules.length > 0 && (
          <div className="space-y-1">
            {existingSchedules.map(sched => (
              <div key={sched.id} className="flex items-center justify-between px-2 py-1.5 rounded bg-zinc-800/40 border border-zinc-700/30">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[10px] text-cyan-400 truncate">{sched.command_name}</span>
                  <span className="font-pixel text-[6px] tracking-wider text-zinc-400">
                    {sched.frequency === 'every_4h' ? '4H' : sched.frequency.toUpperCase().slice(0, 3)}
                    {sched.frequency !== 'hourly' && sched.frequency !== 'every_4h' ? ` ${sched.run_at_time}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => startEdit(sched)}
                    className="font-pixel text-[6px] tracking-wider text-zinc-500 hover:text-cyan-400 transition-colors px-1"
                    title="Edit schedule"
                  >
                    EDIT
                  </button>
                  <button
                    onClick={() => onSave(skill.id, 'off', sched.run_at_time, sched.run_on_day, sched.command_name)}
                    className="font-pixel text-[6px] tracking-wider text-zinc-500 hover:text-red-400 transition-colors px-1"
                    title="Remove schedule"
                  >
                    &times;
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add / Edit form */}
        {(addingNew || editingCommand) && (
          <div className="space-y-2 pt-1 border-t border-zinc-700/30">
            <div className="font-pixel text-[6px] tracking-widest text-zinc-500">
              {editingCommand ? 'EDIT SCHEDULE' : 'ADD SCHEDULE'}
            </div>

            {/* Command select */}
            {!editingCommand && (
              <div>
                <label className="font-pixel text-[6px] tracking-widest text-zinc-500 block mb-1">COMMAND</label>
                <select
                  value={commandName}
                  onChange={e => setCommandName(e.target.value)}
                  className="w-full appearance-none font-pixel text-[7px] tracking-wider bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-cyan-500/40 cursor-pointer"
                >
                  {(unscheduledCommands.length > 0 ? unscheduledCommands : commands).map(c => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Frequency */}
            <div>
              <label className="font-pixel text-[6px] tracking-widest text-zinc-500 block mb-1">FREQUENCY</label>
              <select
                value={frequency}
                onChange={e => {
                  setFrequency(e.target.value);
                  if (e.target.value === 'weekly' && runOnDay === null) setRunOnDay(1);
                  if (e.target.value === 'monthly' && runOnDay === null) setRunOnDay(1);
                }}
                className="w-full appearance-none font-pixel text-[7px] tracking-wider bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-cyan-500/40 cursor-pointer"
              >
                <option value="hourly">HOURLY</option>
                <option value="every_4h">EVERY 4H</option>
                <option value="daily">DAILY</option>
                <option value="weekly">WEEKLY</option>
                <option value="monthly">MONTHLY</option>
              </select>
            </div>

            {/* Time picker */}
            {frequency !== 'hourly' && frequency !== 'every_4h' && (
              <div>
                <label className="font-pixel text-[6px] tracking-widest text-zinc-500 block mb-1">RUN AT</label>
                <input
                  type="time"
                  value={runAtTime}
                  onChange={e => setRunAtTime(e.target.value)}
                  className="w-full font-pixel text-[7px] tracking-wider bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-cyan-500/40"
                />
              </div>
            )}

            {/* Day picker — weekly */}
            {frequency === 'weekly' && (
              <div>
                <label className="font-pixel text-[6px] tracking-widest text-zinc-500 block mb-1">DAY OF WEEK</label>
                <select
                  value={runOnDay ?? 1}
                  onChange={e => setRunOnDay(Number(e.target.value))}
                  className="w-full appearance-none font-pixel text-[7px] tracking-wider bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-cyan-500/40 cursor-pointer"
                >
                  {DAY_NAMES.map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Day picker — monthly */}
            {frequency === 'monthly' && (
              <div>
                <label className="font-pixel text-[6px] tracking-widest text-zinc-500 block mb-1">DAY OF MONTH</label>
                <select
                  value={runOnDay ?? 1}
                  onChange={e => setRunOnDay(Number(e.target.value))}
                  className="w-full appearance-none font-pixel text-[7px] tracking-wider bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-cyan-500/40 cursor-pointer"
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Save / Cancel */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => {
                  onSave(skill.id, frequency, runAtTime, frequency === 'daily' || frequency === 'hourly' || frequency === 'every_4h' ? null : runOnDay, commandName);
                  setAddingNew(false);
                  setEditingCommand(null);
                }}
                className="flex-1 font-pixel text-[7px] tracking-wider px-3 py-1.5 rounded transition-colors bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/25"
              >
                SAVE
              </button>
              <button
                onClick={() => { setAddingNew(false); setEditingCommand(null); }}
                className="font-pixel text-[7px] tracking-wider px-3 py-1.5 rounded transition-colors text-zinc-500 border border-zinc-700 hover:text-zinc-300 hover:border-zinc-600"
              >
                CANCEL
              </button>
            </div>
          </div>
        )}

        {/* Add button — show when not adding and there are unscheduled commands */}
        {!addingNew && !editingCommand && unscheduledCommands.length > 0 && (
          <button
            onClick={startAddNew}
            className="w-full font-pixel text-[7px] tracking-wider px-3 py-1.5 rounded transition-colors text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/10 border-dashed"
          >
            + ADD SCHEDULE
          </button>
        )}

        {/* All commands scheduled message */}
        {!addingNew && !editingCommand && unscheduledCommands.length === 0 && existingSchedules.length > 0 && (
          <div className="font-pixel text-[6px] tracking-wider text-zinc-600 text-center py-1">
            ALL COMMANDS SCHEDULED
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Options Popover
// ===========================================================================

function OptionsPopover({
  skill,
  currentValues,
  onSave,
  onClose,
}: {
  skill: FullSkillDefinition;
  currentValues: Record<string, unknown>;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const options = skill.options ?? [];
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const opt of options) {
      initial[opt.key] = currentValues[opt.key] ?? opt.default;
    }
    return initial;
  });

  async function handleToggle(key: string, newVal: unknown) {
    const updated = { ...values, [key]: newVal };
    setValues(updated);
    await onSave(updated);
  }

  return (
    <div
      className="absolute right-0 bottom-full mb-1 z-50 w-72 bg-jarvis-surface border border-jarvis-border rounded-lg shadow-xl overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-jarvis-border bg-zinc-800/60">
        <span className="font-pixel text-[7px] tracking-widest text-emerald-400">OPTIONS</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors text-xs leading-none">&times;</button>
      </div>

      <div className="p-3 space-y-3">
        {options.map(opt => (
          <div key={opt.key}>
            {opt.type === 'boolean' && (
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0 pr-2">
                  <div className="font-pixel text-[7px] tracking-wider text-zinc-200">{opt.label}</div>
                  {opt.description && (
                    <div className="font-pixel text-[6px] tracking-wider text-zinc-500 mt-0.5 leading-relaxed">{opt.description}</div>
                  )}
                </div>
                <button
                  onClick={() => handleToggle(opt.key, !values[opt.key])}
                  className={`w-8 h-4 rounded-full transition-colors duration-200 flex items-center px-0.5 flex-shrink-0 ${
                    values[opt.key] ? 'bg-emerald-500' : 'bg-zinc-700'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full bg-white transition-transform duration-200 ${values[opt.key] ? 'translate-x-3.5' : 'translate-x-0'}`} />
                </button>
              </div>
            )}
            {opt.type === 'select' && opt.choices && (
              <div>
                <div className="font-pixel text-[7px] tracking-wider text-zinc-200 mb-1">{opt.label}</div>
                {opt.description && (
                  <div className="font-pixel text-[6px] tracking-wider text-zinc-500 mb-1 leading-relaxed">{opt.description}</div>
                )}
                <select
                  value={(values[opt.key] as string) ?? ''}
                  onChange={e => handleToggle(opt.key, e.target.value)}
                  className="w-full appearance-none font-pixel text-[7px] tracking-wider bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-emerald-500/40 cursor-pointer"
                >
                  {opt.choices.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
            {opt.type === 'string' && (
              <div>
                <div className="font-pixel text-[7px] tracking-wider text-zinc-200 mb-1">{opt.label}</div>
                {opt.description && (
                  <div className="font-pixel text-[6px] tracking-wider text-zinc-500 mb-1 leading-relaxed">{opt.description}</div>
                )}
                <input
                  type="text"
                  value={(values[opt.key] as string) ?? ''}
                  onChange={e => setValues(prev => ({ ...prev, [opt.key]: e.target.value }))}
                  onBlur={() => onSave(values)}
                  className="w-full font-pixel text-[7px] tracking-wider bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-emerald-500/40"
                />
              </div>
            )}
            {opt.type === 'number' && (
              <div>
                <div className="font-pixel text-[7px] tracking-wider text-zinc-200 mb-1">{opt.label}</div>
                {opt.description && (
                  <div className="font-pixel text-[6px] tracking-wider text-zinc-500 mb-1 leading-relaxed">{opt.description}</div>
                )}
                <input
                  type="number"
                  value={(values[opt.key] as number) ?? 0}
                  onChange={e => setValues(prev => ({ ...prev, [opt.key]: Number(e.target.value) }))}
                  onBlur={() => onSave(values)}
                  className="w-full font-pixel text-[7px] tracking-wider bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-emerald-500/40"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
