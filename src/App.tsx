import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useDatabase } from './hooks/useDatabase'
import { useCallback } from 'react'
import { fireCEO as fireCEOFromDB } from './lib/database'
import AppLayout from './components/Layout/AppLayout'
import DashboardView from './components/Dashboard/DashboardView'
import MissionsView from './components/Missions/MissionsView'
import MissionDetailPage from './components/Missions/MissionDetailPage'
import SurveillanceView from './components/Surveillance/SurveillanceView'
import VaultView from './components/Vault/VaultView'
import AuditView from './components/Audit/AuditView'
import FinancialsView from './components/Financials/FinancialsView'
import SettingsView from './components/Settings/SettingsView'
import ChatView from './components/Chat/ChatView'
import ApprovalsView from './components/Approvals/ApprovalsView'
import SkillsView from './components/Skills/SkillsView'
import CollateralView from './components/Collateral/CollateralView'
import SoundTestView from './components/SoundTest/SoundTestView'
import FounderCeremony from './components/FounderCeremony/FounderCeremony'
import CEOCeremony from './components/CEOCeremony/CEOCeremony'
import OAuthCallback from './components/OAuthCallback'
import KeySetupStep from './components/FounderCeremony/KeySetupStep'

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
          <div className="font-pixel text-[9px] tracking-wider text-zinc-400 leading-relaxed mb-4">
            {error}
          </div>
          <div className="text-left bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 mb-4">
            <div className="font-pixel text-[8px] tracking-wider text-pixel-cyan mb-3">TROUBLESHOOTING</div>
            <div className="space-y-3 font-mono text-[10px] text-zinc-500 leading-relaxed">
              <div>
                <span className="text-zinc-400">1.</span> Open <span className="text-pixel-green">Docker Desktop</span> and
                check all containers are <span className="text-emerald-400">green</span> (running).
                Look for: supabase-db, supabase-kong, supabase-auth, supabase-rest
              </div>
              <div>
                <span className="text-zinc-400">2.</span> If containers are red or missing, run in terminal:
                <div className="bg-black/50 rounded px-2 py-1 mt-1 text-pixel-green">
                  docker compose -f docker/docker-compose.yml up -d
                </div>
              </div>
              <div>
                <span className="text-zinc-400">3.</span> If Docker Desktop is not open:
                <div className="bg-black/50 rounded px-2 py-1 mt-1 text-pixel-green">
                  open -a Docker
                </div>
                <span className="text-zinc-600">Wait for the whale icon in the menu bar, then restart.</span>
              </div>
              <div>
                <span className="text-zinc-400">4.</span> Full reset — re-run the setup:
                <div className="bg-black/50 rounded px-2 py-1 mt-1 text-pixel-green">
                  npm run jarvis
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="font-pixel text-[8px] tracking-wider text-pixel-green bg-pixel-green/10 border border-pixel-green/25 px-4 py-2 rounded-lg hover:bg-pixel-green/20 transition-colors"
          >
            RETRY CONNECTION
          </button>
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
      <Route path="/oauth/callback" element={<OAuthCallback />} />
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
        <Route path="/settings" element={<SettingsView />} />
        <Route path="/soundtest" element={<SoundTestView />} />
        <Route path="/key" element={<KeySetupStep onComplete={() => window.history.back()} />} />
      </Route>
    </Routes>
  )
}
