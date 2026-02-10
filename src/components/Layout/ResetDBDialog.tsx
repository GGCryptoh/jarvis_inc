import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ResetDBDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function ResetDBDialog({ open, onClose, onConfirm }: ResetDBDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const CONFIRM_PHRASE = 'RESET JARVIS';

  // Reset internal state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setStep(1);
      setConfirmText('');
      setIsResetting(false);
    }
  }, [open]);

  const handleFirstConfirm = useCallback(() => {
    setStep(2);
  }, []);

  const handleFinalConfirm = useCallback(async () => {
    if (confirmText !== CONFIRM_PHRASE) return;
    setIsResetting(true);
    // Small delay for dramatic effect
    await new Promise((r) => setTimeout(r, 800));
    onConfirm();
  }, [confirmText, onConfirm]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="bg-jarvis-surface border-2 border-red-500/40 rounded-lg shadow-[0_0_40px_rgba(239,68,68,0.15)] overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 bg-red-500/10 border-b border-red-500/20">
            <AlertTriangle size={20} className="text-red-500 flex-shrink-0" />
            <div>
              <h2 className="text-red-400 font-semibold text-sm tracking-wide">
                {step === 1 ? 'RESET DATABASE' : 'FINAL CONFIRMATION'}
              </h2>
              <p className="text-red-400/60 text-xs mt-0.5">
                {step === 1 ? 'Step 1 of 2' : 'Step 2 of 2 — Point of no return'}
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="px-5 py-4">
            {step === 1 && (
              <>
                <p className="text-jarvis-text text-sm leading-relaxed mb-3">
                  This will <span className="text-red-400 font-semibold">permanently destroy</span> all data:
                </p>
                <ul className="text-jarvis-muted text-xs space-y-1.5 mb-5 ml-1">
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
                <p className="text-jarvis-muted text-xs mb-4">
                  You will be returned to the Founder Registration ceremony.
                </p>
              </>
            )}

            {step === 2 && (
              <>
                <p className="text-jarvis-text text-sm leading-relaxed mb-4">
                  Type <code className="bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded text-xs font-mono">{CONFIRM_PHRASE}</code> to confirm destruction:
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                  placeholder={CONFIRM_PHRASE}
                  autoFocus
                  className="w-full bg-jarvis-bg border-2 border-red-500/30 text-red-400 font-mono text-sm px-4 py-2.5 rounded focus:outline-none focus:border-red-500/60 placeholder:text-red-500/20 tracking-wider transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinalConfirm();
                  }}
                />
                {confirmText.length > 0 && confirmText !== CONFIRM_PHRASE && (
                  <p className="text-red-500/50 text-xs mt-2 font-mono">
                    Type exactly: {CONFIRM_PHRASE}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-jarvis-border bg-jarvis-bg/50">
            <button
              onClick={onClose}
              disabled={isResetting}
              className="px-4 py-2 text-xs text-jarvis-muted hover:text-jarvis-text border border-jarvis-border rounded transition-colors disabled:opacity-50"
            >
              CANCEL
            </button>
            {step === 1 ? (
              <button
                onClick={handleFirstConfirm}
                className="px-4 py-2 text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded transition-colors"
              >
                PROCEED TO STEP 2
              </button>
            ) : (
              <button
                onClick={handleFinalConfirm}
                disabled={confirmText !== CONFIRM_PHRASE || isResetting}
                className={`px-4 py-2 text-xs rounded border transition-all ${
                  confirmText === CONFIRM_PHRASE && !isResetting
                    ? 'text-white bg-red-600 hover:bg-red-500 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]'
                    : 'text-red-400/40 bg-red-500/5 border-red-500/10 cursor-not-allowed'
                }`}
              >
                {isResetting ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    DESTROYING...
                  </span>
                ) : (
                  'DESTROY & RESET'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
