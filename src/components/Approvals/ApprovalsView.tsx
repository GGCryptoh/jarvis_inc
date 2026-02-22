import { useState, useCallback, useEffect } from 'react';
import { ClipboardCheck, Check, X, Key, Blocks, ChevronDown, ChevronUp, AlertTriangle, ShieldAlert, DollarSign, MessagesSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();
  const [pending, setPending] = useState<ApprovalRow[]>([]);
  const [history, setHistory] = useState<ApprovalRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Per-approval key input state
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  // Per-approval danger confirm input state (for dangerous skills)
  const [confirmInputs, setConfirmInputs] = useState<Record<string, string>>({});

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
    const meta = (approval.metadata ?? {}) as { skillId?: string; skillName?: string; model?: string };

    if (meta.skillId) {
      await saveSkill(meta.skillId, true, meta.model ?? null);
    }

    await updateApprovalStatus(approval.id, 'approved');
    await logAudit(null, 'APPROVED', `Approved skill enable: "${approval.title}"`, 'info');
    window.dispatchEvent(new Event('skills-changed'));
    window.dispatchEvent(new CustomEvent('skill-approved-in-chat', {
      detail: { skillId: meta.skillId, skillName: meta.skillName ?? approval.title },
    }));
    refresh();
  }

  async function handleApproveBudget(approval: ApprovalRow) {
    await updateApprovalStatus(approval.id, 'approved');
    await logAudit(null, 'APPROVED', `Approved budget override: "${approval.title}"`, 'info');
    refresh();
  }

  async function handleDenyBudget(approval: ApprovalRow) {
    await updateApprovalStatus(approval.id, 'denied');
    await logAudit(null, 'DENIED', `Denied budget override: "${approval.title}"`, 'info');
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
            const meta = (approval.metadata ?? {}) as { service?: string; model?: string; agentId?: string; riskLevel?: string };

            const service = meta.service ?? 'Unknown';
            const hints = SERVICE_KEY_HINTS[service];
            const keyValue = keyInputs[approval.id] ?? '';
            const riskLevel = meta.riskLevel ?? 'safe';
            const isDangerous = riskLevel === 'dangerous';
            const isModerate = riskLevel === 'moderate';
            const dangerConfirmValue = confirmInputs[approval.id] ?? '';
            const dangerConfirmed = dangerConfirmValue.toUpperCase() === 'ENABLE';

            const cardBorder = isDangerous ? 'border-red-500/30' : isModerate ? 'border-amber-500/30' : 'border-amber-500/20';

            return (
              <div
                key={approval.id}
                className={`bg-jarvis-surface border ${cardBorder} rounded-xl overflow-hidden`}
              >
                {/* Card header */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.06]">
                  <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                    {approval.type === 'forum_post'
                      ? <MessagesSquare size={18} className="text-pixel-cyan" />
                      : approval.type === 'budget_override'
                      ? <DollarSign size={18} className="text-red-400" />
                      : approval.type === 'skill_enable'
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

                  {/* Risk warning banners for skill_enable approvals */}
                  {approval.type === 'skill_enable' && isModerate && (
                    <div className="mb-4 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5">
                      <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-amber-300/90 leading-relaxed">
                        This skill accesses external CLI tools on the host system.
                      </span>
                    </div>
                  )}
                  {approval.type === 'skill_enable' && isDangerous && (
                    <div className="mb-4 space-y-3">
                      <div className="px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/25 flex items-start gap-2.5">
                        <ShieldAlert size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                        <span className="text-xs text-red-300/90 leading-relaxed">
                          This skill grants system-level access (bash, shell, sudo). Only enable if you trust the execution environment.
                        </span>
                      </div>
                      <input
                        type="text"
                        value={dangerConfirmValue}
                        onChange={e => setConfirmInputs(prev => ({ ...prev, [approval.id]: e.target.value }))}
                        placeholder='Type ENABLE to confirm'
                        className="w-full bg-jarvis-bg border border-red-500/30 text-jarvis-text text-sm font-mono px-3 py-2.5 rounded-lg focus:outline-none focus:border-red-400/50 transition-colors placeholder:text-zinc-600"
                      />
                    </div>
                  )}

                  {/* Forum post preview */}
                  {approval.type === 'forum_post' && (() => {
                    const meta = (approval.metadata ?? {}) as {
                      channel_id?: string; title?: string; body?: string;
                      parent_id?: string; parent_title?: string;
                      risk_level?: string; risk_reason?: string; auto_post_level?: string;
                    };
                    const riskBadgeColors: Record<string, string> = {
                      risky: 'text-red-400 bg-red-500/10 border-red-500/25',
                      moderate: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
                      safe: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
                    };
                    return (
                      <div className="mb-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-mono text-[10px] text-pixel-cyan uppercase tracking-wider">
                            #{meta.channel_id || 'general'}
                          </span>
                          {meta.parent_id && (
                            <span className="font-mono text-[10px] text-jarvis-muted">
                              replying to: {meta.parent_title || meta.parent_id}
                            </span>
                          )}
                          {meta.risk_level && (
                            <span className={`font-pixel text-[6px] tracking-wider px-1.5 py-0.5 rounded border ${riskBadgeColors[meta.risk_level] ?? riskBadgeColors.safe}`}>
                              {meta.risk_level.toUpperCase()}
                            </span>
                          )}
                          {meta.auto_post_level && (
                            <span className="font-pixel text-[6px] tracking-wider px-1.5 py-0.5 rounded text-zinc-500 bg-zinc-800 border border-zinc-700">
                              MODE: {meta.auto_post_level.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="bg-jarvis-bg border border-pixel-cyan/15 rounded-lg p-3">
                          {meta.title && (
                            <h4 className="font-mono text-sm text-jarvis-text font-semibold mb-2">{meta.title}</h4>
                          )}
                          <p className="font-mono text-xs text-jarvis-text/80 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {meta.body || '(empty)'}
                          </p>
                        </div>
                        {meta.risk_reason && (
                          <div className="mt-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
                            <span className="font-pixel text-[6px] tracking-wider text-amber-400">FLAGGED: </span>
                            <span className="font-mono text-[10px] text-amber-300/80">{meta.risk_reason}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Budget override info */}
                  {approval.type === 'budget_override' && (
                    <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-red-300 font-semibold">Budget Exceeded</span>
                        <span className="text-zinc-400 font-mono">
                          ${(meta as Record<string, unknown>).spend != null
                            ? Number((meta as Record<string, unknown>).spend).toFixed(2)
                            : '?'} / ${(meta as Record<string, unknown>).budget != null
                            ? Number((meta as Record<string, unknown>).budget).toFixed(2)
                            : '?'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        All new task dispatch is paused. Approve to resume operations or adjust the budget.
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    {approval.type === 'budget_override' && (
                      <>
                        <button
                          onClick={() => handleApproveBudget(approval)}
                          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors"
                        >
                          <Check size={14} />
                          APPROVE OVERSPEND
                        </button>
                        <button
                          onClick={() => handleDenyBudget(approval)}
                          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg hover:bg-red-500/20 transition-colors"
                        >
                          <X size={14} />
                          DENY
                        </button>
                        <button
                          onClick={() => navigate('/financials')}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-jarvis-muted hover:text-jarvis-text bg-white/[0.03] border border-white/[0.08] rounded-lg hover:bg-white/[0.06] transition-colors"
                        >
                          ADJUST BUDGET
                        </button>
                      </>
                    )}
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
                        disabled={isDangerous && !dangerConfirmed}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Check size={14} />
                        APPROVE
                      </button>
                    )}
                    {approval.type === 'forum_post' && (
                      <>
                        <button
                          onClick={async () => {
                            try {
                              const { executeSkill } = await import('../../lib/skillExecutor');
                              const meta = (approval.metadata ?? {}) as { channel_id?: string; title?: string; body?: string; parent_id?: string };
                              if (meta.parent_id) {
                                await executeSkill('forum', 'reply', { post_id: meta.parent_id, body: meta.body || '' }, { skipRiskGate: true });
                              } else {
                                await executeSkill('forum', 'create_post', { channel_id: meta.channel_id || 'general', title: meta.title || '', body: meta.body || '' }, { skipRiskGate: true });
                              }
                              await updateApprovalStatus(approval.id, 'approved');
                              await logAudit(null, 'APPROVED', `Approved forum post: "${approval.title}"`, 'info');
                              refresh();
                            } catch (err) {
                              console.error('Forum post approval failed:', err);
                            }
                          }}
                          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors"
                        >
                          <Check size={14} />
                          POST IT
                        </button>
                        <button
                          onClick={() => handleDismiss(approval)}
                          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg hover:bg-red-500/20 transition-colors"
                        >
                          <X size={14} />
                          DISCARD
                        </button>
                      </>
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
