import { Routes, Route, Navigate } from 'react-router-dom'
import { useDatabase } from './hooks/useDatabase'
import AppLayout from './components/Layout/AppLayout'
import DashboardView from './components/Dashboard/DashboardView'
import MissionsView from './components/Missions/MissionsView'
import SurveillanceModule from './components/Surveillance/SurveillanceModule'
import VaultView from './components/Vault/VaultView'
import AuditView from './components/Audit/AuditView'
import FinancialsView from './components/Financials/FinancialsView'
import FounderCeremony from './components/FounderCeremony/FounderCeremony'

export default function App() {
  const { ready, initialized, reset, reinit } = useDatabase()

  // Loading state while SQLite boots
  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center">
          <div className="font-pixel text-pixel-green text-[10px] tracking-widest animate-pulse">
            LOADING SYSTEMS...
          </div>
        </div>
      </div>
    )
  }

  // Founder ceremony when DB is empty
  if (!initialized) {
    return <FounderCeremony onComplete={reinit} />
  }

  // Main app
  return (
    <Routes>
      <Route element={<AppLayout onResetDB={reset} />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardView />} />
        <Route path="/missions" element={<MissionsView />} />
        <Route path="/surveillance" element={<SurveillanceModule />} />
        <Route path="/vault" element={<VaultView />} />
        <Route path="/audit" element={<AuditView />} />
        <Route path="/financials" element={<FinancialsView />} />
      </Route>
    </Routes>
  )
}
