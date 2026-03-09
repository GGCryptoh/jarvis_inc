import { useState } from 'react';
import { ArrowRight, ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react';
import type { PendingUpgrade } from '../../lib/skillResolver';

interface SkillUpgradeDialogProps {
  upgrades: PendingUpgrade[];
  onApply: (selected: PendingUpgrade[]) => void;
  onSkip: () => void;
}

export default function SkillUpgradeDialog({ upgrades, onApply, onSkip }: SkillUpgradeDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(upgrades.map(u => u.skillId)));

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(upgrades.map(u => u.skillId)));
  const selectNone = () => setSelected(new Set());

  const handleApply = () => {
    const selectedUpgrades = upgrades.filter(u => selected.has(u.skillId));
    onApply(selectedUpgrades);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onSkip} />
      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="bg-jarvis-surface border border-cyan-500/30 rounded-lg shadow-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 bg-cyan-500/[0.06] border-b border-cyan-500/20">
            <RefreshCw size={18} className="text-cyan-400 flex-shrink-0" />
            <div>
              <h2 className="text-cyan-300 font-semibold text-sm tracking-wide">SKILL UPDATES AVAILABLE</h2>
              <p className="text-zinc-500 text-xs mt-0.5">{upgrades.length} skill{upgrades.length !== 1 ? 's' : ''} have new versions</p>
            </div>
          </div>

          {/* Skill list */}
          <div className="px-5 py-3 max-h-[40vh] overflow-y-auto no-scrollbar">
            <div className="flex items-center justify-between mb-3">
              <span className="font-pixel text-[6px] tracking-wider text-zinc-500">
                {selected.size}/{upgrades.length} SELECTED
              </span>
              <div className="flex gap-2">
                <button onClick={selectAll} className="font-pixel text-[6px] tracking-wider text-cyan-400 hover:text-cyan-300">ALL</button>
                <button onClick={selectNone} className="font-pixel text-[6px] tracking-wider text-zinc-500 hover:text-zinc-400">NONE</button>
              </div>
            </div>

            <div className="space-y-2">
              {upgrades.map(upgrade => (
                <label
                  key={upgrade.skillId}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selected.has(upgrade.skillId)
                      ? 'bg-cyan-500/[0.06] border-cyan-500/30'
                      : 'bg-zinc-800/30 border-zinc-700/30 opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(upgrade.skillId)}
                    onChange={() => toggle(upgrade.skillId)}
                    className="accent-cyan-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-200 text-xs font-medium truncate">{upgrade.skillName}</span>
                      {upgrade.checksumValid ? (
                        <ShieldCheck size={12} className="text-emerald-400 flex-shrink-0" />
                      ) : (
                        <ShieldAlert size={12} className="text-amber-400 flex-shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="font-mono text-[10px] text-zinc-500">v{upgrade.currentVersion}</span>
                      <ArrowRight size={10} className="text-zinc-600" />
                      <span className="font-mono text-[10px] text-cyan-400">v{upgrade.newVersion}</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-jarvis-border bg-jarvis-bg/50">
            <button
              onClick={onSkip}
              className="px-4 py-2 text-xs text-jarvis-muted hover:text-jarvis-text border border-jarvis-border rounded transition-colors"
            >
              SKIP
            </button>
            <button
              onClick={handleApply}
              disabled={selected.size === 0}
              className={`px-4 py-2 text-xs rounded transition-colors border ${
                selected.size > 0
                  ? 'text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30'
                  : 'text-zinc-600 bg-zinc-800 border-zinc-700 cursor-not-allowed'
              }`}
            >
              UPDATE {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
