import { useState, useCallback } from 'react';
import { X, Send, CheckCircle, Loader2, AlertCircle, ArrowRight } from 'lucide-react';

interface TelegramSetupWizardProps {
  channelId: string;
  onComplete: (config: { bot_token: string; bot_username: string }) => void;
  onClose: () => void;
}

export default function TelegramSetupWizard({ channelId, onComplete, onClose }: TelegramSetupWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [token, setToken] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [botName, setBotName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 2: Validate token via Telegram Bot API directly
  const handleValidateToken = useCallback(async () => {
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`https://api.telegram.org/bot${token.trim()}/getMe`);
      const data = await res.json();
      if (data.ok) {
        setBotUsername(data.result.username);
        setBotName(data.result.first_name);
        setStep(3);
      } else {
        setError(data.description || 'Invalid token');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reach Telegram API');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Final done
  const handleDone = useCallback(() => {
    onComplete({
      bot_token: token.trim(),
      bot_username: botUsername,
    });
  }, [token, botUsername, onComplete]);

  const stepLabels = ['Instructions', 'Token', 'Confirm', 'Done'];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg mx-4">
        <div className="bg-jarvis-surface border border-cyan-500/25 rounded-xl shadow-[0_0_40px_rgba(6,182,212,0.08)] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-cyan-500/5">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <Send size={18} className="text-cyan-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-jarvis-text tracking-wide">SET UP TELEGRAM BOT</h2>
                <p className="text-xs text-jarvis-muted mt-0.5">
                  Step {step} of 4 — {stepLabels[step - 1]}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-jarvis-muted hover:text-jarvis-text transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-jarvis-bg">
            <div
              className="h-full bg-cyan-500 transition-all duration-300"
              style={{ width: `${(step / 4) * 100}%` }}
            />
          </div>

          {/* Body */}
          <div className="px-6 py-5">
            {/* Step 1: Instructions */}
            {step === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-jarvis-text leading-relaxed">
                  To connect Telegram, you need to create a bot through BotFather.
                </p>
                <ol className="space-y-3">
                  <li className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 text-xs font-bold flex-shrink-0 mt-0.5">
                      1
                    </span>
                    <span className="text-sm text-jarvis-muted leading-relaxed">
                      Open Telegram and search for{' '}
                      <code className="bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded text-xs font-mono">@BotFather</code>
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 text-xs font-bold flex-shrink-0 mt-0.5">
                      2
                    </span>
                    <span className="text-sm text-jarvis-muted leading-relaxed">
                      Send{' '}
                      <code className="bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded text-xs font-mono">/newbot</code>
                      {' '}and follow the prompts
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 text-xs font-bold flex-shrink-0 mt-0.5">
                      3
                    </span>
                    <span className="text-sm text-jarvis-muted leading-relaxed">
                      Copy the <span className="text-jarvis-text font-medium">HTTP API token</span> BotFather gives you
                    </span>
                  </li>
                </ol>
              </div>
            )}

            {/* Step 2: Paste Token */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-jarvis-muted uppercase tracking-wider mb-2">
                    BOT TOKEN
                  </label>
                  <input
                    type="text"
                    value={token}
                    onChange={e => { setToken(e.target.value); setError(''); }}
                    placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxyz"
                    autoFocus
                    className="w-full bg-jarvis-bg border border-white/[0.08] text-jarvis-text text-sm font-mono px-3 py-2.5 rounded-lg focus:outline-none focus:border-cyan-500/50 transition-colors placeholder:text-zinc-600"
                    onKeyDown={e => { if (e.key === 'Enter' && token.trim()) handleValidateToken(); }}
                  />
                  <p className="text-xs text-jarvis-muted mt-1.5">
                    Paste the token you received from @BotFather
                  </p>
                </div>
                {error && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                    <span className="text-xs text-red-400">{error}</span>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Confirm Bot */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <CheckCircle size={18} className="text-emerald-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-emerald-400 font-medium">
                      Connected to @{botUsername}
                    </p>
                    <p className="text-xs text-jarvis-muted mt-0.5">{botName}</p>
                  </div>
                </div>
                <p className="text-sm text-jarvis-muted">
                  Is this the correct bot? If not, you can go back and try a different token.
                </p>
              </div>
            )}

            {/* Step 4: Done */}
            {step === 4 && (
              <div className="space-y-4 text-center py-4">
                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/25 mx-auto">
                  <CheckCircle size={28} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-jarvis-text">Telegram bot saved!</h3>
                  <p className="text-sm text-jarvis-muted mt-1">
                    The sidecar will auto-connect and start listening.
                  </p>
                  <p className="text-sm text-jarvis-muted mt-2">
                    Send a message to <span className="text-cyan-400 font-medium">@{botUsername}</span> — the first message authorizes your chat.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.06] bg-jarvis-bg/50">
            <div>
              {step > 1 && step < 4 && (
                <button
                  onClick={() => {
                    setError('');
                    if (step === 3) setStep(2);
                    else setStep((step - 1) as any);
                  }}
                  className="px-4 py-2 text-xs text-jarvis-muted hover:text-jarvis-text border border-jarvis-border rounded-lg transition-colors"
                >
                  BACK
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              {step !== 4 && (
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-xs text-jarvis-muted hover:text-jarvis-text transition-colors"
                >
                  CANCEL
                </button>
              )}

              {/* Step 1: Ready */}
              {step === 1 && (
                <button
                  onClick={() => setStep(2)}
                  className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/25 rounded-lg hover:bg-cyan-500/20 transition-colors"
                >
                  READY
                  <ArrowRight size={14} />
                </button>
              )}

              {/* Step 2: Validate */}
              {step === 2 && (
                <button
                  onClick={handleValidateToken}
                  disabled={!token.trim() || loading}
                  className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/25 rounded-lg hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      VALIDATING...
                    </>
                  ) : (
                    'VALIDATE'
                  )}
                </button>
              )}

              {/* Step 3: Confirm or retry */}
              {step === 3 && (
                <>
                  <button
                    onClick={() => { setToken(''); setError(''); setStep(2); }}
                    className="px-4 py-2 text-xs text-jarvis-muted hover:text-jarvis-text border border-jarvis-border rounded-lg transition-colors"
                  >
                    TRY DIFFERENT TOKEN
                  </button>
                  <button
                    onClick={() => setStep(4)}
                    className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors"
                  >
                    LOOKS GOOD, SAVE
                    <ArrowRight size={14} />
                  </button>
                </>
              )}

              {/* Step 4: Done */}
              {step === 4 && (
                <button
                  onClick={handleDone}
                  className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors"
                >
                  <CheckCircle size={14} />
                  DONE
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
