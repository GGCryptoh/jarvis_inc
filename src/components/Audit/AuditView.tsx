import { useState } from 'react'
import { ScrollText, Download, Info, AlertTriangle, AlertOctagon } from 'lucide-react'
import { AuditEntry } from '../../types'
import { auditLog } from '../../data/dummyData'

type SeverityFilter = 'all' | 'info' | 'warning' | 'error'

const agentColors: Record<string, string> = {
  ARIA: 'text-pink-400',
  BOLT: 'text-green-400',
  CIPHER: 'text-purple-400',
  DELTA: 'text-orange-400',
  ECHO: 'text-cyan-400',
  FORGE: 'text-yellow-400',
}

const severityBorderColors: Record<AuditEntry['severity'], string> = {
  info: 'border-l-blue-500/60',
  warning: 'border-l-yellow-500/60',
  error: 'border-l-red-500/60',
}

const severityIcons: Record<AuditEntry['severity'], React.ReactNode> = {
  info: <Info size={15} className="text-blue-400" />,
  warning: <AlertTriangle size={15} className="text-yellow-400" />,
  error: <AlertOctagon size={15} className="text-red-400" />,
}

const filterButtons: { label: string; value: SeverityFilter; activeClass: string }[] = [
  { label: 'All', value: 'all', activeClass: 'bg-white/[0.1] text-jarvis-text border-white/[0.15]' },
  { label: 'Info', value: 'info', activeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  { label: 'Warning', value: 'warning', activeClass: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  { label: 'Error', value: 'error', activeClass: 'bg-red-500/15 text-red-400 border-red-500/30' },
]

export default function AuditView() {
  const [activeFilter, setActiveFilter] = useState<SeverityFilter>('all')

  const filteredLog = activeFilter === 'all'
    ? auditLog
    : auditLog.filter((entry) => entry.severity === activeFilter)

  const infoCount = auditLog.filter((e) => e.severity === 'info').length
  const warningCount = auditLog.filter((e) => e.severity === 'warning').length
  const errorCount = auditLog.filter((e) => e.severity === 'error').length

  return (
    <div className="min-h-screen bg-jarvis-bg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-600/15 border border-emerald-500/25">
            <ScrollText size={24} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-jarvis-text tracking-wide">AUDIT LOG</h1>
            <p className="text-sm text-jarvis-muted">Immutable Activity Record</p>
          </div>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-jarvis-muted bg-jarvis-surface border border-white/[0.08] rounded-lg hover:bg-white/[0.06] hover:text-jarvis-text transition-all">
          <Download size={14} />
          Export
        </button>
      </div>

      {/* Filter Bar + Counts */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          {filterButtons.map((btn) => (
            <button
              key={btn.value}
              onClick={() => setActiveFilter(btn.value)}
              className={[
                'px-4 py-2 text-xs font-semibold rounded-lg border transition-all',
                activeFilter === btn.value
                  ? btn.activeClass
                  : 'bg-transparent text-jarvis-muted border-white/[0.06] hover:bg-white/[0.04] hover:text-jarvis-text',
              ].join(' ')}
            >
              {btn.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 text-xs text-jarvis-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            {infoCount} Info
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            {warningCount} Warning
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {errorCount} Error
          </span>
        </div>
      </div>

      {/* Log Table */}
      <div className="bg-jarvis-surface border border-white/[0.06] rounded-xl overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-[180px_100px_110px_1fr_50px] gap-4 px-6 py-3 border-b border-white/[0.06] bg-white/[0.02]">
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Timestamp</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Agent</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Action</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Details</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider text-center">Sev</span>
        </div>

        {/* Table Rows */}
        {filteredLog.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-jarvis-muted">
            No entries matching the selected filter.
          </div>
        ) : (
          filteredLog.map((entry, idx) => {
            const agentColor = agentColors[entry.agent] || 'text-jarvis-text'
            const borderColor = severityBorderColors[entry.severity]
            const icon = severityIcons[entry.severity]

            return (
              <div
                key={entry.id}
                className={[
                  'grid grid-cols-[180px_100px_110px_1fr_50px] gap-4 px-6 py-3.5 border-b border-white/[0.04] border-l-[3px] items-center transition-colors hover:bg-white/[0.03]',
                  borderColor,
                  idx % 2 === 1 ? 'bg-white/[0.015]' : '',
                ].join(' ')}
              >
                {/* Timestamp */}
                <span className="text-sm font-mono text-jarvis-muted tabular-nums">
                  {entry.timestamp}
                </span>

                {/* Agent */}
                <span className={`text-sm font-bold ${agentColor}`}>
                  {entry.agent}
                </span>

                {/* Action Badge */}
                <div>
                  <span className="inline-block px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-jarvis-text bg-white/[0.06] border border-white/[0.1] rounded-md">
                    {entry.action}
                  </span>
                </div>

                {/* Details */}
                <span
                  className="text-sm text-jarvis-muted truncate cursor-default"
                  title={entry.details}
                >
                  {entry.details}
                </span>

                {/* Severity Icon */}
                <div className="flex justify-center">
                  {icon}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between px-2">
        <span className="text-xs text-jarvis-muted">
          Showing {filteredLog.length} of {auditLog.length} entries
        </span>
        <span className="text-xs text-jarvis-muted font-mono">
          Log integrity: SHA-256 verified
        </span>
      </div>
    </div>
  )
}
