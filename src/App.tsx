import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/Layout/AppLayout'
import DashboardView from './components/Dashboard/DashboardView'
import MissionsView from './components/Missions/MissionsView'
import SurveillanceModule from './components/Surveillance/SurveillanceModule'
import VaultView from './components/Vault/VaultView'
import AuditView from './components/Audit/AuditView'
import FinancialsView from './components/Financials/FinancialsView'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
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
