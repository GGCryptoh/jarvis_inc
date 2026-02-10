import { Outlet } from 'react-router-dom'
import NavigationRail from './NavigationRail'

export default function AppLayout() {
  return (
    <div className="flex h-screen bg-jarvis-bg overflow-hidden">
      <NavigationRail />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
