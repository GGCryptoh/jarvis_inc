import { dashboardStats, initialAgents, missions } from '../../data/dummyData'
import type { Agent, DashboardStat, Mission } from '../../types'

const priorityColor: Record<Mission['priority'], string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  low: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
}

const statusColor: Record<Mission['status'], string> = {
  in_progress: 'bg-emerald-500/20 text-emerald-400',
  review: 'bg-yellow-500/20 text-yellow-400',
  done: 'bg-slate-500/20 text-slate-400',
  backlog: 'bg-zinc-500/20 text-zinc-500',
}

const statusLabel: Record<Mission['status'], string> = {
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  backlog: 'Backlog',
}

function TrendArrow({ trend, change }: { trend: DashboardStat['trend']; change: string }) {
  if (trend === 'up') {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-400">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M6 2.5L9.5 6.5H2.5L6 2.5Z" fill="currentColor" />
        </svg>
        {change}
      </span>
    )
  }
  if (trend === 'down') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-400">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M6 9.5L2.5 5.5H9.5L6 9.5Z" fill="currentColor" />
        </svg>
        {change}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-zinc-500">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <rect x="2" y="5" width="8" height="2" rx="1" fill="currentColor" />
      </svg>
      {change}
    </span>
  )
}

function StatCard({ stat }: { stat: DashboardStat }) {
  return (
    <div className="bg-jarvis-surface border border-jarvis-border rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-jarvis-muted uppercase tracking-wider">
        {stat.label}
      </span>
      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-bold text-white leading-none">{stat.value}</span>
        <TrendArrow trend={stat.trend} change={stat.change} />
      </div>
    </div>
  )
}

function AgentCard({ agent }: { agent: Agent }) {
  const confidenceWidth = `${agent.confidence}%`
  const confidenceColor =
    agent.confidence >= 90
      ? 'bg-emerald-500'
      : agent.confidence >= 75
        ? 'bg-yellow-500'
        : 'bg-red-500'

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
      <p className="text-xs text-zinc-400 truncate" title={agent.currentTask}>
        {agent.currentTask}
      </p>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className={`h-full rounded-full ${confidenceColor} transition-all duration-500`}
            style={{ width: confidenceWidth }}
          />
        </div>
        <span className="text-[10px] font-medium text-zinc-500 tabular-nums">
          {agent.confidence}%
        </span>
      </div>
    </div>
  )
}

export default function DashboardView() {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const topMissions = missions.slice(0, 5)
  const fleetAgents = initialAgents.slice(0, 6)

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

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {dashboardStats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </div>

      {/* Active Operations */}
      <div className="bg-jarvis-surface border border-jarvis-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-jarvis-border">
          <h2 className="text-sm font-semibold text-white tracking-wide">Active Operations</h2>
        </div>
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
                  Due Date
                </th>
              </tr>
            </thead>
            <tbody>
              {topMissions.map((mission) => (
                <tr
                  key={mission.id}
                  className="border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-2.5 text-zinc-200 font-medium">{mission.title}</td>
                  <td className="px-4 py-2.5 text-zinc-400">{mission.assignee}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${priorityColor[mission.priority]}`}
                    >
                      {mission.priority}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColor[mission.status]}`}
                    >
                      {statusLabel[mission.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 tabular-nums text-xs">
                    {mission.dueDate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent Fleet */}
      <div>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-white tracking-wide">Agent Fleet</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {fleetAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      </div>
    </div>
  )
}
