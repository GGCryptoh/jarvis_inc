import { NavLink, useNavigate } from 'react-router-dom'
import {
  Archive,
  BarChart3,
  Target,
  Cctv,
  Shield,
  ScrollText,
  DollarSign,
  DatabaseZap,
  MessageSquare,
  ClipboardCheck,
  Blocks,
  Settings,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import ResetDBDialog from './ResetDBDialog'
import { loadCEO, getPendingApprovalCount, getMissionReviewCount, getNewCollateralCount, getUnreadConversationCount, getSetting } from '../../lib/database'
import { getSupabase } from '../../lib/supabase'
import { getCurrentMonthSpend } from '../../lib/llmUsage'
import { hasInstanceKey } from '../../lib/jarvisKey'

interface NavItem {
  label: string
  icon: React.ElementType
  path: string
  isSurveillance?: boolean
  iconColor?: string
}

const navItems: NavItem[] = [
  { label: 'Dashboard', icon: BarChart3, path: '/dashboard', iconColor: 'text-blue-400' },
  { label: 'Chat', icon: MessageSquare, path: '/chat', iconColor: 'text-yellow-400' },
  { label: 'Approvals', icon: ClipboardCheck, path: '/approvals', iconColor: 'text-amber-400' },
  { label: 'Missions', icon: Target, path: '/missions', iconColor: 'text-red-400' },
  { label: 'Surveillance', icon: Cctv, path: '/surveillance', isSurveillance: true, iconColor: 'text-emerald-400' },
  { label: 'Collateral', icon: Archive, path: '/collateral', iconColor: 'text-orange-400' },
  { label: 'Skills', icon: Blocks, path: '/skills', iconColor: 'text-purple-400' },
  { label: 'The Vault', icon: Shield, path: '/vault', iconColor: 'text-cyan-400' },
  { label: 'Audit', icon: ScrollText, path: '/audit', iconColor: 'text-teal-400' },
  { label: 'Financials', icon: DollarSign, path: '/financials', iconColor: 'text-green-400' },
  { label: 'Settings', icon: Settings, path: '/settings', iconColor: 'text-zinc-400' },
]

type CeoStatus = 'nominal' | 'thinking' | 'error' | 'budget_hold' | 'needs_key'

const statusColorMap: Record<CeoStatus, string> = {
  nominal: 'bg-emerald-500',
  thinking: 'bg-yellow-400',
  error: 'bg-red-500',
  budget_hold: 'bg-amber-500',
  needs_key: 'bg-red-500',
}

const statusLabelMap: Record<CeoStatus, string> = {
  nominal: 'NOMINAL',
  thinking: 'THINKING',
  error: 'ERROR',
  budget_hold: 'BUDGET HOLD',
  needs_key: 'SET KEY → /key',
}

interface NavigationRailProps {
  onResetDB: (options?: { keepMemory?: boolean; clearFinancials?: boolean }) => Promise<void>
  onFireCEO: () => void
}

export default function NavigationRail({ onResetDB, onFireCEO }: NavigationRailProps) {
  const navigate = useNavigate()
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)

  const [ceoName, setCeoName] = useState<string | null>(null)
  const [ceoStatus, setCeoStatus] = useState<CeoStatus>('nominal')
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)
  const [collateralCount, setCollateralCount] = useState(0)
  const [ceoActionCount, setCeoActionCount] = useState(0)
  const [newSkillsCount, setNewSkillsCount] = useState(0)

  // Load CEO + approvals count from DB on mount, check budget state
  useEffect(() => {
    const load = async () => {
      const row = await loadCEO()
      if (row) {
        setCeoName(row.name)
        setCeoStatus((row.status as CeoStatus) || 'nominal')
      }
      try { setPendingApprovals(await getPendingApprovalCount()); } catch { /* DB not ready */ }
      // Check if instance key exists — show red if not
      if (!hasInstanceKey()) {
        setCeoStatus('needs_key')
      } else {
        // Check budget directly — works with or without sidecar running
        try {
          const budgetStr = await getSetting('monthly_budget')
          if (budgetStr) {
            const budget = parseFloat(budgetStr)
            if (!isNaN(budget) && budget > 0) {
              const spend = await getCurrentMonthSpend()
              if (spend.total >= budget) setCeoStatus('budget_hold')
            }
          }
        } catch { /* ignore */ }
      }
    }
    load()
    // Re-check when approvals change (budget might have been approved)
    const onApprovalsChanged = () => load()
    window.addEventListener('approvals-changed', onApprovalsChanged)
    return () => window.removeEventListener('approvals-changed', onApprovalsChanged)
  }, [])

  // Refresh approval count periodically + on custom event
  useEffect(() => {
    const refreshCount = async () => {
      try { setPendingApprovals(await getPendingApprovalCount()); } catch { /* ignore */ }
    }
    const interval = setInterval(refreshCount, 5000)
    window.addEventListener('approvals-changed', refreshCount)
    return () => {
      clearInterval(interval)
      window.removeEventListener('approvals-changed', refreshCount)
    }
  }, [])

  // Refresh mission review count periodically + on custom event
  useEffect(() => {
    const load = async () => {
      try { setReviewCount(await getMissionReviewCount()); } catch { /* ignore */ }
    }
    load()
    const interval = setInterval(load, 5000)
    window.addEventListener('missions-changed', load)
    return () => {
      clearInterval(interval)
      window.removeEventListener('missions-changed', load)
    }
  }, [])

  // Refresh collateral new items count periodically + on custom event
  useEffect(() => {
    const load = async () => {
      try { setCollateralCount(await getNewCollateralCount()); } catch { /* ignore */ }
    }
    load()
    const interval = setInterval(load, 5000)
    window.addEventListener('task-executions-changed', load)
    return () => {
      clearInterval(interval)
      window.removeEventListener('task-executions-changed', load)
    }
  }, [])

  // Refresh unread chat count periodically + on custom events
  useEffect(() => {
    const refresh = () => { getUnreadConversationCount().then(setCeoActionCount).catch(() => {}); }
    refresh()
    window.addEventListener('chat-messages-changed', refresh)
    window.addEventListener('chat-read', refresh)
    const interval = setInterval(refresh, 8000)
    return () => {
      window.removeEventListener('chat-messages-changed', refresh)
      window.removeEventListener('chat-read', refresh)
      clearInterval(interval)
    }
  }, [])

  // Refresh new personal skills count (unseen by founder)
  useEffect(() => {
    const refresh = async () => {
      try {
        const lastSeen = localStorage.getItem('jarvis_skills_last_seen') || '1970-01-01T00:00:00Z'
        const sb = getSupabase()
        const { count } = await sb
          .from('skills')
          .select('*', { count: 'exact', head: true })
          .eq('source', 'personal')
          .gt('updated_at', lastSeen)
        setNewSkillsCount(count ?? 0)
      } catch { /* ignore */ }
    }
    refresh()
    const interval = setInterval(refresh, 5000)
    window.addEventListener('skills-changed', refresh)
    window.addEventListener('skills-seen', refresh)
    return () => {
      clearInterval(interval)
      window.removeEventListener('skills-changed', refresh)
      window.removeEventListener('skills-seen', refresh)
    }
  }, [])


  const ceoInitial = ceoName ? ceoName.charAt(0).toUpperCase() : ':)'
  const ceoTooltip = ceoName ? `CEO ${ceoName}: ${statusLabelMap[ceoStatus]}` : `CEO: ${statusLabelMap[ceoStatus]}`

  return (
    <>
      <nav className="relative flex flex-col items-center w-[72px] min-w-[72px] h-screen bg-jarvis-surface border-r border-white/[0.06] py-4">
        {/* Brand Mark */}
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-600/20 border border-emerald-500/30 mb-8">
          <span className="text-emerald-400 font-bold text-lg tracking-tight">
            J
          </span>
        </div>

        {/* Navigation Items */}
        <div className="flex flex-col items-center gap-1 flex-1">
          {navItems.map((item) => {
            const Icon = item.icon

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  [
                    'relative flex items-center justify-center w-12 h-12 rounded-lg transition-all duration-150 group',
                    isActive
                      ? `${item.iconColor ?? 'text-emerald-400'} bg-white/[0.06]`
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]',
                  ].join(' ')
                }
                onMouseEnter={() => setHoveredItem(item.label)}
                onMouseLeave={() => setHoveredItem(null)}
              >
                {({ isActive }) => (
                  <>
                    {/* Active left accent */}
                    {isActive && (
                      <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full ${
                        item.iconColor?.replace('text-', 'bg-') ?? 'bg-emerald-400'
                      }`} />
                    )}

                    {/* Icon */}
                    <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />

                    {/* Surveillance pulsing dot */}
                    {item.isSurveillance && (
                      <span className="absolute top-2 right-2 flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                    )}

                    {/* Approvals badge */}
                    {item.label === 'Approvals' && pendingApprovals > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-black px-1">
                        {pendingApprovals}
                      </span>
                    )}

                    {/* Missions review badge */}
                    {item.label === 'Missions' && reviewCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-black px-1">
                        {reviewCount}
                      </span>
                    )}

                    {/* Collateral new items badge */}
                    {item.label === 'Collateral' && collateralCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-black px-1">
                        {collateralCount}
                      </span>
                    )}

                    {/* Unread chat conversations badge */}
                    {item.label === 'Chat' && ceoActionCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-yellow-400 text-[9px] font-bold text-black px-1">
                        {ceoActionCount}
                      </span>
                    )}

                    {/* New personal skills badge */}
                    {item.label === 'Skills' && newSkillsCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-black px-1">
                        {newSkillsCount}
                      </span>
                    )}



                    {/* Tooltip */}
                    {hoveredItem === item.label && (
                      <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-zinc-800 border border-white/[0.08] rounded-md text-xs text-zinc-200 whitespace-nowrap z-50 shadow-lg pointer-events-none">
                        {item.label}
                      </div>
                    )}
                  </>
                )}
              </NavLink>
            )
          })}
        </div>

        {/* Bottom section: CEO Status + Reset DB */}
        <div className="flex flex-col items-center gap-3 mt-auto">
          {/* CEO Status Pip */}
          <div className="pb-3 border-b border-white/[0.06] w-10 flex justify-center">
            <div
              className={`relative group ${ceoStatus === 'needs_key' ? 'cursor-pointer animate-pulse' : 'cursor-default'}`}
              onClick={ceoStatus === 'needs_key' ? () => navigate('/key') : undefined}
            >
              <span
                className={[
                  'block w-4 h-4 rounded-full border-2 border-zinc-700',
                  statusColorMap[ceoStatus],
                ].join(' ')}
              />
              <span className="absolute inset-0 flex items-center justify-center text-[7px] leading-none select-none font-bold">
                {ceoInitial}
              </span>

              {/* Status tooltip */}
              <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-zinc-800 border border-white/[0.08] rounded-md text-xs text-zinc-200 whitespace-nowrap z-50 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                {ceoTooltip}
              </div>
            </div>
          </div>

          {/* Reset DB Button */}
          <button
            onClick={() => setResetDialogOpen(true)}
            onMouseEnter={() => setHoveredItem('Reset DB')}
            onMouseLeave={() => setHoveredItem(null)}
            className="relative flex items-center justify-center w-12 h-12 rounded-lg text-red-500/60 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150 group"
          >
            <DatabaseZap size={18} strokeWidth={1.5} />

            {/* Tooltip */}
            {hoveredItem === 'Reset DB' && (
              <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-zinc-800 border border-red-500/20 rounded-md text-xs text-red-400 whitespace-nowrap z-50 shadow-lg pointer-events-none">
                Reset Database
              </div>
            )}
          </button>
        </div>
      </nav>

      {/* Reset DB Dialog */}
      <ResetDBDialog
        open={resetDialogOpen}
        onClose={() => setResetDialogOpen(false)}
        onResetDB={async (options) => {
          setResetDialogOpen(false)
          await onResetDB(options)
        }}
        onFireCEO={() => {
          setResetDialogOpen(false)
          onFireCEO()
        }}
      />
    </>
  )
}
