import { useState } from 'react'
import { DollarSign, TrendingDown, TrendingUp, Minus, Pencil, X } from 'lucide-react'
import { getSetting, setSetting, logAudit } from '../../lib/database'
import { financials } from '../../data/dummyData'

function formatCurrency(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0 })}`
}

// ---------------------------------------------------------------------------
// Budget Edit Dialog — Founder-ceremony themed (dark, green glow, pixel font)
// ---------------------------------------------------------------------------

function BudgetEditDialog({
  currentBudget,
  onSave,
  onClose,
}: {
  currentBudget: number;
  onSave: (value: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(String(currentBudget));

  const parsed = parseFloat(draft);
  const isValid = !isNaN(parsed) && parsed > 0 && parsed <= 100000;

  function handleSave() {
    if (!isValid) return;
    onSave(parsed);
  }

  const presets = [50, 100, 250, 500, 1000];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      {/* Scanline overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10 opacity-[0.03]"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.1) 2px, rgba(0,255,136,0.1) 4px)',
        }}
      />

      <div className="relative z-20 w-full max-w-md mx-4">
        {/* Dialog */}
        <div
          className="bg-black border-2 rounded-lg overflow-hidden"
          style={{ borderColor: 'rgba(0,255,136,0.3)', boxShadow: '0 0 40px rgba(0,255,136,0.08)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(0,255,136,0.15)' }}>
            <div className="flex items-center gap-2">
              <DollarSign size={16} className="text-pixel-green" />
              <h3
                className="font-pixel text-sm tracking-wider text-pixel-green"
                style={{ textShadow: '0 0 10px rgba(0,255,136,0.3)' }}
              >
                SET MONTHLY BUDGET
              </h3>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-md flex items-center justify-center text-pixel-green/40 hover:text-pixel-green/70 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-5 space-y-5">
            {/* Input */}
            <div>
              <label
                className="block font-pixel text-[9px] tracking-widest mb-2"
                style={{ color: 'rgba(0,255,136,0.6)' }}
              >
                BUDGET (USD / MONTH)
              </label>
              <div className="relative">
                <span
                  className="absolute left-4 top-1/2 -translate-y-1/2 font-pixel text-lg"
                  style={{ color: 'rgba(0,255,136,0.4)' }}
                >
                  $
                </span>
                <input
                  type="number"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  autoFocus
                  min={1}
                  max={100000}
                  step={10}
                  className="w-full bg-black border-2 font-pixel text-xl tracking-wider pl-10 pr-4 py-3 rounded-sm focus:outline-none transition-colors"
                  style={{
                    borderColor: isValid ? 'rgba(0,255,136,0.4)' : 'rgba(255,80,80,0.4)',
                    color: isValid ? '#00ff88' : '#ff5050',
                    textShadow: isValid ? '0 0 6px rgba(0,255,136,0.3)' : '0 0 6px rgba(255,80,80,0.3)',
                  }}
                />
              </div>
            </div>

            {/* Presets */}
            <div>
              <label
                className="block font-pixel text-[8px] tracking-widest mb-2"
                style={{ color: 'rgba(0,255,136,0.4)' }}
              >
                QUICK SET
              </label>
              <div className="flex gap-2">
                {presets.map(p => (
                  <button
                    key={p}
                    onClick={() => setDraft(String(p))}
                    className="flex-1 font-pixel text-[9px] tracking-wider py-2 rounded-sm border transition-all"
                    style={{
                      borderColor: parsed === p ? 'rgba(0,255,136,0.6)' : 'rgba(0,255,136,0.15)',
                      backgroundColor: parsed === p ? 'rgba(0,255,136,0.1)' : 'transparent',
                      color: parsed === p ? '#00ff88' : 'rgba(0,255,136,0.5)',
                    }}
                  >
                    ${p}
                  </button>
                ))}
              </div>
            </div>

            {/* Info */}
            <p
              className="font-pixel text-[7px] tracking-wider leading-relaxed"
              style={{ color: 'rgba(0,255,136,0.3)' }}
            >
              This budget controls total monthly AI spend across all agents.
              CEO operations respect this limit unless overridden.
            </p>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t" style={{ borderColor: 'rgba(0,255,136,0.15)' }}>
            <button
              onClick={onClose}
              className="font-pixel text-[9px] tracking-wider px-4 py-2 text-pixel-green/40 hover:text-pixel-green/70 transition-colors"
            >
              CANCEL
            </button>
            <button
              onClick={handleSave}
              disabled={!isValid}
              className="font-pixel text-[9px] tracking-[0.2em] px-6 py-2.5 rounded-sm border-2 transition-all duration-300"
              style={{
                borderColor: isValid ? 'rgba(0,255,136,0.6)' : 'rgba(0,255,136,0.15)',
                backgroundColor: isValid ? 'rgba(0,255,136,0.1)' : 'transparent',
                color: isValid ? '#00ff88' : 'rgba(0,255,136,0.3)',
                cursor: isValid ? 'pointer' : 'not-allowed',
                boxShadow: isValid ? '0 0 20px rgba(0,255,136,0.15)' : 'none',
              }}
            >
              SET BUDGET
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export default function FinancialsView() {
  const [monthlyBudget, setMonthlyBudget] = useState(() => {
    const saved = getSetting('monthly_budget');
    return saved ? parseFloat(saved) : 100; // default $100/mo
  });
  const [showBudgetEdit, setShowBudgetEdit] = useState(false);

  function handleBudgetSave(value: number) {
    const oldBudget = monthlyBudget;
    setSetting('monthly_budget', String(value));
    setMonthlyBudget(value);
    setShowBudgetEdit(false);
    logAudit(null, 'BUDGET', `Monthly budget changed from $${oldBudget} to $${value}`, 'info');
  }

  const totalBudget = monthlyBudget * 12; // annual from monthly
  const totalSpent = financials.reduce((sum, f) => sum + f.actual, 0)
  const remaining = totalBudget - totalSpent
  const burnRate = totalSpent > 0 && financials.length > 0
    ? Math.round(totalSpent / financials.length)
    : 0
  const maxValue = Math.max(...financials.map((f) => Math.max(monthlyBudget, f.actual)))

  const stats = [
    {
      label: 'Monthly Budget',
      value: formatCurrency(monthlyBudget),
      sublabel: `${formatCurrency(totalBudget)} / year`,
      icon: DollarSign,
      color: 'text-jarvis-text',
      borderColor: 'border-white/[0.08]',
      editable: true,
    },
    {
      label: 'Total Spent',
      value: formatCurrency(totalSpent),
      sublabel: `${financials.length} months tracked`,
      icon: TrendingUp,
      color: 'text-emerald-400',
      borderColor: 'border-emerald-500/20',
      editable: false,
    },
    {
      label: 'Remaining',
      value: formatCurrency(remaining),
      sublabel: remaining >= 0 ? 'Under budget' : 'Over budget',
      icon: remaining >= 0 ? TrendingDown : TrendingUp,
      color: remaining >= 0 ? 'text-blue-400' : 'text-red-400',
      borderColor: remaining >= 0 ? 'border-blue-500/20' : 'border-red-500/20',
      editable: false,
    },
    {
      label: 'Burn Rate',
      value: `${formatCurrency(burnRate)}/mo`,
      sublabel: burnRate > monthlyBudget ? 'Exceeds budget' : 'Within budget',
      icon: Minus,
      color: 'text-amber-400',
      borderColor: 'border-amber-500/20',
      editable: false,
    },
  ]

  return (
    <div className="min-h-screen bg-jarvis-bg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-600/15 border border-emerald-500/25">
            <DollarSign size={24} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-jarvis-text tracking-wide">FINANCIALS</h1>
            <p className="text-sm text-jarvis-muted">Budget &amp; Burn Rate</p>
          </div>
        </div>
        <div className="text-xs text-jarvis-muted font-mono">
          FY 2025-2026
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div
              key={stat.label}
              className={`bg-jarvis-surface border ${stat.borderColor} rounded-lg px-5 py-4 relative group`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} className="text-jarvis-muted" />
                <span className="text-xs font-medium text-jarvis-muted uppercase tracking-wider">
                  {stat.label}
                </span>
                {stat.editable && (
                  <button
                    onClick={() => setShowBudgetEdit(true)}
                    className="ml-auto w-6 h-6 rounded flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors opacity-0 group-hover:opacity-100"
                    title="Edit budget"
                  >
                    <Pencil size={12} />
                  </button>
                )}
              </div>
              <span className={`text-2xl font-bold ${stat.color}`}>{stat.value}</span>
              {stat.sublabel && (
                <div className="text-[10px] text-zinc-600 mt-1">{stat.sublabel}</div>
              )}
            </div>
          )
        })}
      </div>

      {/* Bar Chart */}
      <div className="bg-jarvis-surface border border-white/[0.06] rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-semibold text-jarvis-text uppercase tracking-wider">
            Monthly Budget vs Actual
          </h2>
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2">
              <span className="w-4 h-3 rounded-sm border-2 border-zinc-500 bg-transparent" />
              <span className="text-xs text-jarvis-muted">Budget</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-3 rounded-sm bg-emerald-500" />
              <span className="text-xs text-jarvis-muted">Actual</span>
            </div>
          </div>
        </div>

        {/* Chart Area */}
        <div className="flex items-end gap-6 h-56 px-2">
          {financials.map((entry) => {
            const budgetHeight = maxValue > 0 ? (monthlyBudget / maxValue) * 100 : 0
            const actualHeight = maxValue > 0 ? (entry.actual / maxValue) * 100 : 0
            const isOverBudget = entry.actual > monthlyBudget

            return (
              <div key={entry.month} className="flex-1 flex flex-col items-center gap-2">
                {/* Bar Group */}
                <div className="flex items-end gap-1.5 w-full justify-center h-48">
                  {/* Budget Bar (outlined) */}
                  <div className="relative flex-1 max-w-[28px] flex flex-col justify-end">
                    <div
                      className="w-full border-2 border-zinc-500 rounded-t-sm bg-transparent transition-all duration-500"
                      style={{ height: `${budgetHeight}%` }}
                      title={`Budget: ${formatCurrency(monthlyBudget)}`}
                    />
                  </div>
                  {/* Actual Bar (filled) */}
                  <div className="relative flex-1 max-w-[28px] flex flex-col justify-end">
                    <div
                      className={[
                        'w-full rounded-t-sm transition-all duration-500',
                        isOverBudget ? 'bg-red-500/80' : 'bg-emerald-500/80',
                      ].join(' ')}
                      style={{ height: `${actualHeight}%` }}
                      title={`Actual: ${formatCurrency(entry.actual)}`}
                    />
                  </div>
                </div>

                {/* X-axis Label */}
                <span className="text-xs font-medium text-jarvis-muted mt-1">{entry.month}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-jarvis-surface border border-white/[0.06] rounded-xl overflow-hidden">
        <div className="px-6 py-3 border-b border-white/[0.06] bg-white/[0.02]">
          <h2 className="text-sm font-semibold text-jarvis-text uppercase tracking-wider">
            Detailed Breakdown
          </h2>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-[1fr_120px_120px_120px_140px] gap-4 px-6 py-3 border-b border-white/[0.06] bg-white/[0.015]">
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider">Month</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider text-right">Budget</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider text-right">Actual</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider text-right">Variance</span>
          <span className="text-xs font-semibold text-jarvis-muted uppercase tracking-wider text-right">Status</span>
        </div>

        {/* Table Rows */}
        {financials.map((entry, idx) => {
          const variance = monthlyBudget - entry.actual
          const isOverBudget = variance < 0
          const variancePercent = monthlyBudget > 0
            ? ((entry.actual - monthlyBudget) / monthlyBudget * 100).toFixed(1)
            : '0.0'

          return (
            <div
              key={entry.month}
              className={[
                'grid grid-cols-[1fr_120px_120px_120px_140px] gap-4 px-6 py-3.5 border-b border-white/[0.04] items-center transition-colors hover:bg-white/[0.03]',
                idx % 2 === 1 ? 'bg-white/[0.015]' : '',
              ].join(' ')}
            >
              {/* Month */}
              <span className="text-sm font-medium text-jarvis-text">{entry.month} 2026</span>

              {/* Budget */}
              <span className="text-sm font-mono text-jarvis-muted text-right">
                {formatCurrency(monthlyBudget)}
              </span>

              {/* Actual */}
              <span className={`text-sm font-mono text-right ${isOverBudget ? 'text-red-400' : 'text-emerald-400'}`}>
                {formatCurrency(entry.actual)}
              </span>

              {/* Variance */}
              <span className={`text-sm font-mono text-right ${isOverBudget ? 'text-red-400' : 'text-emerald-400'}`}>
                {isOverBudget ? '-' : '+'}{formatCurrency(Math.abs(variance))}
              </span>

              {/* Status */}
              <div className="flex items-center justify-end gap-2">
                {isOverBudget ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 rounded-md">
                    <TrendingUp size={11} />
                    Over {Math.abs(Number(variancePercent))}%
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
                    <TrendingDown size={11} />
                    Under {Math.abs(Number(variancePercent))}%
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {/* Totals Row */}
        <div className="grid grid-cols-[1fr_120px_120px_120px_140px] gap-4 px-6 py-4 bg-white/[0.03] border-t border-white/[0.08]">
          <span className="text-sm font-bold text-jarvis-text uppercase tracking-wider">Total</span>
          <span className="text-sm font-mono font-bold text-jarvis-text text-right">
            {formatCurrency(totalBudget)}
          </span>
          <span className={`text-sm font-mono font-bold text-right ${totalSpent > totalBudget ? 'text-red-400' : 'text-emerald-400'}`}>
            {formatCurrency(totalSpent)}
          </span>
          <span className={`text-sm font-mono font-bold text-right ${remaining < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {remaining >= 0 ? '+' : '-'}{formatCurrency(Math.abs(remaining))}
          </span>
          <div className="flex justify-end">
            <span className={`inline-block px-2.5 py-1 text-[11px] font-bold rounded-md ${remaining >= 0 ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' : 'text-red-400 bg-red-500/10 border border-red-500/20'}`}>
              {remaining >= 0 ? 'UNDER BUDGET' : 'OVER BUDGET'}
            </span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center gap-2 px-2">
        <DollarSign size={12} className="text-jarvis-muted" />
        <span className="text-xs text-jarvis-muted">
          All figures in USD. Monthly budget of {formatCurrency(monthlyBudget)} applies uniformly. Burn rate calculated as trailing average.
        </span>
      </div>

      {/* Budget Edit Dialog */}
      {showBudgetEdit && (
        <BudgetEditDialog
          currentBudget={monthlyBudget}
          onSave={handleBudgetSave}
          onClose={() => setShowBudgetEdit(false)}
        />
      )}
    </div>
  )
}
