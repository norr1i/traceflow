'use client'

import { Fragment, useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { classifyEvent } from '../../trace/[id]/eventCategories'
import {
  ChevronLeft, Package, Layers, ShieldCheck, Truck,
  FileWarning, AlertTriangle, Activity, User, Calendar,
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
  received_at:   string | null
  lot_status:    string | null
  bom_created_at: string | null
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
type CapaRecord = {
  id:         string
  title:      string
  status:     string
  created_at: string
  closed_at:  string | null
}
type RecallRecord = {
  id:         string
  title:      string
  status:     string
  created_at: string
  closed_at:  string | null
}
type DistributionRecord = {
  id:               string
  recipient_name:   string | null
  recipient_type:   string | null
  quantity_shipped: number
  shipped_at:       string
  notes:            string | null
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
  for (const k of ['inspector_name', 'performed_by', 'created_by', 'user_name', 'actor_email']) {
    if (typeof meta[k] === 'string' && meta[k]) return meta[k] as string
  }
  return null
}

// System events are low-signal for business users and collapsed by default.
function isSystemEvent(e: JourneyEvent): boolean {
  return e.source_table === 'scan_events' || e.event_type.startsWith('qr.')
}

// Suppress BOM events that are clearly test/placeholder data: very short material
// names, banned keyword names, or sub-threshold quantities (< 0.01 of any unit).
const LOW_QUALITY_MATERIAL_NAMES = /^(mat|test|sample|temp|tmp|foo|bar|baz)$/i

function isLowQualityMaterialEvent(e: JourneyEvent): boolean {
  if (e.event_type !== 'material.added_to_batch') return false
  const name = ((e.metadata?.material_name as string) ?? '').trim()
  if (LOW_QUALITY_MATERIAL_NAMES.test(name)) return true
  if (name.length > 0 && name.length < 4) return true
  const qty = e.metadata?.quantity as number | undefined
  if (typeof qty === 'number' && qty < 0.01) return true
  return false
}

// Collapse multiple material.added_to_batch events sharing the same minute into
// a single "Materials Allocated (N)" event. Prevents a wall of identical Raw
// Material cards when the BOM has several simultaneous entries.
function groupMaterialEvents(events: JourneyEvent[]): JourneyEvent[] {
  const groups = new Map<string, JourneyEvent[]>()
  const rest: JourneyEvent[] = []

  for (const e of events) {
    if (e.event_type !== 'material.added_to_batch') { rest.push(e); continue }
    const key = e.event_timestamp.substring(0, 16)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }

  const grouped: JourneyEvent[] = []
  for (const [, group] of groups) {
    if (group.length === 1) {
      grouped.push(group[0])
    } else {
      const summaries = group.map(e => {
        const name = ((e.metadata?.material_name as string) ?? '').trim()
        const qty  = e.metadata?.quantity as number | undefined
        const unit = e.metadata?.unit as string | undefined
        return qty !== undefined && unit ? `${name} (${qty.toLocaleString()} ${unit})` : name
      })
      grouped.push({
        event_type:      'material.allocated',
        event_timestamp: group[0].event_timestamp,
        title:           `Materials Allocated (${group.length})`,
        description:     summaries.join(', ') + '.',
        source_table:    'bill_of_materials',
        metadata:        { material_count: group.length, materials: summaries },
      })
    }
  }

  return [...rest, ...grouped].sort(
    (a, b) => new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime(),
  )
}

// Synthesise events for data sources the RPC does not cover.
//
// distribution.shipped: prefer distribution_records (fetched client-side via
// the batches table, which holds the correct FK). Fall back to sales when no
// distribution_records exist so batches that were never linked to a batches row
// still show shipment events.
//
// production.started/completed, CAPAs, and recalls are always synthesised here
// as the RPC has no access to those sources.
function synthesizeEvents(
  order:               TraceOrder,
  sales:               TraceSale[],
  capas:               CapaRecord[],
  recalls:             RecallRecord[],
  distributionRecords: DistributionRecord[],
): JourneyEvent[] {
  const out: JourneyEvent[] = []

  if (order.started_at) {
    out.push({
      event_type:      'production.started',
      event_timestamp: order.started_at,
      title:           'Production Started',
      description:     `Production initiated for ${order.quantity.toLocaleString()} units.`,
      source_table:    'production_orders',
      metadata:        null,
    })
  }

  if (order.completed_at) {
    out.push({
      event_type:      'production.completed',
      event_timestamp: order.completed_at,
      title:           'Production Completed',
      description:     `${order.quantity.toLocaleString()} units produced and ready for quality inspection.`,
      source_table:    'production_orders',
      metadata:        null,
    })
  }

  // Use distribution_records when available — they carry recipient name,
  // delivery note numbers, and PO references. Fall back to sales otherwise.
  if (distributionRecords.length > 0) {
    for (const dr of distributionRecords) {
      const recipient = dr.recipient_name ?? 'Customer'
      out.push({
        event_type:      'distribution.shipped',
        event_timestamp: dr.shipped_at,
        title:           `Shipped to ${recipient}`,
        description:     dr.notes ?? `${dr.quantity_shipped.toLocaleString()} units dispatched to ${recipient}.`,
        source_table:    'distribution_records',
        metadata:        {
          recipient_name:   dr.recipient_name,
          recipient_type:   dr.recipient_type,
          quantity_shipped: dr.quantity_shipped,
        },
      })
    }
  } else {
    for (const sale of sales) {
      out.push({
        event_type:      'distribution.shipped',
        event_timestamp: sale.sold_at,
        title:           sale.customer_name ? `Shipped to ${sale.customer_name}` : 'Shipment Dispatched',
        description:     sale.customer_name
          ? `${sale.quantity.toLocaleString()} units shipped to ${sale.customer_name}.`
          : `${sale.quantity.toLocaleString()} units dispatched.`,
        source_table:    'sales',
        metadata:        sale.customer_name ? { customer_name: sale.customer_name } : null,
      })
    }
  }

  for (const capa of capas) {
    out.push({
      event_type:      'capa.opened',
      event_timestamp: capa.created_at,
      title:           'CAPA Opened',
      description:     capa.title,
      source_table:    'capas',
      metadata:        { capa_id: capa.id, status: capa.status },
    })
    if (capa.closed_at) {
      out.push({
        event_type:      'capa.closed',
        event_timestamp: capa.closed_at,
        title:           'CAPA Closed',
        description:     `${capa.title} — resolved.`,
        source_table:    'capas',
        metadata:        { capa_id: capa.id },
      })
    }
  }

  for (const recall of recalls) {
    out.push({
      event_type:      'recall.initiated',
      event_timestamp: recall.created_at,
      title:           'Recall Initiated',
      description:     recall.title,
      source_table:    'recalls',
      metadata:        { recall_id: recall.id, status: recall.status },
    })
    if (recall.closed_at) {
      out.push({
        event_type:      'recall.closed',
        event_timestamp: recall.closed_at,
        title:           'Recall Closed',
        description:     `${recall.title} — resolved.`,
        source_table:    'recalls',
        metadata:        { recall_id: recall.id },
      })
    }
  }

  return out
}

// Merge RPC events with synthesized events, deduplicating by event_type +
// minute-precision timestamp, and sorting chronologically.
function mergeJourneyEvents(rpc: JourneyEvent[], synth: JourneyEvent[]): JourneyEvent[] {
  const key = (e: JourneyEvent) => `${e.event_type}|${e.event_timestamp.substring(0, 16)}`
  const rpcKeys = new Set(rpc.map(key))
  const deduped = synth.filter(e => !rpcKeys.has(key(e)))
  return [...rpc, ...deduped].sort(
    (a, b) => new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime(),
  )
}

// The RPC pulls QC events from two tables: batch_qc_results (event_type
// 'qc.pass/fail/hold') and quality_inspections ('qc_inspection.passed/…').
// Both represent the same physical inspection. Collapse them to one event
// per day per outcome, preferring the batch_qc_results version which carries
// the full inspection notes.
function deduplicateSameDayQc(events: JourneyEvent[]): JourneyEvent[] {
  const outcome = (type: string): string | null => {
    if (type === 'qc.pass'  || type.endsWith('.passed')) return 'pass'
    if (type === 'qc.fail'  || type.endsWith('.failed')) return 'fail'
    if (type === 'qc.hold'  || type.endsWith('.hold'))   return 'hold'
    return null
  }
  const best = new Map<string, JourneyEvent>()
  const rest: JourneyEvent[] = []
  for (const e of events) {
    const o = outcome(e.event_type)
    if (!o) { rest.push(e); continue }
    const dk = `${e.event_timestamp.substring(0, 10)}|${o}`
    const existing = best.get(dk)
    // batch_qc_results events have richer notes; prefer them
    if (!existing || e.source_table === 'batch_qc_results') best.set(dk, e)
  }
  return [...rest, ...Array.from(best.values())].sort(
    (a, b) => new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime(),
  )
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

const STAGE_FLOW = [
  { key: 'materials'    as const, label: 'Raw Materials'   },
  { key: 'production'   as const, label: 'Production'      },
  { key: 'quality'      as const, label: 'Quality Control' },
  { key: 'distribution' as const, label: 'Distribution'    },
]

function StageFlow({ events }: { events: JourneyEvent[] }) {
  const present = new Set(events.map(e => classifyEvent(e.event_type).stageGroup))
  const hasCompliance = present.has('compliance')

  // Only show stages that have at least one supporting event — never render
  // a placeholder stage that has no recorded business data.
  const visibleStages = STAGE_FLOW.filter(({ key }) => present.has(key))

  // Most advanced stage reached (absolute index in STAGE_FLOW, not visibleStages)
  let currentIdx = -1
  for (let i = STAGE_FLOW.length - 1; i >= 0; i--) {
    if (present.has(STAGE_FLOW[i].key)) { currentIdx = i; break }
  }
  const allDone = present.has('distribution')

  if (visibleStages.length === 0) return null

  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5">
      {visibleStages.map(({ key, label }, vi) => {
        const i = STAGE_FLOW.findIndex(s => s.key === key)
        // All visible stages have events; isCompleted only depends on position.
        const isCompleted = allDone ? i <= currentIdx : i < currentIdx
        const isCurrent   = !allDone && i === currentIdx

        const pill = isCompleted
          ? 'border-emerald-200 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-900/20'
          : isCurrent
          ? 'border-blue-200 dark:border-blue-600/60 bg-blue-50 dark:bg-blue-900/20'
          : 'border-dashed border-gray-200 dark:border-gray-700 bg-transparent opacity-40'
        const dot  = isCompleted ? 'bg-emerald-400' : isCurrent ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
        const text = isCompleted ? 'text-emerald-600 dark:text-emerald-400' : isCurrent ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
        const arrow = isCompleted ? 'text-emerald-300 dark:text-emerald-700' : 'text-gray-300 dark:text-gray-600'

        return (
          <Fragment key={key}>
            <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 shadow-sm ${pill}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              <span className={`text-[10px] font-bold uppercase tracking-wider ${text}`}>{label}</span>
            </div>
            {vi < visibleStages.length - 1 && (
              <span className={`text-[10px] select-none ${arrow}`}>→</span>
            )}
          </Fragment>
        )
      })}
      {hasCompliance && (
        <>
          <span className="text-[10px] text-purple-300 dark:text-purple-700 select-none">→</span>
          <div className="flex items-center gap-1.5 rounded-full border border-purple-200 dark:border-purple-700/60 bg-purple-50 dark:bg-purple-900/20 px-2.5 py-1 shadow-sm">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">Compliance</span>
          </div>
        </>
      )}
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

// ── Traceability records card ─────────────────────────────────────────────────

function AffectedRecords({
  batchId, qcResults, capas, recalls, sales,
}: {
  batchId:   string
  qcResults: TraceQc[]
  capas:     CapaRecord[]
  recalls:   RecallRecord[]
  sales:     TraceSale[]
}) {
  type Row = { label: string; value: number; href: string; color: string; bg: string }
  const rows: Row[] = []

  if (qcResults.length > 0) rows.push({
    label: 'QC Records',
    value: qcResults.length,
    href:  `/quality-control?batch_id=${batchId}`,
    color: 'text-emerald-700 dark:text-emerald-400',
    bg:    'bg-emerald-100 dark:bg-emerald-900/30',
  })
  if (capas.length > 0) rows.push({
    label: capas.length === 1 ? 'CAPA' : 'CAPAs',
    value: capas.length,
    href:  capas.length === 1 ? `/capa/${capas[0].id}` : `/capa?batch_id=${batchId}`,
    color: 'text-amber-700 dark:text-amber-400',
    bg:    'bg-amber-100 dark:bg-amber-900/30',
  })
  if (recalls.length > 0) rows.push({
    label: recalls.length === 1 ? 'Recall' : 'Recalls',
    value: recalls.length,
    href:  recalls.length === 1 ? `/recall/${recalls[0].id}` : `/recall?batch_id=${batchId}`,
    color: 'text-red-700 dark:text-red-400',
    bg:    'bg-red-100 dark:bg-red-900/30',
  })
  if (sales.length > 0) rows.push({
    label: 'Shipments',
    value: sales.length,
    href:  `/sales?batch_id=${batchId}`,
    color: 'text-teal-700 dark:text-teal-400',
    bg:    'bg-teal-100 dark:bg-teal-900/30',
  })

  if (rows.length === 0) return null

  return (
    <div className="mt-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Traceability Records</p>
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

function BatchHeader({ order, qcResults, materials, sales, recalls }: {
  order: TraceOrder; qcResults: TraceQc[]; materials: TraceMaterial[]; sales: TraceSale[]; recalls: RecallRecord[]
}) {
  const [copied, setCopied] = useState(false)
  const latestQc = [...qcResults].sort(
    (a, b) => new Date(b.inspected_at).getTime() - new Date(a.inspected_at).getTime(),
  )[0] ?? null

  function handleCopy() {
    navigator.clipboard.writeText(order.id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const activeRecall  = recalls.find(r => r.status !== 'closed') ?? null
  const resolvedRecall = !activeRecall && recalls.some(r => r.status === 'closed')

  // Recall status overrides all other stage labels. A batch under active
  // field recall must never show "Shipped" — that hides a safety-critical event.
  const stageBadge = (() => {
    if (activeRecall)                     return { label: 'Under Recall',         cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
    if (resolvedRecall && sales.length > 0) return { label: 'Recall Resolved',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
    if (sales.length > 0)                 return { label: 'Shipped',             cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' }
    if (latestQc?.status === 'pass')      return { label: 'Ready for Shipment',  cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
    if (qcResults.length > 0)            return { label: 'Quality Review',       cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
    if (order.started_at)                return { label: 'In Production',        cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' }
    if (materials.length > 0)            return { label: 'Raw Material Received', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' }
    return null
  })()

  return (
    <div className="mb-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 shadow-sm">
      {/* Name + SKU + badges — all on one line */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-base font-bold text-gray-900 dark:text-white leading-tight truncate">{order.product_name}</h2>
          <span className="shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500">SKU: {order.sku}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {stageBadge && (
            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${stageBadge.cls}`}>
              {stageBadge.label}
            </span>
          )}
          {latestQc && (
            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${QC_BADGE[latestQc.status]}`}>
              {QC_LABEL[latestQc.status]}
            </span>
          )}
        </div>
      </div>

      {/* Metadata — inline key/value pairs with dot separators */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-gray-600 dark:text-gray-400">
        <span className="inline-flex items-center gap-1.5">
          <Calendar size={11} className="shrink-0 text-gray-400" />{fmtDate(order.created_at)}
        </span>
        {!!order.quantity && (
          <>
            <span className="select-none text-gray-300 dark:text-gray-600">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Hash size={11} className="shrink-0 text-gray-400" />{order.quantity.toLocaleString()} units
            </span>
          </>
        )}
        {materials.length > 0 && (
          <>
            <span className="select-none text-gray-300 dark:text-gray-600">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Layers size={11} className="shrink-0 text-gray-400" />{materials.length} {materials.length === 1 ? 'material' : 'materials'}
            </span>
          </>
        )}
        <span className="select-none text-gray-300 dark:text-gray-600">·</span>
        <span className="inline-flex items-center gap-1.5">
          <Truck size={11} className="shrink-0 text-gray-400" />
          {sales.length > 0 ? `${sales.length} ${sales.length === 1 ? 'shipment' : 'shipments'}` : 'Not shipped yet'}
        </span>
      </div>

      {/* Batch ID — inline, no background box */}
      <div className="mt-2 flex items-center gap-1.5">
        <Hash size={10} className="shrink-0 text-gray-400" />
        <span className="text-[10px] text-gray-400">Batch ID</span>
        <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">···{order.id.slice(-12)}</span>
        <button
          onClick={handleCopy}
          className="ml-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="Copy full batch ID"
        >
          {copied
            ? <><Check size={9} className="text-emerald-500" />Copied</>
            : <><Copy size={9} />Copy</>
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
  const [capaRecords,       setCapaRecords]       = useState<CapaRecord[]>([])
  const [recallRecords,     setRecallRecords]     = useState<RecallRecord[]>([])
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
      supabase.from('capas').select('id, title, status, created_at, closed_at').eq('batch_id', id),
      supabase.from('recalls').select('id, title, status, created_at, closed_at').eq('batch_id', id),
      supabase
        .from('bill_of_materials')
        .select('id, material_name, lot_number, quantity, unit, created_at, raw_material_lots(id, lot_number, received_at, status, suppliers(name))')
        .eq('production_order_id', id),
      // Resolve the batches.id that links to this production order — needed
      // because distribution_records.batch_id FK → batches.id, not production_orders.id.
      supabase.from('batches').select('id').eq('production_order_id', id),
    ]).then(async ([traceRes, journeyRes, capaRes, recallRes, bomRes, batchesRes]) => {
      if (traceRes.error || !traceRes.data) {
        setNotFound(true)
        setLoading(false)
        setImpactLoading(false)
        return
      }

      const trace   = traceRes.data as TraceData
      const capas   = (capaRes.data   ?? []) as CapaRecord[]
      const recalls = (recallRes.data ?? []) as RecallRecord[]

      setTraceData(trace)
      setCapaRecords(capas)
      setRecallRecords(recalls)

      // Parse BOM first so raw material received events can be synthesized.
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
          received_at:    lots?.received_at ?? null,
          lot_status:     lots?.status     ?? null,
          bom_created_at: row.created_at   ?? null,
        }
      })
      setEnrichedMaterials(materials)

      // Fetch distribution_records via the linked batches row.
      // distribution_records.batch_id references batches.id (not production_orders.id),
      // so a direct query on p_batch_id would always return zero rows.
      const linkedBatchIds = ((batchesRes.data ?? []) as Array<{ id: string }>).map(b => b.id)
      let distributionRecords: DistributionRecord[] = []
      if (linkedBatchIds.length > 0) {
        const { data: distData } = await supabase
          .from('distribution_records')
          .select('id, recipient_name, recipient_type, quantity_shipped, shipped_at, notes')
          .in('batch_id', linkedBatchIds)
          .order('shipped_at', { ascending: true })
        distributionRecords = (distData ?? []) as DistributionRecord[]
      }

      const jd = journeyRes.data as { timeline?: JourneyEvent[] } | null
      const rpcEvents: JourneyEvent[] = (jd?.timeline && Array.isArray(jd.timeline))
        ? [...jd.timeline].sort((a, b) => new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime())
        : []

      const synth  = synthesizeEvents(trace.order, trace.sales, capas, recalls, distributionRecords)
      const merged = deduplicateSameDayQc(mergeJourneyEvents(rpcEvents, synth))
      setJourney(merged)
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
        <div className="space-y-4">
          {[140, 56, 480, 200, 160].map((h, i) => (
            <div key={i} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 animate-pulse" style={{ height: h }} />
          ))}
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

  const capaCount   = capaRecords.length
  const recallCount = recallRecords.length

  // Filter out system events and low-quality placeholder BOM entries,
  // then group simultaneous material allocations into a single card.
  const businessEvents = groupMaterialEvents(
    journey.filter(e => !isSystemEvent(e) && !isLowQualityMaterialEvent(e))
  )
  const sysEvents = journey.filter(e => isSystemEvent(e))

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

      {/* Batch header — product identity */}
      <BatchHeader
        order={traceData.order}
        qcResults={traceData.qc_results}
        materials={traceData.materials}
        sales={traceData.sales}
        recalls={recallRecords}
      />

      <TraceabilitySummary
        materials={traceData.materials}
        qcResults={traceData.qc_results}
        capaCount={capaCount}
        recallCount={recallCount}
      />

      {/* Timeline — primary feature, full width */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-700 px-4 py-3">
          <Activity size={15} className="text-gray-400 dark:text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Product Journey Timeline</h2>
          {businessEvents.length > 1 && (
            <span className="ml-auto rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
              {businessEvents.length} {businessEvents.length === 1 ? 'event' : 'events'}
            </span>
          )}
        </div>
        <div className="px-4 py-4">
          {businessEvents.length === 0 ? (
            <>
              <div className="py-8 text-center">
                <Activity size={32} className="mx-auto mb-3 text-gray-200 dark:text-gray-700" />
                <p className="text-sm text-gray-400 dark:text-gray-500">No operational events recorded yet</p>
              </div>
              {sysEvents.length > 0 && (
                <>
                  <button
                    onClick={() => setShowSysEvents(v => !v)}
                    className="mt-1 flex w-full items-center justify-between rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-medium text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/30 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    <span>System Events ({sysEvents.length})</span>
                    {showSysEvents ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
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
                  isLast={i === businessEvents.length - 1 && sysEvents.length === 0}
                />
              ))}

              {businessEvents.length === 1 && sysEvents.length === 0 && (
                <div className="mt-4 rounded-xl border border-dashed border-blue-200 dark:border-blue-800/40 bg-blue-50/40 dark:bg-blue-900/10 px-4 py-3.5">
                  <p className="text-xs leading-relaxed text-blue-600/80 dark:text-blue-400/80">
                    Production has started. Additional lifecycle events will appear as the batch progresses.
                  </p>
                </div>
              )}

              {sysEvents.length > 0 && (
                <>
                  <button
                    onClick={() => setShowSysEvents(v => !v)}
                    className="mt-3 flex w-full items-center justify-between rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-medium text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/30 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    <span>System Events ({sysEvents.length})</span>
                    {showSysEvents ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
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
      <AffectedRecords
        batchId={id}
        qcResults={traceData.qc_results}
        capas={capaRecords}
        recalls={recallRecords}
        sales={traceData.sales}
      />
    </div>
  )
}
