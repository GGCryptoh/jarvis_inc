import { useEffect, useCallback, useRef } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import NavigationRail from './NavigationRail'
import { useToast, ToastContainer } from './ToastNotification'
import { useCEOScheduler } from '../../hooks/useCEOScheduler'
import { useRealtimeSubscriptions } from '../../hooks/useRealtimeSubscriptions'
import { loadMissions } from '../../lib/database'
import { getSupabase } from '../../lib/supabase'
import { skills as skillDefinitions } from '../../data/skillDefinitions'

interface AppLayoutProps {
  onResetDB: (options?: { keepMemory?: boolean }) => Promise<void>
  onFireCEO: () => void
}

export default function AppLayout({ onResetDB, onFireCEO }: AppLayoutProps) {
  const navigate = useNavigate()
  const { toasts, addToast, dismissToast } = useToast()

  // Track IDs we have already toasted to avoid duplicates on repeated events
  const toastedMissionIds = useRef<Set<string>>(new Set())
  const toastedTaskIds = useRef<Set<string>>(new Set())

  // Guard: don't toast until we have pre-seeded existing IDs
  const seededRef = useRef(false)

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
          const skillName = skillDefinitions.find((s) => s.id === task.skill_id)?.name ?? task.skill_id
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
        <Outlet />
      </main>
      <ToastContainer toasts={toasts} dismissToast={dismissToast} onNavigate={handleNavigate} />
    </div>
  )
}
