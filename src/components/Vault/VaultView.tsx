import { Shield, Lock, RotateCw, AlertTriangle } from 'lucide-react'
import { VaultEntry } from '../../types'
import { vaultEntries } from '../../data/dummyData'

const typeBadgeColors: Record<VaultEntry['type'], string> = {
  api_key: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  credential: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  token: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  secret: 'bg-red-500/15 text-red-400 border-red-500/30',
}

const typeLabels: Record<VaultEntry['type'], string> = {
  api_key: 'API Key',
  credential: 'Credential',
  token: 'Token',
  secret: 'Secret',
}

const statusConfig: Record<VaultEntry['status'], { dot: string; label: string; textClass: string }> = {
  active: { dot: 'bg-emerald-500', label: 'Active', textClass: 'text-emerald-400' },
  expiring: { dot: 'bg-yellow-500', label: 'Expiring', textClass: 'text-yellow-400' },
  expired: { dot: 'bg-red-500', label: 'Expired', textClass: 'text-red-400' },
}

export default function VaultView() {
  const activeCount = vaultEntries.filter((e) => e.status === 'active').length
  const expiringCount = vaultEntries.filter((e) => e.status === 'expiring').length
  const expiredCount = vaultEntries.filter((e) => e.status === 'expired').length

  return (
    <div className="min-h-screen bg-jarvis-bg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-600/15 border border-emerald-500/25">
            <Shield size={24} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-jarvis-text tracking-wide">THE VAULT</h1>
            <p className="text-sm text-jarvis-muted">Credentials &amp; API Keys</p>
          </div>
        </div>
        <div className="text-xs text-jarvis-muted font-mono">
          {vaultEntries.length} entries secured
        </div>
      </div>

      {/* Summary Bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-jarvis-surface border border-emerald-500/15 rounded-lg px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-xs font-medium text-jarvis-muted uppercase tracking-wider">Active</span>
          </div>
          <span className="text-3xl font-bold text-emerald-400">{activeCount}</span>
        </div>
        <div className="bg-jarvis-surface border border-yellow-500/15 rounded-lg px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
            <span className="text-xs font-medium text-jarvis-muted uppercase tracking-wider">Expiring</span>
          </div>
          <span className="text-3xl font-bold text-yellow-400">{expiringCount}</span>
        </div>
        <div className="bg-jarvis-surface border border-red-500/15 rounded-lg px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="text-xs font-medium text-jarvis-muted uppercase tracking-wider">Expired</span>
          </div>
          <span className="text-3xl font-bold text-red-400">{expiredCount}</span>
        </div>
      </div>

      {/* Vault Table */}
      <div className="bg-jarvis-surface border border-white/[0.06] rounded-xl overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-[1fr_120px_120px_140px_120px_140px_90px] gap-4 px-6 py-3 border-b border-white/[0.06] bg-white/[0.02]">
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Name</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Type</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Service</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Key Value</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Rotated</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Status</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider text-right">Action</span>
        </div>

        {/* Table Rows */}
        {vaultEntries.map((entry, idx) => {
          const status = statusConfig[entry.status]
          const badgeColor = typeBadgeColors[entry.type]

          return (
            <div
              key={entry.id}
              className={[
                'grid grid-cols-[1fr_120px_120px_140px_120px_140px_90px] gap-4 px-6 py-4 border-b border-white/[0.04] items-center transition-colors hover:bg-white/[0.03]',
                idx % 2 === 1 ? 'bg-white/[0.015]' : '',
              ].join(' ')}
            >
              {/* Name */}
              <div className="flex items-center gap-3 min-w-0">
                <Lock size={14} className="text-jarvis-muted flex-shrink-0" />
                <span className="text-sm font-medium text-jarvis-text truncate">{entry.name}</span>
              </div>

              {/* Type Badge */}
              <div>
                <span className={`inline-block px-2.5 py-1 text-[11px] font-semibold rounded-md border ${badgeColor}`}>
                  {typeLabels[entry.type]}
                </span>
              </div>

              {/* Service */}
              <span className="text-sm text-jarvis-muted">{entry.service}</span>

              {/* Masked Value */}
              <span className="text-sm font-mono text-zinc-600 tracking-wider select-none">
                {'••••••••••••'}
              </span>

              {/* Last Rotated */}
              <span className="text-sm font-mono text-jarvis-muted">{entry.lastRotated}</span>

              {/* Status */}
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${status.dot} flex-shrink-0`} />
                <span className={`text-sm font-medium ${status.textClass}`}>{status.label}</span>
                {entry.status === 'expiring' && (
                  <AlertTriangle size={13} className="text-yellow-500 flex-shrink-0" />
                )}
              </div>

              {/* Rotate Button */}
              <div className="flex justify-end">
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-jarvis-muted bg-white/[0.04] border border-white/[0.08] rounded-md hover:bg-white/[0.08] hover:text-jarvis-text hover:border-white/[0.12] transition-all">
                  <RotateCw size={12} />
                  Rotate
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer Security Notice */}
      <div className="mt-4 flex items-center gap-2 px-2">
        <Shield size={12} className="text-jarvis-muted" />
        <span className="text-xs text-jarvis-muted">
          All credentials are AES-256 encrypted at rest. Key material never leaves the secure enclave.
        </span>
      </div>
    </div>
  )
}
