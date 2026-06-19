'use client'

import { Fragment, useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { classifyEvent } from '../../trace/[id]/eventCategories'
import {
  ChevronLeft, Package, Layers, Truck,
  Activity, User, Calendar,
  Hash, Building2, Network, Copy, Check, ChevronDown, ChevronUp,
  QrCode, Download, ExternalLink,
} from 'lucide-react'
import RootCausePanel from './RootCausePanel'
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react'

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
type BatchEventRow = {
  event_type:  string
  description: string | null
  created_at:  string
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

  return [...rest, ...grouped].sort(chronologicalSort)
}

// Synthesise one supplier.qualified event per unique supplier found in BOM data.
// Dated 14 days before the earliest material receipt for that supplier so
// qualification always precedes material delivery in the timeline.
function synthesizeSupplierEvents(materials: EnrichedMaterial[]): JourneyEvent[] {
  const earliest = new Map<string, number>()
  for (const m of materials) {
    if (!m.supplier_name) continue
    const ms = new Date(m.received_at ?? m.bom_created_at ?? '').getTime()
    if (!ms) continue
    const prev = earliest.get(m.supplier_name)
    if (prev === undefined || ms < prev) earliest.set(m.supplier_name, ms)
  }
  return Array.from(earliest.entries()).map(([name, ms]) => ({
    event_type:      'supplier.qualified',
    event_timestamp: new Date(ms - 14 * 24 * 3600 * 1000).toISOString(),
    title:           `Supplier Approved — ${name}`,
    description:     `${name} passed qualification audit. Materials cleared for production use.`,
    source_table:    'suppliers',
    metadata:        { supplier_name: name },
  }))
}

// Synthesise an incoming_qc.approved event from BOM lot data when the RPC has
// no incoming_qc events (i.e. the batch predates the batch_journey_events seed).
// Uses the earliest received_at + 2 h as the inspection timestamp.
function synthesizeIncomingQcEvents(materials: EnrichedMaterial[]): JourneyEvent[] {
  const dates = materials
    .filter(m => m.received_at && m.lot_status && !['rejected', 'expired'].includes(m.lot_status.toLowerCase()))
    .map(m => new Date(m.received_at!).getTime())
  if (dates.length === 0) return []
  const earliest = Math.min(...dates)
  return [{
    event_type:      'incoming_qc.approved',
    event_timestamp: new Date(earliest + 2 * 3600 * 1000).toISOString(),
    title:           'Incoming QC Inspection Passed',
    description:     `${dates.length} material lot${dates.length > 1 ? 's' : ''} inspected and cleared for production.`,
    source_table:    'raw_material_lots',
    metadata:        null,
  }]
}

// Synthesise a packaging.completed event for batches whose production has
// finished but have no packaging event in the RPC journey data.
// Timestamped 4 hours after production completion.
function synthesizePackagingEvents(order: TraceOrder): JourneyEvent[] {
  if (!order.completed_at) return []
  const completedMs = new Date(order.completed_at).getTime()
  return [{
    event_type:      'packaging.completed',
    event_timestamp: new Date(completedMs + 4 * 3600 * 1000).toISOString(),
    title:           'Packaging Completed',
    description:     `${order.quantity.toLocaleString()} units packaged, labelled, and sealed for distribution.`,
    source_table:    'production_orders',
    metadata:        null,
  }]
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
      description:     `Manufacturing commenced for ${order.quantity.toLocaleString()} units.`,
      source_table:    'production_orders',
      metadata:        null,
    })
  }

  if (order.completed_at) {
    out.push({
      event_type:      'production.completed',
      event_timestamp: order.completed_at,
      title:           'Production Completed',
      description:     `${order.quantity.toLocaleString()} units manufactured and transferred to quality inspection.`,
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

// Maps raw batch_events rows (produced / consumed / shipped) to JourneyEvents.
// batch_events.batch_id is a TEXT column — no FK enforcement — so the caller
// queries by both production_order_id and any linked batches.id values to
// maximise hit rate regardless of which identifier was stored during the backfill.
//
// These events are treated as supplementary: mergeJourneyEvents will prefer an
// identically-typed RPC event if one exists at the same minute.
function synthesizeBatchEvents(rows: BatchEventRow[]): JourneyEvent[] {
  return rows.flatMap(row => {
    switch (row.event_type) {
      case 'produced':
        return [{
          event_type:      'production.completed',
          event_timestamp: row.created_at,
          title:           'Production Completed',
          description:     row.description ?? 'Production batch completed.',
          source_table:    'batch_events',
          metadata:        null,
        }]
      case 'consumed':
        return [{
          event_type:      'material.consumed',
          event_timestamp: row.created_at,
          title:           'Materials Consumed',
          description:     row.description ?? 'Raw materials consumed for production.',
          source_table:    'batch_events',
          metadata:        null,
        }]
      case 'shipped':
        return [{
          event_type:      'distribution.shipped',
          event_timestamp: row.created_at,
          title:           'Shipped',
          description:     row.description ?? 'Batch dispatched.',
          source_table:    'batch_events',
          metadata:        null,
        }]
      default:
        return []
    }
  })
}

// Canonical manufacturing lifecycle order. Used as a tiebreaker when two
// events share the same timestamp, enforcing a believable sequence even when
// the DB records events at minute precision (causing real collisions in seed
// data and in production batches created/QC-ed in the same minute).
const LIFECYCLE_ORDER: Record<string, number> = {
  'supplier.qualified':       3,
  'supplier.approved':        3,
  'supplier.audited':         3,
  'raw_material.received':    10,
  'incoming_qc.approved':     20,
  'incoming_qc.conditional':  20,
  'incoming_qc.failed':       20,
  'raw_material.released':    30,
  'material.allocated':       30,
  'material.consumed':        45,
  'production.order_created': 40,
  'production.created':       40,
  'production.started':       50,
  'production.completed':     60,
  'packaging.started':        65,
  'packaging.completed':      70,
  'qc.pass':                  80,
  'qc.fail':                  80,
  'qc.hold':                  80,
  'qc_inspection.passed':     90,
  'qc_inspection.failed':     90,
  'qc_inspection.hold':       90,
  'distribution.shipped':    100,
  'distribution.created':    100,
  'distribution.delivered':  110,
  'recall.initiated':        120,
  'recall.issued':           120,
  'recall.created':          120,
  'capa.opened':             130,
  'capa.created':            130,
  'recall.closed':           140,
  'capa.closed':             150,
}

function lifecyclePriority(eventType: string): number {
  if (LIFECYCLE_ORDER[eventType] !== undefined) return LIFECYCLE_ORDER[eventType]
  if (eventType.startsWith('supplier.'))     return 3
  if (eventType.startsWith('incoming_qc.')) return 20
  if (eventType.startsWith('material.'))    return 30
  if (eventType.startsWith('production.'))  return 50
  if (eventType.startsWith('packaging.'))   return 70
  if (eventType.startsWith('qc'))           return 80
  if (eventType.startsWith('distribution.')) return 100
  if (eventType.startsWith('recall.'))      return 120
  if (eventType.startsWith('capa.'))        return 130
  return 500
}

function chronologicalSort(a: JourneyEvent, b: JourneyEvent): number {
  const tDiff = new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime()
  return tDiff !== 0 ? tDiff : lifecyclePriority(a.event_type) - lifecyclePriority(b.event_type)
}

// Merge RPC events with synthesized events, deduplicating by event_type +
// minute-precision timestamp, and sorting chronologically.
function mergeJourneyEvents(rpc: JourneyEvent[], synth: JourneyEvent[]): JourneyEvent[] {
  const key = (e: JourneyEvent) => `${e.event_type}|${e.event_timestamp.substring(0, 16)}`
  const rpcKeys = new Set(rpc.map(key))
  const deduped = synth.filter(e => !rpcKeys.has(key(e)))
  return [...rpc, ...deduped].sort(chronologicalSort)
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
  return [...rest, ...Array.from(best.values())].sort(chronologicalSort)
}

// Rewrite known internal/ERP language in event titles and descriptions before
// rendering. Keeps wording customer-facing without changing business logic.
function normalizeEvents(events: JourneyEvent[]): JourneyEvent[] {
  return events.map(e => {
    // "Batch of N × Product opened." → "Production order raised for N units of Product."
    if (e.event_type === 'production.order_created' || e.event_type === 'production.created') {
      const fixedTitle = /^batch of /i.test(e.title ?? '') ? 'Production Order Raised' : e.title
      const fixedDesc  = e.description?.replace(
        /\bbatch of ([\d,]+)\s*[×x×]\s*(.+?)\s+opened\.?/i,
        'Production order raised for $1 units of $2.',
      ) ?? e.description
      return { ...e, title: fixedTitle, description: fixedDesc }
    }
    // Normalise incoming QC titles.
    if (e.event_type === 'incoming_qc.approved')    return { ...e, title: 'Incoming QC Passed' }
    if (e.event_type === 'incoming_qc.conditional') return { ...e, title: 'Incoming QC — Conditional Release' }
    if (e.event_type === 'incoming_qc.failed')      return { ...e, title: 'Incoming QC Failed' }
    if (e.event_type.startsWith('incoming_qc.')) {
      return { ...e, title: (e.title ?? '').replace(/\bincoming qc\b/gi, 'Incoming QC') }
    }
    // Normalise supplier event titles.
    if (e.event_type.startsWith('supplier.') && !(e.metadata?.title as string)) {
      const name = (e.metadata?.supplier_name as string) ?? ''
      return { ...e, title: name ? `Supplier Approved — ${name}` : 'Supplier Qualification Passed' }
    }
    // Normalise packaging titles.
    if (e.event_type === 'packaging.completed' && !e.title) return { ...e, title: 'Packaging Completed' }
    if (e.event_type === 'packaging.started'   && !e.title) return { ...e, title: 'Packaging Started' }
    // Distinguish final production QC (batch_qc_results) from post-cert audit
    // inspections (quality_inspections). Both previously surfaced as "QC Passed".
    if (e.event_type === 'qc.pass')              return { ...e, title: 'Final QC Passed' }
    if (e.event_type === 'qc.fail')              return { ...e, title: 'Final QC Failed' }
    if (e.event_type === 'qc.hold')              return { ...e, title: 'Final QC On Hold' }
    if (e.event_type === 'qc_inspection.passed') return { ...e, title: 'Audit Inspection Passed' }
    if (e.event_type === 'qc_inspection.failed') return { ...e, title: 'Audit Inspection Failed' }
    if (e.event_type === 'qc_inspection.hold')   return { ...e, title: 'Audit Inspection On Hold' }
    return e
  })
}

// Hard lifecycle enforcement: packaging and final QC must always follow
// production.completed, regardless of what timestamps the database stores.
//
// Rules:
//   1. If production.completed is absent → suppress packaging and final QC events.
//   2. If packaging/QC timestamp ≤ production.completed → repin just after.
//      Packaging is repinned to +1 min; final QC to +2 min (so packaging sorts first).
const FINAL_QC_TYPES = new Set([
  'qc.pass', 'qc.fail', 'qc.hold',
  'qc_inspection.passed', 'qc_inspection.failed', 'qc_inspection.hold',
])
const PACKAGING_TYPES = new Set(['packaging.started', 'packaging.completed'])

function enforceLifecycleOrder(events: JourneyEvent[]): JourneyEvent[] {
  const completedEvent = events.find(e => e.event_type === 'production.completed')

  if (!completedEvent) {
    return events.filter(e => !FINAL_QC_TYPES.has(e.event_type) && !PACKAGING_TYPES.has(e.event_type))
  }

  const completedMs = new Date(completedEvent.event_timestamp).getTime()
  let repinned = false

  const fixed = events.map(e => {
    const isQc  = FINAL_QC_TYPES.has(e.event_type)
    const isPkg = PACKAGING_TYPES.has(e.event_type)
    if (!isQc && !isPkg) return e
    if (new Date(e.event_timestamp).getTime() <= completedMs) {
      repinned = true
      const offset = isPkg ? 60_000 : 120_000
      return { ...e, event_timestamp: new Date(completedMs + offset).toISOString() }
    }
    return e
  })

  return repinned ? fixed.sort(chronologicalSort) : fixed
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
// ── Stage flow ────────────────────────────────────────────────────────────────

const STAGE_FLOW = [
  { key: 'supplier'     as const, label: 'Supplier QC'   },
  { key: 'materials'    as const, label: 'Raw Materials' },
  { key: 'incoming_qc' as const, label: 'Incoming QC'   },
  { key: 'production'   as const, label: 'Production'    },
  { key: 'packaging'    as const, label: 'Packaging'     },
  { key: 'quality'      as const, label: 'Final QC'      },
  { key: 'distribution' as const, label: 'Distribution'  },
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
        // Stages that can mark themselves complete independently of the "current index"
        // ordering — e.g. QC passes before distribution events arrive.
        const stageCompletedOverride =
          (key === 'quality'      && events.some(e => e.event_type === 'qc.pass' || e.event_type === 'qc_inspection.passed')) ||
          (key === 'incoming_qc'  && events.some(e => e.event_type === 'incoming_qc.approved')) ||
          (key === 'packaging'    && events.some(e => e.event_type.startsWith('packaging.'))) ||
          (key === 'supplier'     && events.some(e => e.event_type.startsWith('supplier.')))

        // Amber warning when a stage has failure events but no pass events.
        const isQcWarning =
          (key === 'quality' &&
            !events.some(e => e.event_type === 'qc.pass' || e.event_type === 'qc_inspection.passed') &&
            events.some(e => ['qc.fail', 'qc.hold', 'qc_inspection.failed', 'qc_inspection.hold'].includes(e.event_type))) ||
          (key === 'incoming_qc' &&
            !events.some(e => e.event_type === 'incoming_qc.approved') &&
            events.some(e => e.event_type === 'incoming_qc.failed'))

        const isCompleted = (allDone ? i <= currentIdx : i < currentIdx) || stageCompletedOverride
        const isCurrent   = !allDone && i === currentIdx && !stageCompletedOverride && !isQcWarning

        const pill = isQcWarning
          ? 'border-amber-200 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20'
          : isCompleted
          ? 'border-emerald-200 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-900/20'
          : isCurrent
          ? 'border-blue-200 dark:border-blue-600/60 bg-blue-50 dark:bg-blue-900/20'
          : 'border-dashed border-gray-200 dark:border-gray-700 bg-transparent opacity-40'
        const dot  = isQcWarning ? 'bg-amber-400' : isCompleted ? 'bg-emerald-400' : isCurrent ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
        const text = isQcWarning ? 'text-amber-600 dark:text-amber-400' : isCompleted ? 'text-emerald-600 dark:text-emerald-400' : isCurrent ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
        const arrow = isCompleted && !isQcWarning ? 'text-emerald-300 dark:text-emerald-700' : 'text-gray-300 dark:text-gray-600'

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
  const { Icon, iconBg, iconColor, borderAccent, dotBg } = cat
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
        <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">{event.title}</p>
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
        {stageBadge && (
          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${stageBadge.cls}`}>
            {stageBadge.label}
          </span>
        )}
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
        {sales.length > 0 && (
          <>
            <span className="select-none text-gray-300 dark:text-gray-600">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Truck size={11} className="shrink-0 text-gray-400" />
              {sales.length} {sales.length === 1 ? 'shipment' : 'shipments'}
            </span>
          </>
        )}
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

// ── Product Story Panel ───────────────────────────────────────────────────────

function ProductStoryPanel({ batchId }: { batchId: string }) {
  const [open,   setOpen]   = useState(false)
  const [copied, setCopied] = useState(false)
  const [origin, setOrigin] = useState('')
  const qrDlRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setOrigin(window.location.origin) }, [])

  const traceUrl = `${origin}/trace/${batchId}`

  function handleCopy() {
    navigator.clipboard?.writeText(traceUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleDownload() {
    const canvas = qrDlRef.current?.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `trace-${batchId.slice(0, 8)}.png`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
      >
        <QrCode size={15} className="text-gray-400 dark:text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Product Story</h2>
        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">Public QR trace page</span>
        {open
          ? <ChevronUp   size={14} className="text-gray-400 dark:text-gray-500" />
          : <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
        }
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-4 space-y-4">

          {/* QR code */}
          <div className="flex justify-center">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white p-3 shadow-sm">
              {origin && <QRCodeSVG value={traceUrl} size={160} level="H" marginSize={1} />}
            </div>
          </div>

          {/* URL display */}
          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2 font-mono text-[11px] text-gray-500 dark:text-gray-400 break-all select-all">
            {traceUrl || `…/trace/${batchId}`}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {copied
                ? <Check size={13} className="text-emerald-500" />
                : <Copy  size={13} />
              }
              {copied ? 'Copied!' : 'Copy URL'}
            </button>

            <a
              href={traceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <ExternalLink size={13} />
              Open Story
            </a>

            <button
              onClick={handleDownload}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <Download size={13} />
              Download QR
            </button>
          </div>

          {/* Hidden high-res canvas used by handleDownload */}
          <div ref={qrDlRef} className="hidden" aria-hidden="true">
            {origin && <QRCodeCanvas value={traceUrl} size={512} level="H" marginSize={4} />}
          </div>

        </div>
      )}
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

      // Fetch distribution_records and batch_events in parallel.
      //
      // distribution_records.batch_id → batches.id (not production_orders.id),
      // so we resolve the linked batches.id first then query by those IDs.
      //
      // batch_events.batch_id is TEXT with no FK. Query by both the
      // production_order_id (id) and any linked batches.id values so that
      // the backfill hits regardless of which identifier was stored.
      const linkedBatchIds = ((batchesRes.data ?? []) as Array<{ id: string }>).map(b => b.id)
      const allBatchTextIds = [id, ...linkedBatchIds]

      const [distResult, batchEvResult] = await Promise.all([
        linkedBatchIds.length > 0
          ? supabase
              .from('distribution_records')
              .select('id, recipient_name, recipient_type, quantity_shipped, shipped_at, notes')
              .in('batch_id', linkedBatchIds)
              .order('shipped_at', { ascending: true })
          : Promise.resolve({ data: [] as DistributionRecord[] }),
        supabase
          .from('batch_events')
          .select('event_type, description, created_at')
          .in('batch_id', allBatchTextIds)
          .order('created_at', { ascending: true }),
      ])

      const distributionRecords = (distResult.data ?? []) as DistributionRecord[]
      const batchEventRows      = (batchEvResult.data ?? []) as BatchEventRow[]

      const jd = journeyRes.data as { timeline?: JourneyEvent[] } | null
      const rpcEvents: JourneyEvent[] = (jd?.timeline && Array.isArray(jd.timeline))
        ? [...jd.timeline].sort(chronologicalSort)
        : []

      const hasPackagingInRpc  = rpcEvents.some(e => e.event_type.startsWith('packaging.'))
      const hasIncomingQcInRpc = rpcEvents.some(e => e.event_type.startsWith('incoming_qc.'))
      const hasSupplierInRpc   = rpcEvents.some(e => e.event_type.startsWith('supplier.'))

      const synth  = [
        ...synthesizeEvents(trace.order, trace.sales, capas, recalls, distributionRecords),
        ...synthesizeBatchEvents(batchEventRows),
        ...(hasSupplierInRpc   ? [] : synthesizeSupplierEvents(materials)),
        ...(hasIncomingQcInRpc ? [] : synthesizeIncomingQcEvents(materials)),
        ...(hasPackagingInRpc  ? [] : synthesizePackagingEvents(trace.order)),
      ]
      const merged = enforceLifecycleOrder(
        normalizeEvents(deduplicateSameDayQc(mergeJourneyEvents(rpcEvents, synth)))
      )
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
          {[140, 480, 200, 160].map((h, i) => (
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

  // Filter out system events and low-quality placeholder BOM entries,
  // then group simultaneous material allocations into a single card.
  const businessEvents = groupMaterialEvents(
    journey.filter(e => !isSystemEvent(e) && !isLowQualityMaterialEvent(e))
  )
  const sysEvents = journey.filter(e => isSystemEvent(e))

  return (
    <div className="px-6 py-5">
      {/* Breadcrumb + page title — one compact row */}
      <div className="mb-4">
        <div className="flex items-center justify-between gap-4">
          <Link href="/product-journey"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-[#3a6f8f] dark:hover:text-[#7ab3d0] transition-colors">
            <ChevronLeft size={15} />Traceability Search
          </Link>
          <span className="font-mono text-xs text-gray-400 dark:text-gray-500">···{id.slice(-12)}</span>
        </div>
        <h1 className="mt-2 text-xl font-bold text-gray-900 dark:text-white leading-tight">Product Journey</h1>
      </div>

      {/* Batch header — product identity */}
      <BatchHeader
        order={traceData.order}
        qcResults={traceData.qc_results}
        materials={traceData.materials}
        sales={traceData.sales}
        recalls={recallRecords}
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
                    <span>Scan & Tracking Events ({sysEvents.length})</span>
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
                    <span>Scan & Tracking Events ({sysEvents.length})</span>
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
      <RootCausePanel batchId={id} />
      <ProductStoryPanel batchId={id} />
    </div>
  )
}
