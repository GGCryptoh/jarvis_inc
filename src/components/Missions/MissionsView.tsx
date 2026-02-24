import { useState, useCallback, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Plus, RefreshCw, Pencil, Trash2, X, ChevronRight, ChevronLeft, Search, Eye, EyeOff, Play, SkipForward, CheckCheck } from 'lucide-react'
import { loadMissions, saveMission, updateMission, updateMissionStatus, deleteMission, logAudit, loadAgents, loadCEO, loadTaskExecutions, saveConversation, saveChatMessage, getFounderInfo, type MissionRow, type MissionRoundRow } from '../../lib/database'
import { getSupabase } from '../../lib/supabase'

const priorityColor: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  low: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
}

type ColumnKey = 'backlog' | 'scheduled' | 'in_progress' | 'review' | 'done' | 'archived'

const columns: { key: ColumnKey; label: string }[] = [
  { key: 'backlog', label: 'BACKLOG' },
  { key: 'scheduled', label: 'SCHEDULED' },
  { key: 'in_progress', label: 'IN PROGRESS' },
  { key: 'review', label: 'REVIEW' },
  { key: 'done', label: 'DONE' },
  { key: 'archived', label: 'ARCHIVED' },
]

const columnAccent: Record<ColumnKey, string> = {
  backlog: 'border-zinc-600',
  scheduled: 'border-blue-500',
  in_progress: 'border-emerald-500',
  review: 'border-yellow-500',
  done: 'border-slate-500',
  archived: 'border-zinc-700',
}

const countBadge: Record<ColumnKey, string> = {
  backlog: 'bg-zinc-700/60 text-zinc-400',
  scheduled: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-emerald-500/20 text-emerald-400',
  review: 'bg-yellow-500/20 text-yellow-400',
  done: 'bg-slate-500/20 text-slate-400',
  archived: 'bg-zinc-700/60 text-zinc-500',
}

const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
const STATUSES: ColumnKey[] = ['backlog', 'scheduled', 'in_progress', 'review', 'done', 'archived']
const STATUS_LABELS: Record<ColumnKey, string> = {
  backlog: 'Backlog',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  archived: 'Archived',
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
        <span className="fixed -translate-x-1/2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-[10px] text-zinc-300 whitespace-nowrap z-[100] shadow-lg pointer-events-none" style={{ marginTop: '-2.5rem' }}>
          <span className="text-cyan-400 font-medium">Recurring:</span> {cron}
        </span>
      )}
    </span>
  )
}

const gradeColor: Record<string, string> = {
  'A+': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'A': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'B+': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'B': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'B-': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'C+': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'C': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'C-': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'D': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'F': 'bg-red-500/20 text-red-400 border-red-500/30',
}

function MissionCard({
  mission,
  onEdit,
  onMove,
  onRunNow,
  onSkipNext,
  latestGrade,
}: {
  mission: MissionRow
  onEdit: (m: MissionRow) => void
  onMove: (id: string, dir: 'left' | 'right') => void
  onRunNow: (m: MissionRow) => void
  onSkipNext: (m: MissionRow) => void
  latestGrade: string | null
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
        <Link
          to={`/missions/${mission.id}`}
          className="hover:text-emerald-400 transition-colors"
          onClick={e => e.stopPropagation()}
        >
          {mission.title}
        </Link>
        {mission.recurring && <RecurringBadge cron={mission.recurring} />}
        {mission.recurring && mission.max_runs != null && (
          <span className="text-[8px] font-bold tracking-wider text-violet-400 bg-violet-500/15 border border-violet-500/30 rounded px-1.5 py-0.5 flex-shrink-0">
            {mission.run_count ?? 0}/{mission.max_runs}
          </span>
        )}
        {(mission.current_round ?? 1) > 1 && (
          <span className="text-[8px] font-bold tracking-wider text-cyan-400 bg-cyan-500/15 border border-cyan-500/30 rounded px-1.5 py-0.5 flex-shrink-0">
            R{mission.current_round}
          </span>
        )}
        {latestGrade && (
          <span className={`text-[8px] font-bold tracking-wider rounded px-1.5 py-0.5 flex-shrink-0 border ${gradeColor[latestGrade] ?? 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'}`}>
            {latestGrade}
          </span>
        )}
        {mission.status === 'on_hold' && (
          <span className="text-[8px] font-bold tracking-widest text-amber-400 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5 flex-shrink-0">
            ON HOLD
          </span>
        )}
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
          {mission.scheduled_for && (() => {
            const raw = String(mission.scheduled_for);
            const d = new Date(raw.endsWith('Z') || raw.includes('+') ? raw : raw + 'Z');
            return isNaN(d.getTime()) ? null : (
              <span className="text-[10px] tabular-nums text-blue-400 ml-1">
                · {d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            );
          })()}
          {mission.recurring && mission.last_recurred_at && (
            <span className="text-[10px] tabular-nums text-zinc-600 ml-1">
              · Last run: {new Date(mission.last_recurred_at + (mission.last_recurred_at.endsWith('Z') ? '' : 'Z')).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* Quick actions — visible on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {mission.recurring && (
            <>
              <button
                onClick={e => { e.stopPropagation(); onRunNow(mission); }}
                className="w-6 h-6 flex items-center justify-center rounded text-cyan-500 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                title="Run Now"
              >
                <Play size={11} />
              </button>
              <button
                onClick={e => { e.stopPropagation(); onSkipNext(mission); }}
                className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
                title="Skip Next Run"
              >
                <SkipForward size={11} />
              </button>
            </>
          )}
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
  onSave: (data: { title: string; status: ColumnKey; assignee: string; priority: string; due_date: string; recurring: string; recurring_mode: string; goal: string; max_runs: number | null }) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const isEditing = !!mission
  const [title, setTitle] = useState(mission?.title ?? '')
  const [goal, setGoal] = useState('')
  const [status, setStatus] = useState<ColumnKey>((mission?.status as ColumnKey) ?? defaultStatus)
  const [assignee, setAssignee] = useState(mission?.assignee ?? '')
  const [priority, setPriority] = useState(mission?.priority ?? 'medium')
  const [dueDate, setDueDate] = useState(mission?.due_date ?? '')
  const [recurring, setRecurring] = useState(mission?.recurring ?? '')
  const [recurringMode, setRecurringMode] = useState<'auto' | 'evaluate'>((mission as any)?.recurring_mode ?? 'evaluate')
  const [maxRuns, setMaxRuns] = useState<string>(mission?.max_runs != null ? String(mission.max_runs) : '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [error, setError] = useState('')

  // ESC to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

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

          {/* Goal — create mode only */}
          {!isEditing && (
            <div>
              <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Goal / Brief</label>
              <textarea
                value={goal}
                onChange={e => setGoal(e.target.value)}
                placeholder="What should this mission accomplish? The CEO will review this brief..."
                rows={3}
                className="w-full bg-jarvis-surface border border-jarvis-border rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-colors resize-none"
              />
            </div>
          )}

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
              <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Recurring (cron)</label>
              <input
                type="text"
                value={recurring}
                onChange={e => setRecurring(e.target.value)}
                placeholder="e.g. 0 9 * * 1"
                className="w-full bg-jarvis-surface border border-jarvis-border rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-colors"
              />
            </div>
          </div>

          {/* Recurring Mode + Max Runs — only visible when recurring is set */}
          {recurring.trim() && (
            <>
              <div>
                <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Recurring Mode</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setRecurringMode('auto')}
                    title="Each recurrence is dispatched immediately to the assigned agent without CEO review. Best for routine tasks like daily reports or scheduled checks."
                    className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                      recurringMode === 'auto'
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                        : 'border-jarvis-border text-jarvis-muted hover:text-zinc-300 hover:border-white/[0.12]'
                    }`}
                  >
                    <div className="font-semibold mb-0.5">Auto</div>
                    <div className="text-[10px] opacity-70">Dispatch immediately</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecurringMode('evaluate')}
                    title="CEO evaluates each recurrence before dispatching — may adjust priority, reassign agents, or skip based on current workload and context."
                    className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                      recurringMode === 'evaluate'
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                        : 'border-jarvis-border text-jarvis-muted hover:text-zinc-300 hover:border-white/[0.12]'
                    }`}
                  >
                    <div className="font-semibold mb-0.5">Evaluate</div>
                    <div className="text-[10px] opacity-70">CEO decides each time</div>
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-1.5">Max Runs</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={maxRuns}
                  onChange={e => setMaxRuns(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full bg-jarvis-surface border border-jarvis-border rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-colors"
                />
                <p className="text-[10px] text-zinc-600 mt-1">Leave empty for infinite runs</p>
              </div>
            </>
          )}

          {/* Validation error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
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
              onClick={() => {
                if (!valid) return
                // Validate cron if provided
                if (recurring.trim()) {
                  const cronParts = recurring.trim().split(/\s+/)
                  if (cronParts.length !== 5) {
                    setError('Invalid cron expression. Must have 5 fields: minute hour day-of-month month day-of-week (e.g. "0 9 * * 1")')
                    return
                  }
                }
                setError('')
                const parsedMaxRuns = maxRuns.trim() ? parseInt(maxRuns.trim(), 10) : null
                onSave({ title: title.trim(), status, assignee: assignee.trim(), priority, due_date: dueDate, recurring, recurring_mode: recurring.trim() ? recurringMode : '', goal: goal.trim(), max_runs: (parsedMaxRuns && parsedMaxRuns > 0) ? parsedMaxRuns : null })
              }}
              disabled={!valid}
              className="px-4 py-2 text-xs font-semibold rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isEditing ? 'Save Changes' : 'MISSION BRIEF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mission Review Dialog (task outputs + approve/discard)
// ---------------------------------------------------------------------------

function MissionReviewDialog({ mission, onClose }: { mission: MissionRow; onClose: () => void }) {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadTaskExecutions(mission.id).then(data => {
      setTasks(data)
      setLoading(false)
    })
  }, [mission.id])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const totalCost = tasks.reduce((sum: number, t: any) => sum + (t.cost_usd ?? 0), 0)
  const totalTokens = tasks.reduce((sum: number, t: any) => sum + (t.tokens_used ?? 0), 0)

  const handleApprove = async () => {
    await updateMissionStatus(mission.id, 'done')
    await logAudit('Founder', 'MISSION_APPROVED', `Approved: ${mission.title} ($${totalCost.toFixed(4)})`, 'info')
    window.dispatchEvent(new Event('missions-changed'))
    onClose()
  }

  const handleDiscard = async () => {
    await updateMissionStatus(mission.id, 'done')
    await logAudit('Founder', 'MISSION_DISCARDED', `Discarded: ${mission.title}`, 'warning')
    window.dispatchEvent(new Event('missions-changed'))
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-8">
      <div className="bg-jarvis-surface border border-white/[0.08] rounded-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1">MISSION REVIEW</div>
            <h2 className="text-lg font-bold text-jarvis-text">{mission.title}</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-sm">&#x2715;</button>
        </div>

        {/* Stats */}
        <div className="px-6 py-3 border-b border-white/[0.06] flex items-center gap-6 text-xs text-jarvis-muted">
          <span>{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
          <span>{totalTokens.toLocaleString()} tokens</span>
          <span>${totalCost.toFixed(4)} total cost</span>
        </div>

        {/* Task outputs */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading ? (
            <div className="text-sm text-jarvis-muted text-center py-8">Loading task results...</div>
          ) : tasks.length === 0 ? (
            <div className="text-sm text-jarvis-muted text-center py-8">No task results found</div>
          ) : tasks.map((task: any) => (
            <div key={task.id} className="border border-white/[0.06] rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.04] flex items-center justify-between">
                <span className="text-xs font-medium text-jarvis-text">{task.skill_id} / {task.command_name}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  task.status === 'completed' ? 'text-emerald-400' : task.status === 'failed' ? 'text-red-400' : 'text-cyan-400'
                }`}>
                  {task.status}
                </span>
              </div>
              <div className="px-4 py-3 text-sm text-jarvis-muted whitespace-pre-line leading-relaxed max-h-64 overflow-y-auto">
                {task.result?.output ?? task.result?.error ?? 'No output'}
              </div>
              {task.cost_usd != null && (
                <div className="px-4 py-2 bg-white/[0.01] border-t border-white/[0.04] text-[10px] text-zinc-600">
                  {task.tokens_used?.toLocaleString()} tokens &middot; ${task.cost_usd.toFixed(4)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-white/[0.06] flex items-center justify-end gap-3">
          <button
            onClick={handleDiscard}
            className="px-4 py-2 text-xs font-medium text-zinc-500 hover:text-red-400 transition-colors"
          >
            DISCARD
          </button>
          <button
            onClick={handleApprove}
            className="px-5 py-2 text-xs font-bold text-black bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors"
          >
            APPROVE
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export default function MissionsView() {
  const navigate = useNavigate()
  const [dbMissions, setDbMissions] = useState<MissionRow[]>([])
  const [dialogState, setDialogState] = useState<{ mission: MissionRow | null; defaultStatus: ColumnKey } | null>(null)
  const [reviewMission, setReviewMission] = useState<MissionRow | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [missionGrades, setMissionGrades] = useState<Record<string, string>>({})
  const [confirmArchiveAll, setConfirmArchiveAll] = useState(false)
  const [confirmApproveAll, setConfirmApproveAll] = useState(false)

  const refresh = useCallback(() => {
    loadMissions().then(setDbMissions)
    // Load latest grades for all missions that have rounds (non-blocking)
    getSupabase().from('mission_rounds').select('mission_id, grade, round_number').not('grade', 'is', null)
      .order('round_number', { ascending: false })
      .then(({ data, error }) => {
        if (error || !data) return
        const grades: Record<string, string> = {}
        for (const row of data) {
          if (!grades[row.mission_id] && row.grade) {
            grades[row.mission_id] = row.grade
          }
        }
        setMissionGrades(grades)
      })
  }, [])

  // Load on mount + listen for missions-changed / task-executions-changed events
  useEffect(() => {
    refresh()
    window.addEventListener('missions-changed', refresh)
    window.addEventListener('task-executions-changed', refresh)
    return () => {
      window.removeEventListener('missions-changed', refresh)
      window.removeEventListener('task-executions-changed', refresh)
    }
  }, [refresh])

  // Filter missions by search query
  const filtered = searchQuery.trim()
    ? dbMissions.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : dbMissions

  const grouped: Record<ColumnKey, MissionRow[]> = {
    backlog: [],
    scheduled: [],
    in_progress: [],
    review: [],
    done: [],
    archived: [],
  }

  for (const mission of filtered) {
    // on_hold missions display in the backlog column with a badge
    const status = (mission.status === 'on_hold' ? 'backlog' : mission.status) as ColumnKey
    if (grouped[status]) {
      grouped[status].push(mission)
    }
  }

  const visibleColumns = showArchived ? columns : columns.filter(c => c.key !== 'archived')

  function handleCreate(status: ColumnKey) {
    setDialogState({ mission: null, defaultStatus: status })
  }

  function handleEdit(mission: MissionRow) {
    setDialogState({ mission, defaultStatus: mission.status as ColumnKey })
  }

  async function handleRunNow(mission: MissionRow) {
    const { spawnRecurringChild } = await import('../../lib/ceoDecisionEngine')
    await spawnRecurringChild(mission)
    refresh()
  }

  async function handleSkipNext(mission: MissionRow) {
    const { getSupabase } = await import('../../lib/supabase')
    await getSupabase().from('missions')
      .update({ last_recurred_at: new Date().toISOString() })
      .eq('id', mission.id)
    refresh()
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

    // Auto-dispatch tasks when moving to in_progress
    if (newStatus === 'in_progress') {
      import('../../lib/taskDispatcher').then(({ autoDispatchMission }) => {
        autoDispatchMission(id).catch(err => console.warn('[MissionsView] Auto-dispatch failed:', err))
      })
    }

    refresh()
  }

  async function handleSave(data: { title: string; status: ColumnKey; assignee: string; priority: string; due_date: string; recurring: string; recurring_mode: string; goal: string; max_runs: number | null }) {
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
        recurring_mode: data.recurring_mode || null,
        max_runs: data.recurring?.trim() ? data.max_runs : null,
      })
      await logAudit(null, 'MISSION_EDIT', `Edited mission "${data.title}"`, 'info')
      setDialogState(null)
      refresh()
    } else {
      // Create new — save mission then open CEO chat for review
      const missionId = `mission-${Date.now()}`
      await saveMission({
        id: missionId,
        title: data.title,
        status: data.status,
        assignee: data.assignee || null,
        priority: data.priority,
        due_date: data.due_date || null,
        recurring: data.recurring || null,
        max_runs: data.recurring?.trim() ? data.max_runs : null,
        created_at: new Date().toISOString(),
      })
      await logAudit(null, 'MISSION_BRIEF', `Mission brief: "${data.title}"`, 'info')

      // Create a new conversation for CEO review
      const convId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const founderInfo = await getFounderInfo()
      const ceo = await loadCEO()
      const ceoName = ceo?.name ?? 'CEO'

      await saveConversation({
        id: convId,
        title: `Mission Brief: ${data.title}`,
        type: 'general',
        status: 'active',
      })

      // Seed with the mission brief as a user message
      const briefText = [
        `**MISSION BRIEF**`,
        `**Title:** ${data.title}`,
        data.goal ? `**Goal:** ${data.goal}` : null,
        `**Priority:** ${data.priority}`,
        data.assignee ? `**Suggested Assignee:** ${data.assignee}` : null,
        data.due_date ? `**Due:** ${data.due_date}` : null,
        data.recurring ? `**Recurring:** ${data.recurring}` : null,
        ``,
        `Please review this mission brief. Ask any clarifying questions before we lock it in.`,
      ].filter(Boolean).join('\n')

      await saveChatMessage({
        id: `msg-${Date.now()}-brief`,
        conversation_id: convId,
        sender: 'user',
        text: briefText,
        metadata: { type: 'mission_brief', mission_id: missionId },
      })

      setDialogState(null)
      // Navigate to chat with this conversation
      navigate(`/chat?conversation=${convId}`)
    }
  }

  async function handleDelete() {
    if (!dialogState?.mission) return
    const { mission } = dialogState
    await logAudit(null, 'MISSION_DEL', `Deleted mission "${mission.title}"`, 'warning')
    await deleteMission(mission.id)
    setDialogState(null)
    refresh()
  }

  async function handleApproveAllReview() {
    const reviewMissions = grouped['review']
    if (reviewMissions.length === 0) return
    for (const m of reviewMissions) {
      await updateMissionStatus(m.id, 'done')
    }
    await logAudit(null, 'MISSION_APPROVE_ALL', `Approved ${reviewMissions.length} review mission(s) to done`, 'info')
    setConfirmApproveAll(false)
    window.dispatchEvent(new Event('missions-changed'))
    refresh()
  }

  async function handleArchiveAllDone() {
    const doneMissions = grouped['done']
    if (doneMissions.length === 0) return
    for (const m of doneMissions) {
      await updateMission(m.id, { status: 'archived' })
    }
    await logAudit(null, 'MISSION_ARCHIVE_ALL', `Archived ${doneMissions.length} done mission(s)`, 'info')
    setConfirmArchiveAll(false)
    refresh()
  }

  return (
    <div className="p-6 h-full flex flex-col max-w-[1800px] mx-auto">
      {/* Header + Search + Archived Toggle */}
      <div className="flex items-center justify-between mb-4 gap-4">
        <div className="shrink-0">
          <h1 className="text-xl font-bold text-white tracking-wide">MISSION CONTROL</h1>
          <p className="text-sm text-jarvis-muted mt-0.5">Task Management</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search missions..."
              className="bg-jarvis-surface border border-jarvis-border rounded-lg pl-8 pr-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-colors w-56"
            />
          </div>
          {/* Archived Toggle */}
          <button
            onClick={() => setShowArchived(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${
              showArchived
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                : 'border-jarvis-border bg-jarvis-surface text-zinc-500 hover:text-zinc-300 hover:border-white/[0.12]'
            }`}
            title={showArchived ? 'Hide archived column' : 'Show archived column'}
          >
            {showArchived ? <Eye size={13} /> : <EyeOff size={13} />}
            ARCHIVED
          </button>
        </div>
      </div>

      {/* Kanban Board */}
      <div className={`grid gap-4 flex-1 min-h-0 ${showArchived ? 'grid-cols-6' : 'grid-cols-5'}`}>
        {visibleColumns.map((col) => {
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
                  {(col.key === 'backlog' || col.key === 'scheduled') && (
                    <button
                      onClick={() => handleCreate(col.key)}
                      className="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                      title={`Add to ${col.label}`}
                    >
                      <Plus size={12} />
                    </button>
                  )}
                  {col.key === 'review' && items.length > 0 && (
                    confirmApproveAll ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleApproveAllReview()}
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors"
                        >
                          YES
                        </button>
                        <button
                          onClick={() => setConfirmApproveAll(false)}
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          NO
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmApproveAll(true)}
                        className="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                        title="Approve all — move to done"
                      >
                        <CheckCheck size={12} />
                      </button>
                    )
                  )}
                  {col.key === 'done' && items.length > 0 && (
                    confirmArchiveAll ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleArchiveAllDone()}
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                        >
                          YES
                        </button>
                        <button
                          onClick={() => setConfirmArchiveAll(false)}
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          NO
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmArchiveAll(true)}
                        className="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Archive all done missions"
                      >
                        <Trash2 size={12} />
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Column Body */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                {items.length === 0 ? (
                  (col.key === 'backlog' || col.key === 'scheduled') ? (
                    <button
                      onClick={() => handleCreate(col.key)}
                      className="flex items-center justify-center h-24 w-full rounded-lg border border-dashed border-white/[0.06] text-xs text-zinc-600 hover:border-white/[0.12] hover:text-zinc-400 transition-colors"
                    >
                      + Add mission
                    </button>
                  ) : (
                    <div className="flex items-center justify-center h-24 w-full text-xs text-zinc-700">
                      No missions
                    </div>
                  )
                ) : (
                  items.map((mission) => (
                    <div
                      key={mission.id}
                      onClick={() => {
                        if (mission.status === 'review') setReviewMission(mission)
                      }}
                      className={mission.status === 'review' ? 'cursor-pointer' : ''}
                    >
                      <MissionCard
                        mission={mission}
                        onEdit={handleEdit}
                        onMove={handleMove}
                        onRunNow={handleRunNow}
                        onSkipNext={handleSkipNext}
                        latestGrade={missionGrades[mission.id] ?? null}
                      />
                    </div>
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

      {/* Mission Review Dialog */}
      {reviewMission && (
        <MissionReviewDialog
          mission={reviewMission}
          onClose={() => { setReviewMission(null); refresh(); }}
        />
      )}
    </div>
  )
}
