import { useState, useEffect, useCallback, useRef } from 'react'
import { Outlet, useNavigate, Link } from 'react-router-dom'
import { X, KeyRound } from 'lucide-react'
import NavigationRail from './NavigationRail'
import { hasInstanceKey } from '../../lib/jarvisKey'
import { useToast, ToastContainer } from './ToastNotification'
import { useCEOScheduler } from '../../hooks/useCEOScheduler'
import { useRealtimeSubscriptions } from '../../hooks/useRealtimeSubscriptions'
import { loadMissions } from '../../lib/database'
import { getSupabase } from '../../lib/supabase'
import { refreshSkillsCache, getSkillName } from '../../lib/skillsCache'

interface AppLayoutProps {
  onResetDB: (options?: { keepMemory?: boolean; clearFinancials?: boolean }) => Promise<void>
  onFireCEO: () => void
}

export default function AppLayout({ onResetDB, onFireCEO }: AppLayoutProps) {
  const navigate = useNavigate()
  const { toasts, addToast, dismissToast } = useToast()
  const [showKeyBanner, setShowKeyBanner] = useState(false)

  // Track IDs we have already toasted to avoid duplicates on repeated events
  const toastedMissionIds = useRef<Set<string>>(new Set())
  const toastedTaskIds = useRef<Set<string>>(new Set())

  // Guard: don't toast until we have pre-seeded existing IDs
  const seededRef = useRef(false)

  // Show key setup banner if no instance key (dismissible, persists in sessionStorage)
  useEffect(() => {
    const dismissed = sessionStorage.getItem('jarvis-key-banner-dismissed')
    if (!dismissed && !hasInstanceKey()) {
      setShowKeyBanner(true)
    }
  }, [])

  // Boot skills cache on mount + refresh on skills-changed
  useEffect(() => {
    refreshSkillsCache()
    const handler = () => refreshSkillsCache()
    window.addEventListener('skills-changed', handler)
    return () => window.removeEventListener('skills-changed', handler)
  }, [])

  // CEO scheduler — auto-starts on mount, runs decision engine every 30s
  useCEOScheduler()

  // Supabase Realtime — bridges Postgres changes to window events
  useRealtimeSubscriptions()

  // Pre-seed toasted ID sets on mount so existing records never trigger toasts.
  // This runs before event listeners can fire because seededRef gates them.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Seed mission IDs — mark all current "review" missions as already seen
        const missions = await loadMissions()
        for (const m of missions.filter((m) => m.status === 'review')) {
          toastedMissionIds.current.add(m.id)
        }
      } catch {
        // DB may not be ready — ignore
      }

      try {
        // Seed task IDs — mark all existing completed tasks as already seen
        const { data: existingTasks } = await getSupabase()
          .from('task_executions')
          .select('id')
          .eq('status', 'completed')

        for (const t of existingTasks ?? []) {
          toastedTaskIds.current.add(t.id)
        }
      } catch {
        // Supabase may not be ready — ignore
      }

      if (!cancelled) {
        seededRef.current = true
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // Listen for missions-changed events and toast when a mission enters "review"
  const handleMissionsChanged = useCallback(async () => {
    if (!seededRef.current) return
    try {
      const missions = await loadMissions()
      const reviewMissions = missions.filter((m) => m.status === 'review')
      for (const m of reviewMissions) {
        if (!toastedMissionIds.current.has(m.id)) {
          toastedMissionIds.current.add(m.id)
          addToast(`Mission ready for review: ${m.title}`, 'info', '/missions')
        }
      }
    } catch {
      // DB may not be ready yet — ignore
    }
  }, [addToast])

  useEffect(() => {
    window.addEventListener('missions-changed', handleMissionsChanged)
    return () => {
      window.removeEventListener('missions-changed', handleMissionsChanged)
    }
  }, [handleMissionsChanged])

  // Listen for task-executions-changed events and toast on task completion
  const handleTaskExecutionsChanged = useCallback(async () => {
    if (!seededRef.current) return
    try {
      // Only consider tasks completed in the last 2 minutes to avoid stale toasts
      const cutoff = new Date(Date.now() - 120_000).toISOString()
      const { data: completedTasks } = await getSupabase()
        .from('task_executions')
        .select('id, skill_id, status, completed_at')
        .eq('status', 'completed')
        .gte('completed_at', cutoff)
        .order('completed_at', { ascending: false })
        .limit(5)

      for (const task of completedTasks ?? []) {
        if (!toastedTaskIds.current.has(task.id)) {
          toastedTaskIds.current.add(task.id)
          const skillName = getSkillName(task.skill_id)
          addToast(`${skillName} — Complete`, 'success', '/collateral')
        }
      }
    } catch {
      // DB may not be ready yet — ignore
    }
  }, [addToast])

  useEffect(() => {
    window.addEventListener('task-executions-changed', handleTaskExecutionsChanged)
    return () => {
      window.removeEventListener('task-executions-changed', handleTaskExecutionsChanged)
    }
  }, [handleTaskExecutionsChanged])

  // Listen for navigate-toast events (e.g. "session signing locked — go to /key")
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { message: string; path: string }
      if (detail?.message && detail?.path) {
        addToast(detail.message, 'warning', detail.path)
      }
    }
    window.addEventListener('navigate-toast', handler)
    return () => window.removeEventListener('navigate-toast', handler)
  }, [addToast])

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path)
    },
    [navigate],
  )

  return (
    <div className="flex h-screen bg-jarvis-bg overflow-hidden">
      <NavigationRail onResetDB={onResetDB} onFireCEO={onFireCEO} />
      <main className="flex-1 overflow-auto">
        {showKeyBanner && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <KeyRound size={14} className="text-amber-400 flex-shrink-0" />
              <span className="font-pixel text-[8px] tracking-wider text-amber-400 truncate">
                MARKETPLACE IDENTITY NOT SET
              </span>
              <span className="font-mono text-[10px] text-amber-300/60 truncate hidden sm:inline">
                Generate your cryptographic key to join the marketplace
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link
                to="/key"
                className="font-pixel text-[7px] tracking-wider px-2.5 py-1 rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors"
              >
                SET UP KEY
              </Link>
              <button
                onClick={() => {
                  setShowKeyBanner(false)
                  sessionStorage.setItem('jarvis-key-banner-dismissed', '1')
                }}
                className="text-amber-400/40 hover:text-amber-400 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
        <Outlet />
      </main>
      <ToastContainer toasts={toasts} dismissToast={dismissToast} onNavigate={handleNavigate} />
    </div>
  )
}
