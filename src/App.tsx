import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useDatabase } from './hooks/useDatabase'
import { useCallback } from 'react'
import { fireCEO as fireCEOFromDB } from './lib/database'
import AppLayout from './components/Layout/AppLayout'
import DashboardView from './components/Dashboard/DashboardView'
import MissionsView from './components/Missions/MissionsView'
import SurveillanceView from './components/Surveillance/SurveillanceView'
import SurveillanceModule from './components/Surveillance/SurveillanceModule'
import VaultView from './components/Vault/VaultView'
import AuditView from './components/Audit/AuditView'
import FinancialsView from './components/Financials/FinancialsView'
import ChatView from './components/Chat/ChatView'
import ApprovalsView from './components/Approvals/ApprovalsView'
import SkillsView from './components/Skills/SkillsView'
import FounderCeremony from './components/FounderCeremony/FounderCeremony'
import CEOCeremony from './components/CEOCeremony/CEOCeremony'

export default function App() {
  const { ready, initialized, ceoInitialized, reset, reinit } = useDatabase()
  const navigate = useNavigate()

  // After CEO ceremony, reinit DB state AND navigate to /surveillance
  const handleCeremonyComplete = useCallback(() => {
    reinit()
    navigate('/surveillance', { replace: true })
  }, [reinit, navigate])

  // Fire CEO: remove CEO row + ceremony settings, then re-check DB state
  const handleFireCEO = useCallback(() => {
    fireCEOFromDB()
    reinit()
  }, [reinit])

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
    return <FounderCeremony onComplete={handleCeremonyComplete} />
  }

  // CEO ceremony after founder is set but CEO is not
  if (!ceoInitialized) {
    return <CEOCeremony onComplete={handleCeremonyComplete} />
  }

  // Main app
  return (
    <Routes>
      <Route element={<AppLayout onResetDB={reset} onFireCEO={handleFireCEO} />}>
        <Route path="/" element={<Navigate to="/surveillance" replace />} />
        <Route path="/dashboard" element={<DashboardView />} />
        <Route path="/chat" element={<ChatView />} />
        <Route path="/approvals" element={<ApprovalsView />} />
        <Route path="/missions" element={<MissionsView />} />
        <Route path="/surveillance" element={<SurveillanceView />} />
        <Route path="/skills" element={<SkillsView />} />
        <Route path="/vault" element={<VaultView />} />
        <Route path="/audit" element={<AuditView />} />
        <Route path="/financials" element={<FinancialsView />} />
        <Route path="/sample-surveillance" element={<SurveillanceModule />} />
      </Route>
    </Routes>
  )
}
