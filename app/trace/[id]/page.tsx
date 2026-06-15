'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import {
  ShieldCheck, Package, FlaskConical, Layers, ShoppingCart,
  AlertCircle, AlertTriangle, Loader2, QrCode, Activity, ScanLine,
} from 'lucide-react'
import { LogoIcon } from '../../components/Logo'
import { JourneyMetrics } from './JourneyMetrics'
import { EnhancedTimeline, type JourneyEvent } from './EnhancedTimeline'
import { ConsumerActivity } from './ConsumerActivity'
import { isScanEvent } from './eventCategories'

// ── Types ──────────────────────────────────────────────────────────────────

type QcResult = {
  status: 'pass' | 'fail' | 'hold'
  inspector_name: string
  notes: string | null
  inspected_at: string
}

type Material = {
  material_name: string
  lot_number: string | null
  quantity: number
  unit: string
}

type Sale = {
  customer_name: string | null
  quantity: number
  sold_at: string
}

type TraceData = {
  order: {
    id: string
    product_name: string
    sku: string
    quantity: number
    status: string
    created_at: string
    started_at: string | null
    completed_at: string | null
  }
  qc_results: QcResult[]
  materials: Material[]
  sales: Sale[]
}

type JourneyData = {
  batch: Record<string, unknown>
  timeline: JourneyEvent[]
  event_count: number
}

type RcaAlert = {
  recalls: { recall_number: string; title: string; status: string; affected_units: number | null }[]
  risk_level: 'none' | 'low' | 'medium' | 'high' | 'critical'
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Badge / status class maps ──────────────────────────────────────────────

type QcStatus = 'pass' | 'fail' | 'hold'
const qcBadgeClass: Record<QcStatus, string> = {
  pass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  fail: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  hold: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
}

const orderStatusClass: Record<string, string> = {
  completed:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pending:     'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  cancelled:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

// ── Shared UI primitives ───────────────────────────────────────────────────

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${className}`}>
      {label}
    </span>
  )
}

function Section({ icon, title, count, children }: {
  icon: React.ReactNode; title: string; count?: number; children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-700 px-4 py-3">
        <span className="text-gray-400 dark:text-gray-500">{icon}</span>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="ml-auto rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
            {count}
          </span>
        )}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right font-medium text-gray-900 dark:text-white">{value ?? '—'}</span>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-400 dark:text-gray-500 italic">{text}</p>
}

// ── Scan event logging ─────────────────────────────────────────────────────
// Uses the log_scan_event SECURITY DEFINER RPC instead of a direct insert.
// company_id is derived server-side from the batch — never caller-supplied.

function logScanEvent(batchId: string) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua)
  const browser =
    /Edg\//i.test(ua)     ? 'Edge'    :
    /OPR\//i.test(ua)     ? 'Opera'   :
    /Chrome\//i.test(ua)  ? 'Chrome'  :
    /Safari\//i.test(ua)  ? 'Safari'  :
    /Firefox\//i.test(ua) ? 'Firefox' : 'Other'

  void supabase
    .rpc('log_scan_event', {
      p_batch_id:    batchId,
      p_device_type: isMobile ? 'mobile' : 'desktop',
      p_browser:     browser,
      p_user_agent:  ua.slice(0, 300),
    })
    .then(({ error }) => {
      if (error) console.error('[logScanEvent] rpc failed:', error)
    })
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function PublicTracePage() {
  const { id } = useParams<{ id: string }>()

  const [data,           setData]           = useState<TraceData | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [notFound,       setNotFound]       = useState(false)
  const [journey,        setJourney]        = useState<JourneyEvent[]>([])
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [rcaData,        setRcaData]        = useState<RcaAlert | null>(null)

  useEffect(() => {
    if (!id) return

    logScanEvent(id)
    setJourneyLoading(true)

    // get_batch_journey is SECURITY DEFINER and derives company_id
    // internally, so no separate company_id lookup is needed here.
    supabase
      .rpc('get_batch_trace', { p_batch_id: id })
      .single()
      .then(({ data: rpcData, error }) => {
        if (error || !rpcData) {
          setNotFound(true)
          setLoading(false)
          setJourneyLoading(false)
          return
        }

        setData(rpcData as TraceData)
        setLoading(false)

        supabase
          .rpc('get_batch_journey', { p_batch_id: id })
          .then(({ data: jd, error: je }) => {
            if (!je && jd) {
              const timeline = (jd as JourneyData).timeline
              if (Array.isArray(timeline)) setJourney(timeline)
            }
            setJourneyLoading(false)
          }, () => setJourneyLoading(false))

        supabase
          .rpc('get_root_cause_analysis', { p_batch_id: id })
          .then(({ data: rca, error: rcaErr }) => {
            if (!rcaErr && rca) setRcaData(rca as RcaAlert)
          })
      })
  }, [id])

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 size={28} className="animate-spin text-blue-600" />
      </div>
    )
  }

  // ── Not found ────────────────────────────────────────────────────────────

  if (notFound || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 px-6 text-center">
        <AlertCircle size={44} className="mb-3 text-gray-300 dark:text-gray-600" />
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Batch not found</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">This QR code may be invalid or the batch has been removed.</p>
        <div className="mt-6 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-600">
          <ShieldCheck size={13} />
          <span>Verified by TraceFlow</span>
        </div>
      </div>
    )
  }

  const { order, qc_results, materials, sales } = data
  const latestQc = qc_results[0]

  // Display-only split — journey state is never mutated; both arrays remain queryable.
  const manufacturingEvents = journey.filter(e => !isScanEvent(e.source_table))
  const scanEvents          = journey.filter(e =>  isScanEvent(e.source_table))

  const activeRecalls   = rcaData?.recalls.filter(r => r.status !== 'closed') ?? []
  const showRecallAlert = activeRecalls.length > 0
  const showRiskAlert   = !showRecallAlert &&
    (rcaData?.risk_level === 'high' || rcaData?.risk_level === 'critical')

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">

      {/* Sticky header */}
      <div className="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm px-4 py-3">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LogoIcon size="sm" />
            <div>
              <p className="text-xs font-bold text-gray-900 dark:text-white leading-tight">{order.product_name}</p>
              <p className="font-mono text-[10px] text-gray-400 leading-tight">{order.sku}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge
              label={order.status.replace('_', ' ')}
              className={orderStatusClass[order.status] ?? 'bg-gray-100 text-gray-600'}
            />
            {latestQc && (
              <Badge label={latestQc.status} className={qcBadgeClass[latestQc.status]} />
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-md px-4 py-5 space-y-4">

        {/* Verified badge */}
        <div className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2.5">
          <ShieldCheck size={15} className="text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            Verified by TraceFlow — authentic product batch record
          </span>
        </div>

        {/* Active recall alert */}
        {showRecallAlert && (
          <div className="flex gap-3 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-red-700 dark:text-red-400">Active Recall</p>
              {activeRecalls.map((r, i) => (
                <p key={i} className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                  {r.recall_number}: {r.title}
                  {r.affected_units ? ` — ${r.affected_units.toLocaleString()} units affected` : ''}
                </p>
              ))}
              <p className="text-xs text-red-500 dark:text-red-500 mt-1.5 font-medium">
                Stop use immediately and contact the manufacturer.
              </p>
            </div>
          </div>
        )}

        {/* High / critical risk alert (no active recall) */}
        {showRiskAlert && (
          <div className="flex gap-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-bold text-amber-700 dark:text-amber-400">Quality Alert</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                This batch has been flagged with a {rcaData?.risk_level} risk level. Contact the manufacturer for details.
              </p>
            </div>
          </div>
        )}

        {/* Batch overview */}
        <Section icon={<Package size={15} />} title="Batch Overview">
          <Row label="Product"   value={order.product_name} />
          <Row label="SKU"       value={<span className="font-mono text-xs">{order.sku}</span>} />
          <Row label="Quantity"  value={order.quantity.toLocaleString()} />
          <Row label="Status"    value={
            <Badge
              label={order.status.replace('_', ' ')}
              className={orderStatusClass[order.status] ?? 'bg-gray-100 text-gray-600'}
            />
          } />
          <Row label="Created"   value={fmt(order.created_at)} />
          {order.started_at   && <Row label="Started"   value={fmt(order.started_at)} />}
          {order.completed_at && <Row label="Completed" value={fmt(order.completed_at)} />}
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2">
            <QrCode size={12} className="shrink-0 text-gray-400" />
            <span className="text-[10px] text-gray-400 mr-1.5">Batch Reference</span>
            <span className="font-mono text-[10px] text-gray-400 break-all">···{order.id.slice(-12)}</span>
          </div>
        </Section>

        {/* QC Inspections */}
        <Section icon={<FlaskConical size={15} />} title="QC Inspections" count={qc_results.length}>
          {qc_results.length === 0 && <Empty text="No QC inspections recorded for this batch." />}
          {qc_results.length > 0 && (
            <div className="space-y-2">
              {qc_results.map((r, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/20 px-3 py-2.5">
                  <Badge label={r.status} className={`mt-0.5 shrink-0 ${qcBadgeClass[r.status]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{r.inspector_name}</span>
                      <span className="shrink-0 text-[10px] text-gray-400">{fmtDateTime(r.inspected_at)}</span>
                    </div>
                    {r.notes && (
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{r.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Raw materials */}
        <Section icon={<Layers size={15} />} title="Raw Materials Used" count={materials.length}>
          {materials.length === 0 && <Empty text="No materials linked to this batch." />}
          {materials.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-400">
                  <th className="pb-2 text-left font-medium">Material</th>
                  <th className="pb-2 text-left font-medium">Lot #</th>
                  <th className="pb-2 text-right font-medium">Qty</th>
                  <th className="pb-2 text-right font-medium">Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {materials.map((m, i) => (
                  <tr key={i}>
                    <td className="py-2 font-medium text-gray-900 dark:text-white">{m.material_name}</td>
                    <td className="py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                      {m.lot_number || <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="py-2 text-right text-gray-700 dark:text-gray-300">{m.quantity.toLocaleString()}</td>
                    <td className="py-2 text-right text-gray-500 dark:text-gray-400">{m.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Distribution */}
        <Section icon={<ShoppingCart size={15} />} title="Distribution" count={sales.length}>
          {sales.length === 0 && <Empty text="No distribution records for this product." />}
          {sales.length > 0 && (
            <div className="space-y-2">
              {sales.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{s.customer_name || 'Customer'}</p>
                    <p className="text-xs text-gray-400">{fmt(s.sold_at)}</p>
                  </div>
                  <span className="shrink-0 text-gray-700 dark:text-gray-300 font-medium">
                    {s.quantity.toLocaleString()} units
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Journey Metrics — calculated from real data, no placeholders */}
        {!journeyLoading && (
          <JourneyMetrics
            order={order}
            qcResults={qc_results}
            materials={materials}
            sales={sales}
            manufacturingEvents={manufacturingEvents}
          />
        )}

        {/* Product Journey — manufacturing, quality, distribution only */}
        <Section
          icon={<Activity size={15} />}
          title="Product Journey"
          count={journeyLoading ? undefined : manufacturingEvents.length}
        >
          <EnhancedTimeline
            events={manufacturingEvents}
            isLoading={journeyLoading}
            distributionFallback={sales}
          />
        </Section>

        {/* Consumer Activity — QR scan investigation view (secondary) */}
        <Section
          icon={<ScanLine size={15} />}
          title="Consumer Activity"
          count={journeyLoading ? undefined : scanEvents.length}
        >
          {journeyLoading ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 italic animate-pulse">
              Loading scan records…
            </p>
          ) : (
            <ConsumerActivity events={scanEvents} />
          )}
        </Section>

        {/* Footer */}
        <div className="pb-4 text-center">
          <div className="inline-flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-600">
            <ShieldCheck size={12} />
            <span>Verified by TraceFlow · Powered by traceflow.app</span>
          </div>
        </div>

      </div>
    </div>
  )
}
