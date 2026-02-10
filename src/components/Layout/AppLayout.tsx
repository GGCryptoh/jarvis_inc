import { Outlet } from 'react-router-dom'
import NavigationRail from './NavigationRail'

interface AppLayoutProps {
  onResetDB: () => Promise<void>
}

export default function AppLayout({ onResetDB }: AppLayoutProps) {
  return (
    <div className="flex h-screen bg-jarvis-bg overflow-hidden">
      <NavigationRail onResetDB={onResetDB} />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
