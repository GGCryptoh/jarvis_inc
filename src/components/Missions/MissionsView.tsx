import { missions } from '../../data/dummyData'
import type { Mission } from '../../types'

const priorityColor: Record<Mission['priority'], string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  low: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
}

type ColumnKey = Mission['status']

const columns: { key: ColumnKey; label: string }[] = [
  { key: 'backlog', label: 'BACKLOG' },
  { key: 'in_progress', label: 'IN PROGRESS' },
  { key: 'review', label: 'REVIEW' },
  { key: 'done', label: 'DONE' },
]

const columnAccent: Record<ColumnKey, string> = {
  backlog: 'border-zinc-600',
  in_progress: 'border-emerald-500',
  review: 'border-yellow-500',
  done: 'border-slate-500',
}

const countBadge: Record<ColumnKey, string> = {
  backlog: 'bg-zinc-700/60 text-zinc-400',
  in_progress: 'bg-emerald-500/20 text-emerald-400',
  review: 'bg-yellow-500/20 text-yellow-400',
  done: 'bg-slate-500/20 text-slate-400',
}

function MissionCard({ mission }: { mission: Mission }) {
  return (
    <div className="bg-jarvis-bg border border-jarvis-border rounded-lg p-3 hover:border-white/[0.12] hover:bg-white/[0.02] transition-all duration-150 cursor-default">
      <h3 className="text-sm font-medium text-zinc-200 leading-snug mb-2">
        {mission.title}
      </h3>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs text-jarvis-muted">{mission.assignee}</span>
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${priorityColor[mission.priority]}`}
        >
          {mission.priority}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-zinc-600">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
          <rect x="1.5" y="2.5" width="9" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
          <path d="M1.5 5H10.5" stroke="currentColor" strokeWidth="1" />
          <path d="M4 1V3.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <path d="M8 1V3.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
        <span className="text-[11px] tabular-nums text-zinc-500">{mission.dueDate}</span>
      </div>
    </div>
  )
}

export default function MissionsView() {
  const grouped: Record<ColumnKey, Mission[]> = {
    backlog: [],
    in_progress: [],
    review: [],
    done: [],
  }

  for (const mission of missions) {
    grouped[mission.status].push(mission)
  }

  return (
    <div className="p-6 h-full flex flex-col max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white tracking-wide">MISSION CONTROL</h1>
        <p className="text-sm text-jarvis-muted mt-0.5">Task Management</p>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-4 gap-4 flex-1 min-h-0">
        {columns.map((col) => {
          const items = grouped[col.key]
          return (
            <div key={col.key} className="flex flex-col min-h-0">
              {/* Column Header */}
              <div
                className={`flex items-center justify-between px-3 py-2.5 mb-3 rounded-lg bg-jarvis-surface border-t-2 ${columnAccent[col.key]} border-x border-b border-jarvis-border`}
              >
                <span className="text-xs font-semibold text-zinc-300 tracking-wider">
                  {col.label}
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${countBadge[col.key]}`}
                >
                  {items.length}
                </span>
              </div>

              {/* Column Body */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                {items.length === 0 ? (
                  <div className="flex items-center justify-center h-24 rounded-lg border border-dashed border-white/[0.06] text-xs text-zinc-600">
                    No missions
                  </div>
                ) : (
                  items.map((mission) => (
                    <MissionCard key={mission.id} mission={mission} />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
