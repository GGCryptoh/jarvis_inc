import { DollarSign, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { financials } from '../../data/dummyData'

function formatCurrency(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0 })}`
}

export default function FinancialsView() {
  const totalBudget = financials.reduce((sum, f) => sum + f.budget, 0)
  const totalSpent = financials.reduce((sum, f) => sum + f.actual, 0)
  const remaining = totalBudget - totalSpent
  const burnRate = totalSpent > 0 && financials.length > 0
    ? Math.round(totalSpent / financials.length)
    : 0
  const maxValue = Math.max(...financials.map((f) => Math.max(f.budget, f.actual)))

  const stats = [
    {
      label: 'Total Budget',
      value: formatCurrency(totalBudget),
      icon: DollarSign,
      color: 'text-jarvis-text',
      borderColor: 'border-white/[0.08]',
    },
    {
      label: 'Total Spent',
      value: formatCurrency(totalSpent),
      icon: TrendingUp,
      color: 'text-emerald-400',
      borderColor: 'border-emerald-500/20',
    },
    {
      label: 'Remaining',
      value: formatCurrency(remaining),
      icon: remaining >= 0 ? TrendingDown : TrendingUp,
      color: remaining >= 0 ? 'text-blue-400' : 'text-red-400',
      borderColor: remaining >= 0 ? 'border-blue-500/20' : 'border-red-500/20',
    },
    {
      label: 'Burn Rate',
      value: `${formatCurrency(burnRate)}/mo`,
      icon: Minus,
      color: 'text-amber-400',
      borderColor: 'border-amber-500/20',
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
              className={`bg-jarvis-surface border ${stat.borderColor} rounded-lg px-5 py-4`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} className="text-jarvis-muted" />
                <span className="text-xs font-medium text-jarvis-muted uppercase tracking-wider">
                  {stat.label}
                </span>
              </div>
              <span className={`text-2xl font-bold ${stat.color}`}>{stat.value}</span>
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
            const budgetHeight = maxValue > 0 ? (entry.budget / maxValue) * 100 : 0
            const actualHeight = maxValue > 0 ? (entry.actual / maxValue) * 100 : 0
            const isOverBudget = entry.actual > entry.budget

            return (
              <div key={entry.month} className="flex-1 flex flex-col items-center gap-2">
                {/* Bar Group */}
                <div className="flex items-end gap-1.5 w-full justify-center h-48">
                  {/* Budget Bar (outlined) */}
                  <div className="relative flex-1 max-w-[28px] flex flex-col justify-end">
                    <div
                      className="w-full border-2 border-zinc-500 rounded-t-sm bg-transparent transition-all duration-500"
                      style={{ height: `${budgetHeight}%` }}
                      title={`Budget: ${formatCurrency(entry.budget)}`}
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
          const variance = entry.budget - entry.actual
          const isOverBudget = variance < 0
          const variancePercent = entry.budget > 0
            ? ((entry.actual - entry.budget) / entry.budget * 100).toFixed(1)
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
                {formatCurrency(entry.budget)}
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
          All figures in USD. Burn rate calculated as trailing average across reported months.
        </span>
      </div>
    </div>
  )
}
