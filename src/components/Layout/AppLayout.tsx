import { Outlet } from 'react-router-dom'
import NavigationRail from './NavigationRail'
import { useCEOScheduler } from '../../hooks/useCEOScheduler'
import { useRealtimeSubscriptions } from '../../hooks/useRealtimeSubscriptions'

interface AppLayoutProps {
  onResetDB: () => Promise<void>
  onFireCEO: () => void
}

export default function AppLayout({ onResetDB, onFireCEO }: AppLayoutProps) {
  // CEO scheduler — auto-starts on mount, runs decision engine every 30s
  useCEOScheduler()

  // Supabase Realtime — bridges Postgres changes to window events
  useRealtimeSubscriptions()

  return (
    <div className="flex h-screen bg-jarvis-bg overflow-hidden">
      <NavigationRail onResetDB={onResetDB} onFireCEO={onFireCEO} />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
