'use client'

import { useState, useEffect, useCallback } from 'react'
import { getDashboardStats, type DashboardStats } from './lib/dashboard'
import SectionCard from './components/SectionCard'
import StatCard from './components/StatCard'
import ProductionChart from './components/charts/ProductionChart'
import QcTrendChart from './components/charts/QcTrendChart'
import ScanActivityChart from './components/charts/ScanActivityChart'
import {
  ClipboardList, QrCode, AlertTriangle, FlaskConical,
  Smartphone, Monitor, CheckCircle2, Clock, ShieldCheck,
  XCircle, RefreshCw,
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

// ── QC status config ───────────────────────────────────────────────────────

type QcStatus = 'pass' | 'fail' | 'hold'
const qcCfg: Record<QcStatus, { pill: string; dot: string }> = {
  pass: {
    pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    dot:  'bg-emerald-500',
  },
  fail: {
    pill: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    dot:  'bg-red-500',
  },
  hold: {
    pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    dot:  'bg-amber-400',
  },
}

function QcBadge({ status }: { status: QcStatus }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${qcCfg[status].pill}`}>
      {status}
    </span>
  )
}

// ── QC breakdown bar ───────────────────────────────────────────────────────

function QcBar({ pass, fail, hold }: { pass: number; fail: number; hold: number }) {
  const total = pass + fail + hold
  if (total === 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
        <FlaskConical size={28} className="opacity-40" />
        <p className="text-sm italic">No QC inspections recorded yet.</p>
      </div>
    )
  }
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`
  return (
    <div className="space-y-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
        {pass > 0 && (
          <div
            style={{ width: pct(pass) }}
            className="bg-emerald-500 transition-all duration-700"
            title={`Pass: ${pass}`}
          />
        )}
        {fail > 0 && (
          <div
            style={{ width: pct(fail) }}
            className="bg-red-500 transition-all duration-700"
            title={`Fail: ${fail}`}
          />
        )}
        {hold > 0 && (
          <div
            style={{ width: pct(hold) }}
            className="bg-amber-400 transition-all duration-700"
            title={`Hold: ${hold}`}
          />
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { label: 'Pass', value: pass, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10 dark:bg-emerald-500/20', dot: 'bg-emerald-500' },
            { label: 'Fail', value: fail, color: 'text-red-600 dark:text-red-400',         bg: 'bg-red-500/10 dark:bg-red-500/20',         dot: 'bg-red-500'     },
            { label: 'Hold', value: hold, color: 'text-amber-600 dark:text-amber-400',      bg: 'bg-amber-500/10 dark:bg-amber-500/20',      dot: 'bg-amber-400'   },
          ] as const
        ).map(({ label, value, color, bg, dot }) => (
          <div key={label} className={`rounded-xl ${bg} px-3 py-2.5 text-center`}>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <div className="mt-1 flex items-center justify-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              <span className="text-xs text-gray-500 dark:text-gray-400">{label} · {pct(value)}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{total} total inspections across all batches</p>
    </div>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function SkeletonBlock({ h, className = '' }: { h: string; className?: string }) {
  return <div className={`${h} animate-pulse rounded-2xl bg-gray-200 dark:bg-white/[0.06] ${className}`} />
}

function Skeleton() {
  return (
    <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <SkeletonBlock h="h-7" className="w-52" />
          <SkeletonBlock h="h-4" className="w-36" />
        </div>
        <SkeletonBlock h="h-8" className="w-20" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} h="h-28" />)}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SkeletonBlock h="h-72" />
        <SkeletonBlock h="h-72" />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SkeletonBlock h="h-64" />
        <SkeletonBlock h="h-64" />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SkeletonBlock h="h-72" />
        <SkeletonBlock h="h-72" />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SkeletonBlock h="h-72" />
        <SkeletonBlock h="h-72" />
      </div>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex h-44 flex-col items-center justify-center gap-2.5 text-gray-400 dark:text-gray-500">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-white/[0.05] border border-gray-200 dark:border-white/[0.06]">
        <Icon size={22} className="opacity-60" />
      </div>
      <p className="text-sm">{message}</p>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [stats,      setStats]      = useState<DashboardStats | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
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
    // Auto-refresh every 30 seconds for a "live" feel
    const interval = setInterval(() => load(true), 30_000)
    return () => clearInterval(interval)
  }, [load])

  if (loading) return <Skeleton />
  if (!stats)  return null

  const {
    totalBatches, totalScans, passRate, weeklyInspections,
    qcCounts, ordersByStatus,
    qcTrend, scanTrend,
    recentQc, failedBatches, mostScanned, recentScans, recallRisk,
  } = stats

  const maxScanCount = mostScanned[0]?.scan_count ?? 1
  const hasRisk = recallRisk.failedQcCount > 0 || recallRisk.missingQcCount > 0

  const passRateAccent = passRate === null
    ? 'blue'
    : passRate >= 80
      ? 'green'
      : passRate >= 60
        ? 'yellow'
        : 'red'

  return (
    <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto space-y-6">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Operations Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {lastUpdated
              ? `Updated ${timeAgo(lastUpdated.toISOString())}`
              : 'Live manufacturing overview'}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Live pulsing indicator */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Live</span>
          </div>
          {/* Manual refresh */}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.07] disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Total Batches"
          value={totalBatches}
          subtitle={`${ordersByStatus.in_progress} in progress`}
          accent="blue"
          icon={ClipboardList}
        />
        <StatCard
          title="QC Pass Rate"
          value={passRate !== null ? `${passRate}%` : '—'}
          subtitle={`${qcCounts.pass + qcCounts.fail + qcCounts.hold} total inspections`}
          accent={passRateAccent}
          icon={passRate !== null && passRate >= 80 ? CheckCircle2 : passRate !== null && passRate < 60 ? XCircle : ShieldCheck}
        />
        <StatCard
          title="QR Scans"
          value={totalScans.toLocaleString()}
          subtitle="all-time trace events"
          accent="purple"
          icon={QrCode}
        />
        <StatCard
          title="This Week"
          value={weeklyInspections}
          subtitle="QC inspections last 7 days"
          accent={weeklyInspections > 0 ? 'orange' : 'yellow'}
          icon={FlaskConical}
        />
      </section>

      {/* ── Recall risk banner ─────────────────────────────────────────────── */}
      {hasRisk && (
        <div className="flex items-start gap-4 rounded-2xl border border-red-500/25 bg-red-500/10 dark:bg-red-500/[0.08] p-5">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-700 dark:text-red-400">Recall Risk Detected</p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {recallRisk.failedQcCount > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  <span className="font-bold">{recallRisk.failedQcCount}</span> batch{recallRisk.failedQcCount !== 1 ? 'es' : ''} with failed QC
                </span>
              )}
              {recallRisk.failedWithSales > 0 && (
                <span className="font-semibold text-red-700 dark:text-red-300">
                  ⚠ {recallRisk.failedWithSales} distributed to customers
                </span>
              )}
              {recallRisk.missingQcCount > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  <span className="font-bold">{recallRisk.missingQcCount}</span> batch{recallRisk.missingQcCount !== 1 ? 'es' : ''} missing inspection
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Trend charts ───────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard
          title="QC Trend — Last 7 Days"
          subtitle="Daily pass / fail / hold inspection counts"
        >
          <QcTrendChart data={qcTrend} />
        </SectionCard>

        <SectionCard
          title="QR Scan Activity — Last 7 Days"
          subtitle="Daily product trace scan volume"
        >
          <ScanActivityChart data={scanTrend} />
        </SectionCard>
      </section>

      {/* ── Pipeline + QC breakdown ────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard title="Production Pipeline" subtitle="Orders by current status">
          <ProductionChart data={ordersByStatus} />
        </SectionCard>

        <SectionCard title="QC Inspection Results" subtitle="Cumulative pass / fail / hold breakdown">
          <QcBar pass={qcCounts.pass} fail={qcCounts.fail} hold={qcCounts.hold} />
        </SectionCard>
      </section>

      {/* ── Recent QC + Most scanned ───────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        <SectionCard title="Recent QC Inspections" subtitle="Latest across all batches">
          {recentQc.length === 0 ? (
            <EmptyState icon={FlaskConical} message="No inspections recorded yet." />
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {recentQc.map((q, i) => (
                <li key={i} className="py-3 flex items-start gap-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${qcCfg[q.status].dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{q.product_name}</span>
                      <QcBadge status={q.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {q.inspector_name} · {fmt(q.inspected_at)}
                    </p>
                    {q.notes && (
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 truncate">{q.notes}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Most Scanned Batches" subtitle="By QR scan event count">
          {mostScanned.length === 0 ? (
            <EmptyState icon={QrCode} message="No scan events recorded yet." />
          ) : (
            <ul className="space-y-3.5">
              {mostScanned.map((b, i) => (
                <li key={b.batch_id}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 text-xs font-bold text-gray-400 w-5">#{i + 1}</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{b.product_name}</span>
                      {b.sku && <span className="shrink-0 font-mono text-xs text-gray-400">{b.sku}</span>}
                    </div>
                    <span className="shrink-0 text-sm font-bold text-blue-600 dark:text-blue-400">
                      {b.scan_count}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-blue-500 dark:bg-blue-400 transition-all duration-700"
                      style={{ width: `${(b.scan_count / maxScanCount) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

      </section>

      {/* ── Failed QC + Recent scan events ────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        <SectionCard title="Batches with Failed QC" subtitle="Latest QC status = fail">
          {failedBatches.length === 0 ? (
            <EmptyState icon={CheckCircle2} message="No failed batches — all clear." />
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {failedBatches.map(b => (
                <li key={b.id} className="py-3 flex items-start gap-3">
                  <span className="mt-1.5 flex h-2 w-2 shrink-0 rounded-full bg-red-500 ring-4 ring-red-100 dark:ring-red-900/30" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">{b.product_name}</span>
                      <span className="font-mono text-xs text-gray-400">{b.sku}</span>
                      {b.has_sales && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          Distributed
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400">
                      Inspector: {b.latest_qc.inspector_name} · {fmt(b.latest_qc.inspected_at)}
                    </p>
                    {b.latest_qc.notes && (
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 truncate">{b.latest_qc.notes}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Recent Scan Events" subtitle="Latest QR code traces">
          {recentScans.length === 0 ? (
            <EmptyState icon={QrCode} message="No scan events recorded yet." />
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {recentScans.map((s, i) => (
                <li key={i} className="py-2.5 flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gray-100 dark:bg-white/[0.06] border border-gray-200 dark:border-white/[0.06] text-gray-500 dark:text-gray-400">
                    {s.device_type === 'mobile'
                      ? <Smartphone size={14} />
                      : <Monitor size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{s.product_name}</p>
                    <p className="text-xs text-gray-400">
                      {s.browser ?? 'Browser'} · {s.device_type ?? 'device'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 text-xs text-gray-400">
                    <Clock size={11} />
                    {timeAgo(s.scanned_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

      </section>

    </div>
  )
}
