'use client'

import { useState, useEffect, useCallback } from 'react'
import { getDashboardStats, type DashboardStats } from './lib/dashboard'
import SectionCard from './components/SectionCard'
import StatCard from './components/StatCard'
import ProductionChart from './components/charts/ProductionChart'
import QcTrendChart from './components/charts/QcTrendChart'
import ScanActivityChart from './components/charts/ScanActivityChart'
import SalesChart from './components/charts/SalesChart'
import { useRole } from './lib/auth-context'
import { canView } from './lib/permissions'
import { ACTION_TYPES_BY_SECTION } from './lib/activity'
import { useT, fmtNum, type Lang } from './lib/i18n'
import {
  ClipboardList, QrCode, AlertTriangle, FlaskConical,
  Smartphone, Monitor, CheckCircle2, Clock, ShieldCheck,
  XCircle, RefreshCw, LayoutDashboard,
  TrendingUp, ShoppingCart, Boxes, Package, AlertCircle,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

type TFn = (key: string, vars?: Record<string, string | number>) => string

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string, t: TFn, lang: Lang): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)  return t('common.just_now')
  if (mins < 60) return t('common.time_ago_m', { n: fmtNum(mins, lang) })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return t('common.time_ago_h', { n: fmtNum(hrs, lang) })
  const days = Math.floor(hrs / 24)
  if (days === 1) return t('common.yesterday')
  return t('common.time_ago_d', { n: fmtNum(days, lang) })
}

// ── Status components ──────────────────────────────────────────────────────

type QcStatus = 'pass' | 'fail' | 'hold'

function QcBadge({ status }: { status: QcStatus }) {
  const { t } = useT()
  const cfg: Record<QcStatus, string> = {
    pass: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-500/20',
    fail: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-500/20',
    hold: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-500/20',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg[status]}`}>
      {t(`status.${status}`)}
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  const { t } = useT()
  const cfg: Record<string, string> = {
    completed:   'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-500/20',
    in_progress: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-500/20',
    pending:     'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-500/20',
    cancelled:   'bg-gray-50 dark:bg-white/[0.05] text-gray-500 dark:text-gray-400 ring-1 ring-gray-200 dark:ring-white/[0.07]',
    refunded:    'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-500/20',
  }
  const label = t(`status.${status}`)
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg[status] ?? cfg.pending}`}>
      {label !== `status.${status}` ? label : status.replace('_', ' ')}
    </span>
  )
}

// ── QC breakdown bar ───────────────────────────────────────────────────────

function QcBar({ pass, fail, hold }: { pass: number; fail: number; hold: number }) {
  const { t, lang } = useT()
  const total = pass + fail + hold
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-gray-400 dark:text-[#4A5568]">
        <FlaskConical size={20} strokeWidth={1.5} className="opacity-40" />
        <p className="text-sm">{t('dashboard.no_qc')}</p>
      </div>
    )
  }
  const pctRaw = (n: number) => Math.round((n / total) * 100)
  const pctFmt = (n: number) =>
    fmtNum(pctRaw(n) / 100, lang, { style: 'percent', maximumFractionDigits: 0 })

  return (
    <div className="space-y-4">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.05]">
        {pass > 0 && <div style={{ width: `${pctRaw(pass)}%` }} className="bg-emerald-500 transition-all duration-700" />}
        {fail > 0 && <div style={{ width: `${pctRaw(fail)}%` }} className="bg-red-500 transition-all duration-700" />}
        {hold > 0 && <div style={{ width: `${pctRaw(hold)}%` }} className="bg-amber-400 transition-all duration-700" />}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {(
          [
            { labelKey: 'dashboard.pass', value: pass, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/[0.06] dark:bg-emerald-500/10', dot: 'bg-emerald-500' },
            { labelKey: 'dashboard.fail', value: fail, color: 'text-red-600 dark:text-red-400',         bg: 'bg-red-500/[0.06] dark:bg-red-500/10',         dot: 'bg-red-500'     },
            { labelKey: 'dashboard.hold', value: hold, color: 'text-amber-600 dark:text-amber-400',      bg: 'bg-amber-500/[0.06] dark:bg-amber-500/10',      dot: 'bg-amber-400'   },
          ] as const
        ).map(({ labelKey, value, color, bg, dot }) => (
          <div key={labelKey} className={`rounded-lg ${bg} px-3 py-2.5 text-center`}>
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{fmtNum(value, lang)}</p>
            <div className="mt-1 flex items-center justify-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              <span className="text-[11px] text-gray-500 dark:text-[#4A5568]">{t(labelKey)} · {pctFmt(value)}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 dark:text-[#4A5568]">
        {t('dashboard.total_inspections_count', { n: fmtNum(total, lang) })}
      </p>
    </div>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function SkeletonBlock({ h, className = '' }: { h: string; className?: string }) {
  return <div className={`${h} animate-pulse rounded-xl bg-gray-200 dark:bg-white/[0.05] ${className}`} />
}

function Skeleton() {
  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} h="h-28" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SkeletonBlock h="h-72 lg:col-span-2" />
        <SkeletonBlock h="h-72" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonBlock h="h-60" />
        <SkeletonBlock h="h-60" />
      </div>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-gray-400 dark:text-[#4A5568]">
      <Icon size={20} strokeWidth={1.5} className="opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

// ── Activity timeline ──────────────────────────────────────────────────────

function ActivityTimeline({ entries }: { entries: DashboardStats['activityFeed'] }) {
  const { t, lang, dir } = useT()
  return (
    <div className={`relative ${dir === 'rtl' ? 'pr-5' : 'pl-5'}`}>
      <div className={`absolute ${dir === 'rtl' ? 'right-[6px]' : 'left-[6px]'} top-1.5 h-[calc(100%-12px)] w-px bg-gray-100 dark:bg-white/[0.08]`} />
      <ul className="space-y-4">
        {entries.map((entry) => (
          <li key={entry.id} className="relative">
            <span className={`absolute ${dir === 'rtl' ? '-right-5' : '-left-5'} top-[3px] flex h-3 w-3 items-center justify-center`}>
              <span className="h-[7px] w-[7px] rounded-full bg-[#4a8fb9]/70 ring-[3px] ring-[var(--surface)]" />
            </span>
            <p className="text-[12.5px] leading-snug text-gray-800 dark:text-[#C4CAD6]">
              {entry.message}
            </p>
            <p className="mt-0.5 text-[10.5px] text-gray-400 dark:text-[#4A5568]">
              {entry.actor_email ?? t('common.system')} · {timeAgo(entry.created_at, t, lang)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Rank bar list ──────────────────────────────────────────────────────────

function RankBar({
  items,
  valueKey,
  labelKey,
  subKey,
  formatValue,
  barColor = 'bg-[#4a8fb9]/50',
  maxValue,
}: {
  items: Record<string, unknown>[]
  valueKey: string
  labelKey: string
  subKey?: string
  formatValue?: (v: number) => string
  barColor?: string
  maxValue: number
}) {
  const { lang } = useT()
  return (
    <ul className="space-y-3.5">
      {items.map((item, i) => {
        const val = item[valueKey] as number
        const pct = maxValue > 0 ? (val / maxValue) * 100 : 0
        return (
          <li key={i}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-md bg-gray-100 dark:bg-white/[0.07] text-[10px] font-bold tabular-nums text-gray-400 dark:text-[#4A5568]">
                  {fmtNum(i + 1, lang)}
                </span>
                <span className="text-[12.5px] font-medium text-gray-900 dark:text-[#E8EDF5] truncate">
                  {item[labelKey] as string}
                </span>
                {subKey && !!item[subKey] && (
                  <span className="shrink-0 font-mono text-[11px] text-gray-400 dark:text-[#4A5568]">
                    {String(item[subKey])}
                  </span>
                )}
              </div>
              <span className="shrink-0 text-[12.5px] font-semibold text-gray-700 dark:text-[#A8B3C0] tabular-nums">
                {formatValue ? formatValue(val) : fmtNum(val, lang)}
              </span>
            </div>
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
              <div
                className={`h-full rounded-full ${barColor} transition-all duration-700`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const role = useRole()
  const { t, lang } = useT()

  const showProduction = canView(role, 'dashboard.production')
  const showQuality    = canView(role, 'dashboard.quality')
  const showTracing    = canView(role, 'dashboard.tracing')
  const showInventory  = canView(role, 'dashboard.inventory')
  const showSales      = canView(role, 'dashboard.sales')

  const hasAnySections = showProduction || showQuality || showTracing || showInventory || showSales

  const [stats,       setStats]       = useState<DashboardStats | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [refreshing,  setRefreshing]  = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // ── Locale-aware helpers (close over lang) ─────────────────────────────

  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'

  function fmt(iso: string) {
    return new Date(iso).toLocaleDateString(locale, {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }

  function fmtRevenue(n: number): string {
    if (lang === 'ar') {
      if (n >= 1_000_000) return `${fmtNum(parseFloat((n / 1_000_000).toFixed(1)), lang)} م ر.س`
      if (n >= 1_000)     return `${fmtNum(Math.round(n / 1_000), lang)} ك ر.س`
      return `${fmtNum(n, lang)} ر.س`
    }
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M SAR`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K SAR`
    return `${fmtNum(n, lang)} SAR`
  }

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    try {
      const data = await getDashboardStats()
      setStats(data)
      setLastUpdated(new Date())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(() => load(true), 30_000)
    return () => clearInterval(interval)
  }, [load])

  if (loading) return <Skeleton />
  if (!stats)  return null

  const {
    totalBatches, totalScans, passRate, weeklyInspections,
    qcCounts, ordersByStatus, ordersThisWeek,
    qcTrend, scanTrend,
    recentQc, failedBatches, mostScanned, recentScans, recallRisk,
    recentOrders,
    rawMaterials, lowStockCount, inProgressOrders,
    recentSales, totalSalesRevenue, totalSalesCount, topProducts,
    activityFeed,
  } = stats

  const maxScanCount      = mostScanned[0]?.scan_count ?? 1
  const maxProductRevenue = topProducts[0]?.revenue ?? 1
  const hasRisk = recallRisk.failedQcCount > 0 || recallRisk.missingQcCount > 0

  const passRateAccent = passRate === null ? 'blue'
    : passRate >= 80 ? 'green'
    : passRate >= 60 ? 'yellow'
    : 'red'

  const fmtPassRate = passRate !== null
    ? fmtNum(passRate / 100, lang, { style: 'percent', maximumFractionDigits: 0 })
    : '—'

  // ── Role-smart KPI cards ─────────────────────────────────────────────────

  const kpiCards: React.ReactNode[] = (() => {
    if (showProduction && showQuality) {
      return [
        <StatCard key="batches"
          title={t('dashboard.production_batches')}
          value={fmtNum(totalBatches, lang)}
          subtitle={`${fmtNum(ordersByStatus.in_progress, lang)} ${t('dashboard.in_progress_suffix')}`}
          accent="blue" icon={ClipboardList}
        />,
        <StatCard key="passrate"
          title={t('dashboard.qc_pass_rate')}
          value={fmtPassRate}
          subtitle={`${fmtNum(qcCounts.pass + qcCounts.fail + qcCounts.hold, lang)} ${t('dashboard.total_inspections_suffix')}`}
          accent={passRateAccent}
          icon={passRate !== null && passRate >= 80 ? CheckCircle2 : passRate !== null && passRate < 60 ? XCircle : ShieldCheck}
        />,
        <StatCard key="scans"
          title={t('dashboard.qr_scans')}
          value={fmtNum(totalScans, lang)}
          subtitle={t('dashboard.alltime_trace')}
          accent="purple" icon={QrCode}
        />,
        <StatCard key="weekly"
          title={t('dashboard.inspections_week')}
          value={fmtNum(weeklyInspections, lang)}
          subtitle={t('dashboard.qc_last_7')}
          accent={weeklyInspections > 0 ? 'orange' : 'yellow'} icon={FlaskConical}
        />,
      ]
    }
    if (showQuality && !showProduction) {
      return [
        <StatCard key="passrate"
          title={t('dashboard.qc_pass_rate')}
          value={fmtPassRate}
          subtitle={`${fmtNum(qcCounts.pass + qcCounts.fail + qcCounts.hold, lang)} ${t('dashboard.total_inspections_suffix')}`}
          accent={passRateAccent}
          icon={passRate !== null && passRate >= 80 ? CheckCircle2 : passRate !== null && passRate < 60 ? XCircle : ShieldCheck}
        />,
        <StatCard key="failed"
          title={t('dashboard.failed')}
          value={fmtNum(qcCounts.fail, lang)}
          subtitle={t('dashboard.fail_subtitle')}
          accent="red" icon={XCircle}
        />,
        <StatCard key="hold"
          title={t('dashboard.on_hold')}
          value={fmtNum(qcCounts.hold, lang)}
          subtitle={t('dashboard.hold_subtitle')}
          accent="yellow" icon={Clock}
        />,
        <StatCard key="weekly"
          title={t('dashboard.this_week')}
          value={fmtNum(weeklyInspections, lang)}
          subtitle={t('dashboard.inspection_subtitle')}
          accent={weeklyInspections > 0 ? 'orange' : 'yellow'} icon={FlaskConical}
        />,
      ]
    }
    if (showProduction && showTracing && !showInventory && !showSales) {
      return [
        <StatCard key="batches"
          title={t('dashboard.total_batches')}
          value={fmtNum(totalBatches, lang)}
          subtitle={`${fmtNum(ordersByStatus.completed, lang)} ${t('dashboard.completed_suffix')}`}
          accent="blue" icon={ClipboardList}
        />,
        <StatCard key="inprogress"
          title={t('dashboard.in_progress')}
          value={fmtNum(ordersByStatus.in_progress, lang)}
          subtitle={t('dashboard.active_orders_subtitle')}
          accent="orange" icon={Clock}
        />,
        <StatCard key="thisweek"
          title={t('dashboard.this_week')}
          value={fmtNum(ordersThisWeek, lang)}
          subtitle={t('dashboard.orders_7days')}
          accent="green" icon={ClipboardList}
        />,
        <StatCard key="scans"
          title={t('dashboard.qr_scans')}
          value={fmtNum(totalScans, lang)}
          subtitle={t('dashboard.alltime_trace')}
          accent="purple" icon={QrCode}
        />,
      ]
    }
    if (showInventory && !showQuality) {
      return [
        <StatCard key="materials"
          title={t('dashboard.raw_materials')}
          value={fmtNum(rawMaterials.length, lang)}
          subtitle={t('dashboard.tracked_items')}
          accent="green" icon={Boxes}
        />,
        <StatCard key="lowstock"
          title={t('dashboard.low_stock')}
          value={fmtNum(lowStockCount, lang)}
          subtitle={lowStockCount > 0 ? t('dashboard.below_reorder') : t('dashboard.all_stocked')}
          accent={lowStockCount > 0 ? 'red' : 'green'}
          icon={lowStockCount > 0 ? AlertTriangle : CheckCircle2}
        />,
        <StatCard key="active"
          title={t('dashboard.active_orders')}
          value={fmtNum(ordersByStatus.in_progress, lang)}
          subtitle={t('dashboard.orders_using')}
          accent="orange" icon={ClipboardList}
        />,
        <StatCard key="batches"
          title={t('dashboard.total_batches')}
          value={fmtNum(totalBatches, lang)}
          subtitle={`${fmtNum(ordersByStatus.completed, lang)} ${t('dashboard.completed_suffix')}`}
          accent="blue" icon={Package}
        />,
      ]
    }
    if (showSales && !showQuality) {
      return [
        <StatCard key="salescount"
          title={t('dashboard.total_sales')}
          value={fmtNum(totalSalesCount, lang)}
          subtitle={t('dashboard.alltime_orders')}
          accent="purple" icon={ShoppingCart}
        />,
        <StatCard key="salesrev"
          title={t('dashboard.revenue')}
          value={fmtRevenue(totalSalesRevenue)}
          subtitle={t('dashboard.from_completed')}
          accent="green" icon={TrendingUp}
        />,
        <StatCard key="recall"
          title={t('dashboard.recall_risk')}
          value={fmtNum(recallRisk.failedQcCount, lang)}
          subtitle={recallRisk.failedWithSales > 0
            ? `${fmtNum(recallRisk.failedWithSales, lang)} ${t('dashboard.distributed')}`
            : t('dashboard.failed_qc_sub')}
          accent={recallRisk.failedQcCount > 0 ? 'red' : 'green'}
          icon={recallRisk.failedQcCount > 0 ? AlertTriangle : CheckCircle2}
        />,
        <StatCard key="products"
          title={t('dashboard.products_sold')}
          value={fmtNum(topProducts.length, lang)}
          subtitle={t('dashboard.distinct_products')}
          accent="blue" icon={Package}
        />,
      ]
    }
    return []
  })()

  // ── Activity feed filtered by role ────────────────────────────────────────

  const feedEntries = (() => {
    const relevantTypes = new Set<string>([
      ...(showProduction ? ACTION_TYPES_BY_SECTION.production : []),
      ...(showQuality    ? ACTION_TYPES_BY_SECTION.quality    : []),
      ...(showInventory  ? ACTION_TYPES_BY_SECTION.inventory  : []),
      ...(showSales      ? ACTION_TYPES_BY_SECTION.sales      : []),
      ...(showProduction && showQuality ? ACTION_TYPES_BY_SECTION.admin : []),
    ])
    return activityFeed.filter(e => relevantTypes.has(e.action_type))
  })()

  return (
    <div className="px-6 py-7 max-w-[1400px] mx-auto space-y-5 pb-10">

      {/* ── No-section fallback ──────────────────────────────────────────── */}
      {!hasAnySections && (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-white/[0.02] text-gray-400 dark:text-[#4A5568]">
          <LayoutDashboard size={22} strokeWidth={1.5} className="opacity-40" />
          <div className="text-center">
            <p className="text-sm font-medium text-gray-600 dark:text-[#6B7280]">{t('dashboard.no_role_sections')}</p>
            <p className="mt-0.5 text-xs">{t('dashboard.use_sidebar')}</p>
          </div>
        </div>
      )}

      {/* ── Recall / low-stock risk banners ──────────────────────────────── */}
      {showProduction && hasRisk && (
        <div className="flex items-start gap-3.5 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/[0.06] px-4 py-3.5">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500 dark:text-red-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">{t('dashboard.recall_risk_title')}</p>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5">
              {recallRisk.failedQcCount > 0 && (
                <span className="text-[12px] text-red-600 dark:text-red-400">
                  {t(recallRisk.failedQcCount !== 1
                    ? 'dashboard.recall_batches_failed_plural'
                    : 'dashboard.recall_batches_failed',
                    { n: fmtNum(recallRisk.failedQcCount, lang) })}
                </span>
              )}
              {recallRisk.failedWithSales > 0 && (
                <span className="text-[12px] font-semibold text-red-700 dark:text-red-300">
                  {t('dashboard.recall_distributed_to', { n: fmtNum(recallRisk.failedWithSales, lang) })}
                </span>
              )}
              {recallRisk.missingQcCount > 0 && (
                <span className="text-[12px] text-amber-700 dark:text-amber-400">
                  {t(recallRisk.missingQcCount !== 1
                    ? 'dashboard.recall_missing_qc_plural'
                    : 'dashboard.recall_missing_qc',
                    { n: fmtNum(recallRisk.missingQcCount, lang) })}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {showInventory && !showQuality && !showTracing && lowStockCount > 0 && (
        <div className="flex items-start gap-3.5 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.06] px-4 py-3.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">
              {t(lowStockCount !== 1
                ? 'dashboard.inventory_low_banner_plural'
                : 'dashboard.inventory_low_banner',
                { n: fmtNum(lowStockCount, lang) })}
            </p>
            <p className="mt-0.5 text-[12px] text-amber-700/70 dark:text-amber-400/60">
              {t('dashboard.inventory_low_review')}
            </p>
          </div>
        </div>
      )}

      {/* ── KPI cards ────────────────────────────────────────────────────── */}
      {kpiCards.length > 0 && (
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpiCards}
        </section>
      )}

      {/* ── Primary charts: QC trend + scan activity ─────────────────────── */}
      {(showQuality || showTracing) && (
        <section className={`grid gap-4 ${showQuality && showTracing ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1'}`}>
          {showQuality && (
            <div className={showQuality && showTracing ? 'lg:col-span-2' : ''}>
              <SectionCard title={t('dashboard.section.qc_trend')} subtitle={t('dashboard.section.qc_trend_sub')}>
                <div className="h-56">
                  <QcTrendChart data={qcTrend} />
                </div>
              </SectionCard>
            </div>
          )}
          {showTracing && (
            <SectionCard title={t('dashboard.section.scan_activity')} subtitle={t('dashboard.section.scan_activity_sub')}>
              <div className="h-56">
                <ScanActivityChart data={scanTrend} />
              </div>
            </SectionCard>
          )}
        </section>
      )}

      {/* ── Production pipeline + QC breakdown ───────────────────────────── */}
      {(showProduction || showQuality) && (
        <section className={`grid gap-4 ${showProduction && showQuality ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1'}`}>
          {showProduction && (
            <div className={showProduction && showQuality ? 'lg:col-span-2' : ''}>
              <SectionCard title={t('dashboard.section.production_pipeline')} subtitle={t('dashboard.section.production_pipeline_sub')}>
                <div className="h-56">
                  <ProductionChart data={ordersByStatus} />
                </div>
              </SectionCard>
            </div>
          )}
          {showQuality && (
            <SectionCard title={t('dashboard.section.qc_breakdown')} subtitle={t('dashboard.section.qc_breakdown_sub')}>
              <QcBar pass={qcCounts.pass} fail={qcCounts.fail} hold={qcCounts.hold} />
            </SectionCard>
          )}
        </section>
      )}

      {/* ── Recent QC + Most scanned ──────────────────────────────────────── */}
      {(showQuality || showTracing) && (
        <section className={`grid gap-4 ${showQuality && showTracing ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
          {showQuality && (
            <SectionCard title={t('dashboard.section.recent_qc')} subtitle={t('dashboard.section.recent_qc_sub')}>
              {recentQc.length === 0 ? (
                <EmptyState icon={FlaskConical} message={t('dashboard.no_inspections')} />
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {recentQc.map((q, i) => (
                    <li key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                        q.status === 'pass' ? 'bg-emerald-500' : q.status === 'fail' ? 'bg-red-500' : 'bg-amber-400'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0] truncate">{q.product_name}</span>
                          <QcBadge status={q.status} />
                        </div>
                        <p className="mt-0.5 text-[11px] text-gray-400 dark:text-[#4A5568]">{q.inspector_name} · {fmt(q.inspected_at)}</p>
                        {q.notes && <p className="mt-0.5 text-[11px] text-gray-500 dark:text-[#4B5563] truncate">{q.notes}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}
          {showTracing && (
            <SectionCard title={t('dashboard.section.most_scanned')} subtitle={t('dashboard.section.most_scanned_sub')}>
              {mostScanned.length === 0 ? (
                <EmptyState icon={QrCode} message={t('dashboard.no_scan_events')} />
              ) : (
                <RankBar
                  items={mostScanned as unknown as Record<string, unknown>[]}
                  valueKey="scan_count"
                  labelKey="product_name"
                  subKey="sku"
                  maxValue={maxScanCount}
                  barColor="bg-[#4a8fb9]/50"
                />
              )}
            </SectionCard>
          )}
        </section>
      )}

      {/* ── Failed QC + Recent scans ──────────────────────────────────────── */}
      {(showProduction || showTracing) && (
        <section className={`grid gap-4 ${showProduction && showTracing ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
          {showProduction && (
            <SectionCard title={t('dashboard.section.failed_qc')} subtitle={t('dashboard.section.failed_qc_sub')}>
              {failedBatches.length === 0 ? (
                <EmptyState icon={CheckCircle2} message={t('dashboard.no_failed')} />
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {failedBatches.map(b => (
                    <li key={b.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0]">{b.product_name}</span>
                          <span className="font-mono text-[11px] text-gray-400 dark:text-[#4A5568]">{b.sku}</span>
                          {b.has_sales && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-500/20">
                              {t('dashboard.distributed_label')}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-gray-400 dark:text-[#4A5568]">
                          {b.latest_qc.inspector_name} · {fmt(b.latest_qc.inspected_at)}
                        </p>
                        {b.latest_qc.notes && (
                          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-[#4B5563] truncate">{b.latest_qc.notes}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}
          {showTracing && (
            <SectionCard title={t('dashboard.section.recent_scans')} subtitle={t('dashboard.section.recent_scans_sub')}>
              {recentScans.length === 0 ? (
                <EmptyState icon={QrCode} message={t('dashboard.no_scan_events')} />
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {recentScans.map((s, i) => (
                    <li key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-white/[0.05] text-gray-400 dark:text-[#4A5568]">
                        {s.device_type === 'mobile' ? <Smartphone size={13} /> : <Monitor size={13} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0] truncate">{s.product_name}</p>
                        <p className="text-[11px] text-gray-400 dark:text-[#4A5568]">
                          {s.browser ?? t('common.browser')} · {s.device_type ?? t('common.device')}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 text-[11px] text-gray-400 dark:text-[#4A5568]">
                        <Clock size={10} />
                        {timeAgo(s.scanned_at, t, lang)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}
        </section>
      )}

      {/* ── Operations: recent production orders ─────────────────────────── */}
      {showProduction && showTracing && !showQuality && (
        <section>
          <SectionCard title={t('dashboard.section.recent_orders')} subtitle={t('dashboard.section.recent_orders_sub')} flush>
            {recentOrders.length === 0 ? (
              <div className="px-5 py-4">
                <EmptyState icon={ClipboardList} message={t('dashboard.no_orders')} />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-white/[0.05] text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-[#4A5568]">
                      <th className="px-5 pb-3 pt-0.5 text-start">{t('dashboard.table.product')}</th>
                      <th className="px-5 pb-3 pt-0.5 text-start hidden sm:table-cell">{t('dashboard.table.sku')}</th>
                      <th className="px-5 pb-3 pt-0.5 text-end">{t('dashboard.table.qty')}</th>
                      <th className="px-5 pb-3 pt-0.5 text-center">{t('dashboard.table.status')}</th>
                      <th className="px-5 pb-3 pt-0.5 text-end">{t('dashboard.table.created')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                    {recentOrders.map(b => (
                      <tr key={b.id} className="transition-colors hover:bg-gray-50/80 dark:hover:bg-white/[0.03]">
                        <td className="px-5 py-2.5 text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0]">
                          <span className="truncate block max-w-[200px]">{b.products?.name ?? t('common.unknown')}</span>
                        </td>
                        <td className="px-5 py-2.5 hidden sm:table-cell font-mono text-[11px] text-gray-400 dark:text-[#4A5568]">{b.products?.sku ?? '—'}</td>
                        <td className="px-5 py-2.5 text-end tabular-nums text-[13px] text-gray-600 dark:text-[#A8B3C0]">{fmtNum(b.quantity, lang)}</td>
                        <td className="px-5 py-2.5 text-center"><StatusPill status={b.status} /></td>
                        <td className="px-5 py-2.5 text-end text-[11px] text-gray-400 dark:text-[#4A5568]">{fmt(b.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </section>
      )}

      {/* ── Warehouse: inventory + production demand ──────────────────────── */}
      {showInventory && !showQuality && !showTracing && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard title={t('dashboard.section.inventory')} subtitle={t('dashboard.section.inventory_sub')}>
            {rawMaterials.length === 0 ? (
              <EmptyState icon={Boxes} message={t('dashboard.no_materials')} />
            ) : (
              <ul className="space-y-4">
                {rawMaterials.slice(0, 10).map(mat => {
                  const isLow = mat.quantity_in_stock <= mat.reorder_level
                  const maxLevel = mat.reorder_level * 3
                  const pct = maxLevel > 0 ? Math.min(100, Math.round((mat.quantity_in_stock / maxLevel) * 100)) : 100
                  return (
                    <li key={mat.id} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0] truncate">{mat.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-[12px] font-semibold tabular-nums ${isLow ? 'text-red-500' : 'text-emerald-500'}`}>
                            {fmtNum(mat.quantity_in_stock, lang)} {mat.unit}
                          </span>
                          {isLow && (
                            <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-500/20">
                              {t('common.low')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.05]">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${isLow ? 'bg-red-500' : 'bg-emerald-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-gray-400 dark:text-[#4A5568]">
                        {t('dashboard.reorder_at')} {fmtNum(mat.reorder_level, lang)} {mat.unit}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </SectionCard>

          <SectionCard title={t('dashboard.section.demand')} subtitle={t('dashboard.section.demand_sub')}>
            {inProgressOrders.length === 0 ? (
              <EmptyState icon={ClipboardList} message={t('dashboard.no_active_orders')} />
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {inProgressOrders.map(b => (
                  <li key={b.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0] truncate">
                        {b.products?.name ?? t('common.unknown_product')}
                      </p>
                      <p className="text-[11px] text-gray-400 dark:text-[#4A5568]">
                        {b.products?.sku ?? '—'} · {t('dashboard.qty_prefix')} {fmtNum(b.quantity, lang)}
                      </p>
                    </div>
                    <StatusPill status="in_progress" />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </section>
      )}

      {/* ── Sales: revenue chart + top products ──────────────────────────── */}
      {showSales && !showQuality && !showTracing && (
        <>
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <SectionCard title={t('dashboard.section.revenue_trend')} subtitle={t('dashboard.section.revenue_trend_sub')}>
                <div className="h-56">
                  <SalesChart data={recentSales} />
                </div>
              </SectionCard>
            </div>
            <SectionCard title={t('dashboard.section.top_products')} subtitle={t('dashboard.section.top_products_sub')}>
              {topProducts.length === 0 ? (
                <EmptyState icon={Package} message={t('dashboard.no_top_products')} />
              ) : (
                <RankBar
                  items={topProducts as unknown as Record<string, unknown>[]}
                  valueKey="revenue"
                  labelKey="product_name"
                  formatValue={(v) => fmtRevenue(v)}
                  maxValue={maxProductRevenue}
                  barColor="bg-[#4a8fb9]/35"
                />
              )}
            </SectionCard>
          </section>

          <section>
            <SectionCard title={t('dashboard.section.recent_sales')} subtitle={t('dashboard.section.recent_sales_sub')} flush>
              {recentSales.length === 0 ? (
                <div className="px-5 py-4">
                  <EmptyState icon={ShoppingCart} message={t('dashboard.no_sales')} />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-white/[0.05] text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-[#4A5568]">
                        <th className="px-5 pb-3 pt-0.5 text-start">{t('dashboard.table.product')}</th>
                        <th className="px-5 pb-3 pt-0.5 text-end">{t('dashboard.table.qty')}</th>
                        <th className="px-5 pb-3 pt-0.5 text-end">{t('dashboard.table.total')}</th>
                        <th className="px-5 pb-3 pt-0.5 text-start hidden sm:table-cell">{t('dashboard.table.customer')}</th>
                        <th className="px-5 pb-3 pt-0.5 text-center">{t('dashboard.table.status')}</th>
                        <th className="px-5 pb-3 pt-0.5 text-end">{t('dashboard.table.date')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                      {recentSales.map((s, i) => (
                        <tr key={i} className="transition-colors hover:bg-gray-50/80 dark:hover:bg-white/[0.03]">
                          <td className="px-5 py-2.5">
                            <p className="text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0] truncate max-w-[160px]">{s.product_name}</p>
                          </td>
                          <td className="px-5 py-2.5 text-end tabular-nums text-[13px] text-gray-600 dark:text-[#A8B3C0]">{fmtNum(Number(s.quantity), lang)}</td>
                          <td className="px-5 py-2.5 text-end tabular-nums text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0]">
                            {fmtNum(Number(s.total_price), lang)} {lang === 'ar' ? 'ر.س' : 'SAR'}
                          </td>
                          <td className="px-5 py-2.5 hidden sm:table-cell">
                            <p className="truncate max-w-[130px] text-[11px] text-gray-400 dark:text-[#4A5568]">{s.customer_name || '—'}</p>
                          </td>
                          <td className="px-5 py-2.5 text-center"><StatusPill status={s.status} /></td>
                          <td className="px-5 py-2.5 text-end text-[11px] text-gray-400 dark:text-[#4A5568]">{fmt(s.sold_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </section>
        </>
      )}

      {/* ── Activity feed + Last-updated meta ─────────────────────────────── */}
      {feedEntries.length > 0 && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SectionCard title={t('dashboard.section.activity')} subtitle={t('dashboard.section.activity_sub')}>
              <ActivityTimeline entries={feedEntries} />
            </SectionCard>
          </div>
          <div className="flex flex-col gap-4">
            <div className="glass-card rounded-xl px-5 py-4 space-y-3.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-[#4A5568]">
                {t('dashboard.system_status')}
              </p>
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span className="text-[12.5px] text-gray-700 dark:text-[#C4CAD6]">{t('dashboard.all_operational')}</span>
              </div>
              {lastUpdated && (
                <p className="text-[10.5px] text-gray-400 dark:text-[#4A5568]">
                  {t('dashboard.updated_ago', { time: timeAgo(lastUpdated.toISOString(), t, lang) })}
                </p>
              )}
              <button
                onClick={() => load(true)}
                disabled={refreshing}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.04] px-3 py-2 text-[11.5px] font-medium text-gray-500 dark:text-[#5A6478] hover:bg-gray-100 dark:hover:bg-white/[0.07] disabled:opacity-40 transition-colors"
              >
                <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
                {t('dashboard.refresh_data')}
              </button>
            </div>
          </div>
        </section>
      )}

    </div>
  )
}
