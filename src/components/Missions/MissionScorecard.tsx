interface MissionScorecardProps {
  quality: number;
  completeness: number;
  efficiency: number;
  overall: number;
  grade: string;
  review: string;
  recommendation: string;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 60 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-jarvis-muted uppercase tracking-wider w-28 text-right shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-mono text-zinc-300 w-8 text-right">{value}%</span>
    </div>
  );
}

export const gradeColors: Record<string, string> = {
  'A+': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'A': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'B+': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'B': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'B-': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'C+': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'C': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'C-': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'D': 'bg-red-500/20 text-red-400 border-red-500/30',
  'F': 'bg-red-500/20 text-red-400 border-red-500/30',
};

const recColors: Record<string, string> = {
  approve: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  needs_revision: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  reject: 'bg-red-500/10 text-red-400 border-red-500/20',
};

const recLabels: Record<string, string> = {
  approve: 'APPROVED',
  needs_revision: 'NEEDS REVISION',
  reject: 'REJECTED',
};

export default function MissionScorecard({ quality, completeness, efficiency, overall, grade, review, recommendation }: MissionScorecardProps) {
  return (
    <div className="bg-jarvis-surface border border-white/[0.06] rounded-xl p-5 space-y-4">
      {/* Header with grade badge */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">CEO EVALUATION</span>
        <span className={`text-lg font-bold px-3 py-1 rounded-lg border ${gradeColors[grade] ?? 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'}`}>
          {grade}
        </span>
      </div>

      {/* Score bars */}
      <div className="space-y-2.5">
        <ScoreBar label="Quality" value={quality} />
        <ScoreBar label="Completeness" value={completeness} />
        <ScoreBar label="Efficiency" value={efficiency} />
        <ScoreBar label="Overall" value={overall} />
      </div>

      {/* Review text */}
      {review && (
        <p className="text-sm text-zinc-400 leading-relaxed italic border-l-2 border-white/[0.08] pl-3">
          &ldquo;{review}&rdquo;
        </p>
      )}

      {/* Recommendation badge */}
      <div className="flex justify-end">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full border ${recColors[recommendation] ?? 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'}`}>
          {recLabels[recommendation] ?? recommendation.replace(/_/g, ' ').toUpperCase()}
        </span>
      </div>
    </div>
  );
}
