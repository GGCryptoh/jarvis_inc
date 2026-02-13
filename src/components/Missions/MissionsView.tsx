import { useState, useCallback, useEffect } from 'react'
import { Plus, RefreshCw, Pencil, Trash2, X, ChevronRight, ChevronLeft } from 'lucide-react'
import { loadMissions, saveMission, updateMission, deleteMission, logAudit, loadAgents, loadCEO, type MissionRow } from '../../lib/database'

const priorityColor: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  low: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
}

type ColumnKey = 'backlog' | 'in_progress' | 'review' | 'done'

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

const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
const STATUSES: ColumnKey[] = ['backlog', 'in_progress', 'review', 'done']
const STATUS_LABELS: Record<ColumnKey, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
}

function RecurringBadge({ cron }: { cron: string }) {
  const [showTooltip, setShowTooltip] = useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <RefreshCw size={11} className="text-cyan-400" />
      {showTooltip && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-[10px] text-zinc-300 whitespace-nowrap z-10 shadow-lg">
          <span className="text-cyan-400 font-medium">Recurring:</span> {cron}
        </span>
      )}
    </span>
  )
}

function MissionCard({
  mission,
  onEdit,
  onMove,
}: {
  mission: MissionRow
  onEdit: (m: MissionRow) => void
  onMove: (id: string, dir: 'left' | 'right') => void
}) {
  function formatDate(iso: string | null): string {
    if (!iso) return '\u2014'
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch { return '\u2014' }
  }

  const colIdx = STATUSES.indexOf(mission.status as ColumnKey)
  const canLeft = colIdx > 0
  const canRight = colIdx < STATUSES.length - 1

  return (
    <div className="bg-jarvis-bg border border-jarvis-border rounded-lg p-3 hover:border-white/[0.12] hover:bg-white/[0.02] transition-all duration-150 group">
      <h3 className="text-sm font-medium text-zinc-200 leading-snug mb-2 flex items-center gap-1.5">
        {mission.title}
        {mission.recurring && <RecurringBadge cron={mission.recurring} />}
      </h3>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs text-jarvis-muted">{mission.assignee ?? '\u2014'}</span>
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${priorityColor[mission.priority] ?? 'bg-zinc-500/20 text-zinc-400'}`}
        >
          {mission.priority}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-zinc-600">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
            <rect x="1.5" y="2.5" width="9" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
            <path d="M1.5 5H10.5" stroke="currentColor" strokeWidth="1" />
            <path d="M4 1V3.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            <path d="M8 1V3.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
          <span className="text-[11px] tabular-nums text-zinc-500">{formatDate(mission.created_at ?? mission.due_date)}</span>
        </div>

        {/* Quick actions — visible on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {canLeft && (
            <button
              onClick={e => { e.stopPropagation(); onMove(mission.id, 'left'); }}
              className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
              title={`Move to ${STATUS_LABELS[STATUSES[colIdx - 1]]}`}
            >
              <ChevronLeft size={12} />
            </button>
          )}
          {canRight && (
            <button
              onClick={e => { e.stopPropagation(); onMove(mission.id, 'right'); }}
              className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
              title={`Move to ${STATUS_LABELS[STATUSES[colIdx + 1]]}`}
            >
              <ChevronRight size={12} />
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onEdit(mission); }}
            className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
            title="Edit"
          >
            <Pencil size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create / Edit Mission Dialog
// ---------------------------------------------------------------------------

function MissionDialog({
  mission,
  defaultStatus,
  onSave,
  onDelete,
  onClose,
}: {
  mission: MissionRow | null
  defaultStatus: ColumnKey
  onSave: (data: { title: string; status: ColumnKey; assignee: string; priority: string; due_date: string; recurring: string }) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const isEditing = !!mission
  const [title, setTitle] = useState(mission?.title ?? '')
  const [status, setStatus] = useState<ColumnKey>((mission?.status as ColumnKey) ?? defaultStatus)
  const [assignee, setAssignee] = useState(mission?.assignee ?? '')
  const [priority, setPriority] = useState(mission?.priority ?? 'medium')
  const [dueDate, setDueDate] = useState(mission?.due_date ?? '')
  const [recurring, setRecurring] = useState(mission?.recurring ?? '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Load available assignees
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([])
  useEffect(() => {
    async function loadAssignees() {
      const names: string[] = []
      const ceo = await loadCEO()
      if (ceo) names.push(ceo.name)
      const agents = await loadAgents()
      agents.forEach(a => names.push(a.name))
      setAssigneeOptions(names)
    }
    loadAssignees()
  }, [])

  const valid = title.trim().length > 0

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md mx-4 bg-jarvis-bg border border-jarvis-border rounded-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-jarvis-border">
          <h3 className="text-sm font-semibold text-white tracking-wide">
            {isEditing ? 'EDIT MISSION' : 'NEW MISSION'}
          </h3>
          <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Mission title..."
              autoFocus
              maxLength={120}
              className="w-full bg-jarvis-surface border border-jarvis-border rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-colors"
            />
          </div>

          {/* Status + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as ColumnKey)}
                className="w-full bg-jarvis-surface border border-jarvis-border rounded-lg px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/40 transition-colors"
              >
                {STATUSES.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="w-full bg-jarvis-surface border border-jarvis-border rounded-lg px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/40 transition-colors"
              >
                {PRIORITIES.map(p => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Assignee</label>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {assigneeOptions.map(name => (
                <button
                  key={name}
                  onClick={() => setAssignee(assignee === name ? '' : name)}
                  className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                    assignee === name
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                      : 'border-white/[0.08] text-jarvis-muted hover:text-jarvis-text hover:border-white/[0.15]'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={assignee}
              onChange={e => setAssignee(e.target.value)}
              placeholder="Or type a name..."
              className="w-full bg-jarvis-surface border border-jarvis-border rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-colors"
            />
          </div>

          {/* Due Date + Recurring row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full bg-jarvis-surface border border-jarvis-border rounded-lg px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/40 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Recurring</label>
              <input
                type="text"
                value={recurring}
                onChange={e => setRecurring(e.target.value)}
                placeholder="e.g. Mon 9am"
                className="w-full bg-jarvis-surface border border-jarvis-border rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-jarvis-border">
          <div>
            {isEditing && onDelete && (
              !showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md transition-colors"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={onDelete}
                    className="px-3 py-2 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/30 rounded-md hover:bg-red-500/20 transition-colors"
                  >
                    Confirm Delete
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => valid && onSave({ title: title.trim(), status, assignee: assignee.trim(), priority, due_date: dueDate, recurring })}
              disabled={!valid}
              className="px-4 py-2 text-xs font-semibold rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isEditing ? 'Save Changes' : 'Create Mission'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export default function MissionsView() {
  const [dbMissions, setDbMissions] = useState<MissionRow[]>([])
  const [dialogState, setDialogState] = useState<{ mission: MissionRow | null; defaultStatus: ColumnKey } | null>(null)

  useEffect(() => { loadMissions().then(setDbMissions) }, [])

  const refresh = useCallback(() => { loadMissions().then(setDbMissions) }, [])

  const grouped: Record<ColumnKey, MissionRow[]> = {
    backlog: [],
    in_progress: [],
    review: [],
    done: [],
  }

  for (const mission of dbMissions) {
    const status = mission.status as ColumnKey
    if (grouped[status]) {
      grouped[status].push(mission)
    }
  }

  function handleCreate(status: ColumnKey) {
    setDialogState({ mission: null, defaultStatus: status })
  }

  function handleEdit(mission: MissionRow) {
    setDialogState({ mission, defaultStatus: mission.status as ColumnKey })
  }

  async function handleMove(id: string, dir: 'left' | 'right') {
    const mission = dbMissions.find(m => m.id === id)
    if (!mission) return
    const colIdx = STATUSES.indexOf(mission.status as ColumnKey)
    const newIdx = dir === 'left' ? colIdx - 1 : colIdx + 1
    if (newIdx < 0 || newIdx >= STATUSES.length) return
    const newStatus = STATUSES[newIdx]
    await updateMission(id, { status: newStatus })
    await logAudit(null, 'MISSION_MOVE', `Moved "${mission.title}" to ${STATUS_LABELS[newStatus]}`, 'info')
    refresh()
  }

  async function handleSave(data: { title: string; status: ColumnKey; assignee: string; priority: string; due_date: string; recurring: string }) {
    if (!dialogState) return
    const { mission } = dialogState

    if (mission) {
      // Edit existing
      await updateMission(mission.id, {
        title: data.title,
        status: data.status,
        assignee: data.assignee || null,
        priority: data.priority,
        due_date: data.due_date || null,
        recurring: data.recurring || null,
      })
      await logAudit(null, 'MISSION_EDIT', `Edited mission "${data.title}"`, 'info')
    } else {
      // Create new
      await saveMission({
        id: `mission-${Date.now()}`,
        title: data.title,
        status: data.status,
        assignee: data.assignee || null,
        priority: data.priority,
        due_date: data.due_date || null,
        recurring: data.recurring || null,
        created_at: new Date().toISOString(),
      })
      await logAudit(null, 'MISSION_NEW', `Created mission "${data.title}" in ${STATUS_LABELS[data.status]}`, 'info')
    }

    setDialogState(null)
    refresh()
  }

  async function handleDelete() {
    if (!dialogState?.mission) return
    const { mission } = dialogState
    await logAudit(null, 'MISSION_DEL', `Deleted mission "${mission.title}"`, 'warning')
    await deleteMission(mission.id)
    setDialogState(null)
    refresh()
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
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${countBadge[col.key]}`}
                  >
                    {items.length}
                  </span>
                  <button
                    onClick={() => handleCreate(col.key)}
                    className="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                    title={`Add to ${col.label}`}
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>

              {/* Column Body */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                {items.length === 0 ? (
                  <button
                    onClick={() => handleCreate(col.key)}
                    className="flex items-center justify-center h-24 w-full rounded-lg border border-dashed border-white/[0.06] text-xs text-zinc-600 hover:border-white/[0.12] hover:text-zinc-400 transition-colors"
                  >
                    + Add mission
                  </button>
                ) : (
                  items.map((mission) => (
                    <MissionCard
                      key={mission.id}
                      mission={mission}
                      onEdit={handleEdit}
                      onMove={handleMove}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Mission Dialog */}
      {dialogState && (
        <MissionDialog
          mission={dialogState.mission}
          defaultStatus={dialogState.defaultStatus}
          onSave={handleSave}
          onDelete={dialogState.mission ? handleDelete : undefined}
          onClose={() => setDialogState(null)}
        />
      )}
    </div>
  )
}
