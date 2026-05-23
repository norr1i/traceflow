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

// Desaturated, low-luminance accent tokens — color communicates meaning, not energy
const accentTokens: Record<Accent, {
  icon:      string
  trend_pos: string
  trend_neg: string
  topBar:    string
}> = {
  blue:   {
    icon:      'bg-[#1E3A4A] text-[#5A9ABF] dark:bg-[#1A3040] dark:text-[#5A9ABF]',
    trend_pos: 'text-emerald-600 dark:text-emerald-500',
    trend_neg: 'text-red-500 dark:text-red-400',
    topBar:    'bg-[#2E5870]',
  },
  green:  {
    icon:      'bg-[#1A3828] text-[#4A9A6A] dark:bg-[#162E20] dark:text-[#4A9A6A]',
    trend_pos: 'text-emerald-600 dark:text-emerald-500',
    trend_neg: 'text-red-500 dark:text-red-400',
    topBar:    'bg-[#26583A]',
  },
  yellow: {
    icon:      'bg-[#3A3018] text-[#A08020] dark:bg-[#302810] dark:text-[#A08030]',
    trend_pos: 'text-emerald-600 dark:text-emerald-500',
    trend_neg: 'text-red-500 dark:text-red-400',
    topBar:    'bg-[#6A5420]',
  },
  red:    {
    icon:      'bg-[#3A1E1E] text-[#B04A4A] dark:bg-[#301818] dark:text-[#B05050]',
    trend_pos: 'text-emerald-600 dark:text-emerald-500',
    trend_neg: 'text-red-500 dark:text-red-400',
    topBar:    'bg-[#7A3030]',
  },
  purple: {
    icon:      'bg-[#28203A] text-[#7A60B0] dark:bg-[#201830] dark:text-[#7A60B0]',
    trend_pos: 'text-emerald-600 dark:text-emerald-500',
    trend_neg: 'text-red-500 dark:text-red-400',
    topBar:    'bg-[#4A3870]',
  },
  orange: {
    icon:      'bg-[#3A2818] text-[#A0682A] dark:bg-[#302010] dark:text-[#A0682A]',
    trend_pos: 'text-emerald-600 dark:text-emerald-500',
    trend_neg: 'text-red-500 dark:text-red-400',
    topBar:    'bg-[#784020]',
  },
}

export default function StatCard({ title, value, subtitle, accent = 'blue', icon: Icon, trend }: Props) {
  const tokens = accentTokens[accent]

  return (
    <div className="glass-card rounded-xl overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-[1px]">

      {/* Muted accent top rule — 1.5px, no animation, no glow */}
      <div className={`h-[1.5px] w-full shrink-0 ${tokens.topBar} opacity-70`} />

      <div className="flex flex-col gap-3 px-5 pb-5 pt-4">

        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-[#4A5568] truncate">
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
          <p className="text-[2.5rem] font-bold tabular-nums leading-none tracking-tighter text-gray-900 dark:text-white">
            {value}
          </p>
          {subtitle && (
            <p className="mt-1.5 text-[11px] leading-snug text-gray-400 dark:text-[#4A5568]">
              {subtitle}
            </p>
          )}
        </div>

        {/* Trend */}
        {trend && (
          <div className="flex items-center gap-1.5 border-t border-gray-100 dark:border-white/[0.06] pt-2.5">
            <span className={`text-[11px] font-semibold tabular-nums ${trend.value >= 0 ? tokens.trend_pos : tokens.trend_neg}`}>
              {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%
            </span>
            <span className="text-[11px] text-gray-400 dark:text-[#4A5568]">{trend.label}</span>
          </div>
        )}

      </div>
    </div>
  )
}
