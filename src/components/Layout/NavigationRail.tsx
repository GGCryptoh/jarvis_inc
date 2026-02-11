import { NavLink } from 'react-router-dom'
import {
  BarChart3,
  Target,
  Cctv,
  Shield,
  ScrollText,
  DollarSign,
  DatabaseZap,
  MessageSquare,
  ClipboardCheck,
  FlaskConical,
  Blocks,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import ResetDBDialog from './ResetDBDialog'
import { loadCEO } from '../../lib/database'

interface NavItem {
  label: string
  icon: React.ElementType
  path: string
  isSurveillance?: boolean
}

const navItems: NavItem[] = [
  { label: 'Dashboard', icon: BarChart3, path: '/dashboard' },
  { label: 'Chat', icon: MessageSquare, path: '/chat' },
  { label: 'Approvals', icon: ClipboardCheck, path: '/approvals' },
  { label: 'Missions', icon: Target, path: '/missions' },
  { label: 'Surveillance', icon: Cctv, path: '/surveillance', isSurveillance: true },
  { label: 'Skills', icon: Blocks, path: '/skills' },
  { label: 'The Vault', icon: Shield, path: '/vault' },
  { label: 'Audit', icon: ScrollText, path: '/audit' },
  { label: 'Financials', icon: DollarSign, path: '/financials' },
  { label: 'Sample', icon: FlaskConical, path: '/sample-surveillance' },
]

type CeoStatus = 'nominal' | 'thinking' | 'error'

const statusColorMap: Record<CeoStatus, string> = {
  nominal: 'bg-emerald-500',
  thinking: 'bg-yellow-400',
  error: 'bg-red-500',
}

interface NavigationRailProps {
  onResetDB: () => Promise<void>
}

export default function NavigationRail({ onResetDB }: NavigationRailProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)

  const [ceoName, setCeoName] = useState<string | null>(null)
  const [ceoStatus, setCeoStatus] = useState<CeoStatus>('nominal')

  // Load CEO from DB on mount
  useEffect(() => {
    const row = loadCEO()
    if (row) {
      setCeoName(row.name)
      setCeoStatus((row.status as CeoStatus) || 'nominal')
    }
  }, [])

  const ceoInitial = ceoName ? ceoName.charAt(0).toUpperCase() : ':)'
  const ceoTooltip = ceoName ? `CEO ${ceoName}: ${ceoStatus}` : `CEO: ${ceoStatus}`

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
                      ? 'text-emerald-400 bg-emerald-500/[0.08]'
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
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-emerald-400 rounded-r-full" />
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
            <div className="relative group cursor-default">
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
        onConfirm={async () => {
          setResetDialogOpen(false)
          await onResetDB()
        }}
      />
    </>
  )
}
