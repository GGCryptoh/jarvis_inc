import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Crown, Download, DatabaseZap } from 'lucide-react';
import { loadCEO, getFounderInfo, exportDatabaseAsJSON } from '../../lib/database';
import type { CEORow } from '../../lib/database';

type ActionType = 'fire_ceo' | 'shutter' | 'reset';

interface ResetDBDialogProps {
  open: boolean;
  onClose: () => void;
  onResetDB: (options?: { keepMemory?: boolean; clearFinancials?: boolean }) => void;
  onFireCEO: () => void;
}

export default function ResetDBDialog({ open, onClose, onResetDB, onFireCEO }: ResetDBDialogProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedAction, setSelectedAction] = useState<ActionType | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);

  const [keepMemory, setKeepMemory] = useState(false);
  const [clearFinancials, setClearFinancials] = useState(false);
  const [ceoRow, setCeoRow] = useState<CEORow | null>(null);
  const [founderInfo, setFounderInfo] = useState<{ founderName: string; orgName: string } | null>(null);

  const ceoName = ceoRow?.name ?? 'CEO';
  const orgName = founderInfo?.orgName ?? 'JARVIS';

  // Load CEO and founder info when dialog opens
  useEffect(() => {
    if (open) {
      const load = async () => {
        const [ceo, founder] = await Promise.all([loadCEO(), getFounderInfo()]);
        setCeoRow(ceo);
        setFounderInfo(founder);
      };
      load();
    }
  }, [open]);

  // Reset internal state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedAction(null);
      setConfirmText('');
      setIsExecuting(false);
      setKeepMemory(false);
      setClearFinancials(false);
    }
  }, [open]);

  const confirmPhrase = selectedAction === 'fire_ceo'
    ? `FIRE ${ceoName.toUpperCase()}`
    : selectedAction === 'shutter'
      ? `SHUTTER ${orgName.toUpperCase()}`
      : 'RESET JARVIS';

  const actionLabel = selectedAction === 'fire_ceo'
    ? 'FIRE CEO'
    : selectedAction === 'shutter'
      ? 'SHUTTER BUSINESS'
      : 'RESET DATABASE';

  const actionColor = selectedAction === 'fire_ceo'
    ? { border: 'border-amber-500/40', bg: 'bg-amber-500/10', headerBorder: 'border-amber-500/20', text: 'text-amber-400', subtext: 'text-amber-400/60', dot: 'bg-amber-500/60', inputBorder: 'border-amber-500/30', inputFocus: 'focus:border-amber-500/60', inputText: 'text-amber-400', placeholder: 'placeholder:text-amber-500/20', glow: 'shadow-[0_0_40px_rgba(245,158,11,0.15)]', btnActive: 'text-white bg-amber-600 hover:bg-amber-500 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)]', btnInactive: 'text-amber-400/40 bg-amber-500/5 border-amber-500/10', spinnerLabel: 'FIRING...' }
    : selectedAction === 'shutter'
      ? { border: 'border-blue-500/40', bg: 'bg-blue-500/10', headerBorder: 'border-blue-500/20', text: 'text-blue-400', subtext: 'text-blue-400/60', dot: 'bg-blue-500/60', inputBorder: 'border-blue-500/30', inputFocus: 'focus:border-blue-500/60', inputText: 'text-blue-400', placeholder: 'placeholder:text-blue-500/20', glow: 'shadow-[0_0_40px_rgba(59,130,246,0.15)]', btnActive: 'text-white bg-blue-600 hover:bg-blue-500 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]', btnInactive: 'text-blue-400/40 bg-blue-500/5 border-blue-500/10', spinnerLabel: 'SHUTTERING...' }
      : { border: 'border-red-500/40', bg: 'bg-red-500/10', headerBorder: 'border-red-500/20', text: 'text-red-400', subtext: 'text-red-400/60', dot: 'bg-red-500/60', inputBorder: 'border-red-500/30', inputFocus: 'focus:border-red-500/60', inputText: 'text-red-400', placeholder: 'placeholder:text-red-500/20', glow: 'shadow-[0_0_40px_rgba(239,68,68,0.15)]', btnActive: 'text-white bg-red-600 hover:bg-red-500 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]', btnInactive: 'text-red-400/40 bg-red-500/5 border-red-500/10', spinnerLabel: 'DESTROYING...' };

  const handleSelectAction = useCallback((action: ActionType) => {
    setSelectedAction(action);
    setStep(2);
    setConfirmText('');
  }, []);

  const handleBack = useCallback(() => {
    if (step === 3) {
      setStep(2);
      setConfirmText('');
    } else if (step === 2) {
      setStep(1);
      setSelectedAction(null);
    }
  }, [step]);

  const handleFinalConfirm = useCallback(async () => {
    if (confirmText !== confirmPhrase || !selectedAction) return;
    setIsExecuting(true);
    await new Promise((r) => setTimeout(r, 800));

    if (selectedAction === 'fire_ceo') {
      onClose();
      onFireCEO();
    } else if (selectedAction === 'shutter') {
      // Export data as JSON first
      try {
        const data = await exportDatabaseAsJSON();
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `${ceoName}_${dateStr}_terminated.json`;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // If export fails, still proceed with reset
      }
      // Small extra delay to allow download to start
      await new Promise((r) => setTimeout(r, 500));
      onClose();
      onResetDB({ keepMemory, clearFinancials });
    } else {
      onClose();
      onResetDB({ keepMemory, clearFinancials });
    }
  }, [confirmText, confirmPhrase, selectedAction, onClose, onFireCEO, onResetDB, ceoName, keepMemory, clearFinancials]);

  if (!open) return null;

  // Dynamic border/glow for dialog based on step
  const dialogBorder = step === 1 ? 'border-zinc-600/40' : actionColor.border;
  const dialogGlow = step === 1 ? '' : actionColor.glow;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg mx-4">
        <div className={`bg-jarvis-surface border-2 ${dialogBorder} rounded-lg ${dialogGlow} overflow-hidden`}>
          {/* Header */}
          <div className={`flex items-center gap-3 px-5 py-4 ${step === 1 ? 'bg-zinc-500/10 border-b border-zinc-600/20' : `${actionColor.bg} border-b ${actionColor.headerBorder}`}`}>
            <AlertTriangle size={20} className={step === 1 ? 'text-zinc-400 flex-shrink-0' : `${actionColor.text} flex-shrink-0`} />
            <div>
              <h2 className={`font-semibold text-sm tracking-wide ${step === 1 ? 'text-zinc-300' : actionColor.text}`}>
                {step === 1 ? 'SYSTEM ACTIONS' : actionLabel}
              </h2>
              <p className={`text-xs mt-0.5 ${step === 1 ? 'text-zinc-500' : actionColor.subtext}`}>
                {step === 1 ? 'Step 1 of 3 — Choose an action' : step === 2 ? 'Step 2 of 3 — Review details' : 'Step 3 of 3 — Point of no return'}
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="px-5 py-4">
            {/* Step 1: Choose Action */}
            {step === 1 && (
              <div className="grid grid-cols-3 gap-3">
                {/* Fire CEO */}
                <button
                  onClick={() => handleSelectAction('fire_ceo')}
                  className="flex flex-col items-center gap-2.5 p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/40 transition-all group"
                >
                  <div className="w-10 h-10 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Crown size={18} className="text-amber-400" />
                  </div>
                  <div className="text-center">
                    <div className="text-amber-400 text-[10px] font-bold tracking-wider">FIRE CEO</div>
                    <div className="text-zinc-500 text-[9px] mt-1 leading-tight">Remove CEO. Agents stay.</div>
                  </div>
                </button>

                {/* Shutter the Business */}
                <button
                  onClick={() => handleSelectAction('shutter')}
                  className="flex flex-col items-center gap-2.5 p-4 rounded-lg border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/40 transition-all group"
                >
                  <div className="w-10 h-10 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Download size={18} className="text-blue-400" />
                  </div>
                  <div className="text-center">
                    <div className="text-blue-400 text-[10px] font-bold tracking-wider">SHUTTER</div>
                    <div className="text-zinc-500 text-[9px] mt-1 leading-tight">Export backup, then wipe.</div>
                  </div>
                </button>

                {/* Reset Database */}
                <button
                  onClick={() => handleSelectAction('reset')}
                  className="flex flex-col items-center gap-2.5 p-4 rounded-lg border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 hover:border-red-500/40 transition-all group"
                >
                  <div className="w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <DatabaseZap size={18} className="text-red-400" />
                  </div>
                  <div className="text-center">
                    <div className="text-red-400 text-[10px] font-bold tracking-wider">RESET DB</div>
                    <div className="text-zinc-500 text-[9px] mt-1 leading-tight">Nuclear wipe. Start over.</div>
                  </div>
                </button>
              </div>
            )}

            {/* Step 2: Details */}
            {step === 2 && selectedAction === 'fire_ceo' && (
              <>
                <p className="text-jarvis-text text-sm leading-relaxed mb-3">
                  This will <span className="text-amber-400 font-semibold">remove CEO {ceoName}</span> and their designation settings.
                </p>
                <ul className="text-jarvis-muted text-xs space-y-1.5 mb-5 ml-1">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60 flex-shrink-0" />
                    You&apos;ll go through the CEO Designation ceremony again
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60 flex-shrink-0" />
                    All agent configurations will be preserved
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60 flex-shrink-0" />
                    Missions, vault keys, and audit logs will be preserved
                  </li>
                </ul>
              </>
            )}

            {step === 2 && selectedAction === 'shutter' && (
              <>
                <p className="text-jarvis-text text-sm leading-relaxed mb-3">
                  This will <span className="text-blue-400 font-semibold">export a full backup</span> of all Jarvis Inc. data as JSON, then wipe the system.
                </p>
                <ul className="text-jarvis-muted text-xs space-y-1.5 mb-4 ml-1">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500/60 flex-shrink-0" />
                    Founder info, CEO config, all agents
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500/60 flex-shrink-0" />
                    Vault credentials, missions, audit logs
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500/60 flex-shrink-0" />
                    Financial records and approvals
                  </li>
                </ul>
                <div className="flex items-center gap-2 px-3 py-2 rounded bg-blue-500/10 border border-blue-500/20 mb-4">
                  <Download size={14} className="text-blue-400 flex-shrink-0" />
                  <span className="text-blue-300 text-xs font-mono truncate">
                    {ceoName}_{new Date().toISOString().split('T')[0]}_terminated.json
                  </span>
                </div>
                <label className="flex items-center gap-3 px-3 py-2.5 rounded bg-emerald-500/8 border border-emerald-500/20 mb-3 cursor-pointer hover:bg-emerald-500/12 transition-colors">
                  <input
                    type="checkbox"
                    checked={keepMemory}
                    onChange={e => setKeepMemory(e.target.checked)}
                    className="w-4 h-4 rounded border-emerald-500/40 bg-transparent accent-emerald-500"
                  />
                  <div>
                    <span className="text-emerald-400 text-xs font-semibold">Keep Organizational Memory</span>
                    <p className="text-zinc-500 text-[10px] mt-0.5">Preserve learned facts, decisions, and founder profile across the reset</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 px-3 py-2.5 rounded bg-amber-500/8 border border-amber-500/20 mb-4 cursor-pointer hover:bg-amber-500/12 transition-colors">
                  <input
                    type="checkbox"
                    checked={clearFinancials}
                    onChange={e => setClearFinancials(e.target.checked)}
                    className="w-4 h-4 rounded border-amber-500/40 bg-transparent accent-amber-500"
                  />
                  <div>
                    <span className="text-amber-400 text-xs font-semibold">Clear Financial History</span>
                    <p className="text-zinc-500 text-[10px] mt-0.5">Wipe LLM usage costs and channel usage records</p>
                  </div>
                </label>
                <p className="text-jarvis-muted text-xs">
                  After download, the system will be fully wiped. You&apos;ll return to the Founder Registration ceremony.
                </p>
              </>
            )}

            {step === 2 && selectedAction === 'reset' && (
              <>
                <p className="text-jarvis-text text-sm leading-relaxed mb-3">
                  This will <span className="text-red-400 font-semibold">permanently destroy</span> all data:
                </p>
                <ul className="text-jarvis-muted text-xs space-y-1.5 mb-4 ml-1">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500/60 flex-shrink-0" />
                    Founder identity and organization settings
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500/60 flex-shrink-0" />
                    All agent configurations and mission history
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500/60 flex-shrink-0" />
                    Vault credentials and audit logs
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500/60 flex-shrink-0" />
                    Financial records and budgets
                  </li>
                </ul>
                <label className="flex items-center gap-3 px-3 py-2.5 rounded bg-emerald-500/8 border border-emerald-500/20 mb-3 cursor-pointer hover:bg-emerald-500/12 transition-colors">
                  <input
                    type="checkbox"
                    checked={keepMemory}
                    onChange={e => setKeepMemory(e.target.checked)}
                    className="w-4 h-4 rounded border-emerald-500/40 bg-transparent accent-emerald-500"
                  />
                  <div>
                    <span className="text-emerald-400 text-xs font-semibold">Keep Organizational Memory</span>
                    <p className="text-zinc-500 text-[10px] mt-0.5">Preserve learned facts, decisions, and founder profile across the reset</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 px-3 py-2.5 rounded bg-amber-500/8 border border-amber-500/20 mb-4 cursor-pointer hover:bg-amber-500/12 transition-colors">
                  <input
                    type="checkbox"
                    checked={clearFinancials}
                    onChange={e => setClearFinancials(e.target.checked)}
                    className="w-4 h-4 rounded border-amber-500/40 bg-transparent accent-amber-500"
                  />
                  <div>
                    <span className="text-amber-400 text-xs font-semibold">Clear Financial History</span>
                    <p className="text-zinc-500 text-[10px] mt-0.5">Wipe LLM usage costs and channel usage records</p>
                  </div>
                </label>
                <p className="text-jarvis-muted text-xs">
                  You will be returned to the Founder Registration ceremony.
                </p>
              </>
            )}

            {/* Step 3: Type to confirm */}
            {step === 3 && (
              <>
                <p className="text-jarvis-text text-sm leading-relaxed mb-4">
                  Type <code className={`${actionColor.bg} border ${actionColor.headerBorder} ${actionColor.inputText} px-2 py-0.5 rounded text-xs font-mono`}>{confirmPhrase}</code> to confirm:
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                  placeholder={confirmPhrase}
                  autoFocus
                  className={`w-full bg-jarvis-bg border-2 ${actionColor.inputBorder} ${actionColor.inputText} font-mono text-sm px-4 py-2.5 rounded focus:outline-none ${actionColor.inputFocus} ${actionColor.placeholder} tracking-wider transition-colors`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinalConfirm();
                  }}
                />
                {confirmText.length > 0 && confirmText !== confirmPhrase && (
                  <p className={`${actionColor.subtext} text-xs mt-2 font-mono`}>
                    Type exactly: {confirmPhrase}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-jarvis-border bg-jarvis-bg/50">
            {step === 1 ? (
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs text-jarvis-muted hover:text-jarvis-text border border-jarvis-border rounded transition-colors"
              >
                CANCEL
              </button>
            ) : (
              <>
                <button
                  onClick={handleBack}
                  disabled={isExecuting}
                  className="px-4 py-2 text-xs text-jarvis-muted hover:text-jarvis-text border border-jarvis-border rounded transition-colors disabled:opacity-50"
                >
                  BACK
                </button>
                {step === 2 ? (
                  <button
                    onClick={() => setStep(3)}
                    className={`px-4 py-2 text-xs ${actionColor.text} ${actionColor.bg} hover:opacity-80 border ${actionColor.border} rounded transition-colors`}
                  >
                    PROCEED
                  </button>
                ) : (
                  <button
                    onClick={handleFinalConfirm}
                    disabled={confirmText !== confirmPhrase || isExecuting}
                    className={`px-4 py-2 text-xs rounded border transition-all ${
                      confirmText === confirmPhrase && !isExecuting
                        ? actionColor.btnActive
                        : `${actionColor.btnInactive} cursor-not-allowed`
                    }`}
                  >
                    {isExecuting ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {actionColor.spinnerLabel}
                      </span>
                    ) : (
                      actionLabel
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
