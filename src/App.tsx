import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useDatabase } from './hooks/useDatabase'
import { useCallback } from 'react'
import { fireCEO as fireCEOFromDB } from './lib/database'
import AppLayout from './components/Layout/AppLayout'
import DashboardView from './components/Dashboard/DashboardView'
import MissionsView from './components/Missions/MissionsView'
import MissionDetailPage from './components/Missions/MissionDetailPage'
import SurveillanceView from './components/Surveillance/SurveillanceView'
import SurveillanceModule from './components/Surveillance/SurveillanceModule'
import VaultView from './components/Vault/VaultView'
import AuditView from './components/Audit/AuditView'
import FinancialsView from './components/Financials/FinancialsView'
import ChatView from './components/Chat/ChatView'
import ApprovalsView from './components/Approvals/ApprovalsView'
import SkillsView from './components/Skills/SkillsView'
import CollateralView from './components/Collateral/CollateralView'
import SoundTestView from './components/SoundTest/SoundTestView'
import FounderCeremony from './components/FounderCeremony/FounderCeremony'
import CEOCeremony from './components/CEOCeremony/CEOCeremony'

export default function App() {
  const { ready, initialized, ceoInitialized, error, reset, reinit } = useDatabase()
  const navigate = useNavigate()

  // After ceremony, reinit DB state AND navigate to /surveillance
  const handleCeremonyComplete = useCallback(async () => {
    await reinit()
    navigate('/surveillance', { replace: true })
  }, [reinit, navigate])

  // Fire CEO: remove CEO row + ceremony settings, then re-check DB state
  const handleFireCEO = useCallback(async () => {
    await fireCEOFromDB()
    await reinit()
  }, [reinit])

  // Error state — show connection help
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center max-w-lg p-8">
          <div className="font-pixel text-pixel-pink text-[10px] tracking-widest mb-4">
            CONNECTION ERROR
          </div>
          <div className="font-pixel text-[9px] tracking-wider text-zinc-400 leading-relaxed mb-6">
            {error}
          </div>
          <div className="font-pixel text-[9px] tracking-wider text-zinc-500 leading-relaxed">
            Run <span className="text-pixel-green">npm run jarvis</span> to start the full stack,{' '}
            or set VITE_SUPABASE_URL in .env.development
          </div>
        </div>
      </div>
    )
  }

  // Loading state while connecting to Supabase
  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center">
          <div className="font-pixel text-pixel-green text-[10px] tracking-widest animate-pulse">
            CONNECTING TO SYSTEMS...
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
        <Route path="/missions/:id" element={<MissionDetailPage />} />
        <Route path="/surveillance" element={<SurveillanceView />} />
        <Route path="/skills" element={<SkillsView />} />
        <Route path="/vault" element={<VaultView />} />
        <Route path="/collateral" element={<CollateralView />} />
        <Route path="/audit" element={<AuditView />} />
        <Route path="/financials" element={<FinancialsView />} />
        <Route path="/sample-surveillance" element={<SurveillanceModule />} />
        <Route path="/soundtest" element={<SoundTestView />} />
      </Route>
    </Routes>
  )
}
