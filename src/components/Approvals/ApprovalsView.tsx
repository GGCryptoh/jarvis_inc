import { useState, useCallback, useEffect } from 'react';
import { ClipboardCheck, Check, X, Key, Blocks, ChevronDown, ChevronUp } from 'lucide-react';
import {
  loadApprovals,
  loadAllApprovals,
  updateApprovalStatus,
  saveVaultEntry,
  saveSkill,
  logAudit,
} from '../../lib/database';
import type { ApprovalRow } from '../../lib/database';
import { SERVICE_KEY_HINTS } from '../../lib/models';

export default function ApprovalsView() {
  const [pending, setPending] = useState<ApprovalRow[]>([]);
  const [history, setHistory] = useState<ApprovalRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Per-approval key input state
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    loadApprovals().then(setPending);
    loadAllApprovals().then(all => setHistory(all.filter(a => a.status !== 'pending')));
  }, []);

  const refresh = useCallback(async () => {
    const [p, all] = await Promise.all([loadApprovals(), loadAllApprovals()]);
    setPending(p);
    setHistory(all.filter(a => a.status !== 'pending'));
    // Notify nav badge to update immediately
    window.dispatchEvent(new Event('approvals-changed'));
  }, []);

  async function handleProvideKey(approval: ApprovalRow) {
    const key = keyInputs[approval.id]?.trim();
    if (!key || key.length < 10) return;

    const meta = (approval.metadata ?? {}) as { service?: string; model?: string };

    const service = meta.service ?? 'Unknown';

    await saveVaultEntry({
      id: `vault-${Date.now()}`,
      name: `${service} API Key`,
      type: 'api_key',
      service,
      key_value: key,
    });

    await updateApprovalStatus(approval.id, 'approved');
    await logAudit(null, 'APPROVED', `Provided ${service} API key for "${approval.title}"`, 'info');
    setKeyInputs(prev => {
      const next = { ...prev };
      delete next[approval.id];
      return next;
    });
    refresh();
  }

  async function handleApproveSkillEnable(approval: ApprovalRow) {
    const meta = (approval.metadata ?? {}) as { skillId?: string; model?: string };

    if (meta.skillId) {
      await saveSkill(meta.skillId, true, meta.model ?? null);
    }

    await updateApprovalStatus(approval.id, 'approved');
    await logAudit(null, 'APPROVED', `Approved skill enable: "${approval.title}"`, 'info');
    refresh();
  }

  async function handleDismiss(approval: ApprovalRow) {
    await updateApprovalStatus(approval.id, 'dismissed');
    await logAudit(null, 'DISMISSED', `Dismissed: "${approval.title}"`, 'info');
    refresh();
  }

  return (
    <div className="min-h-screen bg-jarvis-bg p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-600/15 border border-emerald-500/25">
          <ClipboardCheck size={24} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-jarvis-text tracking-wide">APPROVALS</h1>
          <p className="text-sm text-jarvis-muted">Review and approve pending requests</p>
        </div>
      </div>

      {/* Pending Approvals */}
      {pending.length === 0 ? (
        <div className="bg-jarvis-surface border border-emerald-500/15 rounded-xl p-12 text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <Check size={28} className="text-emerald-400" />
          </div>
          <p className="text-lg font-semibold text-emerald-400 mb-1">ALL CLEAR</p>
          <p className="text-sm text-jarvis-muted">No pending approvals</p>
        </div>
      ) : (
        <div className="space-y-4 mb-6">
          {pending.map(approval => {
            const meta = (approval.metadata ?? {}) as { service?: string; model?: string; agentId?: string };

            const service = meta.service ?? 'Unknown';
            const hints = SERVICE_KEY_HINTS[service];
            const keyValue = keyInputs[approval.id] ?? '';

            return (
              <div
                key={approval.id}
                className="bg-jarvis-surface border border-amber-500/20 rounded-xl overflow-hidden"
              >
                {/* Card header */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.06]">
                  <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                    {approval.type === 'skill_enable'
                      ? <Blocks size={18} className="text-amber-400" />
                      : <Key size={18} className="text-amber-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-jarvis-text">{approval.title}</h3>
                    {approval.description && (
                      <p className="text-xs text-jarvis-muted mt-0.5">{approval.description}</p>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-jarvis-muted/60">
                    {approval.created_at?.slice(0, 16) ?? ''}
                  </span>
                </div>

                {/* Card body */}
                <div className="px-6 py-5">
                  {approval.type === 'api_key_request' && hints && (
                    <div className="mb-4">
                      <div className="text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-2">
                        How to get a {service} API key
                      </div>
                      <ol className="space-y-1 mb-2">
                        {hints.steps.map((step, i) => (
                          <li key={i} className="text-xs text-jarvis-muted/80 flex items-start gap-2">
                            <span className="text-emerald-400 font-mono">{i + 1}.</span>
                            {step}
                          </li>
                        ))}
                      </ol>
                      <span className="text-xs text-blue-400/80 font-mono">{hints.url}</span>
                    </div>
                  )}

                  {approval.type === 'api_key_request' && (
                    <div className="mb-4">
                      <input
                        type="password"
                        value={keyValue}
                        onChange={e => setKeyInputs(prev => ({ ...prev, [approval.id]: e.target.value }))}
                        placeholder={`Paste your ${service} API key`}
                        className="w-full bg-jarvis-bg border border-white/[0.08] text-jarvis-text text-sm font-mono px-3 py-2.5 rounded-lg focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-zinc-600"
                      />
                      {keyValue.length > 0 && (
                        <div className="text-xs font-mono text-emerald-400 mt-1">
                          {keyValue.length <= 10 ? keyValue : keyValue.slice(0, 10) + '\u2022\u2022\u2022\u2022'}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    {approval.type === 'api_key_request' && (
                      <button
                        onClick={() => handleProvideKey(approval)}
                        disabled={keyValue.trim().length < 10}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Key size={14} />
                        PROVIDE KEY
                      </button>
                    )}
                    {approval.type === 'skill_enable' && (
                      <button
                        onClick={() => handleApproveSkillEnable(approval)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors"
                      >
                        <Check size={14} />
                        APPROVE
                      </button>
                    )}
                    <button
                      onClick={() => handleDismiss(approval)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-jarvis-muted hover:text-jarvis-text bg-white/[0.03] border border-white/[0.08] rounded-lg hover:bg-white/[0.06] transition-colors"
                    >
                      <X size={14} />
                      DISMISS
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(prev => !prev)}
            className="flex items-center gap-2 text-sm text-jarvis-muted hover:text-jarvis-text transition-colors mb-3"
          >
            {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            History ({history.length})
          </button>

          {showHistory && (
            <div className="space-y-2">
              {history.map(approval => (
                <div
                  key={approval.id}
                  className="bg-jarvis-surface/50 border border-white/[0.04] rounded-lg px-5 py-3 flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <span className="text-sm text-jarvis-muted/70">{approval.title}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                        approval.status === 'approved'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-zinc-500/15 text-zinc-400'
                      }`}
                    >
                      {approval.status.toUpperCase()}
                    </span>
                    <span className="text-[10px] font-mono text-jarvis-muted/40">
                      {approval.created_at?.slice(0, 10) ?? ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
