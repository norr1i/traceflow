import type { LucideIcon } from 'lucide-react'

type Accent = 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange'

type Props = {
  title: string
  value: string | number
  subtitle?: string
  accent?: Accent
  icon?: LucideIcon
  trend?: { value: number; label: string }
}

const accentTokens: Record<Accent, {
  icon: string
  value: string
  trend_pos: string
  trend_neg: string
  dot: string
}> = {
  blue:   { icon: 'bg-[#4a8fb9]/10 text-[#4a8fb9] dark:bg-[#4a8fb9]/15 dark:text-[#60a5d4]',  value: '', trend_pos: 'text-emerald-600 dark:text-emerald-400', trend_neg: 'text-red-500 dark:text-red-400', dot: 'bg-[#4a8fb9]' },
  green:  { icon: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400', value: '', trend_pos: 'text-emerald-600 dark:text-emerald-400', trend_neg: 'text-red-500 dark:text-red-400', dot: 'bg-emerald-500' },
  yellow: { icon: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400', value: '', trend_pos: 'text-emerald-600 dark:text-emerald-400', trend_neg: 'text-red-500 dark:text-red-400', dot: 'bg-amber-400' },
  red:    { icon: 'bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-400', value: '', trend_pos: 'text-emerald-600 dark:text-emerald-400', trend_neg: 'text-red-500 dark:text-red-400', dot: 'bg-red-500' },
  purple: { icon: 'bg-violet-500/10 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400', value: '', trend_pos: 'text-emerald-600 dark:text-emerald-400', trend_neg: 'text-red-500 dark:text-red-400', dot: 'bg-violet-500' },
  orange: { icon: 'bg-orange-500/10 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400', value: '', trend_pos: 'text-emerald-600 dark:text-emerald-400', trend_neg: 'text-red-500 dark:text-red-400', dot: 'bg-orange-400' },
}

export default function StatCard({ title, value, subtitle, accent = 'blue', icon: Icon, trend }: Props) {
  const tokens = accentTokens[accent]

  return (
    <div className="glass-card rounded-xl p-5 flex flex-col gap-3 transition-all duration-150 hover:shadow-md dark:hover:shadow-black/30">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#525563] truncate">
          {title}
        </p>
        {Icon && (
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tokens.icon}`}>
            <Icon size={14} strokeWidth={1.75} />
          </span>
        )}
      </div>

      {/* Value */}
      <div>
        <p className="text-[2.5rem] font-bold tabular-nums leading-none tracking-tight text-gray-900 dark:text-[#E2E8F0]">
          {value}
        </p>
        {subtitle && (
          <p className="mt-1.5 text-[11px] text-gray-400 dark:text-[#525563] leading-snug">
            {subtitle}
          </p>
        )}
      </div>

      {/* Trend */}
      {trend && (
        <div className="flex items-center gap-1.5 pt-1 border-t border-gray-100 dark:border-white/[0.05]">
          <span className={`text-[11px] font-semibold tabular-nums ${trend.value >= 0 ? tokens.trend_pos : tokens.trend_neg}`}>
            {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%
          </span>
          <span className="text-[11px] text-gray-400 dark:text-[#525563]">{trend.label}</span>
        </div>
      )}
    </div>
  )
}
