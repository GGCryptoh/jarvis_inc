import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Settings, Trash2, AlertTriangle, Brain, Server, User, Building2, Crown,
  Search, CheckSquare, Square, MessageCircle, MessageSquare, ChevronDown, Filter, X,
  Wand2, RotateCcw, Save, ChevronRight, FileText, Loader, KeyRound, Copy, Check,
  Zap, RefreshCw, Blocks, Loader2, Lock, Unlock, Package,
} from 'lucide-react';
import { getSetting, setSetting, loadCEO, logAudit, getAllPrompts, setPrompt, deletePrompt, getVaultEntryByService } from '../../lib/database';
import type { CEORow } from '../../lib/database';
import { getSupabase, hasSupabaseConfig, pingSupabase } from '../../lib/supabase';
import { getMemories, deleteMemory, queryMemories, chatWithMemories, consolidateDailyMemories } from '../../lib/memory';
import { hasInstanceKey, loadKeyFromLocalStorage, decryptPrivateKey } from '../../lib/jarvisKey';
import { getMarketplaceStatus, getCachedRawPrivateKey, cacheRawPrivateKey, clearSigningCache, getSigningExpiry, getUnlockDuration, setUnlockDuration, persistKeyToVault, type UnlockDuration } from '../../lib/marketplaceClient';
import type { MemoryRow } from '../../lib/memory';

const categoryColors: Record<string, string> = {
  fact: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  decision: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  preference: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  insight: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  reminder: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  founder_profile: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
};

const categoryDotColors: Record<string, string> = {
  fact: 'bg-blue-400',
  decision: 'bg-purple-400',
  preference: 'bg-amber-400',
  insight: 'bg-cyan-400',
  reminder: 'bg-pink-400',
  founder_profile: 'bg-yellow-400',
};

const categoryLabels: Record<string, string> = {
  fact: 'Fact',
  decision: 'Decision',
  preference: 'Preference',
  insight: 'Insight',
  reminder: 'Reminder',
  founder_profile: 'Profile',
};

const ALL_CATEGORIES = ['fact', 'decision', 'preference', 'insight', 'reminder', 'founder_profile'] as const;

const PAGE_SIZE = 25;

const PROMPT_REGISTRY: Array<{ key: string; label: string; description: string; group: string }> = [
  { key: 'ceo-system-core', label: 'CEO System Prompt', description: 'Core CEO identity, behavioral rules, communication style', group: 'CEO' },
  { key: 'ceo-management-actions', label: 'Management Actions', description: 'Instructions for hire/fire/schedule/mission tool calls', group: 'CEO' },
  { key: 'ceo-tool-usage-flow', label: 'Tool Usage Flow', description: 'Decision tree for when to use skills vs respond directly', group: 'CEO' },
  { key: 'ceo-skill-factory', label: 'Skill Factory Rules', description: 'Instructions for creating new skills dynamically', group: 'CEO' },
  { key: 'agent-system', label: 'Agent System Prompt', description: 'Template for agent chat personalities and work requests', group: 'Agents' },
  { key: 'memory-extraction', label: 'Memory Extraction', description: 'Rules for extracting memories from conversations', group: 'Memory' },
  { key: 'memory-summarization', label: 'Conversation Summary', description: 'How to summarize conversation history', group: 'Memory' },
  { key: 'memory-consolidation', label: 'Topic Consolidation', description: 'How to merge related memories into summaries', group: 'Memory' },
  { key: 'memory-daily-digest', label: 'Daily Digest', description: 'Format for daily memory digest lines', group: 'Memory' },
  { key: 'memory-collateral-extraction', label: 'Collateral Extraction', description: 'Extract findings from task execution results', group: 'Memory' },
  { key: 'memory-chat-system', label: 'Memory Chat', description: 'System prompt for memory Q&A assistant', group: 'Memory' },
  { key: 'mission-synthesis', label: 'Mission Synthesis', description: 'How to synthesize multi-task mission results', group: 'Missions' },
  { key: 'mission-evaluation', label: 'Mission Evaluation', description: 'Scoring criteria for evaluating mission results', group: 'Missions' },
  { key: 'skill-execution-fallback', label: 'Skill Execution', description: 'Fallback system prompt for LLM-based skill execution', group: 'Skills' },
];

const PROMPT_GROUPS = ['CEO', 'Agents', 'Memory', 'Missions', 'Skills'];

function CopyPublicKeyButton({ publicKey }: { publicKey: string }) {
  const [copied, setCopied] = useState(false);
  if (!publicKey) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(publicKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="font-pixel text-[7px] tracking-wider text-cyan-400/60 hover:text-cyan-400 transition-colors flex items-center gap-0.5"
      title="Copy public key for marketplace use"
    >
      {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
      {copied ? 'COPIED' : 'COPY KEY'}
    </button>
  );
}

export default function SettingsView() {
  const navigate = useNavigate();

  // System info
  const [orgName, setOrgName] = useState<string | null>(null);
  const [founderCallsign, setFounderCallsign] = useState<string | null>(null);
  const [ceo, setCeo] = useState<CEORow | null>(null);
  const [supabaseConnected, setSupabaseConnected] = useState<boolean | null>(null);

  // Memory management
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<MemoryRow | null>(null);
  const [showClearAll, setShowClearAll] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [clearingAll, setClearingAll] = useState(false);

  // Preferences
  const [autoCloseMission, setAutoCloseMission] = useState(false);
  const [ceoAutoSummary, setCeoAutoSummary] = useState(true);

  // Category filter
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Bulk edit mode
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);

  // Intelligence management
  const [prompts, setPrompts] = useState<Array<{ key: string; value: string }>>([]);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [showResetAllPrompts, setShowResetAllPrompts] = useState(false);
  const [resetPromptsConfirm, setResetPromptsConfirm] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  // Memory chat (LLM-powered)
  const [chatQuery, setChatQuery] = useState('');
  const [chatResults, setChatResults] = useState<MemoryRow[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSearching, setChatSearching] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatSelectedIds, setChatSelectedIds] = useState<Set<string>>(new Set());
  const chatInputRef = useRef<HTMLInputElement>(null);

  // Consolidation dialog
  const [showConsolidateDialog, setShowConsolidateDialog] = useState(false);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [consolidationResult, setConsolidationResult] = useState<Awaited<ReturnType<typeof consolidateDailyMemories>> | null>(null);

  // Marketplace section state
  const [mktCheckingForum, setMktCheckingForum] = useState(false);
  const [mktRefreshingProfile, setMktRefreshingProfile] = useState(false);
  const [mktSyncingSkills, setMktSyncingSkills] = useState(false);
  const [mktError, setMktError] = useState<string | null>(null);

  // Collapsible sections
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const toggleSection = (id: string) => setExpandedSections(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Unlock state (inline in Marketplace section)
  const [sessionUnlocked, setSessionUnlocked] = useState(false);
  const [showUnlockForm, setShowUnlockForm] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockDuration, setUnlockDurationState] = useState<UnlockDuration>(getUnlockDuration);
  const [vaultSyncing, setVaultSyncing] = useState(false);
  const [vaultSyncResult, setVaultSyncResult] = useState<'success' | 'failed' | null>(null);

  // Versions section
  const [versionInfo, setVersionInfo] = useState<{local: string; skills: string; remote?: string; changelog?: string; checking: boolean; checked: boolean; error?: string}>({
    local: __APP_VERSION__, skills: '0.3.2', checking: false, checked: false
  });
  const [sidecarKeyStatus, setSidecarKeyStatus] = useState<'checking' | 'synced' | 'not_synced'>('checking');

  const refreshMemories = useCallback(async () => {
    try {
      const mems = await getMemories(200);
      setMemories(mems);
    } catch {
      setMemories([]);
    }
  }, []);

  // Load system info on mount
  useEffect(() => {
    async function load() {
      try {
        const [org, founder, ceoRow] = await Promise.all([
          getSetting('org_name'),
          getSetting('founder_name'),
          loadCEO(),
        ]);
        setOrgName(org);
        setFounderCallsign(founder);
        setCeo(ceoRow);
      } catch { /* DB not ready */ }

      // Check Supabase connection
      if (hasSupabaseConfig()) {
        const ok = await pingSupabase();
        setSupabaseConnected(ok);
      } else {
        setSupabaseConnected(false);
      }

      // Load preferences
      try {
        const autoClose = await getSetting('auto_close_on_approve');
        setAutoCloseMission(autoClose === 'true');
        const autoSummary = await getSetting('ceo_auto_summary');
        setCeoAutoSummary(autoSummary !== 'false'); // default true
      } catch { /* ignore */ }

      // Load intelligence prompts
      try {
        const allPrompts = await getAllPrompts();
        setPrompts(allPrompts);
      } catch { /* ignore */ }

      // Check sidecar key status
      try {
        const entry = await getVaultEntryByService('marketplace-signing');
        setSidecarKeyStatus(entry ? 'synced' : 'not_synced');
      } catch { setSidecarKeyStatus('not_synced'); }
    }
    load();
    refreshMemories();
  }, [refreshMemories]);

  // Check initial unlock state
  useEffect(() => {
    setSessionUnlocked(!!getCachedRawPrivateKey());
  }, []);

  // Preference toggles
  async function toggleAutoCloseMission() {
    const newVal = !autoCloseMission;
    setAutoCloseMission(newVal);
    await setSetting('auto_close_on_approve', newVal ? 'true' : 'false');
    await logAudit(null, 'SETTING_CHANGED', `auto_close_on_approve → ${newVal}`, 'info');
  }

  async function toggleCeoAutoSummary() {
    const newVal = !ceoAutoSummary;
    setCeoAutoSummary(newVal);
    await setSetting('ceo_auto_summary', newVal ? 'true' : 'false');
    await logAudit(null, 'SETTING_CHANGED', `ceo_auto_summary → ${newVal}`, 'info');
  }

  // Delete single memory
  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    await deleteMemory(deleteTarget.id);
    await logAudit(null, 'MEMORY_DELETED', `Deleted memory: "${deleteTarget.content.slice(0, 50)}..."`, 'warning');
    setDeleteTarget(null);
    refreshMemories();
  }

  // Bulk delete
  async function handleBulkDelete() {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    try {
      for (const id of selected) {
        await deleteMemory(id);
      }
      await logAudit(null, 'MEMORY_BULK_DELETED', `Bulk deleted ${selected.size} memories`, 'warning');
      setSelected(new Set());
      setBulkMode(false);
      refreshMemories();
    } catch (err) {
      console.error('Bulk delete failed:', err);
    }
    setBulkDeleting(false);
  }

  // Clear all memories
  async function handleClearAll() {
    if (clearConfirmText !== 'CLEAR') return;
    setClearingAll(true);
    try {
      await getSupabase().from('org_memory').delete().neq('id', '');
      await logAudit(null, 'MEMORY_CLEARED', `Cleared all ${memories.length} memories`, 'warning');
      setMemories([]);
      setShowClearAll(false);
      setClearConfirmText('');
    } catch (err) {
      console.error('Failed to clear memories:', err);
    }
    setClearingAll(false);
  }

  // Memory chat — LLM-powered
  async function handleChatSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!chatQuery.trim()) return;
    const userMsg = chatQuery.trim();
    setChatQuery('');
    setChatSearching(true);
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    try {
      const { answer, relevantMemories } = await chatWithMemories(userMsg);
      setChatMessages(prev => [...prev, { role: 'assistant', content: answer }]);
      setChatResults(relevantMemories);
      setChatSelectedIds(new Set());
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Failed to query memories.' }]);
      setChatResults([]);
    }
    setChatSearching(false);
  }

  async function handleChatResultDelete(id: string) {
    await deleteMemory(id);
    setChatResults(prev => prev.filter(m => m.id !== id));
    setChatSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    refreshMemories();
  }

  async function handleBulkChatDelete() {
    for (const id of chatSelectedIds) {
      await deleteMemory(id);
    }
    setChatResults(prev => prev.filter(m => !chatSelectedIds.has(m.id)));
    setChatSelectedIds(new Set());
    refreshMemories();
  }

  function toggleChatSelect(id: string) {
    setChatSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Intelligence prompt handlers
  function toggleGroup(group: string) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  async function handlePromptSave(key: string) {
    setPromptSaving(true);
    await setPrompt(key, editBuffer);
    setPrompts(prev => {
      const existing = prev.find(p => p.key === key);
      if (existing) return prev.map(p => p.key === key ? { ...p, value: editBuffer } : p);
      return [...prev, { key, value: editBuffer }];
    });
    setEditingPrompt(null);
    setEditBuffer('');
    await logAudit(null, 'PROMPT_EDITED', `Edited intelligence prompt: ${key}`, 'info');
    setPromptSaving(false);
  }

  async function handlePromptReset(key: string) {
    await deletePrompt(key);
    setPrompts(prev => prev.filter(p => p.key !== key));
    setEditingPrompt(null);
    await logAudit(null, 'PROMPT_RESET', `Reset intelligence prompt to default: ${key}`, 'warning');
  }

  async function handleResetAllPrompts() {
    if (resetPromptsConfirm !== 'RESET') return;
    for (const reg of PROMPT_REGISTRY) {
      await deletePrompt(reg.key);
    }
    setPrompts([]);
    setShowResetAllPrompts(false);
    setResetPromptsConfirm('');
    await logAudit(null, 'PROMPTS_RESET_ALL', 'Reset all intelligence prompts to defaults', 'warning');
  }

  // Unlock/lock handlers
  async function handleUnlockSession() {
    const existingKey = loadKeyFromLocalStorage();
    if (!existingKey || !unlockPassword) return;
    setUnlocking(true);
    setUnlockError('');
    try {
      const rawPrivateKey = await decryptPrivateKey(existingKey.encryptedPrivateKey, unlockPassword);
      setUnlockDuration(unlockDuration);
      cacheRawPrivateKey(rawPrivateKey);
      setSessionUnlocked(true);
      setShowUnlockForm(false);
      setUnlockPassword('');
      // Re-attempt vault sync on every unlock (covers case where key predates vault sync)
      persistKeyToVault(rawPrivateKey).catch(err => console.warn('[Settings] Vault sync on unlock failed:', err));
    } catch {
      setUnlockError('Wrong password');
    }
    setUnlocking(false);
  }

  function handleLockSession() {
    clearSigningCache();
    setSessionUnlocked(false);
  }

  function handleDurationChange(d: UnlockDuration) {
    setUnlockDurationState(d);
    if (sessionUnlocked) {
      setUnlockDuration(d);
    }
  }

  // Derived: prompt counts
  const customizedPromptCount = prompts.filter(p => PROMPT_REGISTRY.some(r => r.key === p.key)).length;

  // Derived: filtered & paginated memories
  const filteredMemories = useMemo(() => {
    if (categoryFilter === 'all') return memories;
    return memories.filter(m => m.category === categoryFilter);
  }, [memories, categoryFilter]);

  const paginatedMemories = useMemo(() => {
    return filteredMemories.slice(0, page * PAGE_SIZE);
  }, [filteredMemories, page]);

  const hasMore = paginatedMemories.length < filteredMemories.length;

  // Derived: category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of ALL_CATEGORIES) {
      counts[cat] = 0;
    }
    for (const mem of memories) {
      if (counts[mem.category] !== undefined) {
        counts[mem.category]++;
      } else {
        counts[mem.category] = 1;
      }
    }
    return counts;
  }, [memories]);

  // Focus chat input when memory chat opens
  useEffect(() => {
    if (chatOpen) {
      setTimeout(() => chatInputRef.current?.focus(), 50);
    }
  }, [chatOpen]);

  // Reset page when filter changes
  useEffect(() => {
    setPage(1);
  }, [categoryFilter]);

  // Bulk select helpers
  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const visibleIds = paginatedMemories.map(m => m.id);
    const allSelected = visibleIds.every(id => selected.has(id));
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        for (const id of visibleIds) next.add(id);
        return next;
      });
    }
  }

  const allVisibleSelected = paginatedMemories.length > 0 && paginatedMemories.every(m => selected.has(m.id));

  return (
    <div className="min-h-screen bg-jarvis-bg p-5">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-600/15 border border-emerald-500/25">
          <Settings size={24} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-jarvis-text tracking-wide">SETTINGS</h1>
          <p className="text-sm text-jarvis-muted">System Configuration & Memory Management</p>
        </div>
      </div>

      {/* ================================================================ */}
      {/* Row 1: System Info (left) + Preferences (right) -- 2-column     */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 mb-6">
        {/* Left: System Info */}
        <div>
          <h2 className="font-pixel text-[12px] tracking-widest text-emerald-400 mb-3">SYSTEM INFO</h2>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 h-[calc(100%-2rem)]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Org name */}
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <Building2 size={18} className="text-blue-400" />
                </div>
                <div>
                  <span className="font-pixel text-[10px] tracking-wider text-zinc-500 block">ORGANIZATION</span>
                  <span className="font-pixel text-[10px] tracking-wider text-jarvis-text">
                    {orgName ?? '---'}
                  </span>
                </div>
              </div>

              {/* Founder callsign */}
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <User size={18} className="text-purple-400" />
                </div>
                <div>
                  <span className="font-pixel text-[10px] tracking-wider text-zinc-500 block">FOUNDER</span>
                  <span className="font-pixel text-[10px] tracking-wider text-jarvis-text">
                    {founderCallsign ?? '---'}
                  </span>
                </div>
              </div>

              {/* CEO name */}
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <Crown size={18} className="text-amber-400" />
                </div>
                <div>
                  <span className="font-pixel text-[10px] tracking-wider text-zinc-500 block">CEO</span>
                  <span className="font-pixel text-[10px] tracking-wider text-jarvis-text">
                    {ceo?.name ?? '---'}
                  </span>
                </div>
              </div>

              {/* Supabase status */}
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <Server size={18} className="text-emerald-400" />
                </div>
                <div>
                  <span className="font-pixel text-[10px] tracking-wider text-zinc-500 block">SUPABASE</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        supabaseConnected === null
                          ? 'bg-zinc-500 animate-pulse'
                          : supabaseConnected
                            ? 'bg-emerald-500'
                            : 'bg-red-500'
                      }`}
                    />
                    <span className="font-pixel text-[10px] tracking-wider text-jarvis-text">
                      {supabaseConnected === null
                        ? 'CHECKING...'
                        : supabaseConnected
                          ? 'CONNECTED'
                          : 'DISCONNECTED'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Marketplace Identity */}
              {(() => {
                const keyExists = hasInstanceKey();
                const keyData = keyExists ? loadKeyFromLocalStorage() : null;
                const mStatus = getMarketplaceStatus();
                return (
                  <div
                    className={`flex items-center gap-3 ${!keyExists ? 'cursor-pointer' : ''}`}
                    onClick={!keyExists ? () => navigate('/key') : undefined}
                  >
                    <div className={`flex items-center justify-center w-9 h-9 rounded-lg border ${
                      keyExists
                        ? 'bg-cyan-500/10 border-cyan-500/20'
                        : 'bg-red-500/10 border-red-500/20 animate-pulse'
                    }`}>
                      <KeyRound size={18} className={keyExists ? 'text-cyan-400' : 'text-red-400'} />
                    </div>
                    <div>
                      <span className="font-pixel text-[10px] tracking-wider text-zinc-500 block">MARKETPLACE KEY</span>
                      {keyExists ? (
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${mStatus.registered ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                          <span className="font-pixel text-[10px] tracking-wider text-jarvis-text">
                            {keyData?.publicKeyHash?.substring(0, 12)}...
                          </span>
                          <CopyPublicKeyButton publicKey={keyData?.publicKey ?? ''} />
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate('/key'); }}
                            className="font-pixel text-[7px] tracking-wider text-cyan-400/60 hover:text-cyan-400 transition-colors ml-1"
                          >
                            MANAGE
                          </button>
                        </div>
                      ) : (
                        <span className="font-pixel text-[10px] tracking-wider text-red-400">
                          NOT SET — CLICK TO GENERATE
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Right: Preferences */}
        <div>
          <h2 className="font-pixel text-[12px] tracking-widest text-emerald-400 mb-3">PREFERENCES</h2>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 space-y-5 h-[calc(100%-2rem)]">
            {/* Auto-close mission on approve */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="font-pixel text-[10px] tracking-wider text-jarvis-text block">
                  AUTO-CLOSE MISSION
                </span>
                <span className="font-pixel text-[9px] tracking-wider text-zinc-500">
                  Close missions when results approved
                </span>
              </div>
              <button
                onClick={toggleAutoCloseMission}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                  autoCloseMission ? 'bg-emerald-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    autoCloseMission ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="border-t border-zinc-800" />

            {/* CEO auto-summary */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="font-pixel text-[10px] tracking-wider text-jarvis-text block">
                  CEO AUTO-SUMMARY
                </span>
                <span className="font-pixel text-[9px] tracking-wider text-zinc-500">
                  Auto-summarize & extract memories
                </span>
              </div>
              <button
                onClick={toggleCeoAutoSummary}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                  ceoAutoSummary ? 'bg-emerald-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    ceoAutoSummary ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* MARKETPLACE & IDENTITY                                           */}
      {/* ================================================================ */}
      {(() => {
        const mktStatus = getMarketplaceStatus();
        return (
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <MessageSquare size={16} className="text-cyan-400" />
              <h2 className="font-pixel text-[12px] tracking-widest text-cyan-400">MARKETPLACE & IDENTITY</h2>
              <span className={`font-pixel text-[8px] tracking-wider px-2 py-0.5 rounded ${mktStatus.registered ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-zinc-700/50 text-zinc-500 border border-zinc-700'}`}>
                {mktStatus.registered ? 'REGISTERED' : 'NOT REGISTERED'}
              </span>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              {/* Status row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
                  <div className="font-pixel text-[6px] tracking-wider text-zinc-500 mb-1">INSTANCE ID</div>
                  <div className="font-mono text-[10px] text-zinc-300 truncate">
                    {mktStatus.instanceId ? `${mktStatus.instanceId.slice(0, 12)}...` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
                  <div className="font-pixel text-[6px] tracking-wider text-zinc-500 mb-1">NICKNAME</div>
                  <div className="font-mono text-[10px] text-zinc-300 truncate">
                    {mktStatus.nickname || '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
                  <div className="font-pixel text-[6px] tracking-wider text-zinc-500 mb-1">STATUS</div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${mktStatus.registered ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                    <span className="font-mono text-[10px] text-zinc-300">{mktStatus.registered ? 'Online' : 'Offline'}</span>
                  </div>
                </div>
              </div>

              {/* Signing status */}
              <div className="flex items-center gap-3 mb-3 mt-1 px-1">
                <span className={`w-2 h-2 rounded-full ${sessionUnlocked ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
                <span className="font-pixel text-[8px] tracking-wider text-zinc-400">
                  {sessionUnlocked ? `SIGNING ${getSigningExpiry().label}` : 'SESSION LOCKED'}
                </span>
                {!sessionUnlocked ? (
                  <button onClick={() => setShowUnlockForm(!showUnlockForm)}
                    className="font-pixel text-[7px] tracking-wider px-2 py-0.5 rounded border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition-colors">
                    <span className="flex items-center gap-1"><Lock size={9} /> UNLOCK</span>
                  </button>
                ) : (
                  <button onClick={handleLockSession}
                    className="font-pixel text-[7px] tracking-wider px-2 py-0.5 rounded border border-red-500/30 text-red-400/60 hover:bg-red-500/10 transition-colors">
                    <span className="flex items-center gap-1"><Unlock size={9} /> LOCK</span>
                  </button>
                )}
              </div>

              {/* Unlock form */}
              {showUnlockForm && !sessionUnlocked && (
                <div className="mb-4 border border-zinc-700/50 rounded-lg bg-zinc-800/30 p-3">
                  {/* Duration selector */}
                  <div className="mb-3">
                    <div className="font-pixel text-[7px] text-zinc-500 tracking-wider mb-1.5">UNLOCK FOR</div>
                    <div className="flex gap-1">
                      {([
                        { val: 'session' as UnlockDuration, label: 'SESSION' },
                        { val: 'day' as UnlockDuration, label: '1 DAY' },
                        { val: 'week' as UnlockDuration, label: '1 WEEK' },
                        { val: 'month' as UnlockDuration, label: '1 MONTH' },
                        { val: 'forever' as UnlockDuration, label: 'FOREVER' },
                      ]).map(opt => (
                        <button
                          key={opt.val}
                          onClick={() => handleDurationChange(opt.val)}
                          className={`flex-1 font-pixel text-[6px] tracking-wider py-1 rounded border transition-colors ${
                            unlockDuration === opt.val
                              ? opt.val === 'forever'
                                ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                                : 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                              : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {unlockDuration === 'forever' && (
                      <div className="font-pixel text-[6px] text-amber-400/60 tracking-wider mt-1">
                        Key stored in browser until manually locked
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={unlockPassword}
                      onChange={(e) => { setUnlockPassword(e.target.value); setUnlockError(''); }}
                      placeholder="Master password"
                      autoFocus
                      className="flex-1 bg-jarvis-bg border border-zinc-700 text-jarvis-text font-mono text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-zinc-700"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleUnlockSession(); }}
                    />
                    <button
                      onClick={handleUnlockSession}
                      disabled={!unlockPassword || unlocking}
                      className={`font-pixel text-[8px] tracking-wider px-3 py-2 rounded-lg border transition-colors ${
                        unlockPassword && !unlocking
                          ? 'border-emerald-500 text-emerald-400 hover:bg-emerald-500/10 cursor-pointer'
                          : 'border-zinc-700 text-zinc-500 cursor-not-allowed'
                      }`}
                    >
                      {unlocking ? '...' : 'UNLOCK'}
                    </button>
                  </div>
                  {unlockError && (
                    <div className="font-pixel text-[8px] text-red-400 tracking-wider mt-2">{unlockError}</div>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  disabled={mktCheckingForum}
                  onClick={async () => {
                    setMktCheckingForum(true);
                    setMktError(null);
                    try {
                      const { triggerForumCheckNow } = await import('../../lib/ceoDecisionEngine');
                      await triggerForumCheckNow();
                    } catch (e) { setMktError(`Forum check: ${e instanceof Error ? e.message : String(e)}`); }
                    setMktCheckingForum(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 font-pixel text-[7px] tracking-wider text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors disabled:opacity-50"
                >
                  {mktCheckingForum ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
                  CHECK FORUM NOW
                </button>
                <button
                  disabled={mktRefreshingProfile || !mktStatus.registered}
                  onClick={async () => {
                    setMktRefreshingProfile(true);
                    setMktError(null);
                    try {
                      const { refreshMarketplaceProfile } = await import('../../lib/ceoDecisionEngine');
                      await refreshMarketplaceProfile();
                    } catch (e) { setMktError(`Profile refresh: ${e instanceof Error ? e.message : String(e)}`); }
                    setMktRefreshingProfile(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 font-pixel text-[7px] tracking-wider text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-lg transition-colors disabled:opacity-50"
                >
                  {mktRefreshingProfile ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  REFRESH PROFILE
                </button>
                <button
                  disabled={mktSyncingSkills}
                  onClick={async () => {
                    setMktSyncingSkills(true);
                    setMktError(null);
                    try {
                      const { seedSkillsFromRepo } = await import('../../lib/skillResolver');
                      await seedSkillsFromRepo();
                      window.dispatchEvent(new Event('skills-changed'));
                    } catch (e) { setMktError(`Skill sync: ${e instanceof Error ? e.message : String(e)}`); }
                    setMktSyncingSkills(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 font-pixel text-[7px] tracking-wider text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-lg transition-colors disabled:opacity-50"
                >
                  {mktSyncingSkills ? <Loader2 size={10} className="animate-spin" /> : <Blocks size={10} />}
                  SYNC SKILLS
                </button>
                <button
                  disabled={vaultSyncing || !sessionUnlocked}
                  onClick={async () => {
                    setVaultSyncing(true);
                    setVaultSyncResult(null);
                    try {
                      const ok = await persistKeyToVault();
                      setVaultSyncResult(ok ? 'success' : 'failed');
                    } catch { setVaultSyncResult('failed'); }
                    setVaultSyncing(false);
                    setTimeout(() => setVaultSyncResult(null), 3000);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 font-pixel text-[7px] tracking-wider text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg transition-colors disabled:opacity-50"
                  title={!sessionUnlocked ? 'Unlock signing first' : 'Sync signing key to vault for sidecar use'}
                >
                  {vaultSyncing ? <Loader2 size={10} className="animate-spin" /> : <KeyRound size={10} />}
                  {vaultSyncResult === 'success' ? 'SYNCED!' : vaultSyncResult === 'failed' ? 'FAILED' : 'SYNC KEY TO VAULT'}
                </button>
                {mktError && (
                  <div className="w-full mt-2 p-2 rounded bg-red-500/10 border border-red-500/25">
                    <p className="font-mono text-[10px] text-red-400">{mktError}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ================================================================ */}
      {/* JARVIS INC VERSIONS                                              */}
      {/* ================================================================ */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <Package size={16} className="text-emerald-400" />
          <h2 className="font-pixel text-[12px] tracking-widest text-emerald-400">JARVIS INC VERSIONS</h2>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
              <div className="font-pixel text-[6px] tracking-wider text-zinc-500 mb-1">APP</div>
              <div className="font-mono text-[10px] text-zinc-300">v{versionInfo.local}</div>
            </div>
            <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
              <div className="font-pixel text-[6px] tracking-wider text-zinc-500 mb-1">SKILLS</div>
              <div className="font-mono text-[10px] text-zinc-300">v{versionInfo.skills}</div>
            </div>
            <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
              <div className="font-pixel text-[6px] tracking-wider text-zinc-500 mb-1">MARKETPLACE</div>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${getMarketplaceStatus().registered ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                <span className="font-mono text-[10px] text-zinc-300">
                  {getMarketplaceStatus().registered ? 'CONNECTED' : 'OFFLINE'}
                </span>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
              <div className="font-pixel text-[6px] tracking-wider text-zinc-500 mb-1">SIDECAR</div>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${sidecarKeyStatus === 'synced' ? 'bg-emerald-400' : sidecarKeyStatus === 'checking' ? 'bg-zinc-600 animate-pulse' : 'bg-amber-400'}`} />
                <span className={`font-mono text-[10px] ${sidecarKeyStatus === 'synced' ? 'text-emerald-400' : sidecarKeyStatus === 'checking' ? 'text-zinc-500' : 'text-amber-400'}`}>
                  {sidecarKeyStatus === 'synced' ? 'KEY SYNCED' : sidecarKeyStatus === 'checking' ? '...' : 'NOT SYNCED'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              disabled={versionInfo.checking}
              onClick={async () => {
                setVersionInfo(prev => ({ ...prev, checking: true, error: undefined }));
                try {
                  const res = await fetch('https://jarvisinc.app/api/version');
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const data = await res.json();
                  setVersionInfo(prev => ({ ...prev, remote: data.latest_app_version, changelog: data.changelog, checking: false, checked: true }));
                } catch (e) {
                  setVersionInfo(prev => ({ ...prev, checking: false, checked: true, error: e instanceof Error ? e.message : String(e) }));
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 font-pixel text-[7px] tracking-wider text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg transition-colors disabled:opacity-50"
            >
              {versionInfo.checking ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              CHECK FOR UPDATES
            </button>
            {versionInfo.checked && !versionInfo.error && versionInfo.remote && (
              <span className="font-pixel text-[8px] tracking-wider">
                {versionInfo.remote === versionInfo.local ? (
                  <span className="text-emerald-400">Up to date</span>
                ) : (
                  <span className="text-amber-400">Update available: v{versionInfo.remote} — run <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-amber-300">npm run update</code></span>
                )}
              </span>
            )}
            {versionInfo.error && (
              <span className="font-pixel text-[8px] tracking-wider text-red-400">
                Check failed: {versionInfo.error}
              </span>
            )}
          </div>
          {versionInfo.checked && !versionInfo.error && versionInfo.remote && versionInfo.remote !== versionInfo.local && versionInfo.changelog && (
            <details className="mt-3">
              <summary className="font-pixel text-[8px] tracking-wider text-cyan-400 cursor-pointer hover:text-cyan-300 transition-colors">
                WHAT&apos;S NEW IN v{versionInfo.remote}
              </summary>
              <div className="mt-2 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30 font-mono text-[10px] text-zinc-400 leading-relaxed whitespace-pre-wrap">
                {versionInfo.changelog}
              </div>
            </details>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* Intelligence Management                                          */}
      {/* ================================================================ */}
      <div className="mb-6">
        <button onClick={() => toggleSection('intelligence')}
          className="w-full flex items-center gap-3 mb-3 hover:opacity-80 transition-opacity">
          <ChevronRight size={14} className={`text-emerald-400 transition-transform ${expandedSections.has('intelligence') ? 'rotate-90' : ''}`} />
          <Wand2 size={16} className="text-emerald-400" />
          <h2 className="font-pixel text-[12px] tracking-widest text-emerald-400">INTELLIGENCE MANAGEMENT</h2>
          <span className="font-pixel text-[10px] tracking-wider text-zinc-500">
            {PROMPT_REGISTRY.length} prompts
          </span>
          {customizedPromptCount > 0 && (
            <span className="font-pixel text-[10px] tracking-wider text-amber-400">
              {customizedPromptCount} customized
            </span>
          )}
        </button>

        {expandedSections.has('intelligence') && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          {PROMPT_GROUPS.map(group => {
            const groupPrompts = PROMPT_REGISTRY.filter(r => r.group === group);
            const groupCustomized = groupPrompts.filter(r => prompts.some(p => p.key === r.key)).length;
            const isOpen = openGroups.has(group);

            return (
              <div key={group} className="border-b border-zinc-800/50 last:border-b-0">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors"
                >
                  <ChevronRight
                    size={14}
                    className={`text-zinc-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  />
                  <span className="font-pixel text-[10px] tracking-wider text-jarvis-text">{group.toUpperCase()}</span>
                  <span className="font-pixel text-[9px] tracking-wider text-zinc-600">({groupPrompts.length})</span>
                  {groupCustomized > 0 && (
                    <span className="ml-auto font-pixel text-[9px] tracking-wider text-amber-400">
                      {groupCustomized} customized
                    </span>
                  )}
                </button>

                {/* Group items */}
                {isOpen && (
                  <div className="border-t border-zinc-800/30">
                    {groupPrompts.map(reg => {
                      const stored = prompts.find(p => p.key === reg.key);
                      const isCustomized = !!stored;
                      const isEditing = editingPrompt === reg.key;

                      return (
                        <div key={reg.key} className="border-b border-zinc-800/30 last:border-b-0">
                          {/* Prompt row */}
                          <div
                            className={`flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer ${
                              isEditing ? 'bg-white/[0.02]' : ''
                            }`}
                            onClick={() => {
                              if (isEditing) {
                                setEditingPrompt(null);
                                setEditBuffer('');
                              } else {
                                setEditingPrompt(reg.key);
                                setEditBuffer(stored?.value ?? '');
                              }
                            }}
                          >
                            <FileText size={14} className="text-zinc-600 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="font-pixel text-[10px] tracking-wider text-jarvis-text block">
                                {reg.label}
                              </span>
                              <span className="font-pixel text-[9px] tracking-wider text-zinc-500">
                                {reg.description}
                              </span>
                            </div>
                            <span
                              className={`px-2 py-0.5 text-[9px] font-semibold tracking-wider rounded-md border flex-shrink-0 ${
                                isCustomized
                                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                  : 'bg-zinc-500/10 text-zinc-500 border-zinc-700'
                              }`}
                            >
                              {isCustomized ? 'CUSTOMIZED' : 'DEFAULT'}
                            </span>
                            <ChevronRight
                              size={14}
                              className={`text-zinc-600 transition-transform flex-shrink-0 ${
                                isEditing ? 'rotate-90' : ''
                              }`}
                            />
                          </div>

                          {/* Expanded editor */}
                          {isEditing && (
                            <div className="px-5 pb-4 pt-1">
                              <textarea
                                value={editBuffer}
                                onChange={e => setEditBuffer(e.target.value)}
                                placeholder="Enter custom prompt content... (leave empty and save to set an empty override, or Reset to Default to remove override)"
                                className="w-full bg-jarvis-bg border border-zinc-700 text-jarvis-text text-[11px] font-mono px-4 py-3 rounded-lg focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-zinc-700 resize-y"
                                style={{ minHeight: '200px', maxHeight: '400px' }}
                              />
                              <div className="flex items-center gap-2 mt-3">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePromptSave(reg.key);
                                  }}
                                  disabled={promptSaving}
                                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-semibold tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Save size={12} />
                                  {promptSaving ? 'SAVING...' : 'SAVE'}
                                </button>
                                {isCustomized && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePromptReset(reg.key);
                                    }}
                                    className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-semibold tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg hover:bg-amber-500/20 transition-colors"
                                  >
                                    <RotateCcw size={12} />
                                    RESET TO DEFAULT
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingPrompt(null);
                                    setEditBuffer('');
                                  }}
                                  className="px-4 py-2 text-[10px] font-semibold tracking-wider text-zinc-400 border border-zinc-700 rounded-lg hover:text-zinc-200 hover:border-zinc-600 transition-colors"
                                >
                                  CANCEL
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Reset all button */}
          {customizedPromptCount > 0 && (
            <div className="px-5 py-4 border-t border-zinc-800 flex justify-end">
              <button
                onClick={() => setShowResetAllPrompts(true)}
                className="px-4 py-2 text-[11px] font-semibold tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg hover:bg-amber-500/20 transition-colors"
              >
                RESET ALL TO DEFAULTS
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* Row 2: Memory Metric Boxes                                       */}
      {/* ================================================================ */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => toggleSection('memory')}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <ChevronRight size={14} className={`text-emerald-400 transition-transform ${expandedSections.has('memory') ? 'rotate-90' : ''}`} />
            <h2 className="font-pixel text-[12px] tracking-widest text-emerald-400">MEMORY MANAGEMENT</h2>
            <span className="font-pixel text-[10px] tracking-wider text-zinc-500">
              {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
            </span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConsolidationResult(null);
              setIsConsolidating(false);
              setShowConsolidateDialog(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors ml-auto"
          >
            <Brain size={12} />
            CONSOLIDATE
          </button>
        </div>

        {/* Stat cards row — always visible */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 mb-4">
          {/* Total */}
          <button
            onClick={() => setCategoryFilter('all')}
            className={`bg-zinc-900/50 border rounded-lg p-3 text-center transition-colors cursor-pointer ${
              categoryFilter === 'all' ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <span className="text-2xl font-bold text-jarvis-text block">{memories.length}</span>
            <span className="font-pixel text-[9px] tracking-wider text-zinc-500">TOTAL</span>
          </button>

          {/* Per category */}
          {ALL_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(categoryFilter === cat ? 'all' : cat)}
              className={`bg-zinc-900/50 border rounded-lg p-3 text-center transition-colors cursor-pointer ${
                categoryFilter === cat
                  ? `${categoryColors[cat]}`
                  : 'border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <span className={`w-2 h-2 rounded-full ${categoryDotColors[cat]}`} />
                <span className="text-2xl font-bold text-jarvis-text">{categoryCounts[cat] ?? 0}</span>
              </div>
              <span className="font-pixel text-[9px] tracking-wider text-zinc-500 uppercase">
                {categoryLabels[cat]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {expandedSections.has('memory') && (<>
      {/* ================================================================ */}
      {/* Row 3: Memory Table (left ~70%) + Chat Panel (right ~30%)        */}
      {/* ================================================================ */}
      <div className="flex gap-5 mb-6">
        {/* Left: Memory table area */}
        <div className={chatOpen ? 'flex-1 min-w-0' : 'w-full'}>
          {/* Category filter pills + bulk edit button + chat toggle */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Filter size={14} className="text-zinc-500" />

            {/* ALL pill */}
            <button
              onClick={() => setCategoryFilter('all')}
              className={`px-3 py-1 text-[10px] font-semibold tracking-wider rounded-full border transition-colors ${
                categoryFilter === 'all'
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
              }`}
            >
              ALL
            </button>

            {/* Category pills */}
            {ALL_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1 text-[10px] font-semibold tracking-wider rounded-full border transition-colors ${
                  categoryFilter === cat
                    ? categoryColors[cat]
                    : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
                }`}
              >
                {categoryLabels[cat].toUpperCase()}
              </button>
            ))}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Memory chat toggle */}
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold tracking-wider rounded-full border transition-colors ${
                chatOpen
                  ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-400'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
              }`}
            >
              <MessageCircle size={12} />
              MEMORY CHAT
            </button>

            {/* Bulk edit toggle */}
            {memories.length > 0 && (
              <button
                onClick={() => {
                  setBulkMode(!bulkMode);
                  if (bulkMode) setSelected(new Set());
                }}
                className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold tracking-wider rounded-full border transition-colors ${
                  bulkMode
                    ? 'border-red-500/50 bg-red-500/15 text-red-400'
                    : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
                }`}
              >
                {bulkMode ? <X size={12} /> : <CheckSquare size={12} />}
                {bulkMode ? 'CANCEL' : 'BULK EDIT'}
              </button>
            )}
          </div>

          {/* Memory table */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            {filteredMemories.length === 0 ? (
              <div className="p-12 text-center">
                <Brain size={32} className="text-jarvis-muted mx-auto mb-4 opacity-40" />
                <p className="font-pixel text-[10px] tracking-wider text-zinc-500">
                  {categoryFilter === 'all'
                    ? 'No organizational memories stored yet.'
                    : `No ${categoryLabels[categoryFilter]?.toLowerCase() ?? categoryFilter} memories found.`}
                </p>
                <p className="font-pixel text-[10px] tracking-wider text-zinc-600 mt-1">
                  {categoryFilter === 'all'
                    ? 'The CEO extracts memories from your conversations automatically.'
                    : 'Try selecting a different category or ALL.'}
                </p>
              </div>
            ) : (
              <>
                {/* Table header */}
                <div className={`grid gap-4 px-5 py-3 border-b border-zinc-800 bg-white/[0.02] ${
                  bulkMode
                    ? 'grid-cols-[36px_100px_1fr_80px_120px_120px_60px]'
                    : 'grid-cols-[100px_1fr_80px_120px_120px_60px]'
                }`}>
                  {bulkMode && (
                    <button
                      onClick={toggleSelectAll}
                      className="flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
                      title={allVisibleSelected ? 'Deselect all' : 'Select all visible'}
                    >
                      {allVisibleSelected
                        ? <CheckSquare size={14} className="text-emerald-400" />
                        : <Square size={14} />}
                    </button>
                  )}
                  <span className="font-pixel text-[10px] tracking-wider text-zinc-500">CATEGORY</span>
                  <span className="font-pixel text-[10px] tracking-wider text-zinc-500">CONTENT</span>
                  <span className="font-pixel text-[10px] tracking-wider text-zinc-500">IMP.</span>
                  <span className="font-pixel text-[10px] tracking-wider text-zinc-500">TAGS</span>
                  <span className="font-pixel text-[10px] tracking-wider text-zinc-500">CREATED</span>
                  <span className="font-pixel text-[10px] tracking-wider text-zinc-500 text-right">DEL</span>
                </div>

                {/* Rows */}
                {paginatedMemories.map((mem, idx) => (
                  <div
                    key={mem.id}
                    className={[
                      `grid gap-4 px-5 py-3 border-b border-zinc-800/50 items-center hover:bg-white/[0.02] transition-colors`,
                      bulkMode
                        ? 'grid-cols-[36px_100px_1fr_80px_120px_120px_60px]'
                        : 'grid-cols-[100px_1fr_80px_120px_120px_60px]',
                      idx % 2 === 1 ? 'bg-white/[0.01]' : '',
                      selected.has(mem.id) ? 'bg-emerald-500/5' : '',
                    ].join(' ')}
                  >
                    {/* Checkbox (bulk mode) */}
                    {bulkMode && (
                      <button
                        onClick={() => toggleSelect(mem.id)}
                        className="flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {selected.has(mem.id)
                          ? <CheckSquare size={14} className="text-emerald-400" />
                          : <Square size={14} />}
                      </button>
                    )}

                    {/* Category badge */}
                    <div>
                      <span
                        className={`inline-block px-2 py-0.5 text-[9px] font-semibold rounded-md border uppercase tracking-wider ${
                          categoryColors[mem.category] ?? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
                        }`}
                      >
                        {categoryLabels[mem.category] ?? mem.category}
                      </span>
                    </div>

                    {/* Content (truncated) */}
                    <span
                      className="font-pixel text-[10px] tracking-wider text-zinc-300 truncate"
                      title={mem.content}
                    >
                      {mem.content.length > 100 ? mem.content.slice(0, 100) + '...' : mem.content}
                    </span>

                    {/* Importance */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500/60 rounded-full"
                          style={{ width: `${mem.importance * 10}%` }}
                        />
                      </div>
                      <span className="font-pixel text-[10px] tracking-wider text-zinc-500">{mem.importance}</span>
                    </div>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1 overflow-hidden">
                      {mem.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 text-[8px] bg-white/[0.05] border border-white/[0.08] rounded text-zinc-500 truncate max-w-[55px]"
                        >
                          {tag}
                        </span>
                      ))}
                      {mem.tags.length > 2 && (
                        <span className="text-[8px] text-zinc-600">+{mem.tags.length - 2}</span>
                      )}
                    </div>

                    {/* Created */}
                    <span className="font-pixel text-[10px] tracking-wider text-zinc-500 font-mono">
                      {mem.created_at?.slice(0, 10) ?? '---'}
                    </span>

                    {/* Delete */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => setDeleteTarget(mem)}
                        className="flex items-center justify-center w-7 h-7 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Show More button */}
                {hasMore && (
                  <div className="px-5 py-4 text-center border-t border-zinc-800/50">
                    <button
                      onClick={() => setPage(p => p + 1)}
                      className="inline-flex items-center gap-2 px-5 py-2 text-[10px] font-semibold tracking-wider text-zinc-400 border border-zinc-700 rounded-lg hover:text-zinc-200 hover:border-zinc-600 transition-colors"
                    >
                      <ChevronDown size={14} />
                      SHOW MORE ({filteredMemories.length - paginatedMemories.length} remaining)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Clear all button */}
          {memories.length > 0 && (
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowClearAll(true)}
                className="px-4 py-2 text-[11px] font-semibold tracking-wider text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg hover:bg-red-500/20 transition-colors"
              >
                CLEAR ALL MEMORIES
              </button>
            </div>
          )}
        </div>

        {/* Right: Memory Search Chat Panel */}
        {chatOpen && (
          <div className="w-[340px] flex-shrink-0 flex flex-col">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg flex flex-col h-[600px]">
              {/* Chat header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <Search size={14} className="text-cyan-400" />
                  <span className="font-pixel text-[10px] tracking-wider text-cyan-400">MEMORY CHAT</span>
                </div>
                <button
                  onClick={() => setChatOpen(false)}
                  className="text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Chat conversation + results area */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {chatMessages.length === 0 && !chatSearching && (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4">
                    <Brain size={28} className="text-zinc-700 mb-3" />
                    <p className="font-pixel text-[10px] tracking-wider text-zinc-600">
                      Ask questions about your memories.
                    </p>
                    <p className="font-pixel text-[9px] tracking-wider text-zinc-700 mt-1">
                      The LLM will answer using your organizational memories as context.
                    </p>
                  </div>
                )}

                {/* Chat messages */}
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`rounded-lg p-2.5 ${
                      msg.role === 'user'
                        ? 'bg-cyan-500/10 border border-cyan-500/20 ml-6'
                        : 'bg-zinc-800/60 border border-zinc-700/40 mr-6'
                    }`}
                  >
                    <span className="font-pixel text-[8px] tracking-wider text-zinc-500 block mb-1">
                      {msg.role === 'user' ? 'YOU' : 'MEMORY ASSISTANT'}
                    </span>
                    <p className="font-pixel text-[10px] tracking-wider text-zinc-300 leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </p>
                  </div>
                ))}

                {chatSearching && (
                  <div className="flex items-center justify-center py-4">
                    <span className="font-pixel text-[10px] tracking-wider text-cyan-400 animate-pulse">
                      THINKING...
                    </span>
                  </div>
                )}

                {/* Relevant memory cards with checkboxes */}
                {chatResults.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    <div className="flex items-center justify-between px-1">
                      <span className="font-pixel text-[8px] tracking-wider text-zinc-600">
                        RELEVANT MEMORIES ({chatResults.length})
                      </span>
                      <button
                        onClick={() => {
                          if (chatSelectedIds.size === chatResults.length) setChatSelectedIds(new Set());
                          else setChatSelectedIds(new Set(chatResults.map(m => m.id)));
                        }}
                        className="font-pixel text-[8px] tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {chatSelectedIds.size === chatResults.length ? 'DESELECT ALL' : 'SELECT ALL'}
                      </button>
                    </div>
                    {chatResults.map(mem => (
                      <div
                        key={mem.id}
                        className={`bg-zinc-800/50 border rounded-lg p-2.5 group cursor-pointer transition-colors ${
                          chatSelectedIds.has(mem.id) ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-zinc-700/50 hover:border-zinc-600'
                        }`}
                        onClick={() => toggleChatSelect(mem.id)}
                      >
                        <div className="flex items-start gap-2">
                          <div className="mt-0.5 flex-shrink-0">
                            {chatSelectedIds.has(mem.id)
                              ? <CheckSquare size={12} className="text-cyan-400" />
                              : <Square size={12} className="text-zinc-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`inline-block px-1.5 py-0.5 text-[7px] font-semibold rounded border uppercase tracking-wider ${categoryColors[mem.category] ?? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'}`}>
                                {categoryLabels[mem.category] ?? mem.category}
                              </span>
                              <span className="font-pixel text-[8px] text-zinc-600">IMP: {mem.importance}</span>
                            </div>
                            <p className="font-pixel text-[9px] tracking-wider text-zinc-400 leading-relaxed line-clamp-2">
                              {mem.content}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bulk action bar */}
              {chatSelectedIds.size > 0 && (
                <div className="px-3 py-2 border-t border-zinc-800 flex items-center justify-between">
                  <span className="font-pixel text-[9px] tracking-wider text-zinc-400">
                    {chatSelectedIds.size} SELECTED
                  </span>
                  <button
                    onClick={handleBulkChatDelete}
                    className="px-3 py-1.5 text-[9px] font-semibold tracking-wider text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg hover:bg-red-500/20 transition-colors"
                  >
                    DELETE SELECTED
                  </button>
                </div>
              )}

              {/* Chat input */}
              <form onSubmit={handleChatSearch} className="p-3 border-t border-zinc-800">
                <div className="flex gap-2">
                  <input
                    ref={chatInputRef}
                    type="text"
                    value={chatQuery}
                    onChange={e => setChatQuery(e.target.value)}
                    placeholder="Ask about your memories..."
                    className="flex-1 bg-jarvis-bg border border-zinc-700 text-jarvis-text text-[11px] font-pixel tracking-wider px-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500/50 transition-colors placeholder:text-zinc-700"
                  />
                  <button
                    type="submit"
                    disabled={chatSearching || !chatQuery.trim()}
                    className="flex items-center justify-center w-9 h-9 bg-cyan-500/10 border border-cyan-500/25 rounded-lg text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Search size={14} />
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* Bulk edit floating action bar                                     */}
      {/* ================================================================ */}
      {bulkMode && selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-4 px-6 py-3 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl shadow-black/40">
          <span className="font-pixel text-[10px] tracking-wider text-zinc-400">
            {selected.size} SELECTED
          </span>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="px-5 py-2 text-[11px] font-semibold tracking-wider text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {bulkDeleting ? 'DELETING...' : `DELETE SELECTED (${selected.size})`}
          </button>
          <button
            onClick={() => {
              setBulkMode(false);
              setSelected(new Set());
            }}
            className="px-4 py-2 text-[11px] font-semibold tracking-wider text-zinc-400 border border-zinc-700 rounded-lg hover:text-zinc-200 hover:border-zinc-600 transition-colors"
          >
            CANCEL
          </button>
        </div>
      )}
      </>)}

      {/* ================================================================ */}
      {/* Modals                                                            */}
      {/* ================================================================ */}

      {/* Delete single memory confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative z-10 bg-jarvis-surface border border-red-500/20 rounded-xl w-full max-w-md mx-4 shadow-2xl">
            <div className="px-6 py-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                  <AlertTriangle size={20} className="text-red-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-jarvis-text">Delete Memory</h3>
                  <p className="text-xs text-jarvis-muted truncate max-w-[300px]">
                    {deleteTarget.content}
                  </p>
                </div>
              </div>

              <p className="text-sm text-jarvis-muted mb-4">
                Are you sure you want to delete this memory? This action cannot be undone.
              </p>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="px-4 py-2 text-sm text-jarvis-muted hover:text-jarvis-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="px-5 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg hover:bg-red-500/20 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset all prompts confirmation */}
      {showResetAllPrompts && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setShowResetAllPrompts(false);
              setResetPromptsConfirm('');
            }}
          />
          <div className="relative z-10 bg-jarvis-surface border border-amber-500/30 rounded-xl w-full max-w-md mx-4 shadow-2xl">
            <div className="px-6 py-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center">
                  <RotateCcw size={20} className="text-amber-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-amber-400">RESET ALL PROMPTS</h3>
                  <p className="text-xs text-jarvis-muted">
                    This will reset all {customizedPromptCount} customized prompts to defaults.
                  </p>
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-4">
                <p className="text-sm text-amber-300 font-medium mb-3">
                  All custom prompt overrides will be permanently deleted. The system will revert to hardcoded defaults.
                </p>
                <label className="block text-xs font-medium text-amber-400/80 uppercase tracking-wider mb-1.5">
                  Type RESET to confirm
                </label>
                <input
                  type="text"
                  value={resetPromptsConfirm}
                  onChange={(e) => setResetPromptsConfirm(e.target.value)}
                  placeholder="RESET"
                  className="w-full bg-jarvis-bg border border-amber-500/30 text-jarvis-text text-sm font-mono px-3 py-2.5 rounded-lg focus:outline-none focus:border-amber-500/60 transition-colors placeholder:text-zinc-700"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowResetAllPrompts(false);
                    setResetPromptsConfirm('');
                  }}
                  className="px-4 py-2 text-sm text-jarvis-muted hover:text-jarvis-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResetAllPrompts}
                  disabled={resetPromptsConfirm !== 'RESET'}
                  className="px-5 py-2 text-sm font-medium text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  RESET ALL
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Consolidation dialog */}
      {showConsolidateDialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { if (!isConsolidating) setShowConsolidateDialog(false); }}
          />
          <div className="relative z-10 bg-jarvis-surface border border-emerald-500/20 rounded-xl w-full max-w-md mx-4 shadow-2xl">
            <div className="px-6 py-5">
              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <Brain size={20} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-emerald-400">CONSOLIDATE MEMORIES</h3>
                  <p className="text-xs text-jarvis-muted">
                    Merge older memories per category via LLM
                  </p>
                </div>
              </div>

              {/* State A: Ready */}
              {!isConsolidating && !consolidationResult && (
                <>
                  <p className="text-sm text-jarvis-muted mb-4">
                    Consolidation groups all memories older than today by category and uses the LLM to produce a single summary per category. Originals are archived.
                  </p>
                  <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 mb-4">
                    <span className="font-pixel text-[9px] tracking-wider text-zinc-500 block mb-2">CURRENT COUNTS</span>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {ALL_CATEGORIES.map(cat => (
                        <div key={cat} className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${categoryDotColors[cat]}`} />
                            <span className="font-pixel text-[10px] tracking-wider text-zinc-400">
                              {categoryLabels[cat]}
                            </span>
                          </div>
                          <span className="font-pixel text-[10px] tracking-wider text-jarvis-text font-bold">
                            {categoryCounts[cat] ?? 0}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-800">
                      <span className="font-pixel text-[10px] tracking-wider text-zinc-400">Total</span>
                      <span className="font-pixel text-[10px] tracking-wider text-jarvis-text font-bold">{memories.length}</span>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setShowConsolidateDialog(false)}
                      className="px-4 py-2 text-sm text-jarvis-muted hover:text-jarvis-text transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        setIsConsolidating(true);
                        try {
                          const result = await consolidateDailyMemories();
                          setConsolidationResult(result);
                        } catch (err) {
                          console.error('Consolidation failed:', err);
                          setConsolidationResult({ consolidated: 0, deleted: 0, topicCount: 0, beforeCounts: {}, afterCounts: {} });
                        }
                        await refreshMemories();
                        setIsConsolidating(false);
                      }}
                      className="px-5 py-2 text-sm font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors"
                    >
                      RUN CONSOLIDATION
                    </button>
                  </div>
                </>
              )}

              {/* State B: Running */}
              {isConsolidating && (
                <div className="flex flex-col items-center py-8">
                  <Loader size={28} className="text-emerald-400 animate-spin mb-4" />
                  <span className="font-pixel text-[10px] tracking-wider text-emerald-400 animate-pulse">
                    CONSOLIDATING...
                  </span>
                  <span className="font-pixel text-[9px] tracking-wider text-zinc-500 mt-1">
                    Sending memories to LLM for consolidation
                  </span>
                </div>
              )}

              {/* State C: Done */}
              {!isConsolidating && consolidationResult && (() => {
                const bc = consolidationResult.beforeCounts;
                const ac = consolidationResult.afterCounts;
                const allCats = [...new Set([...Object.keys(bc), ...Object.keys(ac), ...ALL_CATEGORIES])];
                const totalBefore = Object.values(bc).reduce((s, n) => s + n, 0);
                const totalAfter = Object.values(ac).reduce((s, n) => s + n, 0);

                return (
                  <>
                    {consolidationResult.consolidated === 0 ? (
                      <p className="text-sm text-zinc-400 mb-4">
                        Nothing to consolidate — no categories had 2+ memories older than today.
                      </p>
                    ) : (
                      <p className="text-sm text-emerald-300 mb-4">
                        Consolidated {consolidationResult.deleted} memories into {consolidationResult.topicCount} category {consolidationResult.topicCount === 1 ? 'summary' : 'summaries'}.
                      </p>
                    )}

                    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden mb-4">
                      {/* Table header */}
                      <div className="grid grid-cols-[1fr_60px_60px_60px] gap-2 px-3 py-2 border-b border-zinc-800 bg-white/[0.02]">
                        <span className="font-pixel text-[9px] tracking-wider text-zinc-500">CATEGORY</span>
                        <span className="font-pixel text-[9px] tracking-wider text-zinc-500 text-right">BEFORE</span>
                        <span className="font-pixel text-[9px] tracking-wider text-zinc-500 text-right">AFTER</span>
                        <span className="font-pixel text-[9px] tracking-wider text-zinc-500 text-right">DELTA</span>
                      </div>

                      {/* Category rows */}
                      {ALL_CATEGORIES.filter(cat => (bc[cat] ?? 0) > 0 || (ac[cat] ?? 0) > 0).map(cat => {
                        const before = bc[cat] ?? 0;
                        const after = ac[cat] ?? 0;
                        const delta = after - before;
                        return (
                          <div key={cat} className="grid grid-cols-[1fr_60px_60px_60px] gap-2 px-3 py-1.5 border-b border-zinc-800/50 items-center">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${categoryDotColors[cat] ?? 'bg-zinc-400'}`} />
                              <span className="font-pixel text-[10px] tracking-wider text-zinc-300">
                                {categoryLabels[cat] ?? cat}
                              </span>
                            </div>
                            <span className="font-pixel text-[10px] tracking-wider text-zinc-400 text-right">{before}</span>
                            <span className="font-pixel text-[10px] tracking-wider text-jarvis-text text-right font-bold">{after}</span>
                            <span className={`font-pixel text-[10px] tracking-wider text-right font-bold ${
                              delta < 0 ? 'text-emerald-400' : delta > 0 ? 'text-amber-400' : 'text-zinc-500'
                            }`}>
                              {delta > 0 ? `+${delta}` : delta === 0 ? '—' : delta}
                            </span>
                          </div>
                        );
                      })}

                      {/* Total row */}
                      <div className="grid grid-cols-[1fr_60px_60px_60px] gap-2 px-3 py-2 bg-white/[0.02] items-center">
                        <span className="font-pixel text-[10px] tracking-wider text-jarvis-text font-bold">TOTAL</span>
                        <span className="font-pixel text-[10px] tracking-wider text-zinc-400 text-right">{totalBefore}</span>
                        <span className="font-pixel text-[10px] tracking-wider text-jarvis-text text-right font-bold">{totalAfter}</span>
                        <span className={`font-pixel text-[10px] tracking-wider text-right font-bold ${
                          totalAfter - totalBefore < 0 ? 'text-emerald-400' : 'text-zinc-500'
                        }`}>
                          {totalAfter - totalBefore > 0 ? `+${totalAfter - totalBefore}` : totalAfter - totalBefore === 0 ? '—' : totalAfter - totalBefore}
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        onClick={() => setShowConsolidateDialog(false)}
                        className="px-5 py-2 text-sm font-medium text-jarvis-muted hover:text-jarvis-text border border-zinc-700 rounded-lg hover:border-zinc-600 transition-colors"
                      >
                        CLOSE
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Clear all memories confirmation */}
      {showClearAll && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setShowClearAll(false);
              setClearConfirmText('');
            }}
          />
          <div className="relative z-10 bg-jarvis-surface border border-red-500/30 rounded-xl w-full max-w-md mx-4 shadow-2xl">
            <div className="px-6 py-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                  <AlertTriangle size={20} className="text-red-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-red-400">CLEAR ALL MEMORIES</h3>
                  <p className="text-xs text-jarvis-muted">
                    This will permanently delete all {memories.length} memories.
                  </p>
                </div>
              </div>

              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4">
                <p className="text-sm text-red-300 font-medium mb-3">
                  This is a destructive action. All organizational memories will be permanently lost.
                </p>
                <label className="block text-xs font-medium text-red-400/80 uppercase tracking-wider mb-1.5">
                  Type CLEAR to confirm
                </label>
                <input
                  type="text"
                  value={clearConfirmText}
                  onChange={(e) => setClearConfirmText(e.target.value)}
                  placeholder="CLEAR"
                  className="w-full bg-jarvis-bg border border-red-500/30 text-jarvis-text text-sm font-mono px-3 py-2.5 rounded-lg focus:outline-none focus:border-red-500/60 transition-colors placeholder:text-zinc-700"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowClearAll(false);
                    setClearConfirmText('');
                  }}
                  className="px-4 py-2 text-sm text-jarvis-muted hover:text-jarvis-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearAll}
                  disabled={clearConfirmText !== 'CLEAR' || clearingAll}
                  className="px-5 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {clearingAll ? 'CLEARING...' : 'CLEAR ALL'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
