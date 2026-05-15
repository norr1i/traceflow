'use client'

import { useState, useEffect } from 'react'
import { getDashboardStats, type DashboardStats } from './lib/dashboard'
import SectionCard from './components/SectionCard'
import StatCard from './components/StatCard'
import ProductionChart from './components/charts/ProductionChart'
import {
  ClipboardList, QrCode, XCircle, AlertCircle,
  AlertTriangle, FlaskConical, Smartphone, Monitor,
  CheckCircle2, Clock,
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
    return <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500 italic">No QC inspections recorded yet.</p>
  }
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`
  return (
    <div className="space-y-3">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
        {pass > 0 && (
          <div style={{ width: pct(pass) }} className="bg-emerald-500 transition-all" title={`Pass: ${pass}`} />
        )}
        {fail > 0 && (
          <div style={{ width: pct(fail) }} className="bg-red-500 transition-all" title={`Fail: ${fail}`} />
        )}
        {hold > 0 && (
          <div style={{ width: pct(hold) }} className="bg-amber-400 transition-all" title={`Hold: ${hold}`} />
        )}
      </div>
      <div className="flex items-center justify-between">
        {(
          [
            { label: 'Pass', value: pass, color: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
            { label: 'Fail', value: fail, color: 'text-red-600 dark:text-red-400',         dot: 'bg-red-500'     },
            { label: 'Hold', value: hold, color: 'text-amber-600 dark:text-amber-400',      dot: 'bg-amber-400'   },
          ] as const
        ).map(({ label, value, color, dot }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
            <span className={`text-sm font-semibold ${color}`}>{value}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{label} · {pct(value)}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{total} total inspections across all batches</p>
    </div>
  )
}

// ── Loading skeleton ───────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto space-y-6">
      <div className="h-7 w-52 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-700" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-56 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-700" />
        ))}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [stats,   setStats]   = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDashboardStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Skeleton />
  if (!stats)  return null

  const { totalBatches, totalScans, qcCounts, ordersByStatus,
          recentQc, failedBatches, mostScanned, recentScans, recallRisk } = stats
  const maxScanCount = mostScanned[0]?.scan_count ?? 1
  const hasRisk = recallRisk.failedQcCount > 0 || recallRisk.missingQcCount > 0

  return (
    <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Operations Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Live manufacturing overview</p>
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          title="Total Batches"
          value={totalBatches}
          subtitle={`${ordersByStatus.in_progress} in progress`}
          accent="blue"
          icon={ClipboardList}
        />
        <StatCard
          title="QR Scans"
          value={totalScans.toLocaleString()}
          subtitle="total scan events"
          accent="purple"
          icon={QrCode}
        />
        <StatCard
          title="Failed QC"
          value={recallRisk.failedQcCount}
          subtitle={recallRisk.failedQcCount > 0 ? `${recallRisk.failedWithSales} distributed` : 'no failures'}
          accent={recallRisk.failedQcCount > 0 ? 'red' : 'green'}
          icon={recallRisk.failedQcCount > 0 ? XCircle : CheckCircle2}
        />
        <StatCard
          title="Missing QC"
          value={recallRisk.missingQcCount}
          subtitle="batches not yet inspected"
          accent={recallRisk.missingQcCount > 0 ? 'yellow' : 'green'}
          icon={AlertCircle}
        />
      </section>

      {/* ── Recall risk banner ─────────────────────────────────────────────── */}
      {hasRisk && (
        <div className="flex items-start gap-4 rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-5">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-700 dark:text-red-400">Recall Risk Detected</p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-red-600 dark:text-red-400">
                <span className="font-bold">{recallRisk.failedQcCount}</span> batch{recallRisk.failedQcCount !== 1 ? 'es' : ''} with failed QC
              </span>
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

      {/* ── QC breakdown + Production status ──────────────────────────────── */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard title="QC Inspection Results" subtitle="Pass / Fail / Hold across all batches">
          <QcBar pass={qcCounts.pass} fail={qcCounts.fail} hold={qcCounts.hold} />
        </SectionCard>

        <SectionCard title="Production Pipeline" subtitle="Orders by current status">
          <ProductionChart data={ordersByStatus} />
        </SectionCard>
      </section>

      {/* ── Failed QC batches + Recent inspections ─────────────────────────── */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        <SectionCard title="Batches with Failed QC" subtitle="Latest QC status = fail">
          {failedBatches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <CheckCircle2 size={32} className="text-emerald-400" />
              <p className="text-sm text-gray-400 dark:text-gray-500">No failed batches — all clear.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {failedBatches.map(b => (
                <li key={b.id} className="py-3 flex items-start gap-3">
                  <span className="mt-0.5 flex h-2 w-2 shrink-0 rounded-full bg-red-500 ring-4 ring-red-100 dark:ring-red-900/30" />
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

        <SectionCard title="Recent QC Inspections" subtitle="Latest across all batches">
          {recentQc.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <FlaskConical size={32} className="text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-400 dark:text-gray-500">No inspections recorded yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {recentQc.map((q, i) => (
                <li key={i} className="py-3 flex items-start gap-3">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${qcCfg[q.status].dot}`} />
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

      </section>

      {/* ── Most scanned + Recent scan events ─────────────────────────────── */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        <SectionCard title="Most Scanned Batches" subtitle="By QR scan event count">
          {mostScanned.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <QrCode size={32} className="text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-400 dark:text-gray-500">No scan events recorded yet.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {mostScanned.map((b, i) => (
                <li key={b.batch_id}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 text-xs font-bold text-gray-400 w-4">#{i + 1}</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{b.product_name}</span>
                      {b.sku && <span className="shrink-0 font-mono text-xs text-gray-400">{b.sku}</span>}
                    </div>
                    <span className="shrink-0 text-sm font-bold text-gray-700 dark:text-gray-300">
                      {b.scan_count}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                    <div
                      className="h-full rounded-full bg-blue-500 dark:bg-blue-400 transition-all"
                      style={{ width: `${(b.scan_count / maxScanCount) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Recent Scan Events" subtitle="Latest QR code scans">
          {recentScans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <QrCode size={32} className="text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-400 dark:text-gray-500">No scan events recorded yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {recentScans.map((s, i) => (
                <li key={i} className="py-2.5 flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
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
