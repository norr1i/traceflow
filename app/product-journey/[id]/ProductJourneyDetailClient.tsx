'use client'

import { Fragment, useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { classifyEvent } from '../../trace/[id]/eventCategories'
import {
  ChevronLeft, Package, Layers, ShieldCheck, Truck,
  FileWarning, AlertTriangle, Activity, Loader2, User, Calendar,
  Hash, Building2, Network, Copy, Check, ChevronDown, ChevronUp,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type TraceOrder = {
  id:           string
  product_name: string
  sku:          string
  quantity:     number
  status:       string
  created_at:   string
  started_at:   string | null
  completed_at: string | null
}
type TraceQc = {
  status:         'pass' | 'fail' | 'hold'
  inspector_name: string
  notes:          string | null
  inspected_at:   string
}
type TraceMaterial = {
  material_name: string
  lot_number:    string | null
  quantity:      number
  unit:          string
}
type TraceSale = {
  customer_name: string | null
  quantity:      number
  sold_at:       string
}
type TraceData = {
  order:      TraceOrder
  qc_results: TraceQc[]
  materials:  TraceMaterial[]
  sales:      TraceSale[]
}
type JourneyEvent = {
  event_type:      string
  event_timestamp: string
  title:           string
  description:     string | null
  source_table:    string
  metadata:        Record<string, unknown> | null
}
type EnrichedMaterial = {
  id:            string
  material_name: string
  lot_number:    string | null
  quantity:      number
  unit:          string
  supplier_name: string | null
}
type AffectedBatch = {
  production_order_id: string
  product_name:        string
  status:              string
  created_at:          string
}
type MaterialImpact = {
  material_name:    string
  affected_batches: AffectedBatch[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  )
}
function extractActor(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null
  for (const k of ['inspector_name', 'performed_by', 'created_by', 'user_name']) {
    if (typeof meta[k] === 'string' && meta[k]) return meta[k] as string
  }
  return null
}

// System events are low-signal for business users and collapsed by default.
function isSystemEvent(e: JourneyEvent): boolean {
  return e.source_table === 'scan_events' || e.event_type.startsWith('qr.')
}

// ── Badge maps ────────────────────────────────────────────────────────────────

const ORDER_BADGE: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  completed:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelled:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}
const ORDER_LABEL: Record<string, string> = {
  pending: 'Pending', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled',
}
const QC_BADGE: Record<string, string> = {
  pass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  fail: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  hold: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
}
const QC_TEXT: Record<string, string> = {
  pass: 'text-emerald-600 dark:text-emerald-400',
  fail: 'text-red-600 dark:text-red-400',
  hold: 'text-amber-600 dark:text-amber-400',
}
const QC_LABEL: Record<string, string> = {
  pass: 'QC Passed', fail: 'QC Failed', hold: 'QC On Hold',
}

// ── Stage flow ────────────────────────────────────────────────────────────────

const STAGES = [
  { key: 'materials',    label: 'Raw Materials',   dot: 'bg-orange-400', text: 'text-orange-500 dark:text-orange-400' },
  { key: 'production',   label: 'Production',      dot: 'bg-blue-500',   text: 'text-blue-600 dark:text-blue-400'    },
  { key: 'quality',      label: 'Quality Control', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'distribution', label: 'Distribution',    dot: 'bg-teal-500',   text: 'text-teal-600 dark:text-teal-400'   },
] as const

function StageFlow({ events }: { events: JourneyEvent[] }) {
  const present = new Set(events.map(e => classifyEvent(e.event_type).stageGroup))
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5">
      {STAGES.map((s, i) => {
        const has = present.has(s.key)
        return (
          <Fragment key={s.key}>
            <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 shadow-sm ${has ? 'border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800/60' : 'border-dashed border-gray-200 dark:border-gray-700 bg-transparent opacity-40'}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
              <span className={`text-[10px] font-bold uppercase tracking-wider ${s.text}`}>{s.label}</span>
            </div>
            {i < STAGES.length - 1 && (
              <span className="text-[10px] text-gray-300 dark:text-gray-600 select-none">→</span>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

// ── Timeline event card ───────────────────────────────────────────────────────

function TimelineEvent({ event, isLast }: { event: JourneyEvent; isLast: boolean }) {
  const cat   = classifyEvent(event.event_type)
  const actor = extractActor(event.metadata)
  const { Icon, iconBg, iconColor, badgeClass, borderAccent, dotBg, label: catLabel } = cat
  return (
    <div className="flex gap-3 group">
      <div className="flex shrink-0 flex-col items-center" style={{ width: 36 }}>
        <div className={`relative z-10 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-white dark:border-gray-900 shadow-sm ${iconBg} transition-transform duration-150 group-hover:scale-105`}>
          <Icon size={15} className={iconColor} />
        </div>
        {!isLast && (
          <div className={`mt-1 w-0.5 flex-1 ${dotBg} opacity-20`} style={{ minHeight: 24 }} />
        )}
      </div>
      <div className={`min-w-0 flex-1 rounded-xl border border-gray-100 dark:border-gray-700/60 border-l-2 ${borderAccent} bg-white dark:bg-gray-800/60 px-3.5 py-3 shadow-sm hover:shadow-md transition-shadow ${isLast ? 'mb-0.5' : 'mb-3'}`}>
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">{event.title}</p>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>{catLabel}</span>
        </div>
        {event.description && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{event.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">{fmtDateTime(event.event_timestamp)}</span>
          {actor && (
            <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-300">
              <User size={9} />{actor}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Timeline skeleton ─────────────────────────────────────────────────────────

function TimelineSkeleton() {
  return (
    <div>
      {[65, 80, 55, 70].map((w, i) => (
        <div key={i} className="flex gap-3 mb-3">
          <div className="flex shrink-0 flex-col items-center" style={{ width: 36 }}>
            <div className="mt-0.5 h-9 w-9 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
            {i < 3 && <div className="mt-1 w-0.5 flex-1 bg-gray-200 dark:bg-gray-700" style={{ minHeight: 40 }} />}
          </div>
          <div className="flex-1 rounded-xl border border-gray-100 dark:border-gray-700/60 border-l-2 border-l-gray-200 bg-white dark:bg-gray-800/60 px-3.5 py-3 shadow-sm space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="h-3.5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" style={{ width: `${w}%` }} />
              <div className="h-4 w-20 rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />
            </div>
            <div className="h-2.5 w-4/5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="h-2 w-1/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Journey Health panel ──────────────────────────────────────────────────────

function HealthRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 dark:border-gray-700/60 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`text-sm font-semibold ${valueClass ?? 'text-gray-900 dark:text-white'}`}>{value}</span>
    </div>
  )
}

function HealthPanel({ order, qcResults }: { order: TraceOrder; qcResults: TraceQc[] }) {
  const latestQc   = qcResults[0] ?? null
  const openIssues = qcResults.filter(r => r.status === 'fail').length
  const stageLabel = ORDER_LABEL[order.status] ?? order.status.replace(/_/g, ' ')

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Journey Health</p>
      <HealthRow label="Current Stage" value={stageLabel} />
      {latestQc && (
        <HealthRow label="Quality Status" value={QC_LABEL[latestQc.status]} valueClass={QC_TEXT[latestQc.status]} />
      )}
      {openIssues > 0 && (
        <HealthRow label="Open Issues" value={`${openIssues} failed QC`} valueClass="text-red-600 dark:text-red-400" />
      )}
    </div>
  )
}

// ── Affected records card ─────────────────────────────────────────────────────

function AffectedRecords({
  qcCount, capaCount, recallCount, shipments,
}: {
  qcCount:     number
  capaCount:   number
  recallCount: number
  shipments:   number
}) {
  const rows = [
    { label: 'QC Records', value: qcCount,     href: '/quality-control', color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
    { label: 'CAPAs',      value: capaCount,   href: '/capa',            color: 'text-amber-700 dark:text-amber-400',    bg: 'bg-amber-100 dark:bg-amber-900/30'    },
    { label: 'Recalls',    value: recallCount, href: '/recall',          color: 'text-red-700 dark:text-red-400',        bg: 'bg-red-100 dark:bg-red-900/30'        },
    { label: 'Shipments',  value: shipments,   href: '/sales',           color: 'text-teal-700 dark:text-teal-400',      bg: 'bg-teal-100 dark:bg-teal-900/30'      },
  ].filter(r => r.value > 0)

  if (rows.length === 0) return null

  return (
    <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Affected Records</p>
      <div className="space-y-1">
        {rows.map(({ label, value, href, color, bg }) => (
          <a
            key={label}
            href={href}
            className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors group"
          >
            <span className="text-sm text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
              {label}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${bg} ${color}`}>
              {value}
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}

// ── Batch header ──────────────────────────────────────────────────────────────

function BatchHeader({ order, qcResults, materials, sales }: {
  order: TraceOrder; qcResults: TraceQc[]; materials: TraceMaterial[]; sales: TraceSale[]
}) {
  const [copied, setCopied] = useState(false)
  const latestQc = qcResults[0] ?? null

  function handleCopy() {
    navigator.clipboard.writeText(order.id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="mb-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">{order.product_name}</h2>
          <p className="mt-0.5 font-mono text-xs text-gray-400 dark:text-gray-500">SKU: {order.sku}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${ORDER_BADGE[order.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {ORDER_LABEL[order.status] ?? order.status.replace(/_/g, ' ')}
          </span>
          {latestQc && (
            <span className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${QC_BADGE[latestQc.status]}`}>
              {QC_LABEL[latestQc.status]}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          { icon: Calendar, label: 'Production Date', value: fmtDate(order.created_at), show: true },
          { icon: Hash,     label: 'Batch Quantity',  value: order.quantity ? `${order.quantity.toLocaleString()} units` : '', show: !!order.quantity },
          { icon: Layers,   label: 'Raw Materials',   value: String(materials.length), show: materials.length > 0 },
          { icon: Truck,    label: 'Distribution',    value: sales.length > 0 ? `${sales.length} ${sales.length === 1 ? 'shipment' : 'shipments'}` : 'Not shipped yet', show: true },
        ] as const).filter(c => c.show).map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl bg-gray-50 dark:bg-gray-700/40 px-3 py-2.5">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
              <Icon size={9} />{label}
            </p>
            <p className="text-sm font-bold text-gray-900 dark:text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Batch ID with copy */}
      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Hash size={11} className="shrink-0 text-gray-400" />
          <span className="text-[10px] text-gray-400">Batch ID</span>
          <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400 truncate">···{order.id.slice(-12)}</span>
        </div>
        <button
          onClick={handleCopy}
          className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          title="Copy full batch ID"
        >
          {copied
            ? <><Check size={10} className="text-emerald-500" />Copied</>
            : <><Copy size={10} />Copy</>
          }
        </button>
      </div>
    </div>
  )
}

// ── Traceability summary — conditional, no zero cards ────────────────────────

function TraceabilitySummary({
  materials, qcResults, capaCount, recallCount,
}: {
  materials:   TraceMaterial[]
  qcResults:   TraceQc[]
  capaCount:   number
  recallCount: number
}) {
  const items = [
    { icon: Layers,        label: 'Raw Materials', value: materials.length, color: 'text-orange-600 dark:text-orange-400' },
    { icon: ShieldCheck,   label: 'QC Records',    value: qcResults.length, color: 'text-emerald-600 dark:text-emerald-400' },
    { icon: FileWarning,   label: 'CAPAs',         value: capaCount,        color: 'text-amber-600 dark:text-amber-400'  },
    { icon: AlertTriangle, label: 'Recalls',       value: recallCount,      color: 'text-red-600 dark:text-red-400'      },
  ].filter(i => i.value > 0)

  if (items.length === 0) return null

  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {items.map(({ icon: Icon, label, value, color }) => (
        <div key={label} className="min-w-[80px] flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-center shadow-sm">
          <div className="flex justify-center mb-1"><Icon size={14} className={color} /></div>
          <p className={`text-xl font-bold leading-tight ${color}`}>{value}</p>
          <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">{label}</p>
        </div>
      ))}
    </div>
  )
}

// ── Materials used ────────────────────────────────────────────────────────────

function MaterialsUsed({ materials }: { materials: EnrichedMaterial[] }) {
  if (materials.length === 0) return null
  return (
    <div className="mt-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-700 px-4 py-3">
        <Layers size={15} className="text-orange-500 dark:text-orange-400" />
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Materials Used</h2>
        <span className="ml-auto rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
          {materials.length} {materials.length === 1 ? 'material' : 'materials'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700/60">
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Material</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Lot Number</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Supplier</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m, i) => (
              <tr
                key={m.id}
                className={`${i < materials.length - 1 ? 'border-b border-gray-100 dark:border-gray-700/40' : ''} hover:bg-gray-50 dark:hover:bg-gray-700/20 transition-colors`}
              >
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{m.material_name}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                  {m.lot_number ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                </td>
                <td className="px-4 py-3">
                  {m.supplier_name ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                      <Building2 size={10} className="text-blue-400" />{m.supplier_name}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-xs text-gray-600 dark:text-gray-400">
                  {m.quantity.toLocaleString()} {m.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Impact analysis ───────────────────────────────────────────────────────────

function ImpactAnalysis({ impacts, loading }: { impacts: MaterialImpact[]; loading: boolean }) {
  const totalAffected = impacts.reduce((n, m) => n + m.affected_batches.length, 0)

  return (
    <div className="mt-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-700 px-4 py-3">
        <Network size={15} className="text-violet-500 dark:text-violet-400" />
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Impact Analysis</h2>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">If a material is defective, which batches are affected?</p>
        </div>
        {!loading && totalAffected > 0 && (
          <span className="ml-auto rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
            {totalAffected} batch{totalAffected !== 1 ? 'es' : ''} at risk
          </span>
        )}
        {!loading && totalAffected === 0 && (
          <span className="ml-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            Isolated
          </span>
        )}
      </div>

      <div className="px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            {[70, 50, 80].map((w, i) => (
              <div key={i} className="h-12 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : impacts.length === 0 ? (
          <div className="py-6 text-center">
            <Network size={28} className="mx-auto mb-2 text-gray-200 dark:text-gray-700" />
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">No cross-batch exposure</p>
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
              Materials in this batch are not shared with other recorded batches.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {impacts.map(impact => (
              <div key={impact.material_name}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/40 px-2.5 py-1 text-xs font-semibold text-orange-700 dark:text-orange-400">
                    <Layers size={11} />{impact.material_name}
                  </span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    ↓ {impact.affected_batches.length} other {impact.affected_batches.length === 1 ? 'batch' : 'batches'}
                  </span>
                </div>
                <div className="space-y-1.5 pl-2">
                  {impact.affected_batches.map(batch => (
                    <a
                      key={batch.production_order_id}
                      href={`/product-journey/${batch.production_order_id}`}
                      className="flex items-center justify-between rounded-xl border border-gray-100 dark:border-gray-700/60 bg-gray-50 dark:bg-gray-700/30 px-3 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700/60 hover:border-gray-200 dark:hover:border-gray-600 transition-colors group"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate group-hover:text-[#3a6f8f] dark:group-hover:text-[#7ab3d0] transition-colors">
                          {batch.product_name}
                        </p>
                        <p className="font-mono text-[10px] text-gray-400 dark:text-gray-500">
                          ···{batch.production_order_id.slice(-10)} · {fmtDate(batch.created_at)}
                        </p>
                      </div>
                      <span className={`ml-3 shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${ORDER_BADGE[batch.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {ORDER_LABEL[batch.status] ?? batch.status}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProductJourneyDetailClient() {
  const { id } = useParams<{ id: string }>()

  const [traceData,         setTraceData]         = useState<TraceData | null>(null)
  const [journey,           setJourney]           = useState<JourneyEvent[]>([])
  const [loading,           setLoading]           = useState(true)
  const [notFound,          setNotFound]          = useState(false)
  const [capaCount,         setCapaCount]         = useState(0)
  const [recallCount,       setRecallCount]       = useState(0)
  const [enrichedMaterials, setEnrichedMaterials] = useState<EnrichedMaterial[]>([])
  const [impactData,        setImpactData]        = useState<MaterialImpact[]>([])
  const [impactLoading,     setImpactLoading]     = useState(true)
  const [showSysEvents,     setShowSysEvents]     = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setImpactLoading(true)

    Promise.all([
      supabase.rpc('get_batch_trace',   { p_batch_id: id }).single(),
      supabase.rpc('get_batch_journey', { p_batch_id: id }).single(),
      supabase.from('capas').select('id',   { count: 'exact', head: true }).eq('batch_id', id),
      supabase.from('recalls').select('id', { count: 'exact', head: true }).eq('batch_id', id),
      supabase
        .from('bill_of_materials')
        .select('id, material_name, lot_number, quantity, unit, raw_material_lots(id, suppliers(name))')
        .eq('production_order_id', id),
    ]).then(async ([traceRes, journeyRes, capaRes, recallRes, bomRes]) => {
      if (traceRes.error || !traceRes.data) {
        setNotFound(true)
        setLoading(false)
        setImpactLoading(false)
        return
      }

      setTraceData(traceRes.data as TraceData)

      const jd = journeyRes.data as { timeline?: JourneyEvent[] } | null
      if (jd?.timeline && Array.isArray(jd.timeline)) {
        setJourney(
          [...jd.timeline].sort(
            (a, b) => new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime(),
          ),
        )
      }

      setCapaCount(capaRes.count ?? 0)
      setRecallCount(recallRes.count ?? 0)

      const rawBom = (bomRes.data ?? []) as any[]
      const materials: EnrichedMaterial[] = rawBom.map(row => {
        const lots     = Array.isArray(row.raw_material_lots) ? row.raw_material_lots[0] : row.raw_material_lots
        const supplier = lots ? (Array.isArray(lots.suppliers) ? lots.suppliers[0] : lots.suppliers) : null
        return {
          id:            row.id,
          material_name: row.material_name,
          lot_number:    row.lot_number ?? null,
          quantity:      row.quantity,
          unit:          row.unit,
          supplier_name: supplier?.name ?? null,
        }
      })
      setEnrichedMaterials(materials)
      setLoading(false)

      const materialNames = [...new Set(materials.map(m => m.material_name))]
      if (materialNames.length === 0) {
        setImpactLoading(false)
        return
      }

      const { data: impactRows } = await supabase
        .from('bill_of_materials')
        .select('production_order_id, material_name, production_orders(id, status, created_at, products(name, sku))')
        .in('material_name', materialNames)
        .neq('production_order_id', id)
        .limit(200)

      if (impactRows) {
        const byMaterial: Record<string, AffectedBatch[]> = {}
        for (const row of impactRows as any[]) {
          const po   = Array.isArray(row.production_orders) ? row.production_orders[0] : row.production_orders
          if (!po) continue
          const prod = Array.isArray(po.products) ? po.products[0] : po.products
          const batch: AffectedBatch = {
            production_order_id: row.production_order_id,
            product_name:        prod?.name ?? 'Unknown',
            status:              po.status,
            created_at:          po.created_at,
          }
          if (!byMaterial[row.material_name]) byMaterial[row.material_name] = []
          if (!byMaterial[row.material_name].some(b => b.production_order_id === batch.production_order_id)) {
            byMaterial[row.material_name].push(batch)
          }
        }

        setImpactData(
          Object.entries(byMaterial).map(([material_name, affected_batches]) => ({
            material_name,
            affected_batches: affected_batches.sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
            ),
          })),
        )
      }

      setImpactLoading(false)
    })
  }, [id])

  if (loading) {
    return (
      <div className="px-6 py-5">
        <div className="mb-5 h-4 w-32 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8 space-y-4">
            {[140, 60, 420].map((h, i) => (
              <div key={i} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 animate-pulse" style={{ height: h }} />
            ))}
          </div>
          <div className="lg:col-span-4 space-y-4">
            {[160, 140].map((h, i) => (
              <div key={i} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 animate-pulse" style={{ height: h }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (notFound || !traceData) {
    return (
      <div className="px-6 py-5">
        <Link href="/product-journey"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
          <ChevronLeft size={15} />Traceability Search
        </Link>
        <div className="flex flex-col items-center py-20 text-center">
          <Package size={40} className="mb-3 text-gray-200 dark:text-gray-700" />
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">Batch not found</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            This batch ID may be invalid or the record has been removed.
          </p>
        </div>
      </div>
    )
  }

  const businessEvents = journey.filter(e => !isSystemEvent(e))
  const sysEvents      = journey.filter(e => isSystemEvent(e))

  return (
    <div className="px-6 py-5">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <Link href="/product-journey"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-[#3a6f8f] dark:hover:text-[#7ab3d0] transition-colors">
          <ChevronLeft size={15} />Traceability Search
        </Link>
        <span className="font-mono text-xs text-gray-400 dark:text-gray-500">···{id.slice(-12)}</span>
      </div>

      {/* Page title */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Product Journey</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          End-to-end traceability for{' '}
          <span className="font-medium text-gray-700 dark:text-gray-300">{traceData.order.product_name}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: main content */}
        <div className="lg:col-span-8">
          <BatchHeader
            order={traceData.order}
            qcResults={traceData.qc_results}
            materials={traceData.materials}
            sales={traceData.sales}
          />

          <TraceabilitySummary
            materials={traceData.materials}
            qcResults={traceData.qc_results}
            capaCount={capaCount}
            recallCount={recallCount}
          />

          {/* Timeline */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-700 px-4 py-3">
              <Activity size={15} className="text-gray-400 dark:text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Product Journey Timeline</h2>
              {businessEvents.length > 0 && (
                <span className="ml-auto rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                  {businessEvents.length} events
                </span>
              )}
            </div>
            <div className="px-4 py-4">
              {businessEvents.length === 0 ? (
                <>
                  <div className="py-8 text-center">
                    <Activity size={32} className="mx-auto mb-3 text-gray-200 dark:text-gray-700" />
                    <p className="text-sm text-gray-400 dark:text-gray-500">No operational events recorded yet</p>
                    {sysEvents.length > 0 && (
                      <p className="mt-1 text-xs text-gray-300 dark:text-gray-600">
                        {sysEvents.length} system event{sysEvents.length !== 1 ? 's' : ''} hidden below
                      </p>
                    )}
                  </div>
                  {sysEvents.length > 0 && (
                    <>
                      <button
                        onClick={() => setShowSysEvents(v => !v)}
                        className="mt-1 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                      >
                        {showSysEvents ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {showSysEvents ? 'Hide' : 'Show'} {sysEvents.length} system event{sysEvents.length !== 1 ? 's' : ''}
                      </button>
                      {showSysEvents && (
                        <div className="mt-2">
                          {sysEvents.map((event, i) => (
                            <TimelineEvent
                              key={`sys-${event.event_type}-${event.event_timestamp}-${i}`}
                              event={event}
                              isLast={i === sysEvents.length - 1}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  <StageFlow events={businessEvents} />

                  {businessEvents.map((event, i) => (
                    <TimelineEvent
                      key={`${event.event_type}-${event.event_timestamp}-${i}`}
                      event={event}
                      isLast={i === businessEvents.length - 1 && (!showSysEvents || sysEvents.length === 0)}
                    />
                  ))}

                  {sysEvents.length > 0 && (
                    <>
                      <button
                        onClick={() => setShowSysEvents(v => !v)}
                        className="mt-2 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                      >
                        {showSysEvents ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {showSysEvents ? 'Hide' : 'Show'} {sysEvents.length} system event{sysEvents.length !== 1 ? 's' : ''}
                      </button>

                      {showSysEvents && (
                        <div className="mt-2">
                          {sysEvents.map((event, i) => (
                            <TimelineEvent
                              key={`sys-${event.event_type}-${event.event_timestamp}-${i}`}
                              event={event}
                              isLast={i === sysEvents.length - 1}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <MaterialsUsed materials={enrichedMaterials} />
          {enrichedMaterials.length > 0 && (
            <ImpactAnalysis impacts={impactData} loading={impactLoading} />
          )}
        </div>

        {/* Right: health + affected records */}
        <div className="lg:col-span-4">
          <HealthPanel order={traceData.order} qcResults={traceData.qc_results} />
          <AffectedRecords
            qcCount={traceData.qc_results.length}
            capaCount={capaCount}
            recallCount={recallCount}
            shipments={traceData.sales.length}
          />
        </div>
      </div>
    </div>
  )
}
