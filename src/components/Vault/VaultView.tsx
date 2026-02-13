import { useState, useCallback, useEffect } from 'react';
import { Shield, Lock, Plus, Pencil, Trash2, X, AlertTriangle } from 'lucide-react';
import {
  loadVaultEntries,
  saveVaultEntry,
  updateVaultEntry,
  deleteVaultEntry,
  getEntitiesUsingService,
  logAudit,
} from '../../lib/database';
import type { VaultRow } from '../../lib/database';
import { SERVICE_KEY_HINTS } from '../../lib/models';

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

export default function VaultView() {
  const [entries, setEntries] = useState<VaultRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<VaultRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultRow | null>(null);
  const [deleteEntities, setDeleteEntities] = useState<{ type: 'ceo' | 'agent'; name: string; model: string }[]>([]);

  useEffect(() => { loadVaultEntries().then(setEntries) }, []);

  const refresh = useCallback(() => { loadVaultEntries().then(setEntries) }, []);

  // Modal state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<string>('api_key');
  const [formService, setFormService] = useState('');
  const [formKey, setFormKey] = useState('');

  function openAdd() {
    setEditingEntry(null);
    setFormName('');
    setFormType('api_key');
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
  }

  const serviceOptions = Object.keys(SERVICE_KEY_HINTS);

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
            <p className="text-sm text-jarvis-muted">Credentials &amp; API Keys</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-jarvis-muted font-mono">{entries.length} entries secured</span>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors"
          >
            <Plus size={16} />
            ADD KEY
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {(['api_key', 'credential', 'token'] as const).map(type => {
          const count = entries.filter(e => e.type === type).length;
          const colors = type === 'api_key'
            ? { border: 'border-blue-500/15', dot: 'bg-blue-500', text: 'text-blue-400', label: 'API Keys' }
            : type === 'credential'
              ? { border: 'border-purple-500/15', dot: 'bg-purple-500', text: 'text-purple-400', label: 'Credentials' }
              : { border: 'border-amber-500/15', dot: 'bg-amber-500', text: 'text-amber-400', label: 'Tokens & Secrets' };
          const actualCount = type === 'token' ? entries.filter(e => e.type === 'token' || e.type === 'secret').length : count;
          return (
            <div key={type} className={`bg-jarvis-surface border ${colors.border} rounded-lg px-5 py-4`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
                <span className="text-xs font-medium text-jarvis-muted uppercase tracking-wider">{colors.label}</span>
              </div>
              <span className={`text-3xl font-bold ${colors.text}`}>{actualCount}</span>
            </div>
          );
        })}
      </div>

      {/* Vault Table */}
      {entries.length === 0 ? (
        <div className="bg-jarvis-surface border border-white/[0.06] rounded-xl p-12 text-center">
          <Lock size={32} className="text-jarvis-muted mx-auto mb-4 opacity-40" />
          <p className="text-jarvis-muted text-sm mb-1">No credentials stored yet</p>
          <p className="text-jarvis-muted/60 text-xs">Add API keys during CEO or agent setup, or manually with the ADD KEY button.</p>
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

          {entries.map((entry, idx) => (
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
                {entry.created_at?.slice(0, 10) ?? '—'}
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

      {/* Footer */}
      <div className="mt-4 flex items-center gap-2 px-2">
        <Shield size={12} className="text-jarvis-muted" />
        <span className="text-xs text-jarvis-muted">
          All credentials are stored locally in your browser via IndexedDB. No data leaves your machine.
        </span>
      </div>

      {/* Add/Edit Modal */}
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

      {/* Delete Confirmation Modal */}
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
    </div>
  );
}
