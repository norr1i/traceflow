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
import {
  ClipboardList, QrCode, AlertTriangle, FlaskConical,
  Smartphone, Monitor, CheckCircle2, Clock, ShieldCheck,
  XCircle, RefreshCw, LayoutDashboard,
  TrendingUp, ShoppingCart, Boxes, Package, AlertCircle,
} from 'lucide-react'

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmtRevenue(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M SAR`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K SAR`
  return `${n.toLocaleString()} SAR`
}

// ── Status components ──────────────────────────────────────────────────────

type QcStatus = 'pass' | 'fail' | 'hold'

function QcBadge({ status }: { status: QcStatus }) {
  const cfg: Record<QcStatus, string> = {
    pass: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-500/20',
    fail: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-500/20',
    hold: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-500/20',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${cfg[status]}`}>
      {status}
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    completed:   'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-500/20',
    in_progress: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-500/20',
    pending:     'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-500/20',
    cancelled:   'bg-gray-50 dark:bg-white/[0.05] text-gray-500 dark:text-gray-400 ring-1 ring-gray-200 dark:ring-white/[0.07]',
    refunded:    'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-500/20',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${cfg[status] ?? cfg.pending}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ── QC breakdown bar ───────────────────────────────────────────────────────

function QcBar({ pass, fail, hold }: { pass: number; fail: number; hold: number }) {
  const total = pass + fail + hold
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-gray-400 dark:text-[#4A5568]">
        <FlaskConical size={20} strokeWidth={1.5} className="opacity-40" />
        <p className="text-sm">No QC inspections recorded yet.</p>
      </div>
    )
  }
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`
  return (
    <div className="space-y-4">
      {/* Stacked bar */}
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.05]">
        {pass > 0 && <div style={{ width: pct(pass) }} className="bg-emerald-500 transition-all duration-700" />}
        {fail > 0 && <div style={{ width: pct(fail) }} className="bg-red-500 transition-all duration-700" />}
        {hold > 0 && <div style={{ width: pct(hold) }} className="bg-amber-400 transition-all duration-700" />}
      </div>
      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        {(
          [
            { label: 'Pass', value: pass, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/[0.06] dark:bg-emerald-500/10', dot: 'bg-emerald-500' },
            { label: 'Fail', value: fail, color: 'text-red-600 dark:text-red-400',         bg: 'bg-red-500/[0.06] dark:bg-red-500/10',         dot: 'bg-red-500'     },
            { label: 'Hold', value: hold, color: 'text-amber-600 dark:text-amber-400',      bg: 'bg-amber-500/[0.06] dark:bg-amber-500/10',      dot: 'bg-amber-400'   },
          ] as const
        ).map(({ label, value, color, bg, dot }) => (
          <div key={label} className={`rounded-lg ${bg} px-3 py-2.5 text-center`}>
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
            <div className="mt-1 flex items-center justify-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              <span className="text-[11px] text-gray-500 dark:text-[#4A5568]">{label} · {pct(value)}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 dark:text-[#4A5568]">{total.toLocaleString()} total inspections</p>
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
  return (
    <div className="relative pl-5">
      <div className="absolute left-[6px] top-1.5 h-[calc(100%-12px)] w-px bg-gray-100 dark:bg-white/[0.08]" />
      <ul className="space-y-4">
        {entries.map((entry) => (
          <li key={entry.id} className="relative">
            <span className="absolute -left-5 top-[3px] flex h-3 w-3 items-center justify-center">
              <span className="h-[7px] w-[7px] rounded-full bg-[#4a8fb9]/70 ring-[3px] ring-[var(--surface)]" />
            </span>
            <p className="text-[12.5px] leading-snug text-gray-800 dark:text-[#C4CAD6]">
              {entry.message}
            </p>
            <p className="mt-0.5 text-[10.5px] text-gray-400 dark:text-[#4A5568]">
              {entry.actor_email ?? 'System'} · {timeAgo(entry.created_at)}
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
                  {i + 1}
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
                {formatValue ? formatValue(val) : val}
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

  // ── Role-smart KPI cards ─────────────────────────────────────────────────

  const kpiCards: React.ReactNode[] = (() => {
    if (showProduction && showQuality) {
      return [
        <StatCard key="batches"  title="Production Batches" value={totalBatches}  subtitle={`${ordersByStatus.in_progress} in progress`} accent="blue"  icon={ClipboardList} />,
        <StatCard key="passrate" title="QC Pass Rate"        value={passRate !== null ? `${passRate}%` : '—'} subtitle={`${qcCounts.pass + qcCounts.fail + qcCounts.hold} total inspections`} accent={passRateAccent} icon={passRate !== null && passRate >= 80 ? CheckCircle2 : passRate !== null && passRate < 60 ? XCircle : ShieldCheck} />,
        <StatCard key="scans"    title="QR Scans"            value={totalScans.toLocaleString()} subtitle="all-time trace events" accent="purple" icon={QrCode} />,
        <StatCard key="weekly"   title="Inspections This Week" value={weeklyInspections} subtitle="QC records last 7 days" accent={weeklyInspections > 0 ? 'orange' : 'yellow'} icon={FlaskConical} />,
      ]
    }
    if (showQuality && !showProduction) {
      return [
        <StatCard key="passrate" title="QC Pass Rate" value={passRate !== null ? `${passRate}%` : '—'} subtitle={`${qcCounts.pass + qcCounts.fail + qcCounts.hold} total inspections`} accent={passRateAccent} icon={passRate !== null && passRate >= 80 ? CheckCircle2 : passRate !== null && passRate < 60 ? XCircle : ShieldCheck} />,
        <StatCard key="failed"   title="Failed"       value={qcCounts.fail}    subtitle="batches with QC fail"      accent="red"    icon={XCircle}      />,
        <StatCard key="hold"     title="On Hold"      value={qcCounts.hold}    subtitle="pending re-inspection"     accent="yellow" icon={Clock}        />,
        <StatCard key="weekly"   title="This Week"    value={weeklyInspections} subtitle="inspections last 7 days" accent={weeklyInspections > 0 ? 'orange' : 'yellow'} icon={FlaskConical} />,
      ]
    }
    if (showProduction && showTracing && !showInventory && !showSales) {
      return [
        <StatCard key="batches"    title="Total Batches" value={totalBatches}               subtitle={`${ordersByStatus.completed} completed`}   accent="blue"   icon={ClipboardList} />,
        <StatCard key="inprogress" title="In Progress"   value={ordersByStatus.in_progress} subtitle="active production orders"                  accent="orange" icon={Clock}         />,
        <StatCard key="thisweek"   title="This Week"     value={ordersThisWeek}             subtitle="orders created last 7 days"                accent="green"  icon={ClipboardList} />,
        <StatCard key="scans"      title="QR Scans"      value={totalScans.toLocaleString()} subtitle="all-time trace events"                    accent="purple" icon={QrCode}        />,
      ]
    }
    if (showInventory && !showQuality) {
      return [
        <StatCard key="materials" title="Raw Materials" value={rawMaterials.length}        subtitle="tracked inventory items"                                          accent="green"                                  icon={Boxes}                                                  />,
        <StatCard key="lowstock"  title="Low Stock"     value={lowStockCount}              subtitle={lowStockCount > 0 ? 'at or below reorder level' : 'all stocked'} accent={lowStockCount > 0 ? 'red' : 'green'}   icon={lowStockCount > 0 ? AlertTriangle : CheckCircle2} />,
        <StatCard key="active"    title="Active Orders" value={ordersByStatus.in_progress} subtitle="production orders using materials"                                accent="orange"                                 icon={ClipboardList}                                          />,
        <StatCard key="batches"   title="Total Batches" value={totalBatches}               subtitle={`${ordersByStatus.completed} completed`}                         accent="blue"                                   icon={Package}                                                />,
      ]
    }
    if (showSales && !showQuality) {
      return [
        <StatCard key="salescount" title="Total Sales"  value={totalSalesCount}              subtitle="all-time orders"                                                                        accent="purple"                                          icon={ShoppingCart} />,
        <StatCard key="salesrev"   title="Revenue"      value={fmtRevenue(totalSalesRevenue)} subtitle="from completed sales"                                                                   accent="green"                                           icon={TrendingUp}   />,
        <StatCard key="recall"     title="Recall Risk"  value={recallRisk.failedQcCount}      subtitle={recallRisk.failedWithSales > 0 ? `${recallRisk.failedWithSales} distributed` : 'failed QC batches'} accent={recallRisk.failedQcCount > 0 ? 'red' : 'green'} icon={recallRisk.failedQcCount > 0 ? AlertTriangle : CheckCircle2} />,
        <StatCard key="products"   title="Products Sold" value={topProducts.length}            subtitle="distinct products with sales"                                                           accent="blue"                                            icon={Package}      />,
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
            <p className="text-sm font-medium text-gray-600 dark:text-[#6B7280]">No dashboard sections available for your role.</p>
            <p className="mt-0.5 text-xs">Use the sidebar to navigate to your module.</p>
          </div>
        </div>
      )}

      {/* ── Recall / low-stock risk banners ──────────────────────────────── */}
      {showProduction && hasRisk && (
        <div className="flex items-start gap-3.5 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/[0.06] px-4 py-3.5">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500 dark:text-red-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Recall Risk Detected</p>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5">
              {recallRisk.failedQcCount > 0 && (
                <span className="text-[12px] text-red-600 dark:text-red-400">
                  <span className="font-semibold">{recallRisk.failedQcCount}</span> batch{recallRisk.failedQcCount !== 1 ? 'es' : ''} with failed QC
                </span>
              )}
              {recallRisk.failedWithSales > 0 && (
                <span className="text-[12px] font-semibold text-red-700 dark:text-red-300">
                  {recallRisk.failedWithSales} distributed to customers
                </span>
              )}
              {recallRisk.missingQcCount > 0 && (
                <span className="text-[12px] text-amber-700 dark:text-amber-400">
                  <span className="font-semibold">{recallRisk.missingQcCount}</span> batch{recallRisk.missingQcCount !== 1 ? 'es' : ''} missing inspection
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
              {lowStockCount} material{lowStockCount !== 1 ? 's' : ''} at or below reorder level
            </p>
            <p className="mt-0.5 text-[12px] text-amber-700/70 dark:text-amber-400/60">
              Review inventory and raise purchase orders as needed.
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

      {/* ── Primary charts: main (2/3) + secondary (1/3) ─────────────────── */}
      {(showQuality || showTracing) && (
        <section className={`grid gap-4 ${showQuality && showTracing ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1'}`}>
          {showQuality && (
            <div className={showQuality && showTracing ? 'lg:col-span-2' : ''}>
              <SectionCard title="QC Trend — Last 7 Days" subtitle="Daily pass / fail / hold">
                <div className="h-56">
                  <QcTrendChart data={qcTrend} />
                </div>
              </SectionCard>
            </div>
          )}
          {showTracing && (
            <SectionCard title="QR Scan Activity" subtitle="Daily trace volume — 7 days">
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
              <SectionCard title="Production Pipeline" subtitle="Orders by current status">
                <div className="h-56">
                  <ProductionChart data={ordersByStatus} />
                </div>
              </SectionCard>
            </div>
          )}
          {showQuality && (
            <SectionCard title="QC Breakdown" subtitle="Cumulative pass / fail / hold">
              <QcBar pass={qcCounts.pass} fail={qcCounts.fail} hold={qcCounts.hold} />
            </SectionCard>
          )}
        </section>
      )}

      {/* ── Recent QC + Most scanned ──────────────────────────────────────── */}
      {(showQuality || showTracing) && (
        <section className={`grid gap-4 ${showQuality && showTracing ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
          {showQuality && (
            <SectionCard title="Recent QC Inspections" subtitle="Latest across all batches">
              {recentQc.length === 0 ? (
                <EmptyState icon={FlaskConical} message="No inspections recorded yet." />
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
            <SectionCard title="Most Scanned Batches" subtitle="By QR scan event count">
              {mostScanned.length === 0 ? (
                <EmptyState icon={QrCode} message="No scan events recorded yet." />
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
            <SectionCard title="Batches with Failed QC" subtitle="Latest QC status = fail">
              {failedBatches.length === 0 ? (
                <EmptyState icon={CheckCircle2} message="No failed batches — all clear." />
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
                              Distributed
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
            <SectionCard title="Recent Scan Events" subtitle="Latest QR code traces">
              {recentScans.length === 0 ? (
                <EmptyState icon={QrCode} message="No scan events recorded yet." />
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {recentScans.map((s, i) => (
                    <li key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-white/[0.05] text-gray-400 dark:text-[#4A5568]">
                        {s.device_type === 'mobile' ? <Smartphone size={13} /> : <Monitor size={13} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0] truncate">{s.product_name}</p>
                        <p className="text-[11px] text-gray-400 dark:text-[#4A5568]">{s.browser ?? 'Browser'} · {s.device_type ?? 'device'}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 text-[11px] text-gray-400 dark:text-[#4A5568]">
                        <Clock size={10} />
                        {timeAgo(s.scanned_at)}
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
          <SectionCard title="Recent Production Orders" subtitle="Last 10 orders across all statuses" flush>
            {recentOrders.length === 0 ? (
              <div className="px-5 py-4">
                <EmptyState icon={ClipboardList} message="No production orders found." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-white/[0.05] text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-[#4A5568]">
                      <th className="px-5 pb-3 pt-0.5 text-left">Product</th>
                      <th className="px-5 pb-3 pt-0.5 text-left hidden sm:table-cell">SKU</th>
                      <th className="px-5 pb-3 pt-0.5 text-right">Qty</th>
                      <th className="px-5 pb-3 pt-0.5 text-center">Status</th>
                      <th className="px-5 pb-3 pt-0.5 text-right">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                    {recentOrders.map(b => (
                      <tr key={b.id} className="transition-colors hover:bg-gray-50/80 dark:hover:bg-white/[0.03]">
                        <td className="px-5 py-2.5 text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0]">
                          <span className="truncate block max-w-[200px]">{b.products?.name ?? 'Unknown'}</span>
                        </td>
                        <td className="px-5 py-2.5 hidden sm:table-cell font-mono text-[11px] text-gray-400 dark:text-[#4A5568]">{b.products?.sku ?? '—'}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-[13px] text-gray-600 dark:text-[#A8B3C0]">{b.quantity.toLocaleString()}</td>
                        <td className="px-5 py-2.5 text-center"><StatusPill status={b.status} /></td>
                        <td className="px-5 py-2.5 text-right text-[11px] text-gray-400 dark:text-[#4A5568]">{fmt(b.created_at)}</td>
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
          <SectionCard title="Inventory Status" subtitle="Current stock vs. reorder points">
            {rawMaterials.length === 0 ? (
              <EmptyState icon={Boxes} message="No raw materials on record." />
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
                            {mat.quantity_in_stock.toLocaleString()} {mat.unit}
                          </span>
                          {isLow && (
                            <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-500/20">
                              Low
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
                      <p className="text-[10px] text-gray-400 dark:text-[#4A5568]">Reorder at {mat.reorder_level.toLocaleString()} {mat.unit}</p>
                    </li>
                  )
                })}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Production Demand" subtitle="Active orders consuming materials">
            {inProgressOrders.length === 0 ? (
              <EmptyState icon={ClipboardList} message="No active production orders." />
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {inProgressOrders.map(b => (
                  <li key={b.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0] truncate">
                        {b.products?.name ?? 'Unknown product'}
                      </p>
                      <p className="text-[11px] text-gray-400 dark:text-[#4A5568]">
                        {b.products?.sku ?? '—'} · Qty: {b.quantity.toLocaleString()}
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
              <SectionCard title="Revenue Trend" subtitle="Sales value — most recent orders">
                <div className="h-56">
                  <SalesChart data={recentSales} />
                </div>
              </SectionCard>
            </div>
            <SectionCard title="Top Products" subtitle="By revenue — completed sales">
              {topProducts.length === 0 ? (
                <EmptyState icon={Package} message="No completed sales recorded yet." />
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
            <SectionCard title="Recent Sales" subtitle="Last 15 orders across all statuses" flush>
              {recentSales.length === 0 ? (
                <div className="px-5 py-4">
                  <EmptyState icon={ShoppingCart} message="No sales recorded yet." />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-white/[0.05] text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-[#4A5568]">
                        <th className="px-5 pb-3 pt-0.5 text-left">Product</th>
                        <th className="px-5 pb-3 pt-0.5 text-right">Qty</th>
                        <th className="px-5 pb-3 pt-0.5 text-right">Total</th>
                        <th className="px-5 pb-3 pt-0.5 text-left hidden sm:table-cell">Customer</th>
                        <th className="px-5 pb-3 pt-0.5 text-center">Status</th>
                        <th className="px-5 pb-3 pt-0.5 text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                      {recentSales.map((s, i) => (
                        <tr key={i} className="transition-colors hover:bg-gray-50/80 dark:hover:bg-white/[0.03]">
                          <td className="px-5 py-2.5">
                            <p className="text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0] truncate max-w-[160px]">{s.product_name}</p>
                          </td>
                          <td className="px-5 py-2.5 text-right tabular-nums text-[13px] text-gray-600 dark:text-[#A8B3C0]">{Number(s.quantity).toLocaleString()}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0]">
                            {Number(s.total_price).toLocaleString()} SAR
                          </td>
                          <td className="px-5 py-2.5 hidden sm:table-cell">
                            <p className="truncate max-w-[130px] text-[11px] text-gray-400 dark:text-[#4A5568]">{s.customer_name || '—'}</p>
                          </td>
                          <td className="px-5 py-2.5 text-center"><StatusPill status={s.status} /></td>
                          <td className="px-5 py-2.5 text-right text-[11px] text-gray-400 dark:text-[#4A5568]">{fmt(s.sold_at)}</td>
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
            <SectionCard title="Recent Activity" subtitle="Audit log of actions by your team">
              <ActivityTimeline entries={feedEntries} />
            </SectionCard>
          </div>
          {/* Status sidebar */}
          <div className="flex flex-col gap-4">
            <div className="glass-card rounded-xl px-5 py-4 space-y-3.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-gray-400 dark:text-[#4A5568]">
                System Status
              </p>
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span className="text-[12.5px] text-gray-700 dark:text-[#C4CAD6]">All systems operational</span>
              </div>
              {lastUpdated && (
                <p className="text-[10.5px] text-gray-400 dark:text-[#4A5568]">
                  Updated {timeAgo(lastUpdated.toISOString())}
                </p>
              )}
              <button
                onClick={() => load(true)}
                disabled={refreshing}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.04] px-3 py-2 text-[11.5px] font-medium text-gray-500 dark:text-[#5A6478] hover:bg-gray-100 dark:hover:bg-white/[0.07] disabled:opacity-40 transition-colors"
              >
                <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
                Refresh data
              </button>
            </div>
          </div>
        </section>
      )}

    </div>
  )
}
