import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Lock, Plus, Pencil, Trash2, X, AlertTriangle, Mail, Send, MessageCircle, Phone, Bell, Key, Unlock } from 'lucide-react';
import TelegramSetupWizard from './TelegramSetupWizard';
import {
  loadVaultEntries,
  saveVaultEntry,
  updateVaultEntry,
  deleteVaultEntry,
  getEntitiesUsingService,
  loadChannels,
  saveChannel,
  deleteChannel,
  logAudit,
} from '../../lib/database';
import type { VaultRow, ChannelRow } from '../../lib/database';
import { SERVICE_KEY_HINTS } from '../../lib/models';
import { hasInstanceKey } from '../../lib/jarvisKey';
import { getSigningExpiry } from '../../lib/marketplaceClient';

const TYPE_OPTIONS = ['api_key', 'credential', 'token', 'secret'] as const;

const typeBadgeColors: Record<string, string> = {
  api_key: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  credential: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  token: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  secret: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const typeLabels: Record<string, string> = {
  api_key: 'API Key',
  credential: 'Credential',
  token: 'Token',
  secret: 'Secret',
};

function maskKey(key: string): string {
  if (key.length <= 10) return key;
  return key.slice(0, 10) + '\u2022\u2022\u2022\u2022';
}

const CHANNEL_TYPES = [
  { type: 'email', label: 'Email', icon: Mail, defaultCost: 0.001 },
  { type: 'telegram', label: 'Telegram', icon: Send, defaultCost: 0.0 },
  { type: 'sms', label: 'SMS', icon: MessageCircle, defaultCost: 0.01 },
  { type: 'voice', label: 'Voice', icon: Phone, defaultCost: 0.05 },
] as const;

const channelIconMap: Record<string, typeof Mail> = {
  email: Mail,
  telegram: Send,
  sms: MessageCircle,
  voice: Phone,
};

type TabId = 'keys' | 'credentials' | 'tokens' | 'channels';

const TABS: { id: TabId; label: string }[] = [
  { id: 'keys', label: 'Keys' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'tokens', label: 'Tokens & Secrets' },
  { id: 'channels', label: 'Channels' },
];

export default function VaultView() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<VaultRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('keys');
  const [signingStatus, setSigningStatus] = useState(getSigningExpiry());
  const keyExists = hasInstanceKey();

  // Refresh signing status periodically
  useEffect(() => {
    const interval = setInterval(() => setSigningStatus(getSigningExpiry()), 5000);
    return () => clearInterval(interval);
  }, []);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<VaultRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultRow | null>(null);
  const [deleteEntities, setDeleteEntities] = useState<{ type: 'ceo' | 'agent'; name: string; model: string }[]>([]);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [channelFormType, setChannelFormType] = useState('email');
  const [channelFormCost, setChannelFormCost] = useState('0.001');
  const [deleteChannelTarget, setDeleteChannelTarget] = useState<ChannelRow | null>(null);
  const [telegramWizardChannel, setTelegramWizardChannel] = useState<ChannelRow | null>(null);

  const refresh = useCallback(() => { loadVaultEntries().then(setEntries); }, []);
  const refreshChannels = useCallback(() => { loadChannels().then(setChannels); }, []);

  useEffect(() => {
    loadVaultEntries().then(setEntries);
    loadChannels().then(setChannels);
  }, []);

  // Modal state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<string>('api_key');
  const [formService, setFormService] = useState('');
  const [formKey, setFormKey] = useState('');

  function openAdd() {
    setEditingEntry(null);
    setFormName('');
    // Pre-select type based on active tab
    if (activeTab === 'credentials') {
      setFormType('credential');
    } else if (activeTab === 'tokens') {
      setFormType('token');
    } else {
      setFormType('api_key');
    }
    setFormService('');
    setFormKey('');
    setModalOpen(true);
  }

  function openEdit(entry: VaultRow) {
    setEditingEntry(entry);
    setFormName(entry.name);
    setFormType(entry.type);
    setFormService(entry.service);
    setFormKey(entry.key_value);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!formName.trim() || !formService.trim() || !formKey.trim()) return;
    if (editingEntry) {
      await updateVaultEntry(editingEntry.id, { name: formName.trim(), key_value: formKey.trim() });
      await logAudit(null, 'KEY_UPDATED', `Updated "${formName.trim()}" (${editingEntry.service})`, 'info');
    } else {
      await saveVaultEntry({
        id: `vault-${Date.now()}`,
        name: formName.trim(),
        type: formType,
        service: formService.trim(),
        key_value: formKey.trim(),
      });
      await logAudit(null, 'KEY_ADDED', `Added ${formType} "${formName.trim()}" for ${formService.trim()}`, 'info');
    }
    setModalOpen(false);
    refresh();
    window.dispatchEvent(new Event('vault-changed'));
  }

  async function handleDeleteClick(entry: VaultRow) {
    const entities = await getEntitiesUsingService(entry.service);
    setDeleteEntities(entities);
    setDeleteTarget(entry);
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    await logAudit(null, 'KEY_DELETED', `Deleted "${deleteTarget.name}" (${deleteTarget.service})`, 'warning');
    await deleteVaultEntry(deleteTarget.id);
    setDeleteTarget(null);
    setDeleteEntities([]);
    refresh();
    window.dispatchEvent(new Event('vault-changed'));
  }

  function openAddChannel() {
    setChannelFormType('email');
    setChannelFormCost('0.001');
    setChannelModalOpen(true);
  }

  async function handleSaveChannel() {
    const cost = parseFloat(channelFormCost);
    if (isNaN(cost) || cost < 0) return;
    await saveChannel({
      id: `ch-${channelFormType}-${Date.now()}`,
      type: channelFormType,
      enabled: false,
      config: {},
      cost_per_unit: cost,
    });
    await logAudit(null, 'CHANNEL_ADDED', `Added ${channelFormType} notification channel`, 'info');
    setChannelModalOpen(false);
    refreshChannels();
  }

  async function handleDeleteChannelConfirm() {
    if (!deleteChannelTarget) return;
    await logAudit(null, 'CHANNEL_DELETED', `Deleted ${deleteChannelTarget.type} notification channel`, 'warning');
    await deleteChannel(deleteChannelTarget.id);
    setDeleteChannelTarget(null);
    refreshChannels();
  }


  const serviceOptions = Object.keys(SERVICE_KEY_HINTS);

  // Filtered entries per tab
  const filteredEntries = activeTab === 'keys'
    ? entries.filter(e => e.type === 'api_key')
    : activeTab === 'credentials'
      ? entries.filter(e => e.type === 'credential')
      : activeTab === 'tokens'
        ? entries.filter(e => e.type === 'token' || e.type === 'secret')
        : [];

  // Header button config based on tab
  const showAddKey = activeTab === 'keys' || activeTab === 'credentials' || activeTab === 'tokens';
  const showAddChannel = activeTab === 'channels';

  return (
    <div className="min-h-screen bg-jarvis-bg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-600/15 border border-emerald-500/25">
            <Shield size={24} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-jarvis-text tracking-wide">THE VAULT</h1>
            <p className="text-sm text-jarvis-muted">The Vault</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-jarvis-muted font-mono">{entries.length} entries secured</span>
          {showAddKey && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors"
            >
              <Plus size={16} />
              ADD KEY
            </button>
          )}
          {showAddChannel && (
            <button
              onClick={openAddChannel}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/25 rounded-lg hover:bg-cyan-500/20 transition-colors"
            >
              <Plus size={16} />
              ADD CHANNEL
            </button>
          )}
        </div>
      </div>

      {/* Signing Status Banner */}
      {keyExists && (
        <button
          onClick={() => navigate('/key')}
          className={`w-full mb-6 flex items-center gap-3 px-5 py-3.5 rounded-xl border transition-colors ${
            signingStatus.unlocked
              ? 'bg-emerald-500/10 border-emerald-500/25 hover:border-emerald-500/40'
              : 'bg-red-500/10 border-red-500/25 hover:border-red-500/40'
          }`}
        >
          <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${
            signingStatus.unlocked ? 'bg-emerald-500/15' : 'bg-red-500/15'
          }`}>
            {signingStatus.unlocked ? (
              <Unlock size={18} className="text-emerald-400" />
            ) : (
              <Lock size={18} className="text-red-400" />
            )}
          </div>
          <div className="flex-1 text-left">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${signingStatus.unlocked ? 'text-emerald-400' : 'text-red-400'}`}>
                MARKETPLACE SIGNING
              </span>
              <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider ${
                signingStatus.unlocked
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-red-500/15 text-red-400 border border-red-500/30 animate-pulse'
              }`}>
                {signingStatus.label}
              </span>
            </div>
            <p className="text-xs text-jarvis-muted mt-0.5">
              {signingStatus.unlocked
                ? 'Private key is unlocked — forum posts, votes, and marketplace actions are signed.'
                : 'Private key is locked — click to unlock for marketplace & forum signing.'}
            </p>
          </div>
          <Key size={16} className="text-jarvis-muted" />
        </button>
      )}

      {!keyExists && (
        <button
          onClick={() => navigate('/key')}
          className="w-full mb-6 flex items-center gap-3 px-5 py-3.5 rounded-xl border border-amber-500/25 bg-amber-500/10 hover:border-amber-500/40 transition-colors"
        >
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/15">
            <Key size={18} className="text-amber-400" />
          </div>
          <div className="flex-1 text-left">
            <span className="text-sm font-semibold text-amber-400">NO INSTANCE KEY</span>
            <p className="text-xs text-jarvis-muted mt-0.5">
              Click to generate your Ed25519 keypair for marketplace registration and forum signing.
            </p>
          </div>
        </button>
      )}

      {/* Summary Bar */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {([
          { type: 'api_key' as const, tab: 'keys' as TabId, border: 'border-blue-500/15', dot: 'bg-blue-500', text: 'text-blue-400', label: 'API Keys' },
          { type: 'credential' as const, tab: 'credentials' as TabId, border: 'border-purple-500/15', dot: 'bg-purple-500', text: 'text-purple-400', label: 'Credentials' },
          { type: 'token' as const, tab: 'tokens' as TabId, border: 'border-amber-500/15', dot: 'bg-amber-500', text: 'text-amber-400', label: 'Tokens & Secrets' },
        ]).map(item => {
          const count = item.type === 'token'
            ? entries.filter(e => e.type === 'token' || e.type === 'secret').length
            : entries.filter(e => e.type === item.type).length;
          return (
            <button
              key={item.type}
              onClick={() => setActiveTab(item.tab)}
              className={`bg-jarvis-surface border ${item.border} rounded-lg px-5 py-4 text-left transition-colors hover:border-white/[0.12] ${activeTab === item.tab ? 'ring-1 ring-emerald-500/30' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2.5 h-2.5 rounded-full ${item.dot}`} />
                <span className="text-xs font-medium text-jarvis-muted uppercase tracking-wider">{item.label}</span>
              </div>
              <span className={`text-3xl font-bold ${item.text}`}>{count}</span>
            </button>
          );
        })}
        <button
          onClick={() => setActiveTab('channels')}
          className={`bg-jarvis-surface border border-cyan-500/15 rounded-lg px-5 py-4 text-left transition-colors hover:border-white/[0.12] ${activeTab === 'channels' ? 'ring-1 ring-emerald-500/30' : ''}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" />
            <span className="text-xs font-medium text-jarvis-muted uppercase tracking-wider">Channels</span>
          </div>
          <span className="text-3xl font-bold text-cyan-400">{channels.length}</span>
        </button>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 mb-6 border-b border-white/[0.06] pb-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-semibold tracking-wider transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-jarvis-muted hover:text-jarvis-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content: Keys / Credentials / Tokens */}
      {(activeTab === 'keys' || activeTab === 'credentials' || activeTab === 'tokens') && (
        <>
          {filteredEntries.length === 0 ? (
            <div className="bg-jarvis-surface border border-white/[0.06] rounded-xl p-12 text-center">
              <Lock size={32} className="text-jarvis-muted mx-auto mb-4 opacity-40" />
              <p className="text-jarvis-muted text-sm mb-1">
                No {activeTab === 'keys' ? 'API keys' : activeTab === 'credentials' ? 'credentials' : 'tokens or secrets'} stored yet
              </p>
              <p className="text-jarvis-muted/60 text-xs">Add entries with the ADD KEY button above.</p>
            </div>
          ) : (
            <div className="bg-jarvis-surface border border-white/[0.06] rounded-xl overflow-hidden">
              {/* Table Header */}
              <div className="grid grid-cols-[1fr_100px_110px_160px_140px_90px] gap-4 px-6 py-3 border-b border-white/[0.06] bg-white/[0.02]">
                <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Name</span>
                <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Type</span>
                <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Service</span>
                <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Key</span>
                <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Added</span>
                <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider text-right">Actions</span>
              </div>

              {filteredEntries.map((entry, idx) => (
                <div
                  key={entry.id}
                  className={[
                    'grid grid-cols-[1fr_100px_110px_160px_140px_90px] gap-4 px-6 py-4 border-b border-white/[0.04] items-center transition-colors hover:bg-white/[0.03]',
                    idx % 2 === 1 ? 'bg-white/[0.015]' : '',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Lock size={14} className="text-jarvis-muted flex-shrink-0" />
                    <span className="text-sm font-medium text-jarvis-text truncate">{entry.name}</span>
                  </div>

                  <div>
                    <span className={`inline-block px-2.5 py-1 text-[11px] font-semibold rounded-md border ${typeBadgeColors[entry.type] ?? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'}`}>
                      {typeLabels[entry.type] ?? entry.type}
                    </span>
                  </div>

                  <span className="text-sm text-jarvis-muted">{entry.service}</span>

                  <span className="text-sm font-mono text-zinc-500 tracking-wider select-none">
                    {maskKey(entry.key_value)}
                  </span>

                  <span className="text-sm font-mono text-jarvis-muted">
                    {entry.created_at?.slice(0, 10) ?? '---'}
                  </span>

                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => openEdit(entry)}
                      className="flex items-center justify-center w-8 h-8 text-jarvis-muted hover:text-jarvis-text hover:bg-white/[0.06] rounded-md transition-colors"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDeleteClick(entry)}
                      className="flex items-center justify-center w-8 h-8 text-jarvis-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Tab Content: Channels */}
      {activeTab === 'channels' && (
        <>
          {channels.length === 0 ? (
            <div className="bg-jarvis-surface border border-white/[0.06] rounded-xl p-12 text-center">
              <Bell size={32} className="text-jarvis-muted mx-auto mb-4 opacity-40" />
              <p className="text-jarvis-muted text-sm mb-1">No notification channels configured</p>
              <p className="text-jarvis-muted/60 text-xs">Add channels for Email, Telegram, SMS, or Voice notifications.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {channels.map(channel => {
                const IconComponent = channelIconMap[channel.type] ?? Bell;
                const channelMeta = CHANNEL_TYPES.find(ct => ct.type === channel.type);
                const label = channelMeta?.label ?? channel.type.charAt(0).toUpperCase() + channel.type.slice(1);
                const isTelegram = channel.type === 'telegram';
                const channelConfig = (channel.config ?? {}) as Record<string, unknown>;
                const isConfigured = isTelegram && !!channelConfig.bot_token;
                return (
                  <div
                    key={channel.id}
                    className="bg-jarvis-surface border border-white/[0.06] rounded-xl p-5 flex flex-col gap-3 hover:border-white/[0.1] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                          <IconComponent size={18} className="text-cyan-400" />
                        </div>
                        <span className="text-sm font-semibold text-jarvis-text uppercase tracking-wide">{label}</span>
                      </div>
                      {isConfigured ? (
                        <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 uppercase tracking-wider">
                          Connected
                        </span>
                      ) : isTelegram ? (
                        <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 uppercase tracking-wider">
                          Ready
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 uppercase tracking-wider">
                          Coming Soon
                        </span>
                      )}
                    </div>

                    <div className="space-y-1.5 mt-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-jarvis-muted">Cost per unit</span>
                        <span className="text-xs font-mono text-jarvis-text">${channel.cost_per_unit.toFixed(4)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-jarvis-muted">Status</span>
                        {isConfigured ? (
                          <span className="text-xs font-medium text-emerald-400">@{String(channelConfig.bot_username ?? 'bot')}</span>
                        ) : (
                          <span className="text-xs font-medium text-zinc-500">{isTelegram ? 'Not configured' : 'Disabled'}</span>
                        )}
                      </div>
                      {isTelegram && !!channelConfig.authorized_chat_id && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-jarvis-muted">Chat ID</span>
                          <span className="text-xs font-mono text-emerald-400">{String(channelConfig.authorized_chat_id)}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-auto pt-2">
                      {isTelegram ? (
                        <button
                          onClick={() => setTelegramWizardChannel(channel)}
                          className="flex-1 px-3 py-1.5 text-xs font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/25 rounded-md hover:bg-cyan-500/20 transition-colors"
                        >
                          {isConfigured ? 'Reconfigure' : 'Configure'}
                        </button>
                      ) : (
                        <button
                          disabled
                          className="flex-1 px-3 py-1.5 text-xs font-medium text-jarvis-muted bg-white/[0.03] border border-white/[0.06] rounded-md cursor-not-allowed opacity-50"
                        >
                          Configure
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteChannelTarget(channel)}
                        className="flex items-center justify-center w-8 h-8 text-jarvis-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}


      {/* Footer */}
      <div className="mt-4 flex items-center gap-2 px-2">
        <Shield size={12} className="text-jarvis-muted" />
        <span className="text-xs text-jarvis-muted">
          All credentials are stored locally in your browser via IndexedDB. No data leaves your machine.
        </span>
      </div>

      {/* Add/Edit Vault Entry Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModalOpen(false)} />
          <div className="relative z-10 bg-jarvis-surface border border-white/[0.08] rounded-xl w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
              <h2 className="text-lg font-semibold text-jarvis-text">
                {editingEntry ? 'Edit Credential' : 'Add Credential'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-jarvis-muted hover:text-jarvis-text transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g. Anthropic API Key"
                  className="w-full bg-jarvis-bg border border-white/[0.08] text-jarvis-text text-sm px-3 py-2.5 rounded-lg focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-zinc-600"
                />
              </div>

              {!editingEntry && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Type</label>
                    <select
                      value={formType}
                      onChange={e => setFormType(e.target.value)}
                      className="w-full bg-jarvis-bg border border-white/[0.08] text-jarvis-text text-sm px-3 py-2.5 rounded-lg focus:outline-none focus:border-emerald-500/50 transition-colors"
                    >
                      {TYPE_OPTIONS.map(t => (
                        <option key={t} value={t}>{typeLabels[t]}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Service</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {serviceOptions.map(s => (
                        <button
                          key={s}
                          onClick={() => setFormService(s)}
                          className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                            formService === s
                              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                              : 'border-white/[0.08] text-jarvis-muted hover:text-jarvis-text hover:border-white/[0.15]'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={formService}
                      onChange={e => setFormService(e.target.value)}
                      placeholder="Or type custom service name"
                      className="w-full bg-jarvis-bg border border-white/[0.08] text-jarvis-text text-sm px-3 py-2.5 rounded-lg focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-zinc-600"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Key Value</label>
                <input
                  type="password"
                  value={formKey}
                  onChange={e => setFormKey(e.target.value)}
                  placeholder="Paste API key or secret"
                  className="w-full bg-jarvis-bg border border-white/[0.08] text-jarvis-text text-sm font-mono px-3 py-2.5 rounded-lg focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-zinc-600"
                />
                {formKey.length > 0 && (
                  <div className="text-xs font-mono text-emerald-400 mt-1.5">{maskKey(formKey)}</div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/[0.06]">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-jarvis-muted hover:text-jarvis-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formName.trim() || !formKey.trim() || (!editingEntry && !formService.trim())}
                className="px-5 py-2 text-sm font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {editingEntry ? 'Save Changes' : 'Add Key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Vault Entry Confirmation Modal */}
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
                  <h3 className="text-base font-semibold text-jarvis-text">Delete Credential</h3>
                  <p className="text-xs text-jarvis-muted">{deleteTarget.name}</p>
                </div>
              </div>

              {deleteEntities.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4">
                  <p className="text-sm text-red-300 font-medium mb-2">This key is used by:</p>
                  <ul className="space-y-1">
                    {deleteEntities.map((e, i) => (
                      <li key={i} className="text-sm text-red-200/80">
                        {e.type === 'ceo' ? 'CEO' : 'Agent'} <span className="font-semibold">{e.name}</span> ({e.model})
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-red-400/70 mt-3">Deleting this key may break their functionality.</p>
                </div>
              )}

              {deleteEntities.length === 0 && (
                <p className="text-sm text-jarvis-muted mb-4">
                  Are you sure you want to delete this credential? This action cannot be undone.
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setDeleteTarget(null); setDeleteEntities([]); }}
                  className="px-4 py-2 text-sm text-jarvis-muted hover:text-jarvis-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="px-5 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg hover:bg-red-500/20 transition-colors"
                >
                  {deleteEntities.length > 0 ? 'DELETE ANYWAY' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Channel Modal */}
      {channelModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setChannelModalOpen(false)} />
          <div className="relative z-10 bg-jarvis-surface border border-white/[0.08] rounded-xl w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
              <h2 className="text-lg font-semibold text-jarvis-text">Add Notification Channel</h2>
              <button onClick={() => setChannelModalOpen(false)} className="text-jarvis-muted hover:text-jarvis-text transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-2">Channel Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {CHANNEL_TYPES.map(ct => {
                    const Icon = ct.icon;
                    const selected = channelFormType === ct.type;
                    return (
                      <button
                        key={ct.type}
                        onClick={() => {
                          setChannelFormType(ct.type);
                          setChannelFormCost(ct.defaultCost.toString());
                        }}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
                          selected
                            ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400'
                            : 'border-white/[0.08] text-jarvis-muted hover:text-jarvis-text hover:border-white/[0.15]'
                        }`}
                      >
                        <Icon size={18} />
                        <span className="text-sm font-medium">{ct.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Cost Per Unit ($)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={channelFormCost}
                  onChange={e => setChannelFormCost(e.target.value)}
                  className="w-full bg-jarvis-bg border border-white/[0.08] text-jarvis-text text-sm font-mono px-3 py-2.5 rounded-lg focus:outline-none focus:border-cyan-500/50 transition-colors placeholder:text-zinc-600"
                />
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <p className="text-xs text-amber-400">
                  Notification adapters are not yet implemented. Channels will be saved as placeholders for future use.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/[0.06]">
              <button
                onClick={() => setChannelModalOpen(false)}
                className="px-4 py-2 text-sm text-jarvis-muted hover:text-jarvis-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveChannel}
                className="px-5 py-2 text-sm font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/25 rounded-lg hover:bg-cyan-500/20 transition-colors"
              >
                Add Channel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Telegram Setup Wizard */}
      {telegramWizardChannel && (
        <TelegramSetupWizard
          channelId={telegramWizardChannel.id}
          onComplete={async (config) => {
            // Save channel config to DB
            const sb = (await import('../../lib/supabase')).getSupabase();
            await sb.from('notification_channels').update({
              enabled: true,
              config: {
                bot_token: config.bot_token,
                bot_username: config.bot_username,
                authorized_chat_id: null,
              },
            }).eq('id', telegramWizardChannel.id);
            await logAudit(null, 'CHANNEL_CONFIGURED', `Configured Telegram bot @${config.bot_username}`, 'info');
            setTelegramWizardChannel(null);
            refreshChannels();
          }}
          onClose={() => setTelegramWizardChannel(null)}
        />
      )}

      {/* Delete Channel Confirmation Modal */}
      {deleteChannelTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteChannelTarget(null)} />
          <div className="relative z-10 bg-jarvis-surface border border-red-500/20 rounded-xl w-full max-w-md mx-4 shadow-2xl">
            <div className="px-6 py-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                  <AlertTriangle size={20} className="text-red-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-jarvis-text">Delete Channel</h3>
                  <p className="text-xs text-jarvis-muted capitalize">{deleteChannelTarget.type} notification channel</p>
                </div>
              </div>

              <p className="text-sm text-jarvis-muted mb-4">
                Are you sure you want to remove this notification channel? This action cannot be undone.
              </p>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteChannelTarget(null)}
                  className="px-4 py-2 text-sm text-jarvis-muted hover:text-jarvis-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteChannelConfirm}
                  className="px-5 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg hover:bg-red-500/20 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
