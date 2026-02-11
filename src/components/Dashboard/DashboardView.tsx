import { useState } from 'react'
import { Pencil, X, Target, Check, RefreshCw, Crown } from 'lucide-react'
import { getSetting, setSetting, loadMissions, loadAgents, loadCEO, type MissionRow, type AgentRow } from '../../lib/database'

const priorityColor: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  low: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
}

const statusColor: Record<string, string> = {
  in_progress: 'bg-emerald-500/20 text-emerald-400',
  review: 'bg-yellow-500/20 text-yellow-400',
  done: 'bg-slate-500/20 text-slate-400',
  backlog: 'bg-zinc-500/20 text-zinc-500',
}

const statusLabel: Record<string, string> = {
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  backlog: 'Backlog',
}

function StatCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="bg-jarvis-surface border border-jarvis-border rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-jarvis-muted uppercase tracking-wider">
        {label}
      </span>
      <span className="text-2xl font-bold text-white leading-none">{value}</span>
      {sublabel && <span className="text-[10px] text-zinc-600 mt-0.5">{sublabel}</span>}
    </div>
  )
}

function AgentCard({ agent }: { agent: AgentRow }) {
  return (
    <div className="bg-jarvis-surface border border-jarvis-border rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-white truncate">{agent.name}</h4>
          <p className="text-xs text-jarvis-muted">{agent.role}</p>
        </div>
        <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-400 border border-white/[0.08]">
          {agent.model}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="text-[10px] text-zinc-500">Idle</span>
      </div>
    </div>
  )
}

// Recurring mission icon with hover tooltip
function RecurringBadge({ cron }: { cron: string }) {
  const [showTooltip, setShowTooltip] = useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <RefreshCw size={12} className="text-cyan-400" />
      {showTooltip && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-[10px] text-zinc-300 whitespace-nowrap z-10 shadow-lg">
          <span className="text-cyan-400 font-medium">Recurring:</span> {cron}
        </span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Mission Card — reads/writes primary_mission setting
// ---------------------------------------------------------------------------

function MissionCard() {
  const [mission, setMission] = useState(() => getSetting('primary_mission') ?? '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function openEdit() {
    setDraft(mission);
    setEditing(true);
  }

  function saveEdit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSetting('primary_mission', trimmed);
    setMission(trimmed);
    setEditing(false);
  }

  if (!mission) return null;

  return (
    <>
      <div className="bg-jarvis-surface border border-jarvis-border rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
            <Target size={16} className="text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-jarvis-muted uppercase tracking-wider">
                Primary Mission
              </span>
            </div>
            <p className="text-sm text-zinc-200 leading-relaxed">{mission}</p>
          </div>
          <button
            onClick={openEdit}
            className="flex-shrink-0 w-7 h-7 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.08] transition-colors"
            title="Edit mission"
          >
            <Pencil size={13} />
          </button>
        </div>
      </div>

      {/* Edit Mission Dialog */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setEditing(false)} />
          <div className="relative w-full max-w-lg mx-4 bg-jarvis-bg border border-jarvis-border rounded-lg shadow-2xl">
            {/* Dialog header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-jarvis-border">
              <div className="flex items-center gap-2">
                <Target size={16} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-white tracking-wide">Edit Primary Mission</h3>
              </div>
              <button
                onClick={() => setEditing(false)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Dialog body */}
            <div className="px-5 py-4">
              <label className="block text-xs font-medium text-jarvis-muted uppercase tracking-wider mb-2">
                Mission Statement
              </label>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={4}
                autoFocus
                maxLength={500}
                className="w-full bg-jarvis-surface border border-jarvis-border rounded-lg px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 resize-none"
                placeholder="Describe your organization's primary mission..."
              />
              <div className="flex justify-end mt-1">
                <span className="text-[10px] text-zinc-600 tabular-nums">{draft.length}/500</span>
              </div>
            </div>

            {/* Dialog footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-jarvis-border">
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={!draft.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Check size={14} />
                Save Mission
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function DashboardView() {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const [dbMissions] = useState(() => loadMissions())
  const [agents] = useState(() => loadAgents())
  const [ceo] = useState(() => loadCEO())
  const topMissions = dbMissions.slice(0, 10)

  // Compute real stats from DB
  const agentCount = agents.length
  const activeMissions = dbMissions.filter(m => m.status === 'in_progress').length
  const doneMissions = dbMissions.filter(m => m.status === 'done').length
  const totalMissions = dbMissions.length
  const monthlyBudget = parseFloat(getSetting('monthly_budget') ?? '100')

  function formatDate(iso: string | null): string {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return '—' }
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide">COMMAND CENTER</h1>
          <p className="text-sm text-jarvis-muted mt-0.5">System Overview</p>
        </div>
        <span className="text-xs text-jarvis-muted">{today}</span>
      </div>

      {/* Primary Mission */}
      <MissionCard />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label="Agents" value={String(agentCount)} sublabel={ceo ? `+ CEO ${ceo.name}` : 'No CEO yet'} />
        <StatCard label="Active Missions" value={String(activeMissions)} sublabel={`${totalMissions} total`} />
        <StatCard label="Completed" value={String(doneMissions)} sublabel={totalMissions > 0 ? `${Math.round(doneMissions / totalMissions * 100)}% done` : 'No missions'} />
        <StatCard label="Monthly Budget" value={`$${monthlyBudget}`} sublabel="Edit in Financials" />
        <StatCard label="Total Spend" value="$0.00" sublabel="No LLM calls yet" />
        <StatCard label="System Status" value="Online" sublabel="Demo mode" />
      </div>

      {/* Mission Control */}
      <div className="bg-jarvis-surface border border-jarvis-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-jarvis-border">
          <h2 className="text-sm font-semibold text-white tracking-wide">Mission Control</h2>
        </div>
        {topMissions.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-zinc-500">No missions yet. Complete onboarding to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-jarvis-muted uppercase tracking-wider">
                    Mission
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-jarvis-muted uppercase tracking-wider">
                    Assignee
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-jarvis-muted uppercase tracking-wider">
                    Priority
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-jarvis-muted uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-jarvis-muted uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {topMissions.map((mission) => (
                  <tr
                    key={mission.id}
                    className="border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-2.5 text-zinc-200 font-medium">
                      <span className="flex items-center gap-2">
                        {mission.title}
                        {mission.recurring && <RecurringBadge cron={mission.recurring} />}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400">{mission.assignee ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${priorityColor[mission.priority] ?? 'bg-zinc-500/20 text-zinc-400'}`}
                      >
                        {mission.priority}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColor[mission.status] ?? 'bg-zinc-500/20 text-zinc-500'}`}
                      >
                        {statusLabel[mission.status] ?? mission.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 tabular-nums text-xs">
                      {formatDate(mission.created_at ?? mission.due_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Agent Fleet */}
      <div>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-white tracking-wide">Agent Fleet</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* CEO card */}
          {ceo && (
            <div className="bg-jarvis-surface border border-yellow-500/20 rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-yellow-300 truncate flex items-center gap-1.5">
                    <Crown size={12} />
                    {ceo.name}
                  </h4>
                  <p className="text-xs text-jarvis-muted">Chief Executive Officer</p>
                </div>
                <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-yellow-400/[0.08] text-yellow-400/70 border border-yellow-400/15">
                  {ceo.model}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-[10px] text-zinc-500">{ceo.status === 'nominal' ? 'Online' : ceo.status}</span>
              </div>
            </div>
          )}
          {/* Agent cards */}
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
          {!ceo && agents.length === 0 && (
            <div className="col-span-full bg-jarvis-surface border border-jarvis-border rounded-lg px-4 py-8 text-center">
              <p className="text-xs text-zinc-500">No agents hired yet. Visit Surveillance to hire your first agent.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
