import { Search } from 'lucide-react';

interface ResearchOfferCardProps {
  onAccept: () => void;
  onSkip: () => void;
  disabled: boolean;
}

export default function ResearchOfferCard({ onAccept, onSkip, disabled }: ResearchOfferCardProps) {
  return (
    <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.04] overflow-hidden">
      <div className="px-3 py-2 border-b border-amber-400/20 bg-amber-400/[0.06]">
        <div className="font-pixel text-[8px] tracking-widest text-amber-300">
          {'\u265B'} MARKET RESEARCH BRIEF
        </div>
      </div>

      <div className="px-3 py-3 flex items-start gap-2.5">
        <Search size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-pixel text-[9px] tracking-wider text-zinc-200">
            Competitive Landscape Analysis
          </div>
          <div className="font-pixel text-[7px] tracking-wider text-zinc-500 leading-relaxed mt-0.5">
            Market sizing, competitor mapping, key trends & opportunities
          </div>
        </div>
      </div>

      {!disabled && (
        <div className="flex items-center justify-between px-3 py-2.5 border-t border-amber-400/20 bg-amber-400/[0.03]">
          <button
            onClick={onSkip}
            className="font-pixel text-[7px] tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            SKIP FOR NOW
          </button>
          <button
            onClick={onAccept}
            className="retro-button !text-[8px] !py-1.5 !px-4 tracking-widest hover:!text-emerald-400"
          >
            YES, DO IT
          </button>
        </div>
      )}

      {disabled && (
        <div className="flex items-center justify-center px-3 py-2 border-t border-emerald-500/20 bg-emerald-500/[0.04]">
          <span className="font-pixel text-[7px] tracking-wider text-emerald-400">
            {'\u2713'} QUEUED
          </span>
        </div>
      )}
    </div>
  );
}
