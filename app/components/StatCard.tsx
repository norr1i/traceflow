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

const iconGradient: Record<Accent, string> = {
  blue:   'from-blue-500 to-blue-700',
  green:  'from-emerald-500 to-emerald-700',
  yellow: 'from-amber-400 to-amber-600',
  red:    'from-red-500 to-red-700',
  purple: 'from-violet-500 to-violet-700',
  orange: 'from-orange-400 to-orange-600',
}

const iconGlow: Record<Accent, string> = {
  blue:   'shadow-[0_0_18px_rgba(59,130,246,0.55)]',
  green:  'shadow-[0_0_18px_rgba(16,185,129,0.55)]',
  yellow: 'shadow-[0_0_18px_rgba(245,158,11,0.5)]',
  red:    'shadow-[0_0_18px_rgba(239,68,68,0.5)]',
  purple: 'shadow-[0_0_18px_rgba(139,92,246,0.55)]',
  orange: 'shadow-[0_0_18px_rgba(249,115,22,0.5)]',
}

const trendColor: Record<Accent, string> = {
  blue:   'text-blue-500 dark:text-blue-400',
  green:  'text-emerald-600 dark:text-emerald-400',
  yellow: 'text-amber-600 dark:text-amber-400',
  red:    'text-red-500 dark:text-red-400',
  purple: 'text-violet-500 dark:text-violet-400',
  orange: 'text-orange-500 dark:text-orange-400',
}

export default function StatCard({ title, value, subtitle, accent = 'blue', icon: Icon, trend }: Props) {
  return (
    <div className="
      group relative rounded-2xl p-5
      border border-gray-200 dark:border-white/[0.07]
      bg-white dark:bg-white/[0.04]
      dark:backdrop-blur-xl
      shadow-sm dark:shadow-none
      transition-all duration-300
      hover:-translate-y-0.5
      dark:hover:border-white/[0.12]
      dark:hover:bg-white/[0.06]
      dark:hover:shadow-[0_16px_48px_rgba(0,0,0,0.45)]
    ">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {title}
          </p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-white leading-none">
            {value}
          </p>
          {subtitle && (
            <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">{subtitle}</p>
          )}
          {trend && (
            <p className={`mt-1.5 text-xs font-semibold ${trend.value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
              {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
            </p>
          )}
        </div>
        {Icon && (
          <span className={`
            flex h-11 w-11 shrink-0 items-center justify-center rounded-xl
            bg-gradient-to-br ${iconGradient[accent]}
            ${iconGlow[accent]}
            transition-all duration-300
            group-hover:scale-110
          `}>
            <Icon size={20} className="text-white drop-shadow-sm" />
          </span>
        )}
      </div>

      {/* Subtle bottom accent line */}
      <div className={`
        absolute bottom-0 left-6 right-6 h-px rounded-full opacity-0
        bg-gradient-to-r ${iconGradient[accent]}
        dark:group-hover:opacity-40 transition-opacity duration-300
      `} />
    </div>
  )
}
