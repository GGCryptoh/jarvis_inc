import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScrollText, Download, Info, AlertTriangle, AlertOctagon, MessageSquare, ChevronDown, Users, Monitor } from 'lucide-react'
import { type AuditLogRow } from '../../lib/database'
import { getSupabase, hasSupabaseConfig } from '../../lib/supabase'

type AuditTab = 'system' | 'a2a'
type SeverityFilter = 'all' | 'info' | 'warning' | 'error'
type DateRange = 'today' | 'yesterday' | 'week' | 'month' | 'all'

const PAGE_SIZE = 50

const severityBorderColors: Record<string, string> = {
  info: 'border-l-blue-500/60',
  warning: 'border-l-yellow-500/60',
  error: 'border-l-red-500/60',
}

const severityIcons: Record<string, React.ReactNode> = {
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

const dateButtons: { label: string; value: DateRange }[] = [
  { label: 'TODAY', value: 'today' },
  { label: 'YESTERDAY', value: 'yesterday' },
  { label: 'LAST WEEK', value: 'week' },
  { label: 'LAST MONTH', value: 'month' },
  { label: 'ALL', value: 'all' },
]

function getDateCutoff(range: DateRange): string | null {
  const now = new Date()
  switch (range) {
    case 'today': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      return start.toISOString()
    }
    case 'yesterday': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      return start.toISOString()
    }
    case 'week':
      return new Date(Date.now() - 7 * 86400000).toISOString()
    case 'month':
      return new Date(Date.now() - 30 * 86400000).toISOString()
    case 'all':
      return null
  }
}

function formatTimestamp(ts: string): string {
  if (!ts) return '\u2014'
  try {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ts
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  } catch { return ts }
}

function parseConversationId(details: string | null): string | null {
  if (!details) return null
  const match = details.match(/\[conv:([^\]]+)\]/)
  return match?.[1] || null
}

function stripConvTag(details: string | null): string {
  if (!details) return '\u2014'
  return details.replace(/\s*\[conv:[^\]]*\]/, '').trim() || '\u2014'
}

export default function AuditView() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<AuditTab>('system')
  const [entries, setEntries] = useState<AuditLogRow[]>([])
  const [activeFilter, setActiveFilter] = useState<SeverityFilter>('all')
  const [dateRange, setDateRange] = useState<DateRange>('today')
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [totalLoaded, setTotalLoaded] = useState(0)

  const loadPage = useCallback(async (offset: number, append: boolean) => {
    if (!hasSupabaseConfig()) return
    setLoading(true)
    try {
      let query = getSupabase()
        .from('audit_log')
        .select('id, timestamp, agent, action, details, severity')
        .order('id', { ascending: false })

      const cutoff = getDateCutoff(dateRange)
      if (cutoff) {
        query = query.gte('timestamp', cutoff)
      }

      query = query.range(offset, offset + PAGE_SIZE - 1)

      const { data } = await query
      const rows = (data ?? []) as AuditLogRow[]

      if (append) {
        setEntries(prev => [...prev, ...rows])
      } else {
        setEntries(rows)
      }
      setTotalLoaded(offset + rows.length)
      setHasMore(rows.length === PAGE_SIZE)
    } catch {
      setHasMore(false)
    }
    setLoading(false)
  }, [dateRange])

  // Reload when date range changes
  useEffect(() => {
    loadPage(0, false)
  }, [loadPage])

  const loadMore = () => {
    loadPage(totalLoaded, true)
  }

  const filteredLog = activeFilter === 'all'
    ? entries
    : entries.filter((e) => e.severity === activeFilter)

  const infoCount = entries.filter((e) => e.severity === 'info').length
  const warningCount = entries.filter((e) => e.severity === 'warning').length
  const errorCount = entries.filter((e) => e.severity === 'error').length

  function handleExport() {
    const lines = entries.map(e =>
      `${e.timestamp}\t${e.severity.toUpperCase()}\t${e.agent ?? 'SYSTEM'}\t${e.action}\t${e.details ?? ''}`
    )
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jarvis-audit-${new Date().toISOString().slice(0, 10)}.tsv`
    a.click()
    URL.revokeObjectURL(url)
  }

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
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-jarvis-muted bg-jarvis-surface border border-white/[0.08] rounded-lg hover:bg-white/[0.06] hover:text-jarvis-text transition-all"
        >
          <Download size={14} />
          Export
        </button>
      </div>

      {/* Tab Toggle */}
      <div className="flex items-center gap-2 mb-5">
        <button
          onClick={() => setActiveTab('system')}
          className={[
            'flex items-center gap-2 px-5 py-2.5 text-xs font-bold tracking-wider rounded-lg border transition-all',
            activeTab === 'system'
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'bg-transparent text-jarvis-muted border-white/[0.06] hover:bg-white/[0.04] hover:text-jarvis-text',
          ].join(' ')}
        >
          <Monitor size={14} />
          FOUNDER / SYSTEM
        </button>
        <button
          onClick={() => setActiveTab('a2a')}
          className={[
            'flex items-center gap-2 px-5 py-2.5 text-xs font-bold tracking-wider rounded-lg border transition-all',
            activeTab === 'a2a'
              ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
              : 'bg-transparent text-jarvis-muted border-white/[0.06] hover:bg-white/[0.04] hover:text-jarvis-text',
          ].join(' ')}
        >
          <Users size={14} />
          A2A (AGENT-TO-AGENT)
        </button>
      </div>

      {activeTab === 'a2a' ? (
        /* A2A placeholder */
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4">
            <Users size={28} className="text-cyan-400/60" />
          </div>
          <h3 className="text-lg font-semibold text-jarvis-text mb-2">Agent-to-Agent Auditing</h3>
          <p className="text-sm text-jarvis-muted max-w-md">
            Agent-to-agent communication auditing will appear here when A2A messaging is enabled.
            All inter-agent delegations, requests, and coordination events will be logged.
          </p>
        </div>
      ) : (
      <>
      {/* Date Range Chips */}
      <div className="flex items-center gap-2 mb-4">
        {dateButtons.map((btn) => (
          <button
            key={btn.value}
            onClick={() => setDateRange(btn.value)}
            className={[
              'px-3 py-1.5 text-[11px] font-semibold tracking-wider rounded-full border transition-all',
              dateRange === btn.value
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-transparent text-jarvis-muted border-white/[0.06] hover:bg-white/[0.04] hover:text-jarvis-text',
            ].join(' ')}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Severity Filter + Counts */}
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
        <div className="grid grid-cols-[160px_110px_120px_1fr_50px] gap-4 px-6 py-3 border-b border-white/[0.06] bg-white/[0.02]">
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Timestamp</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Agent</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Action</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Details</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider text-center">Sev</span>
        </div>

        {/* Table Rows */}
        {filteredLog.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-jarvis-muted">
            {loading
              ? 'Loading...'
              : entries.length === 0
                ? 'No audit entries for this period.'
                : 'No entries matching the selected filter.'}
          </div>
        ) : (
          filteredLog.map((entry, idx) => (
            <div
              key={entry.id}
              className={[
                'grid grid-cols-[160px_110px_120px_1fr_50px] gap-4 px-6 py-3.5 border-b border-white/[0.04] border-l-[3px] items-center transition-colors hover:bg-white/[0.03]',
                severityBorderColors[entry.severity] ?? 'border-l-zinc-600',
                idx % 2 === 1 ? 'bg-white/[0.015]' : '',
              ].join(' ')}
            >
              <span className="text-sm font-mono text-jarvis-muted tabular-nums">
                {formatTimestamp(entry.timestamp)}
              </span>
              <span className="text-sm font-bold text-jarvis-text">
                {entry.agent ?? 'SYSTEM'}
              </span>
              <div>
                <span className="inline-block px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-jarvis-text bg-white/[0.06] border border-white/[0.1] rounded-md">
                  {entry.action}
                </span>
              </div>
              <span className="text-sm text-jarvis-muted truncate cursor-default flex items-center" title={entry.details ?? ''}>
                {entry.action === 'CEO_CHAT' && parseConversationId(entry.details)
                  ? <>
                      {stripConvTag(entry.details)}
                      <button
                        onClick={() => navigate(`/chat?conversation=${parseConversationId(entry.details)}`)}
                        className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded hover:bg-emerald-500/20 transition-colors flex-shrink-0"
                      >
                        <MessageSquare size={10} /> VIEW CHAT
                      </button>
                    </>
                  : (entry.details ?? '\u2014')
                }
              </span>
              <div className="flex justify-center">
                {severityIcons[entry.severity] ?? severityIcons.info}
              </div>
            </div>
          ))
        )}

        {/* Load More */}
        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 text-xs font-semibold text-jarvis-muted hover:text-jarvis-text hover:bg-white/[0.03] transition-colors border-t border-white/[0.04]"
          >
            <ChevronDown size={14} />
            {loading ? 'LOADING...' : `LOAD MORE (${PAGE_SIZE} at a time)`}
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between px-2">
        <span className="text-xs text-jarvis-muted">
          Showing {filteredLog.length} of {entries.length} loaded{hasMore ? ' (more available)' : ''}
        </span>
        <span className="text-xs text-jarvis-muted font-mono">
          Audit log
        </span>
      </div>
      </>
      )}
    </div>
  )
}
