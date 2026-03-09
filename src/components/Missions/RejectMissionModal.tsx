import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

interface RejectMissionModalProps {
  missionId: string;
  missionTitle: string;
  currentRound: number;
  onReject: (feedback: string, strategy: 'include_collateral' | 'start_fresh') => void;
  onClose: () => void;
}

export default function RejectMissionModal({ missionId, missionTitle, currentRound, onReject, onClose }: RejectMissionModalProps) {
  const [feedback, setFeedback] = useState('');
  const [strategy, setStrategy] = useState<'include_collateral' | 'start_fresh'>('include_collateral');

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md mx-4 bg-jarvis-bg border border-jarvis-border rounded-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-jarvis-border">
          <div className="flex items-center gap-3">
            <RefreshCw size={16} className="text-orange-400" />
            <h3 className="text-sm font-semibold text-white tracking-wide">REJECT & REDO</h3>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Round transition indicator */}
          <div className="flex items-center justify-center gap-3 text-xs">
            <span className="text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded px-2 py-1 font-bold">
              ROUND {currentRound}
            </span>
            <span className="text-zinc-500">&rarr;</span>
            <span className="text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-2 py-1 font-bold">
              ROUND {currentRound + 1}
            </span>
          </div>

          {/* Mission title */}
          <div className="text-xs text-jarvis-muted">
            Mission: <span className="text-zinc-300">{missionTitle}</span>
          </div>

          {/* Feedback textarea */}
          <div>
            <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">What went wrong?</label>
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="Describe what needs improvement..."
              rows={4}
              autoFocus
              className="w-full bg-jarvis-surface border border-jarvis-border rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-orange-500/40 transition-colors resize-none"
            />
          </div>

          {/* Redo strategy */}
          <div>
            <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Redo Strategy</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStrategy('include_collateral')}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                  strategy === 'include_collateral'
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                    : 'border-jarvis-border text-jarvis-muted hover:text-zinc-300 hover:border-white/[0.12]'
                }`}
              >
                <div className="font-semibold mb-0.5">Include Collateral</div>
                <div className="text-[10px] opacity-70">Agent sees prior work</div>
              </button>
              <button
                type="button"
                onClick={() => setStrategy('start_fresh')}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                  strategy === 'start_fresh'
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                    : 'border-jarvis-border text-jarvis-muted hover:text-zinc-300 hover:border-white/[0.12]'
                }`}
              >
                <div className="font-semibold mb-0.5">Start Fresh</div>
                <div className="text-[10px] opacity-70">Clean slate</div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-jarvis-border">
          <button onClick={onClose} className="px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
          <button
            onClick={() => feedback.trim() && onReject(feedback.trim(), strategy)}
            disabled={!feedback.trim()}
            className="px-4 py-2 text-xs font-semibold rounded-md bg-orange-500/20 border border-orange-500/30 text-orange-400 hover:bg-orange-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            SEND BACK &mdash; START ROUND {currentRound + 1}
          </button>
        </div>
      </div>
    </div>
  );
}
