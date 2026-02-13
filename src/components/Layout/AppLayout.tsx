import { useEffect, useCallback } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import NavigationRail from './NavigationRail'
import { useToast, ToastContainer } from './ToastNotification'
import { useCEOScheduler } from '../../hooks/useCEOScheduler'
import { useRealtimeSubscriptions } from '../../hooks/useRealtimeSubscriptions'
import { loadMissions } from '../../lib/database'

interface AppLayoutProps {
  onResetDB: () => Promise<void>
  onFireCEO: () => void
}

export default function AppLayout({ onResetDB, onFireCEO }: AppLayoutProps) {
  const navigate = useNavigate()
  const { toasts, addToast, dismissToast } = useToast()

  // CEO scheduler — auto-starts on mount, runs decision engine every 30s
  useCEOScheduler()

  // Supabase Realtime — bridges Postgres changes to window events
  useRealtimeSubscriptions()

  // Listen for missions-changed events and toast when a mission enters "review"
  const handleMissionsChanged = useCallback(async () => {
    try {
      const missions = await loadMissions()
      const reviewMissions = missions.filter((m) => m.status === 'review')
      for (const m of reviewMissions) {
        addToast(`Mission ready for review: ${m.title}`, 'info', '/missions')
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
