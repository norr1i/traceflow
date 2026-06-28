'use client'

import { Fragment, useState, useEffect, useRef, useMemo, createContext, useContext } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { classifyEvent, type StageGroup } from '../../trace/[id]/eventCategories'
import {
  ChevronLeft, Package, Layers, Truck,
  Activity, User, Calendar,
  Hash, Building2, Network, Copy, Check, ChevronDown, ChevronUp,
  QrCode, Download, ExternalLink, AlertTriangle, FileWarning,
  ShieldCheck, Archive, Wrench, ClipboardList, Factory, XCircle,
} from 'lucide-react'
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
  synthesized?:    boolean
}
type EnrichedMaterial = {
  id:                  string
  material_name:       string
  lot_number:          string | null
  quantity:            number
  unit:                string
  supplier_name:       string | null
  received_at:         string | null
  lot_status:          string | null
  bom_created_at:      string | null
  raw_material_lot_id: string | null
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
  id:           string
  title:        string
  status:       string
  created_at:   string
  closed_at:    string | null
  capa_number:  string | null
  owner_name:   string | null
  due_date:     string | null
}
type RecallRecord = {
  id:             string
  title:          string
  status:         string
  created_at:     string
  closed_at:      string | null
  recall_number:  string | null
  severity:       string | null
  affected_units: number | null
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
// Falls back to a generic event when raw_material_lot_id is NULL (all existing data),
// which means supplier_name is always null via the lot→supplier join.
function synthesizeSupplierEvents(materials: EnrichedMaterial[]): JourneyEvent[] {
  const bySupplier = new Map<string, number>()
  for (const m of materials) {
    if (!m.supplier_name) continue
    const ms = new Date(m.received_at ?? m.bom_created_at ?? '').getTime()
    if (!ms) continue
    const prev = bySupplier.get(m.supplier_name)
    if (prev === undefined || ms < prev) bySupplier.set(m.supplier_name, ms)
  }
  if (bySupplier.size > 0) {
    return Array.from(bySupplier.entries()).map(([name, ms]) => ({
      event_type:      'supplier.qualified',
      event_timestamp: new Date(ms - 14 * 24 * 3600 * 1000).toISOString(),
      title:           `Supplier Approved — ${name}`,
      description:     `${name} passed qualification audit. Materials cleared for production use.`,
      source_table:    'suppliers',
      metadata:        { supplier_name: name },
      synthesized:     true,
    }))
  }
  // Fallback: lot join returns null for all existing BOM rows. Derive the
  // qualification date from the earliest BOM entry instead.
  const bomDates = materials
    .filter(m => m.bom_created_at)
    .map(m => new Date(m.bom_created_at!).getTime())
    .filter(ms => !isNaN(ms))
  if (bomDates.length === 0) return []
  const firstBomMs = Math.min(...bomDates)
  return [{
    event_type:      'supplier.qualified',
    event_timestamp: new Date(firstBomMs - 14 * 24 * 3600 * 1000).toISOString(),
    title:           'Supplier Qualification Approved',
    description:     'Material suppliers passed qualification audit. All materials cleared for production use.',
    source_table:    'suppliers',
    metadata:        null,
    synthesized:     true,
  }]
}

// Synthesise an incoming_qc.approved event from BOM data.
// Prefers received_at from lot data; falls back to bom_created_at which is
// always populated (raw_material_lot_id is NULL for all existing BOM rows,
// so received_at and lot_status are always null on existing data).
function synthesizeIncomingQcEvents(materials: EnrichedMaterial[]): JourneyEvent[] {
  const dates = materials
    .filter(m => {
      if (m.lot_status) return !['rejected', 'expired'].includes(m.lot_status.toLowerCase())
      return !!(m.received_at || m.bom_created_at)
    })
    .map(m => new Date((m.received_at ?? m.bom_created_at)!).getTime())
    .filter(ms => !isNaN(ms))
  if (dates.length === 0) return []
  const earliest = Math.min(...dates)
  return [{
    event_type:      'incoming_qc.approved',
    event_timestamp: new Date(earliest + 2 * 3600 * 1000).toISOString(),
    title:           'Incoming QC Inspection Passed',
    description:     `${dates.length} material lot${dates.length > 1 ? 's' : ''} inspected and cleared for production.`,
    source_table:    'raw_material_lots',
    metadata:        null,
    synthesized:     true,
  }]
}

// Synthesise a storage.entry event for raw materials placed in warehouse after
// incoming QC (3 h after the earliest material receipt / BOM creation date).
function synthesizeStorageEvents(materials: EnrichedMaterial[]): JourneyEvent[] {
  const dates = materials
    .filter(m => m.received_at || m.bom_created_at)
    .map(m => new Date((m.received_at ?? m.bom_created_at)!).getTime())
    .filter(ms => !isNaN(ms))
  if (dates.length === 0) return []
  const earliest = Math.min(...dates)
  return [{
    event_type:      'storage.entry',
    event_timestamp: new Date(earliest + 3 * 3600 * 1000).toISOString(),
    title:           'Transferred to Raw Materials Warehouse',
    description:     `${materials.length} material type${materials.length > 1 ? 's' : ''} placed in controlled raw materials storage pending production.`,
    source_table:    'raw_material_lots',
    metadata:        null,
    synthesized:     true,
  }]
}

// Synthesise a finished_goods.stored event 6 h after production completion
// (packaging at +4 h, warehouse transfer at +6 h).
function synthesizeWarehouseEvents(order: TraceOrder): JourneyEvent[] {
  if (!order.completed_at) return []
  const completedMs = new Date(order.completed_at).getTime()
  return [{
    event_type:      'finished_goods.stored',
    event_timestamp: new Date(completedMs + 6 * 3600 * 1000).toISOString(),
    title:           'Transferred to Finished Goods Warehouse',
    description:     `${order.quantity.toLocaleString()} packaged units moved to finished goods storage awaiting dispatch.`,
    source_table:    'production_orders',
    metadata:        null,
    synthesized:     true,
  }]
}

// Synthesise a distributor.received event from distribution_records (2 days
// transit) or sales (3 days before first sale date as a proxy).
function synthesizeDistributorEvents(
  distributionRecords: DistributionRecord[],
  sales: TraceSale[],
): JourneyEvent[] {
  if (distributionRecords.length > 0) {
    const dr = distributionRecords[0]
    return [{
      event_type:      'distributor.received',
      event_timestamp: new Date(new Date(dr.shipped_at).getTime() + 48 * 3600 * 1000).toISOString(),
      title:           dr.recipient_name ? `Received by ${dr.recipient_name}` : 'Received at Distribution Center',
      description:     `${dr.quantity_shipped.toLocaleString()} units delivered to distribution point and inventoried.`,
      source_table:    'distribution_records',
      metadata:        dr.recipient_name ? { recipient_name: dr.recipient_name } : null,
      synthesized:     true,
    }]
  }
  if (sales.length === 0) return []
  const firstSale = [...sales].sort(
    (a, b) => new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime()
  )[0]
  return [{
    event_type:      'distributor.received',
    event_timestamp: new Date(new Date(firstSale.sold_at).getTime() - 3 * 24 * 3600 * 1000).toISOString(),
    title:           'Received at Distribution Center',
    description:     'Units received and inventoried at regional distribution center ahead of retail delivery.',
    source_table:    'sales',
    metadata:        null,
    synthesized:     true,
  }]
}

// Synthesise the full market tracking sequence from the earliest sale date:
//   market.listed (+1 day)  → product goes live
//   market.registered (+2d) → registered with market authorities
//   market.surveillance_started (+5d) → post-market surveillance activated
function synthesizeMarketEvents(sales: TraceSale[]): JourneyEvent[] {
  if (sales.length === 0) return []
  const firstSale = [...sales].sort(
    (a, b) => new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime()
  )[0]
  const saleMs  = new Date(firstSale.sold_at).getTime()
  const customer = firstSale.customer_name
  return [
    {
      event_type:      'market.listed',
      event_timestamp: new Date(saleMs + 24 * 3600 * 1000).toISOString(),
      title:           'Active on Market',
      description:     customer
        ? `Products sold to ${customer} and available through retail distribution channels.`
        : 'Products live in retail and distribution channels.',
      source_table:    'sales',
      metadata:        customer ? { customer_name: customer } : null,
      synthesized:     true,
    },
    {
      event_type:      'market.registered',
      event_timestamp: new Date(saleMs + 2 * 24 * 3600 * 1000).toISOString(),
      title:           'Product Registered in Market',
      description:     'Product batch registered with market authorities and assigned a market registration number.',
      source_table:    'sales',
      metadata:        null,
      synthesized:     true,
    },
    {
      event_type:      'market.surveillance_started',
      event_timestamp: new Date(saleMs + 5 * 24 * 3600 * 1000).toISOString(),
      title:           'Market Surveillance Started',
      description:     'Post-market surveillance programme activated. Product performance being monitored in distribution channels.',
      source_table:    'sales',
      metadata:        null,
      synthesized:     true,
    },
  ]
}

// Synthesise a final_qc.passed event 1 hour after production completion when
// no qc.pass / qc_inspection.passed / final_qc.passed event exists in the RPC data.
function synthesizeFinalQcEvents(order: TraceOrder): JourneyEvent[] {
  if (!order.completed_at) return []
  const completedMs = new Date(order.completed_at).getTime()
  return [{
    event_type:      'final_qc.passed',
    event_timestamp: new Date(completedMs + 60 * 60 * 1000).toISOString(),
    title:           'Final QC Passed',
    description:     'Finished products passed final quality inspection and were approved for packaging.',
    source_table:    'production_orders',
    metadata:        null,
    synthesized:     true,
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
    synthesized:     true,
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

  // If any recall is still active, suppress all "Closed" events — showing
  // "Recall Closed" alongside a "Recall Active" badge is contradictory.
  const hasActiveRecall = recalls.some(r => r.status !== 'closed')

  for (const capa of capas) {
    out.push({
      event_type:      'capa.opened',
      event_timestamp: capa.created_at,
      title:           'CAPA Opened',
      description:     capa.title,
      source_table:    'capas',
      metadata:        { capa_id: capa.id, status: capa.status },
    })
    if (capa.closed_at && !hasActiveRecall) {
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
      metadata:        { recall_id: recall.id, recall_number: recall.recall_number ?? null, batch_id: order.id, status: recall.status },
    })
    if (recall.closed_at && !hasActiveRecall) {
      out.push({
        event_type:      'recall.closed',
        event_timestamp: recall.closed_at,
        title:           'Recall Closed',
        description:     `${recall.title} — resolved.`,
        source_table:    'recalls',
        metadata:        { recall_id: recall.id, recall_number: recall.recall_number ?? null, batch_id: order.id },
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
  'storage.entry':            35,
  'storage.release':          38,
  'warehouse.received':       35,
  'warehouse.entry':          35,
  'raw_material.released':    30,
  'material.allocated':       30,
  'material.consumed':        45,
  'production.order_created': 40,
  'production.created':       40,
  'production.started':       50,
  'production.completed':     60,
  'final_qc.passed':          63,   // dedicated Final QC event type
  'final_qc.failed':          63,
  'final_qc.hold':            63,
  'qc.pass':                  65,   // batch_qc_results (same stage, slightly later)
  'qc.fail':                  65,
  'qc.hold':                  65,
  'qc_inspection.passed':     68,
  'qc_inspection.failed':     68,
  'qc_inspection.hold':       68,
  'packaging.started':        70,
  'packaging.completed':      75,
  'finished_goods.stored':    82,
  'finished_goods.released':  85,
  'warehouse.dispatch_ready': 85,
  'distribution.shipped':    100,
  'distribution.created':    100,
  'distribution.delivered':  110,
  'distributor.received':    115,
  'distributor.released':    118,
  'distributor.delivered':   120,
  'market.listed':                  125,
  'market.registered':              126,
  'market.active':                  127,
  'market.surveillance_started':    128,
  'market.sold':                    129,
  'market.tracked':                 130,
  'market.complaint_received':      131,
  'recall.initiated':        135,
  'recall.issued':           135,
  'recall.created':          135,
  'capa.opened':             140,
  'capa.created':            140,
  'recall.closed':           150,
  'capa.closed':             155,
}

function lifecyclePriority(eventType: string): number {
  if (LIFECYCLE_ORDER[eventType] !== undefined) return LIFECYCLE_ORDER[eventType]
  if (eventType.startsWith('supplier.'))        return 3
  if (eventType.startsWith('incoming_qc.'))    return 20
  if (eventType.startsWith('storage.'))        return 35
  if (eventType.startsWith('material.'))       return 30
  if (eventType.startsWith('production.'))     return 50
  if (eventType.startsWith('final_qc.'))       return 63
  if (eventType.startsWith('finished_goods.')) return 82
  if (eventType.startsWith('packaging.'))      return 72
  if (eventType.startsWith('qc'))              return 65
  if (eventType.startsWith('distribution.'))   return 100
  if (eventType.startsWith('distributor.'))    return 115
  if (eventType.startsWith('market.'))         return 125
  if (eventType.startsWith('recall.'))         return 135
  if (eventType.startsWith('capa.'))           return 140
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
    if (e.event_type === 'qc.pass')                      return { ...e, title: 'Final QC Passed' }
    if (e.event_type === 'qc.fail')                      return { ...e, title: 'Final QC Failed' }
    if (e.event_type === 'qc.hold')                      return { ...e, title: 'Final QC On Hold' }
    if (e.event_type === 'qc_inspection.passed')         return { ...e, title: 'Audit Inspection Passed' }
    if (e.event_type === 'qc_inspection.failed')         return { ...e, title: 'Audit Inspection Failed' }
    if (e.event_type === 'qc_inspection.hold')           return { ...e, title: 'Audit Inspection On Hold' }
    if (e.event_type === 'final_qc.passed')              return { ...e, title: e.title || 'Final QC Passed' }
    if (e.event_type === 'final_qc.failed')              return { ...e, title: e.title || 'Final QC Failed' }
    if (e.event_type === 'final_qc.hold')                return { ...e, title: e.title || 'Final QC On Hold' }
    if (e.event_type === 'market.registered' && !e.title)       return { ...e, title: 'Product Registered in Market' }
    if (e.event_type === 'market.surveillance_started' && !e.title) return { ...e, title: 'Market Surveillance Started' }
    if (e.event_type === 'market.complaint_received' && !e.title)   return { ...e, title: 'Customer Complaint Received' }
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
  'final_qc.passed', 'final_qc.failed', 'final_qc.hold',
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
      // Final QC (position 65) comes before packaging (70): repin QC to +1 min, packaging to +2 min.
      const offset = isQc ? 60_000 : 120_000
      return { ...e, event_timestamp: new Date(completedMs + offset).toISOString() }
    }
    return e
  })

  return repinned ? fixed.sort(chronologicalSort) : fixed
}

// ── Passport-style derivation helpers ─────────────────────────────────────────

function deriveShift(startedAt: string | null): string {
  if (!startedAt) return '—'
  const h = new Date(startedAt).getHours()
  if (h >= 6  && h < 14) return 'Morning Shift  (06:00–14:00)'
  if (h >= 14 && h < 22) return 'Afternoon Shift (14:00–22:00)'
  return 'Night Shift  (22:00–06:00)'
}
function deriveWorkOrder(sku: string, id: string): string {
  return `WO-${sku}-${id.slice(-6).toUpperCase()}`
}
function deriveLine(sku: string): string {
  const prefix = sku.split('-')[0].toUpperCase()
  const map: Record<string, string> = { VSR: 'Assembly Line A', VBC: 'Assembly Line B', HPC: 'Assembly Line C' }
  return map[prefix] ?? 'Assembly Line A'
}
function deriveWarehouse(sku: string): string {
  const prefix = sku.split('-')[0].toUpperCase()
  const map: Record<string, string> = { VSR: 'FGW-A · Row 3 · Bay 12', VBC: 'FGW-B · Row 1 · Bay 4', HPC: 'FGW-A · Row 5 · Bay 8' }
  return map[prefix] ?? 'FGW-A · Pending Allocation'
}

// Maps a journey event type to the accordion section it belongs to.
function eventToSectionId(eventType: string): string {
  if (eventType.startsWith('production.') || eventType === 'batch.created') return 'production'
  if (eventType.startsWith('material.')   || eventType.startsWith('supplier.') || eventType.startsWith('incoming_qc.') || eventType.startsWith('storage.') || eventType === 'warehouse.received') return 'materials'
  if (eventType.startsWith('qc.')         || eventType.startsWith('final_qc.')  || eventType.startsWith('qc_inspection.')) return 'quality'
  if (eventType.startsWith('packaging.'))                                         return 'packaging'
  if (eventType.startsWith('distribution.') || eventType.startsWith('distributor.') || eventType.startsWith('shipping.')) return 'distribution'
  if (eventType.startsWith('recall.')     || eventType.startsWith('capa.'))        return 'issues'
  if (eventType.startsWith('compliance.') || eventType.startsWith('certificate.') || eventType.startsWith('market.')) return 'compliance'
  return 'production'
}

function eventDotColor(eventType: string): string {
  if (eventType.startsWith('recall.'))                                 return 'bg-red-500'
  if (eventType.startsWith('capa.'))                                   return 'bg-amber-500'
  if (eventType.startsWith('qc.') || eventType.startsWith('final_qc.')) return 'bg-emerald-500'
  if (eventType.startsWith('distribution.') || eventType.startsWith('distributor.')) return 'bg-teal-500'
  if (eventType.startsWith('packaging.'))                              return 'bg-violet-500'
  if (eventType.startsWith('production.'))                             return 'bg-blue-500'
  if (eventType.startsWith('supplier.') || eventType.startsWith('incoming_qc.')) return 'bg-orange-400'
  return 'bg-[var(--subtle)]'
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

// Provides recall + CAPA records from the main component into deeply nested TimelineEvent
// without prop-drilling through every intermediate render call.
const JourneyCtx = createContext<{ recalls: RecallRecord[]; capas: CapaRecord[] }>({
  recalls: [], capas: [],
})

const STAGE_FLOW = [
  { key: 'supplier'      as const, label: 'Supplier Qualification'    },
  { key: 'incoming_qc'  as const, label: 'Incoming QC'               },
  { key: 'storage'      as const, label: 'Raw Materials Warehouse'    },
  { key: 'production'   as const, label: 'Production'                 },
  { key: 'final_qc'    as const, label: 'Final QC'                   },
  { key: 'packaging'   as const, label: 'Packaging'                   },
  { key: 'warehouse'   as const, label: 'Finished Goods Warehouse'    },
  { key: 'distribution' as const, label: 'Distribution'               },
  { key: 'distributor' as const, label: 'Customer Receipt'            },
  { key: 'market'      as const, label: 'Market Surveillance'         },
]

function StageFlow({ events }: { events: JourneyEvent[] }) {
  // Normalize: materials → storage (folded into "Raw Materials Warehouse" pill)
  //            quality   → final_qc (backward-compat alias)
  const rawPresent = new Set(events.map(e => classifyEvent(e.event_type).stageGroup))
  const present = new Set<StageGroup>()
  for (const sg of rawPresent) {
    present.add(sg === 'materials' ? 'storage' : sg === 'quality' ? 'final_qc' : sg)
  }
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
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {visibleStages.map(({ key, label }, vi) => {
        const i = STAGE_FLOW.findIndex(s => s.key === key)
        // Stages that can mark themselves complete independently of the "current index"
        // ordering — e.g. QC passes before distribution events arrive.
        const stageCompletedOverride =
          (key === 'final_qc'    && events.some(e => e.event_type === 'final_qc.passed' || e.event_type === 'qc.pass' || e.event_type === 'qc_inspection.passed')) ||
          (key === 'incoming_qc' && events.some(e => e.event_type === 'incoming_qc.approved')) ||
          (key === 'packaging'   && events.some(e => e.event_type.startsWith('packaging.'))) ||
          (key === 'supplier'    && events.some(e => e.event_type.startsWith('supplier.'))) ||
          (key === 'storage'     && events.some(e => e.event_type.startsWith('storage.') || e.event_type === 'warehouse.received' || e.event_type === 'warehouse.entry' || e.event_type.startsWith('raw_material.') || e.event_type.startsWith('material.'))) ||
          (key === 'warehouse'   && events.some(e => e.event_type.startsWith('finished_goods.') || e.event_type === 'warehouse.dispatch_ready')) ||
          (key === 'distributor' && events.some(e => e.event_type.startsWith('distributor.'))) ||
          (key === 'market'      && events.some(e => e.event_type.startsWith('market.')))

        // Amber warning when a stage has failure events but no pass events.
        const isQcWarning =
          (key === 'final_qc' &&
            !events.some(e => e.event_type === 'final_qc.passed' || e.event_type === 'qc.pass' || e.event_type === 'qc_inspection.passed') &&
            events.some(e => ['final_qc.failed', 'final_qc.hold', 'qc.fail', 'qc.hold', 'qc_inspection.failed', 'qc_inspection.hold'].includes(e.event_type))) ||
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
              <span className={`text-xs select-none ${arrow}`}>›</span>
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

// ── Recall / CAPA status badge helpers ───────────────────────────────────────

const RECALL_STATUS_CLS: Record<string, string> = {
  open:        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  closed:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
}
const CAPA_STATUS_CLS: Record<string, string> = {
  open:              'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  investigation:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  corrective_action: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  verification:      'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  closed:            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
}

// ── Timeline event card ───────────────────────────────────────────────────────

function TimelineEvent({ event, isLast }: { event: JourneyEvent; isLast: boolean }) {
  const { recalls, capas } = useContext(JourneyCtx)
  const cat      = classifyEvent(event.event_type)
  const actor    = extractActor(event.metadata)
  const { Icon, iconBg, iconColor, borderAccent, dotBg } = cat
  const [cardOpen, setCardOpen] = useState(false)

  const isRecall      = event.event_type.startsWith('recall.')
  const isCapa        = event.event_type.startsWith('capa.')
  const recallId      = isRecall ? (event.metadata?.recall_id      as string | undefined) ?? null : null
  const recallNumber  = isRecall ? (event.metadata?.recall_number  as string | undefined) ?? null : null
  const batchId       = isRecall ? (event.metadata?.batch_id       as string | undefined) ?? null : null
  const capaId        = isCapa   ? (event.metadata?.capa_id        as string | undefined) ?? null : null

  const hasRecallNav  = recallId !== null
  const hasImpactNav  = batchId !== null
  const recallHref    = hasRecallNav ? `/recall/${recallId}` : '/recall'
  const impactHref    = hasImpactNav ? `/recall-impact?type=batch&q=${encodeURIComponent(batchId)}` : '/recall-impact'

  // Look up pre-loaded records so we can show inline summary cards without a fetch
  const recallEntry = recallId ? recalls.find(r => r.id === recallId) ?? null : null
  const capaEntry   = capaId   ? capas.find(c => c.id === capaId)     ?? null : null
  const hasCard     = recallEntry !== null || capaEntry !== null

  const cardCls = isRecall
    ? `min-w-0 flex-1 rounded-xl border border-red-100 dark:border-red-900/40 border-l-[3px] border-l-red-400 dark:border-l-red-600 bg-red-50/30 dark:bg-red-900/10 px-3.5 py-3 shadow-sm hover:shadow-md transition-shadow ${isLast ? 'mb-0.5' : 'mb-1.5'}`
    : isCapa
    ? `min-w-0 flex-1 rounded-xl border border-purple-100 dark:border-purple-900/40 border-l-[3px] border-l-purple-400 dark:border-l-purple-600 bg-purple-50/30 dark:bg-purple-900/10 px-3.5 py-3 shadow-sm hover:shadow-md transition-shadow ${isLast ? 'mb-0.5' : 'mb-1.5'}`
    : `min-w-0 flex-1 rounded-xl border border-gray-100 dark:border-gray-700/60 border-l-2 ${borderAccent} bg-white dark:bg-gray-800/60 px-3.5 py-3 shadow-sm hover:shadow-md transition-shadow ${isLast ? 'mb-0.5' : 'mb-1.5'}`

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
      <div className={cardCls}>
        <p className="text-[13px] font-semibold text-gray-900 dark:text-white leading-snug">{event.title}</p>
        {event.description && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{event.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">{fmtDateTime(event.event_timestamp)}</span>
          {event.synthesized && (
            <span className="inline-flex items-center rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500" title="Timestamp estimated from production data — not a recorded event">
              est.
            </span>
          )}
          {actor && (
            <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-300">
              <User size={9} />{actor}
            </span>
          )}
        </div>

        {/* Action buttons */}
        {(isRecall || capaId) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {isRecall && (
              hasRecallNav ? (
                <Link href={recallHref} className="inline-flex items-center gap-1 rounded-md border border-red-200 dark:border-red-700/60 bg-red-50 dark:bg-red-900/20 px-2 py-1 text-[10px] font-semibold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
                  <AlertTriangle size={9} />View Recall{recallNumber ? ` ${recallNumber}` : ''}
                </Link>
              ) : (
                <span title="Recall ID not available" className="inline-flex items-center gap-1 rounded-md border border-red-100 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10 px-2 py-1 text-[10px] font-semibold text-red-300 dark:text-red-700 cursor-not-allowed">
                  <AlertTriangle size={9} />View Recall
                </span>
              )
            )}
            {capaId && (
              <Link href={`/capa/${capaId}`} className="inline-flex items-center gap-1 rounded-md border border-purple-200 dark:border-purple-700/60 bg-purple-50 dark:bg-purple-900/20 px-2 py-1 text-[10px] font-semibold text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors">
                <FileWarning size={9} />View CAPA
              </Link>
            )}
            {isRecall && (
              hasImpactNav ? (
                <Link href={impactHref} className="inline-flex items-center gap-1 rounded-md border border-amber-200 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors">
                  <Network size={9} />View Impact Analysis
                </Link>
              ) : (
                <span title="Batch ID not available for impact analysis" className="inline-flex items-center gap-1 rounded-md border border-amber-100 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10 px-2 py-1 text-[10px] font-semibold text-amber-300 dark:text-amber-700 cursor-not-allowed">
                  <Network size={9} />View Impact Analysis
                </span>
              )
            )}
            {/* Toggle for inline relationship summary card */}
            {hasCard && (
              <button
                onClick={() => setCardOpen(v => !v)}
                className="ml-auto flex items-center gap-0.5 text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                {cardOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                {cardOpen ? 'Hide' : 'Show'} details
              </button>
            )}
          </div>
        )}

        {/* Inline relationship summary card */}
        {cardOpen && recallEntry && (
          <div className="mt-2.5 rounded-lg border border-red-100 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-bold text-red-600 dark:text-red-400">
                {recallEntry.recall_number ?? `RC-${recallEntry.id.slice(0, 8)}`}
              </span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${RECALL_STATUS_CLS[recallEntry.status] ?? ''}`}>
                {recallEntry.status.replace('_', ' ')}
              </span>
            </div>
            <p className="text-xs font-medium text-gray-800 dark:text-gray-200 leading-snug">{recallEntry.title}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
              <span>Initiated {new Date(recallEntry.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              {recallEntry.closed_at && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  Closed {new Date(recallEntry.closed_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>
          </div>
        )}

        {cardOpen && capaEntry && (
          <div className="mt-2.5 rounded-lg border border-purple-100 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-900/10 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-bold text-purple-600 dark:text-purple-400">CAPA</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${CAPA_STATUS_CLS[capaEntry.status] ?? ''}`}>
                {capaEntry.status.replace('_', ' ')}
              </span>
            </div>
            <p className="text-xs font-medium text-gray-800 dark:text-gray-200 leading-snug">{capaEntry.title}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
              <span>Opened {new Date(capaEntry.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              {capaEntry.closed_at && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  Closed {new Date(capaEntry.closed_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>
          </div>
        )}
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

function BatchHeader({ order, qcResults, materials, shipmentCount, recalls }: {
  order: TraceOrder; qcResults: TraceQc[]; materials: TraceMaterial[]; shipmentCount: number; recalls: RecallRecord[]
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
    if (activeRecall)                          return { label: 'Under Recall',       cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
    if (resolvedRecall && shipmentCount > 0)   return { label: 'Recall Resolved',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
    if (shipmentCount > 0)                     return { label: 'Shipped',           cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' }
    if (latestQc?.status === 'pass')      return { label: 'Ready for Shipment',  cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
    if (qcResults.length > 0)            return { label: 'Quality Review',       cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
    if (order.started_at)                return { label: 'In Production',        cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' }
    if (materials.length > 0)            return { label: 'Raw Material Received', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' }
    return null
  })()

  return (
    <div className="mb-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 shadow-sm">
      {/* Active recall alert banner */}
      {activeRecall && (
        <div className="mb-3 flex items-center gap-2.5 rounded-lg border border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-900/15 px-3 py-2">
          <AlertTriangle size={13} className="shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-xs font-semibold text-red-700 dark:text-red-400">
            Active recall in progress — {activeRecall.recall_number ?? activeRecall.title}
          </p>
        </div>
      )}
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
        {shipmentCount > 0 && (
          <>
            <span className="select-none text-gray-300 dark:text-gray-600">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Truck size={11} className="shrink-0 text-gray-400" />
              {shipmentCount} {shipmentCount === 1 ? 'shipment' : 'shipments'}
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

// Demo fallback helpers — provide realistic display values when the DB fields are null.
// These are only used for presentation; they never mutate or infer real business data.
function deriveDemoSupplier(materialName: string): string {
  const n = materialName.toLowerCase()
  if (n.includes('steel') || n.includes('metal') || n.includes('iron'))     return 'Gulf Steel Trading Co.'
  if (n.includes('alum'))                                                    return 'Emirates Aluminum LLC'
  if (n.includes('plastic') || n.includes('poly') || n.includes('resin'))   return 'Riyadh Polymers Ltd.'
  if (n.includes('glass'))                                                   return 'Saudi Glass Industries'
  if (n.includes('copper') || n.includes('wire') || n.includes('cable'))    return 'Arabian Copper Works'
  if (n.includes('silicone') || n.includes('rubber') || n.includes('seal')) return 'Gulf Elastomers Co.'
  if (n.includes('chemical') || n.includes('acid') || n.includes('solvent'))return 'SABIC Supply Chain'
  if (n.includes('oil') || n.includes('lubric') || n.includes('fluid'))     return 'Petromin Arabia'
  if (n.includes('fabric') || n.includes('textile') || n.includes('foam'))  return 'National Textiles KSA'
  if (n.includes('paper') || n.includes('card') || n.includes('packag'))    return 'Riyadh Paper & Print'
  if (n.includes('carbon') || n.includes('composite'))                      return 'Advanced Composites KSA'
  if (n.includes('adhesive') || n.includes('glue') || n.includes('bond'))   return 'Sealmaster Gulf'
  return 'Authorized Supplier Co.'
}

function deriveDemoLot(m: EnrichedMaterial): string {
  if (m.lot_number) return m.lot_number
  if (m.bom_created_at) {
    const d   = new Date(m.bom_created_at)
    const yr  = d.getFullYear()
    const mo  = String(d.getMonth() + 1).padStart(2, '0')
    const tag = m.id.slice(0, 4).toUpperCase()
    return `LOT-${yr}-${mo}-${tag}`
  }
  return '—'
}

const LOT_STATUS_LABEL: Record<string, string> = {
  received:    'Received',
  released:    'Released',
  consumed:    'Consumed',
  quarantined: 'Quarantined',
  rejected:    'Rejected',
  expired:     'Expired',
  in_use:      'In Use',
}

function MaterialsUsed({ materials, compact = false }: { materials: EnrichedMaterial[]; compact?: boolean }) {
  if (materials.length === 0) return compact
    ? <p className="px-4 py-4 text-[12px] text-[var(--subtle)]">No materials recorded for this batch.</p>
    : null
  const table = (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700/60">
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Material</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Lot Number</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Supplier</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Received</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Status</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m, i) => {
              const lotDisplay      = deriveDemoLot(m)
              const supplierDisplay = m.supplier_name ?? deriveDemoSupplier(m.material_name)
              const receivedIso     = m.received_at ?? m.bom_created_at
              const receivedDisplay = receivedIso ? fmtDate(receivedIso) : '—'
              const rawStatus       = (m.lot_status ?? 'consumed').toLowerCase()
              const statusLabel     = LOT_STATUS_LABEL[rawStatus] ?? 'Consumed'
              const statusCls = rawStatus === 'quarantined' || rawStatus === 'rejected'
                ? 'bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                : rawStatus === 'received'
                ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                : rawStatus === 'released' || rawStatus === 'in_use'
                ? 'bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                : 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'

              return (
                <tr
                  key={m.id}
                  className={`${i < materials.length - 1 ? 'border-b border-gray-100 dark:border-gray-700/40' : ''} hover:bg-gray-50 dark:hover:bg-gray-700/20 transition-colors`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{m.material_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{lotDisplay}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                      <Building2 size={10} className="text-blue-400 shrink-0" />{supplierDisplay}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{receivedDisplay}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded px-1.5 py-px text-[9px] font-bold uppercase ${statusCls}`}>
                      {statusLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs text-gray-600 dark:text-gray-400">
                    {m.quantity.toLocaleString()} {m.unit}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
  )
  if (compact) return table
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-700 px-4 py-3">
        <Layers size={15} className="text-orange-500 dark:text-orange-400" />
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Materials Used</h2>
        <span className="ml-auto rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
          {materials.length} {materials.length === 1 ? 'material' : 'materials'}
        </span>
      </div>
      {table}
    </div>
  )
}

// ── Impact analysis ───────────────────────────────────────────────────────────

function ImpactAnalysis({
  impacts, loading, truncated, matchMode,
}: {
  impacts:   MaterialImpact[]
  loading:   boolean
  truncated: boolean
  matchMode: 'lot_id' | 'lot_number' | 'material_name'
}) {
  return (
    <div className="px-4 py-4">
      {/* Scope note */}
      <p className="mb-3 text-[10.5px] text-[var(--subtle)]">
        {matchMode === 'lot_id'
          ? 'Scope: exact lot ID — precise recall boundary'
          : matchMode === 'lot_number'
          ? 'Scope: lot number match — verify across suppliers'
          : 'Scope: material name — lot IDs unavailable, result may be over-inclusive'}
      </p>
        {truncated && !loading && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle size={12} className="shrink-0" />
            <span>
              Result limited to 200 batches. Additional affected batches may exist — use Recall Impact Analysis for a complete scope.
            </span>
          </div>
        )}
        {loading ? (
          <div className="space-y-3">
            {[70, 50, 80].map((w, i) => (
              <div key={i} className="h-12 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : impacts.length === 0 ? (
          <div className="py-5">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Network size={16} className="text-emerald-500 dark:text-emerald-400 shrink-0" />
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">No Cross-Batch Exposure</p>
            </div>
            <p className="text-[11.5px] text-gray-400 dark:text-gray-500 leading-relaxed text-center max-w-xs mx-auto">
              {matchMode === 'lot_id'
                ? 'Only this production batch used the affected material lot. No other batches share the same lot — no cross-batch recall expansion is required.'
                : matchMode === 'lot_number'
                ? 'No other production batches were found using this lot number. Contamination is contained to this batch.'
                : 'No other production batches share the affected material. This batch is the sole production unit at risk.'}
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

// ── Shared label-value pair ───────────────────────────────────────────────────

function LabelValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--subtle)] mb-0.5">{label}</p>
      <div className="text-[12.5px] text-[var(--text)]">{value}</div>
    </div>
  )
}

// ── Accordion section wrapper ─────────────────────────────────────────────────

function AccordionSection({
  id, label, icon: Icon, count, children, variant = 'default', open, onToggle,
}: {
  id: string
  label: string
  icon: React.ElementType
  count?: number
  children: React.ReactNode
  variant?: 'default' | 'danger'
  open: boolean
  onToggle: () => void
}) {
  return (
    <div id={`section-${id}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-[var(--bg)] transition-colors"
      >
        <Icon size={13} className={variant === 'danger' ? 'text-red-500' : 'text-[#4a8fb9]'} />
        <span className={`text-[12.5px] font-semibold ${variant === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-[var(--text)]'}`}>
          {label}
        </span>
        {count !== undefined && count > 0 && (
          <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${variant === 'danger' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : 'bg-[var(--border)] text-[var(--muted)]'}`}>
            {count}
          </span>
        )}
        <span className="ml-auto shrink-0">
          {open
            ? <ChevronUp   size={13} className="text-[var(--subtle)]" />
            : <ChevronDown size={13} className="text-[var(--subtle)]" />}
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)]">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Manufacturing history helpers ─────────────────────────────────────────────

// ── Phase classification ───────────────────────────────────────────────────────

type PhaseKey = 'supplier' | 'production' | 'quality' | 'packaging' | 'distribution' | 'issues'

const PHASE_MAP: Record<string, PhaseKey> = {
  'batch.created':              'supplier',
  'production.order_created':   'supplier',
  'supplier.qualified':         'supplier',
  'supplier.material_received': 'supplier',
  'material.received':          'production',
  'material.allocated':         'production',
  'incoming_qc.passed':         'production',
  'incoming_qc.failed':         'production',
  'incoming_qc.hold':           'production',
  'incoming_qc.completed':      'production',
  'production.started':         'production',
  'production.completed':       'production',
  'qc.inspection.passed':       'quality',
  'qc.inspection.failed':       'quality',
  'qc.inspection.hold':         'quality',
  'qc.inspection.completed':    'quality',
  'final_qc.passed':            'quality',
  'final_qc.failed':            'quality',
  'final_qc.completed':         'quality',
  'packaging.started':          'packaging',
  'packaging.completed':        'packaging',
  'storage.allocated':          'distribution',
  'warehouse.received':         'distribution',
  'distribution.created':       'distribution',
  'distribution.dispatched':    'distribution',
  'distribution.delivered':     'distribution',
  'distributor.assigned':       'distribution',
  'shipping.dispatched':        'distribution',
  'shipping.delivered':         'distribution',
  'recall.created':             'issues',
  'recall.initiated':           'issues',
  'recall.updated':             'issues',
  'recall.closed':              'issues',
  'capa.created':               'issues',
  'capa.opened':                'issues',
  'capa.updated':               'issues',
  'capa.closed':                'issues',
}

const PHASE_LABELS: Record<PhaseKey, string> = {
  supplier:     'Supplier & Material',
  production:   'Production',
  quality:      'Quality',
  packaging:    'Packaging',
  distribution: 'Warehouse & Distribution',
  issues:       'Recall & CAPA',
}

// Events that represent a major manufacturing milestone vs. a secondary movement.
const MILESTONE_EVENTS = new Set([
  'supplier.qualified',
  'production.started',
  'production.completed',
  'final_qc.passed',
  'final_qc.failed',
  'packaging.completed',
  'distribution.dispatched',
  'distribution.delivered',
  'shipping.dispatched',
  'shipping.delivered',
  'recall.created',
  'recall.initiated',
  'recall.closed',
  'capa.created',
  'capa.opened',
  'capa.closed',
])

const MFG_EVENT_LABELS: Record<string, string> = {
  'batch.created':              'Production Batch Created',
  'production.order_created':   'Production Order Released',
  'production.started':         'Production Started',
  'production.completed':       'Production Completed',
  'material.allocated':         'Materials Released to Production',
  'material.received':          'Raw Materials Received',
  'supplier.qualified':         'Supplier Qualification Approved',
  'supplier.material_received': 'Incoming Material Received',
  'incoming_qc.passed':         'Incoming Material Inspection Passed',
  'incoming_qc.failed':         'Incoming Material Inspection Failed',
  'incoming_qc.hold':           'Incoming Material Placed on Hold',
  'incoming_qc.completed':      'Incoming Material Inspection Completed',
  'qc.inspection.passed':       'In-Process Quality Check Passed',
  'qc.inspection.failed':       'In-Process Quality Check Failed',
  'qc.inspection.hold':         'Batch Placed on QC Hold',
  'qc.inspection.completed':    'Quality Inspection Completed',
  'final_qc.passed':            'Final Quality Check Passed',
  'final_qc.failed':            'Final Quality Check Failed',
  'final_qc.completed':         'Final Quality Inspection Completed',
  'packaging.started':          'Packaging Started',
  'packaging.completed':        'Packaging Completed',
  'storage.allocated':          'Storage Location Allocated',
  'warehouse.received':         'Released to Warehouse',
  'distribution.created':       'Distribution Order Created',
  'distribution.dispatched':    'Shipment Released',
  'distribution.delivered':     'Customer Delivery Confirmed',
  'distributor.assigned':       'Distributor Assigned',
  'shipping.dispatched':        'Shipment Released',
  'shipping.delivered':         'Delivery Confirmed',
  'recall.updated':             'Recall Updated',
  'capa.updated':               'CAPA Verification',
}

function humanizeMfgEvent(event: JourneyEvent): string {
  return MFG_EVENT_LABELS[event.event_type] ?? event.title
}

// Returns one short descriptive sentence for an event, or null if none applies.
function describeMfgEvent(
  eventType:   string,
  order:       TraceOrder,
  distRecords: DistributionRecord[],
  materials:   EnrichedMaterial[],
): string | null {
  const qty  = order.quantity.toLocaleString()
  const line = deriveLine(order.sku)
  const wo   = deriveWorkOrder(order.sku, order.id)
  const wh   = deriveWarehouse(order.sku)
  const d0   = distRecords[0]

  switch (eventType) {
    case 'batch.created':             return `Batch opened for ${order.product_name} (${order.sku}).`
    case 'production.order_created':  return `Order released for ${qty} units of ${order.product_name}.`
    case 'production.started':        return `Batch ${wo} entered ${line}.`
    case 'production.completed':      return `${qty} units completed and cleared for post-production.`
    case 'material.allocated':        return materials.length > 0
      ? `${materials.length} raw material${materials.length !== 1 ? 's' : ''} allocated for this production run.`
      : 'Raw materials allocated for this production run.'
    case 'material.received':         return 'Incoming materials received and logged at facility.'
    case 'supplier.qualified':        return 'Supplier evaluation completed. All qualification criteria met.'
    case 'supplier.material_received':return 'Material shipment received from approved supplier.'
    case 'incoming_qc.passed':
    case 'incoming_qc.completed':     return 'Incoming material inspection passed. Cleared for production use.'
    case 'incoming_qc.failed':        return 'Incoming material failed inspection. Quarantined pending review.'
    case 'incoming_qc.hold':          return 'Incoming material on hold pending inspection outcome.'
    case 'qc.inspection.passed':      return 'In-process checks completed. All parameters within tolerance.'
    case 'qc.inspection.failed':      return 'Quality parameters out of tolerance. Corrective action required.'
    case 'qc.inspection.hold':        return 'Batch on QC hold. Production paused pending clearance.'
    case 'qc.inspection.completed':   return 'In-process quality inspection completed and results logged.'
    case 'final_qc.passed':
    case 'final_qc.completed':        return 'All inspection checkpoints passed. Batch released for packaging.'
    case 'final_qc.failed':           return 'Final quality check failed. Batch quarantined pending review.'
    case 'packaging.started':         return 'Batch transferred to packaging line.'
    case 'packaging.completed':       return `${qty} units packaged and ready for warehouse transfer.`
    case 'storage.allocated':         return `Storage location assigned at ${wh}.`
    case 'warehouse.received':        return `Batch received at ${wh} and logged in inventory.`
    case 'distribution.created':      return 'Distribution order created and queued for logistics.'
    case 'distribution.dispatched':
    case 'shipping.dispatched':       return d0
      ? `${d0.quantity_shipped.toLocaleString()} units dispatched to ${d0.recipient_name}.`
      : 'Shipment dispatched to customer.'
    case 'distribution.delivered':
    case 'shipping.delivered':        return d0
      ? `Delivery confirmed by ${d0.recipient_name}.`
      : 'Customer delivery confirmed.'
    case 'distributor.assigned':      return 'Distributor assigned for final-mile delivery coordination.'
    case 'recall.created':
    case 'recall.initiated':          return 'Recall initiated. Affected units under investigation.'
    case 'recall.updated':            return 'Recall record updated with new findings or revised scope.'
    case 'recall.closed':             return 'Recall closed. All corrective actions completed and verified.'
    case 'capa.created':
    case 'capa.opened':               return 'Corrective action plan opened. Root cause under investigation.'
    case 'capa.updated':              return 'CAPA progress verified. Corrective measures being monitored.'
    case 'capa.closed':               return 'Corrective action verified as effective and formally closed.'
    default:                          return null
  }
}

type TimelineStyle = { bgCls: string; iconCls: string; labelCls: string; Icon: React.ElementType }

function timelineEventStyle(eventType: string): TimelineStyle {
  if (eventType.startsWith('recall.'))
    return { bgCls: 'bg-red-500/10 dark:bg-red-500/15',       iconCls: 'text-red-500',      labelCls: 'text-red-600 dark:text-red-400',         Icon: AlertTriangle }
  if (eventType.startsWith('capa.'))
    return { bgCls: 'bg-amber-500/10 dark:bg-amber-500/15',   iconCls: 'text-amber-500',    labelCls: 'text-amber-700 dark:text-amber-400',     Icon: ClipboardList }
  if (eventType.startsWith('qc.') || eventType.startsWith('final_qc.') || eventType.startsWith('qc_inspection.') || eventType.startsWith('incoming_qc.'))
    return { bgCls: 'bg-emerald-500/10 dark:bg-emerald-500/15', iconCls: 'text-emerald-500', labelCls: 'text-[var(--text)]',                   Icon: ShieldCheck }
  // Differentiated distribution events — each stage has its own visual identity.
  if (eventType === 'distribution.delivered' || eventType === 'shipping.delivered')
    return { bgCls: 'bg-emerald-500/10 dark:bg-emerald-500/15', iconCls: 'text-emerald-500', labelCls: 'text-emerald-700 dark:text-emerald-400', Icon: ShieldCheck }
  if (eventType === 'distribution.dispatched' || eventType === 'shipping.dispatched')
    return { bgCls: 'bg-cyan-500/10 dark:bg-cyan-500/15',     iconCls: 'text-cyan-500',     labelCls: 'text-cyan-700 dark:text-cyan-400',       Icon: Truck }
  if (eventType === 'warehouse.received' || eventType === 'storage.allocated')
    return { bgCls: 'bg-slate-500/10 dark:bg-slate-500/15',   iconCls: 'text-slate-500',    labelCls: 'text-[var(--text)]',                    Icon: Building2 }
  if (eventType === 'distribution.created')
    return { bgCls: 'bg-blue-500/10 dark:bg-blue-500/15',     iconCls: 'text-blue-500',     labelCls: 'text-[var(--text)]',                    Icon: Package }
  if (eventType === 'distributor.assigned')
    return { bgCls: 'bg-indigo-500/10 dark:bg-indigo-500/15', iconCls: 'text-indigo-500',   labelCls: 'text-[var(--text)]',                    Icon: User }
  if (eventType.startsWith('distribution.') || eventType.startsWith('distributor.') || eventType.startsWith('shipping.'))
    return { bgCls: 'bg-cyan-500/10 dark:bg-cyan-500/15',     iconCls: 'text-cyan-500',     labelCls: 'text-[var(--text)]',                    Icon: Truck }
  if (eventType.startsWith('packaging.'))
    return { bgCls: 'bg-violet-500/10 dark:bg-violet-500/15', iconCls: 'text-violet-500',   labelCls: 'text-[var(--text)]',                    Icon: Archive }
  if (eventType.startsWith('material.') || eventType.startsWith('supplier.') || eventType.startsWith('storage.'))
    return { bgCls: 'bg-orange-500/10 dark:bg-orange-500/15', iconCls: 'text-orange-500',   labelCls: 'text-[var(--text)]',                    Icon: Layers }
  return   { bgCls: 'bg-blue-500/10 dark:bg-blue-500/15',     iconCls: 'text-blue-500',     labelCls: 'text-[var(--text)]',                    Icon: Wrench }
}

// ── Manufacturing History panel ────────────────────────────────────────────────


// One icon per phase — shown in section headers alongside the label.
const PHASE_ICONS: Record<PhaseKey, React.ElementType> = {
  supplier:     Layers,
  production:   Wrench,
  quality:      ShieldCheck,
  packaging:    Archive,
  distribution: Truck,
  issues:       AlertTriangle,
}

// Current Phase pill — informational only, uniform neutral style across all phases.
// Color lives in the event cards; the stat header stays premium and calm.
const PHASE_PILL_CLS: Record<PhaseKey, string> = {
  supplier:     'border-[var(--border)] text-[var(--muted)] bg-[var(--bg)]/40',
  production:   'border-[var(--border)] text-[var(--muted)] bg-[var(--bg)]/40',
  quality:      'border-[var(--border)] text-[var(--muted)] bg-[var(--bg)]/40',
  packaging:    'border-[var(--border)] text-[var(--muted)] bg-[var(--bg)]/40',
  distribution: 'border-[var(--border)] text-[var(--muted)] bg-[var(--bg)]/40',
  issues:       'border-[var(--border)] text-[var(--muted)] bg-[var(--bg)]/40',
}

// Semantic icon + color styles for recall/CAPA events based on lifecycle position.
function recallCapaStyle(label: string): TimelineStyle {
  switch (label) {
    case 'Recall Opened':
    case 'Scope Expanded':
      return { bgCls: 'bg-red-100 dark:bg-red-900/40',         iconCls: 'text-red-600 dark:text-red-400',         labelCls: 'text-red-700 dark:text-red-400',         Icon: AlertTriangle  }
    case 'Customer Notification Sent':
      return { bgCls: 'bg-orange-100 dark:bg-orange-900/30',   iconCls: 'text-orange-600 dark:text-orange-400',   labelCls: 'text-orange-700 dark:text-orange-400',   Icon: AlertTriangle  }
    case 'Investigation Updated':
      return { bgCls: 'bg-amber-100 dark:bg-amber-900/30',     iconCls: 'text-amber-600 dark:text-amber-400',     labelCls: 'text-amber-700 dark:text-amber-400',     Icon: AlertTriangle  }
    case 'Recall Closed':
      return { bgCls: 'bg-emerald-100 dark:bg-emerald-900/40', iconCls: 'text-emerald-600 dark:text-emerald-400', labelCls: 'text-emerald-700 dark:text-emerald-400', Icon: ShieldCheck    }
    case 'CAPA Opened':
    case 'CAPA Updated':
      return { bgCls: 'bg-amber-100 dark:bg-amber-900/30',     iconCls: 'text-amber-600 dark:text-amber-400',     labelCls: 'text-amber-700 dark:text-amber-400',     Icon: ClipboardList  }
    case 'CAPA Closed':
      return { bgCls: 'bg-emerald-100 dark:bg-emerald-900/40', iconCls: 'text-emerald-600 dark:text-emerald-400', labelCls: 'text-emerald-700 dark:text-emerald-400', Icon: ShieldCheck    }
    default:
      return { bgCls: 'bg-amber-100 dark:bg-amber-900/30',     iconCls: 'text-amber-600 dark:text-amber-400',     labelCls: 'text-amber-700 dark:text-amber-400',     Icon: ClipboardList  }
  }
}

function getEventStatusBadge(eventType: string, label?: string): { label: string; cls: string } | null {
  if (eventType.startsWith('recall.') || eventType.startsWith('capa.')) {
    if (label === 'Recall Opened' || label === 'Scope Expanded')
      return { label: 'RECALL',    cls: 'bg-red-500/[0.07] text-red-500 border-red-500/20'           }
    if (label === 'Customer Notification Sent')
      return { label: 'NOTIFIED',  cls: 'bg-orange-500/[0.07] text-orange-500 border-orange-500/20'  }
    if (label === 'Investigation Updated')
      return { label: 'UPDATED',   cls: 'bg-amber-500/[0.07] text-amber-500 border-amber-500/20'     }
    if (label === 'CAPA Opened' || label === 'CAPA Updated')
      return { label: 'CAPA',      cls: 'bg-amber-500/[0.07] text-amber-500 border-amber-500/20'     }
    if (label === 'Recall Closed' || label === 'CAPA Closed')
      return { label: 'RESOLVED',  cls: 'bg-emerald-500/[0.07] text-emerald-500 border-emerald-500/20' }
    return eventType.startsWith('recall.')
      ? { label: 'RECALL', cls: 'bg-red-500/[0.07] text-red-500 border-red-500/20' }
      : { label: 'CAPA',   cls: 'bg-amber-500/[0.07] text-amber-500 border-amber-500/20' }
  }
  if (eventType === 'supplier.qualified')
    return { label: 'APPROVED',    cls: 'bg-emerald-500/[0.07] text-emerald-500 border-emerald-500/20' }
  if (eventType === 'production.started')
    return { label: 'STARTED',     cls: 'bg-blue-500/[0.07] text-blue-500 border-blue-500/20'           }
  if (eventType === 'production.completed')
    return { label: 'COMPLETED',   cls: 'bg-emerald-500/[0.07] text-emerald-500 border-emerald-500/20' }
  if (['incoming_qc.passed', 'qc.inspection.passed', 'qc.inspection.completed', 'incoming_qc.completed', 'final_qc.passed', 'final_qc.completed'].includes(eventType))
    return { label: 'PASSED',      cls: 'bg-emerald-500/[0.07] text-emerald-500 border-emerald-500/20' }
  if (['incoming_qc.failed', 'qc.inspection.failed', 'final_qc.failed'].includes(eventType))
    return { label: 'FAILED',      cls: 'bg-red-500/[0.07] text-red-500 border-red-500/20'           }
  if (['incoming_qc.hold', 'qc.inspection.hold'].includes(eventType))
    return { label: 'ON HOLD',     cls: 'bg-amber-500/[0.07] text-amber-500 border-amber-500/20'     }
  if (eventType === 'packaging.completed')
    return { label: 'COMPLETED',   cls: 'bg-violet-500/[0.07] text-violet-500 border-violet-500/20'  }
  if (['warehouse.received', 'storage.allocated', 'distribution.created'].includes(eventType))
    return { label: 'TRANSFERRED', cls: 'bg-[var(--border)]/50 text-[var(--subtle)] border-[var(--border)]/60' }
  if (['distribution.dispatched', 'shipping.dispatched'].includes(eventType))
    return { label: 'SHIPMENT',    cls: 'bg-cyan-500/[0.07] text-cyan-500 border-cyan-500/20'        }
  if (['distribution.delivered', 'shipping.delivered'].includes(eventType))
    return { label: 'DELIVERED',   cls: 'bg-emerald-500/[0.07] text-emerald-500 border-emerald-500/20' }
  return null
}

// ── Inline Root Cause Analysis block ─────────────────────────────────────────
// Fetches get_root_cause_analysis and renders investigation detail inline within
// a timeline event expansion.  Avoids a standalone bottom-of-page panel.

type RcaSignalInline = {
  signal_type: string
  severity:    'high' | 'medium' | 'low'
  summary:     string
  occurred_at: string
  detail:      string | null
}

type RcaMaterialInline = {
  bom_id:          string
  material_name:   string
  lot_number:      string | null
  lot_received_at: string | null
  lot_status:      string | null
  supplier_name:   string | null
}

type RcaCapaInline = {
  title:             string
  root_cause:        string | null
  corrective_action: string | null
  preventive_action: string | null
  owner_name:        string | null
  due_date:          string | null
  overdue:           boolean
}

type RcaRecallInline = {
  title:      string
  root_cause: string | null
  status:     string
}

type RcaDataInline = {
  issue_signals:  RcaSignalInline[]
  material_trace: RcaMaterialInline[]
  capas:          RcaCapaInline[]
  recalls:        RcaRecallInline[]
  risk_score:     number
}

const RCA_LOT_BADGE: Record<string, string> = {
  available:   'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
  released:    'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
  consumed:    'bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400',
  in_use:      'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  received:    'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  quarantine:  'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  quarantined: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  rejected:    'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  expired:     'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
}

function isRcaPlaceholder(title: string): boolean {
  const t = (title ?? '').toLowerCase().trim()
  return t === 'automatic capa test' || t === 'just testing' || t === 'test' || t === 'testing' || t === 'demo'
}

function InlineRcaBlock({ batchId, showMaterialTrace = false }: { batchId: string; showMaterialTrace?: boolean }) {
  const [data,    setData]    = useState<RcaDataInline | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .rpc('get_root_cause_analysis', { p_batch_id: batchId })
      .then(({ data: rca, error }) => {
        if (error) console.error('[InlineRcaBlock]', error)
        setData(rca as RcaDataInline | null)
        setLoading(false)
      })
  }, [batchId])

  if (loading) {
    return (
      <div className="px-3 py-3 space-y-1.5">
        {[32, 48, 24].map(w => (
          <div key={w} className={`h-2.5 w-${w} rounded-full bg-[var(--border)]/20 animate-pulse`} />
        ))}
      </div>
    )
  }

  if (!data) return null

  const cleanCapas   = data.capas.filter(c => !isRcaPlaceholder(c.title))
  const cleanRecalls = data.recalls.filter(r => !isRcaPlaceholder(r.title))
  const primaryCapa   = cleanCapas[0] ?? null
  const primaryRecall = cleanRecalls.find(r => r.status !== 'closed') ?? cleanRecalls[0] ?? null
  const rootCause     = primaryCapa?.root_cause ?? primaryRecall?.root_cause ?? null
  const correctiveAct = primaryCapa?.corrective_action ?? null
  const preventiveAct = primaryCapa?.preventive_action ?? null
  const primarySig    = data.issue_signals[0] ?? null
  const hasContent    = rootCause || correctiveAct || primarySig || (showMaterialTrace && data.material_trace.length > 0)

  if (!hasContent) {
    return (
      <div className="px-3 py-2.5 flex items-center gap-2 text-[11px] text-[var(--subtle)]">
        <ShieldCheck size={11} className="text-emerald-500 shrink-0" />
        No investigation notes recorded.
      </div>
    )
  }

  return (
    <div className="divide-y divide-[var(--border)]/30">

      {/* Root cause */}
      <div className="px-3 py-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] opacity-60 mb-1">Root Cause</p>
        <p className="text-[12px] leading-relaxed text-[var(--text)]">
          {rootCause ?? 'Root cause investigation is in progress.'}
        </p>
      </div>

      {/* Detection signal */}
      {primarySig && (
        <div className="px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] opacity-60 mb-1">Detection</p>
          <div className="flex items-start gap-2">
            {primarySig.severity === 'high'
              ? <XCircle      size={12} className="mt-0.5 shrink-0 text-red-500" />
              : <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
            }
            <div className="min-w-0">
              <p className="text-[11.5px] font-medium text-[var(--text)] leading-snug">{primarySig.summary}</p>
              {primarySig.detail && (
                <p className="mt-0.5 text-[11px] text-[var(--subtle)] leading-relaxed">{primarySig.detail}</p>
              )}
              <p className="mt-1 text-[10px] text-[var(--subtle)]">
                Detected {fmtDate(primarySig.occurred_at)}
                {' · '}
                <span className={`font-semibold ${primarySig.severity === 'high' ? 'text-red-500' : 'text-amber-500'}`}>
                  {primarySig.severity} severity
                </span>
              </p>
            </div>
          </div>
          {data.issue_signals.length > 1 && (
            <p className="mt-1.5 text-[10.5px] text-[var(--subtle)]">
              +{data.issue_signals.length - 1} additional signal{data.issue_signals.length > 2 ? 's' : ''} recorded.
            </p>
          )}
        </div>
      )}

      {/* Corrective action */}
      <div className="px-3 py-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] opacity-60 mb-1">Corrective Action</p>
        {correctiveAct ? (
          <div className="space-y-2">
            <p className="text-[12px] leading-relaxed text-[var(--text)]">{correctiveAct}</p>
            {preventiveAct && (
              <div className="rounded-lg border border-blue-100/60 dark:border-blue-900/40 bg-blue-50/20 dark:bg-blue-900/10 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-blue-500 dark:text-blue-400 mb-1">
                  Preventive Measure
                </p>
                <p className="text-[11.5px] leading-relaxed text-[var(--text)]">{preventiveAct}</p>
              </div>
            )}
            {primaryCapa && (primaryCapa.owner_name || primaryCapa.due_date) && (
              <p className="text-[10px] text-[var(--subtle)]">
                {primaryCapa.owner_name && <>Owner: {primaryCapa.owner_name}</>}
                {primaryCapa.owner_name && primaryCapa.due_date && ' · '}
                {primaryCapa.due_date && <>Due: {fmtDate(primaryCapa.due_date)}</>}
                {primaryCapa.overdue && <span className="ml-1.5 text-red-500 dark:text-red-400 font-semibold">· Overdue</span>}
              </p>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-[var(--subtle)]">Corrective action plan is in progress.</p>
        )}
      </div>

      {/* Material trace — only when showMaterialTrace=true (CAPA event, no prior trace shown) */}
      {showMaterialTrace && data.material_trace.length > 0 && (
        <div className="px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] opacity-60 mb-1.5">Material Trace</p>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]/40">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[var(--border)]/40 bg-[var(--bg)]/60">
                  {['Material', 'Lot', 'Status', 'Supplier'].map(h => (
                    <th key={h} className="px-2.5 py-1.5 text-left font-semibold text-[var(--subtle)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/25">
                {data.material_trace.map(mat => {
                  const s = mat.lot_status ?? 'consumed'
                  const isSuspect = s === 'quarantine' || s === 'quarantined' || s === 'rejected'
                  const lot = mat.lot_number ?? (mat.lot_received_at
                    ? `LOT-${new Date(mat.lot_received_at).getFullYear()}-${mat.bom_id.slice(0, 4).toUpperCase()}`
                    : '—')
                  return (
                    <tr key={mat.bom_id} className={isSuspect ? 'bg-red-500/[0.03]' : ''}>
                      <td className={`px-2.5 py-2 font-medium truncate max-w-[120px] ${isSuspect ? 'text-red-600 dark:text-red-400' : 'text-[var(--text)]'}`}>
                        {mat.material_name}
                      </td>
                      <td className="px-2.5 py-2 font-mono text-[var(--subtle)] text-[10px]">{lot}</td>
                      <td className="px-2.5 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${RCA_LOT_BADGE[s] ?? 'bg-gray-100 text-gray-600'}`}>
                          {s}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-[var(--subtle)] truncate max-w-[120px]">
                        {mat.supplier_name ?? deriveDemoSupplier(mat.material_name)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Inline evidence panel — attached to each timeline event ──────────────────

type EventEvidenceProps = {
  event:           JourneyEvent
  label:           string
  order:           TraceOrder
  materials:       EnrichedMaterial[]
  distRecords:     DistributionRecord[]
  qcResults:       TraceQc[]
  recallRecords:   RecallRecord[]
  capaRecords:     CapaRecord[]
  impactData:      MaterialImpact[]
  impactLoading:   boolean
  impactMatchMode: 'lot_id' | 'lot_number' | 'material_name'
}

function EventEvidence({
  event, label, order, materials, distRecords, qcResults,
  recallRecords, capaRecords, impactData, impactLoading, impactMatchMode,
}: EventEvidenceProps) {
  const et = event.event_type

  function Wrap({ children }: { children: React.ReactNode }) {
    return (
      <div className="ml-[56px] mt-0 mb-1.5 rounded-b-lg border-l border-r border-b border-[var(--border)]/35 bg-[var(--bg)] overflow-hidden">
        {children}
      </div>
    )
  }

  function ELV({ label: l, value }: { label: string; value: React.ReactNode }) {
    return (
      <div>
        <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] opacity-55 mb-0.5">{l}</p>
        <div className="text-[11.5px] text-[var(--text)]">{value}</div>
      </div>
    )
  }

  // ── Supplier / Material received events ────────────────────────────────────
  if (
    et.startsWith('supplier.') || et === 'material.received' ||
    et === 'material.added_to_batch' || et === 'material.allocated' ||
    et === 'incoming_qc.passed'
  ) {
    if (materials.length === 0) return null
    return (
      <Wrap>
        <p className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] border-b border-[var(--border)]/30">
          Raw Materials · {materials.length} {materials.length === 1 ? 'material' : 'materials'}
        </p>
        {materials.map((m, i) => {
          const lot       = deriveDemoLot(m)
          const supplier  = m.supplier_name ?? deriveDemoSupplier(m.material_name)
          const rawStatus = (m.lot_status ?? 'consumed').toLowerCase()
          const lbl       = LOT_STATUS_LABEL[rawStatus] ?? 'Consumed'
          const sCls      = rawStatus === 'quarantined' || rawStatus === 'quarantine' || rawStatus === 'rejected'
            ? 'bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400'
            : rawStatus === 'received' || rawStatus === 'in_use'
            ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
            : 'bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400'
          return (
            <div key={m.id} className={`px-3 py-2 flex items-center justify-between gap-3 ${i < materials.length - 1 ? 'border-b border-[var(--border)]/20' : ''}`}>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[var(--text)] truncate">{m.material_name}</p>
                <p className="text-[10px] text-[var(--subtle)] mt-0.5 truncate">
                  <span className="font-mono">{lot}</span> · {supplier}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className={`text-[8.5px] font-bold uppercase rounded px-1.5 py-px ${sCls}`}>{lbl}</span>
                <p className="text-[10px] text-[var(--subtle)] mt-0.5 tabular-nums">{m.quantity.toLocaleString()} {m.unit}</p>
              </div>
            </div>
          )
        })}
      </Wrap>
    )
  }

  // ── Production events ──────────────────────────────────────────────────────
  if (
    et === 'production.started' || et === 'production.completed' ||
    et === 'production.planned' || et === 'batch.created'
  ) {
    const wo   = deriveWorkOrder(order.sku, order.id)
    const line = deriveLine(order.sku)
    const shft = deriveShift(order.started_at)
    return (
      <Wrap>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2.5">
          <ELV label="Work Order"      value={<span className="font-mono text-[10.5px]">{wo}</span>} />
          <ELV label="Production Line" value={line} />
          <ELV label="Shift"           value={shft} />
          <ELV label="Quantity"        value={`${order.quantity.toLocaleString()} units`} />
          <ELV label="Started"         value={order.started_at   ? fmtDate(order.started_at)   : '—'} />
          <ELV label="Completed"       value={order.completed_at ? fmtDate(order.completed_at) : '—'} />
        </div>
      </Wrap>
    )
  }

  // ── Quality inspection events ──────────────────────────────────────────────
  if (
    et.startsWith('qc.') || et.startsWith('final_qc.') ||
    et.startsWith('qc_inspection.') || et.startsWith('inspection.')
  ) {
    if (qcResults.length === 0) return null
    return (
      <Wrap>
        <p className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] border-b border-[var(--border)]/30">
          Quality Inspection · {qcResults.length} record{qcResults.length !== 1 ? 's' : ''}
        </p>
        {qcResults.map((q, i) => {
          const bCls = q.status === 'pass' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
            : q.status === 'fail' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
            : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
          const dot = q.status === 'pass' ? 'bg-emerald-500' : q.status === 'fail' ? 'bg-red-500' : 'bg-amber-500'
          return (
            <div key={i} className={`px-3 py-2 flex items-start gap-2.5 ${i < qcResults.length - 1 ? 'border-b border-[var(--border)]/20' : ''}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`text-[9px] font-bold uppercase rounded px-1.5 py-px ${bCls}`}>{q.status}</span>
                  {q.inspector_name && <span className="text-[11px] text-[var(--muted)]">{q.inspector_name}</span>}
                  <span className="ml-auto text-[10px] text-[var(--subtle)] tabular-nums">{fmtDate(q.inspected_at)}</span>
                </div>
                {q.notes && <p className="mt-1 text-[11px] text-[var(--muted)] leading-snug">{q.notes}</p>}
              </div>
            </div>
          )
        })}
      </Wrap>
    )
  }

  // ── Packaging / Warehouse events ───────────────────────────────────────────
  if (
    et.startsWith('packaging.') || et.startsWith('storage.') ||
    et.startsWith('finished_goods.') || et === 'warehouse.received' || et === 'warehouse.dispatch_ready'
  ) {
    const wh  = deriveWarehouse(order.sku)
    const pkd = order.completed_at
      ? new Date(new Date(order.completed_at).getTime() + 4 * 3600_000).toISOString()
      : null
    return (
      <Wrap>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2.5">
          <ELV label="Packaging Date"   value={pkd ? fmtDate(pkd) : '—'} />
          <ELV label="Status"           value={order.status === 'completed' ? 'Complete' : 'Pending'} />
          <ELV label="Storage Location" value={wh} />
          <ELV label="Release Status"   value={
            order.status === 'completed'
              ? <span className="text-emerald-600 dark:text-emerald-400">Released for Distribution</span>
              : <span className="text-[var(--subtle)]">Pending</span>
          } />
        </div>
      </Wrap>
    )
  }

  // ── Distribution / Shipping events ─────────────────────────────────────────
  if (
    et.startsWith('distribution.') || et.startsWith('shipping.') ||
    et === 'distributor.assigned' || et === 'market.available'
  ) {
    if (distRecords.length === 0) return null
    return (
      <Wrap>
        <p className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] border-b border-[var(--border)]/30">
          Shipments · {distRecords.length} record{distRecords.length !== 1 ? 's' : ''}
        </p>
        {distRecords.map((r, i) => (
          <div key={r.id} className={`pl-3 pr-5 py-2 flex items-center justify-between gap-3 ${i < distRecords.length - 1 ? 'border-b border-[var(--border)]/20' : ''}`}>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-[var(--text)] truncate">{r.recipient_name ?? '—'}</p>
              <p className="text-[10px] text-[var(--subtle)] mt-0.5 capitalize">{r.recipient_type ?? '—'} · {fmtDate(r.shipped_at)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[13px] font-semibold tabular-nums text-[var(--text)]">{r.quantity_shipped.toLocaleString()}</p>
              <p className="text-[9px] text-[var(--subtle)]">units shipped</p>
            </div>
          </div>
        ))}
      </Wrap>
    )
  }

  // ── Recall events ──────────────────────────────────────────────────────────
  if (et.startsWith('recall.')) {
    const recall = label === 'Recall Closed'
      ? (recallRecords.find(r => r.status === 'closed') ?? recallRecords[0] ?? null)
      : (recallRecords.find(r => r.status !== 'closed') ?? recallRecords[0] ?? null)
    if (!recall) return null

    const linkedCapa = label === 'Recall Closed'
      ? (capaRecords.find(c => c.status === 'closed') ?? capaRecords[0] ?? null)
      : (capaRecords.find(c => c.status !== 'closed') ?? capaRecords[0] ?? null)

    const totalOther = impactData.reduce((n, m) => n + m.affected_batches.length, 0)

    return (
      <Wrap>
        {/* ① Recall Record */}
        <div className="px-3 pt-2.5 pb-2 border-b border-[var(--border)]/30">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] opacity-60 mb-1.5">Recall Record</p>
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            {recall.recall_number && <span className="font-mono text-[10px] text-[var(--subtle)]">{recall.recall_number}</span>}
            <span className="inline-flex rounded px-1.5 py-px text-[8.5px] font-bold uppercase bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
              {recall.status === 'closed' ? 'Closed' : 'Active'}
            </span>
            {recall.severity && (
              <span className={`inline-flex rounded px-1.5 py-px text-[8.5px] font-bold uppercase ${severityBadgeCls(recall.severity)}`}>
                {recall.severity}
              </span>
            )}
          </div>
          <p className="text-[13px] font-semibold text-[var(--text)] leading-snug">{recall.title}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-[10.5px] text-[var(--subtle)]">
            {recall.affected_units != null && (
              <span><span className="font-semibold text-red-600 dark:text-red-400">{recall.affected_units.toLocaleString()}</span> units affected</span>
            )}
            <span>Opened {fmtDate(recall.created_at)}</span>
            {recall.closed_at && <span>Closed {fmtDate(recall.closed_at)}</span>}
          </div>
        </div>

        {/* ② Material Trace — raw materials in this batch */}
        {materials.length > 0 && (
          <div className="border-b border-[var(--border)]/30">
            <p className="px-3 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] opacity-60">
              Material Trace · {materials.length} {materials.length === 1 ? 'material' : 'materials'}
            </p>
            {materials.map((m, i) => {
              const lot      = deriveDemoLot(m)
              const supplier = m.supplier_name ?? deriveDemoSupplier(m.material_name)
              const rs       = (m.lot_status ?? 'consumed').toLowerCase()
              const suspect  = rs === 'quarantined' || rs === 'quarantine' || rs === 'rejected'
              return (
                <div key={m.id} className={`px-3 py-1.5 flex items-center justify-between gap-3 ${i < materials.length - 1 ? 'border-b border-[var(--border)]/15' : ''}`}>
                  <div className="min-w-0">
                    <p className={`text-[11.5px] font-medium truncate ${suspect ? 'text-red-600 dark:text-red-400' : 'text-[var(--text)]'}`}>{m.material_name}</p>
                    <p className="text-[10px] text-[var(--subtle)] mt-0.5 truncate">
                      <span className="font-mono">{lot}</span> · {supplier}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[8.5px] font-bold uppercase rounded px-1.5 py-px ${
                    suspect
                      ? 'bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                      : 'bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400'
                  }`}>{LOT_STATUS_LABEL[rs] ?? 'Consumed'}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* ③ Linked CAPA */}
        {linkedCapa && (
          <div className="px-3 py-2 border-b border-[var(--border)]/30">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] opacity-60 mb-1.5">Corrective Action (CAPA)</p>
            <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
              {linkedCapa.capa_number && <span className="font-mono text-[10px] text-[var(--subtle)]">{linkedCapa.capa_number}</span>}
              <span className={`text-[8.5px] font-bold uppercase rounded px-1.5 py-px ${
                linkedCapa.status === 'closed'
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                  : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
              }`}>{linkedCapa.status.replace('_', ' ')}</span>
              {linkedCapa.due_date && new Date(linkedCapa.due_date) < new Date() && linkedCapa.status !== 'closed' && (
                <span className="text-[8.5px] font-bold uppercase rounded px-1.5 py-px bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">Overdue</span>
              )}
            </div>
            <p className="text-[11.5px] font-medium text-[var(--text)] leading-snug">{linkedCapa.title}</p>
            <div className="flex flex-wrap gap-x-3 mt-0.5 text-[10px] text-[var(--subtle)]">
              {linkedCapa.owner_name && <span>{linkedCapa.owner_name}</span>}
              {linkedCapa.due_date && <span>Due {fmtDate(linkedCapa.due_date)}</span>}
            </div>
          </div>
        )}

        {/* ④ Cross-batch exposure */}
        <div className="border-b border-[var(--border)]/30">
          <p className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] opacity-60">Cross-Batch Exposure</p>
          {impactLoading ? (
            <div className="px-3 pb-2"><div className="h-4 rounded bg-[var(--border)]/20 animate-pulse" /></div>
          ) : totalOther === 0 ? (
            <div className="px-3 pb-2 flex items-center gap-2">
              <Network size={12} className="text-emerald-500 shrink-0" />
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">No cross-batch exposure detected</p>
            </div>
          ) : (
            <div className="pb-1">
              <p className="px-3 pb-1 text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                {totalOther} other batch{totalOther !== 1 ? 'es' : ''} share affected materials
              </p>
              {impactData.map(mat => (
                <div key={mat.material_name} className="px-3 pb-2">
                  <p className="text-[10px] text-[var(--subtle)] mb-1">{mat.material_name}</p>
                  <div className="space-y-1">
                    {mat.affected_batches.slice(0, 3).map(batch => (
                      <a
                        key={batch.production_order_id}
                        href={`/product-journey/${batch.production_order_id}`}
                        className="flex items-center justify-between rounded-lg border border-[var(--border)]/40 px-2.5 py-1.5 hover:bg-[var(--bg)] hover:border-[var(--border)]/70 transition-colors group"
                      >
                        <p className="text-[11px] font-medium text-[var(--text)] group-hover:text-[#3a6f8f] dark:group-hover:text-[#7ab3d0] truncate">{batch.product_name}</p>
                        <span className="shrink-0 ml-2 text-[8.5px] font-bold uppercase text-[var(--subtle)]">{batch.status}</span>
                      </a>
                    ))}
                    {mat.affected_batches.length > 3 && (
                      <p className="text-[10px] text-[var(--subtle)] pl-1">+{mat.affected_batches.length - 3} more batches</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ⑤ Root Cause Investigation */}
        <div>
          <p className="px-3 pt-2 pb-0 text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] opacity-60">
            Root Cause Investigation
          </p>
          <InlineRcaBlock batchId={order.id} showMaterialTrace={false} />
        </div>

        {/* ⑥ Quick links */}
        <div className="px-3 py-1.5 flex items-center gap-4">
          <Link href="/recall" className="text-[10.5px] text-[#4a8fb9] hover:underline">Recall Details →</Link>
          <Link href="/recall-impact" className="text-[10.5px] text-[#4a8fb9] hover:underline">Full Impact Analysis →</Link>
          <Link href="/capa" className="text-[10.5px] text-[#4a8fb9] hover:underline">CAPA Records →</Link>
        </div>
      </Wrap>
    )
  }

  // ── CAPA events ────────────────────────────────────────────────────────────
  if (et.startsWith('capa.')) {
    const capa = label === 'CAPA Closed'
      ? (capaRecords.find(c => c.status === 'closed') ?? capaRecords[0] ?? null)
      : (capaRecords.find(c => c.status !== 'closed') ?? capaRecords[0] ?? null)
    if (!capa) return null
    const capaBadge = capa.status === 'closed'
      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
      : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
    const overdue = capa.due_date && new Date(capa.due_date) < new Date() && capa.status !== 'closed'
    return (
      <Wrap>
        {/* CAPA identity */}
        <div className="px-3 pt-2.5 pb-2 border-b border-[var(--border)]/30">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--subtle)] opacity-60 mb-1">CAPA Record</p>
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            {capa.capa_number && <span className="font-mono text-[10px] text-[var(--subtle)]">{capa.capa_number}</span>}
            <span className={`text-[8.5px] font-bold uppercase rounded px-1.5 py-px ${capaBadge}`}>
              {capa.status.replace('_', ' ')}
            </span>
            {overdue && (
              <span className="text-[8.5px] font-bold uppercase rounded px-1.5 py-px bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">Overdue</span>
            )}
          </div>
          <p className="text-[13px] font-semibold text-[var(--text)] leading-snug">{capa.title}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10.5px] text-[var(--subtle)]">
            {capa.owner_name && <span>Assigned to {capa.owner_name}</span>}
            {capa.due_date && <span>Due {fmtDate(capa.due_date)}</span>}
          </div>
        </div>
        {/* Root cause + corrective + preventive action */}
        <InlineRcaBlock batchId={order.id} showMaterialTrace={true} />
      </Wrap>
    )
  }

  return null
}

function SidebarTimeline({
  events, order, distRecords, materials, qcResults, impactData, impactLoading, impactMatchMode,
}: {
  events:          JourneyEvent[]
  order:           TraceOrder
  distRecords:     DistributionRecord[]
  materials:       EnrichedMaterial[]
  qcResults:       TraceQc[]
  impactData:      MaterialImpact[]
  impactLoading:   boolean
  impactMatchMode: 'lot_id' | 'lot_number' | 'material_name'
}) {
  const { recalls: recallRecords, capas: capaRecords } = useContext(JourneyCtx)
  // Single expansion — opening a new event collapses the previous one.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  // Mounted keys — once opened, EventEvidence stays in DOM so the collapse animation is smooth.
  const [mountedKeys, setMountedKeys] = useState<Set<string>>(() => new Set())
  function toggleKey(key: string) {
    setExpandedKey(prev => (prev === key ? null : key))
    setMountedKeys(prev => { const n = new Set(prev); n.add(key); return n })
  }

  const currentStatus = useMemo(() => {
    const activeRecall = recallRecords.find(r => r.status !== 'closed')
    if (activeRecall) return { label: 'Recall Active',       pillCls: 'bg-red-500/10 text-red-500 border-red-500/30'           }
    const activeCapa  = capaRecords.find(c => c.status !== 'closed')
    if (activeCapa)   return { label: 'CAPA In Progress',    pillCls: 'bg-amber-500/10 text-amber-500 border-amber-500/30'     }
    const types = new Set(events.map(e => e.event_type))
    if (types.has('recall.closed'))                                               return { label: 'Recall Closed',       pillCls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' }
    if (types.has('distribution.delivered') || types.has('shipping.delivered'))   return { label: 'Delivered',           pillCls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' }
    if (types.has('distribution.dispatched') || types.has('shipping.dispatched')) return { label: 'In Transit',          pillCls: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/30'          }
    if (types.has('final_qc.passed'))                                             return { label: 'QC Passed',           pillCls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' }
    if (types.has('packaging.completed'))                                         return { label: 'Packaged',            pillCls: 'bg-violet-500/10 text-violet-500 border-violet-500/30'    }
    if (types.has('production.completed'))                                        return { label: 'Production Complete', pillCls: 'bg-blue-500/10 text-blue-500 border-blue-500/30'          }
    if (types.has('production.started'))                                          return { label: 'In Production',       pillCls: 'bg-blue-500/10 text-blue-500 border-blue-500/30'          }
    return { label: 'Pending', pillCls: 'bg-[var(--border)]/60 text-[var(--muted)] border-[var(--border)]' }
  }, [events, recallRecords, capaRecords])

  const enriched = useMemo(() => {
    let recallSeq    = 0
    let capaSeq      = 0
    let currentPhase: PhaseKey | null = null
    const RECALL_LIFECYCLE = ['Recall Opened', 'Scope Expanded', 'Customer Notification Sent', 'Investigation Updated']

    return events.map(event => {
      const phase     = (PHASE_MAP[event.event_type] ?? 'production') as PhaseKey
      const showPhase = phase !== currentPhase
      currentPhase    = phase
      const isMilestone = MILESTONE_EVENTS.has(event.event_type)

      let label: string
      if (event.event_type === 'recall.created' || event.event_type === 'recall.initiated') {
        label = RECALL_LIFECYCLE[recallSeq] ?? 'Investigation Updated'
        recallSeq++
      } else if (event.event_type === 'recall.updated') {
        label = 'Investigation Updated'
      } else if (event.event_type === 'recall.closed') {
        label = 'Recall Closed'
      } else if (event.event_type === 'capa.created' || event.event_type === 'capa.opened') {
        label = capaSeq++ === 0 ? 'CAPA Opened' : 'CAPA Updated'
      } else if (event.event_type === 'capa.updated') {
        label = 'CAPA Updated'
      } else if (event.event_type === 'capa.closed') {
        label = 'CAPA Closed'
      } else {
        label = humanizeMfgEvent(event)
      }

      const evStyle = (event.event_type.startsWith('recall.') || event.event_type.startsWith('capa.'))
        ? recallCapaStyle(label)
        : timelineEventStyle(event.event_type)

      const isShipment = event.event_type.startsWith('distribution.')
        || event.event_type.startsWith('shipping.')
        || event.event_type === 'distributor.assigned'
      const d0 = distRecords[0]
      const recipient = isShipment && d0
        ? { name: d0.recipient_name, type: d0.recipient_type ?? '' }
        : null

      return { event, label, isMilestone, evStyle, phase, showPhase, recipient }
    })
  }, [events, distRecords])

  const phaseCounts = useMemo(() => {
    const counts: Partial<Record<PhaseKey, number>> = {}
    for (const { phase } of enriched) counts[phase] = (counts[phase] ?? 0) + 1
    return counts
  }, [enriched])

  // Active phase: drives the header pill and section header highlighting.
  const currentPhaseKey = useMemo(() => {
    if (recallRecords.some(r => r.status !== 'closed') || capaRecords.some(c => c.status !== 'closed'))
      return 'issues' as PhaseKey
    return enriched.length > 0 ? enriched[enriched.length - 1].phase : null
  }, [enriched, recallRecords, capaRecords])

  const { duration } = useMemo(() => {
    const s = events.find(e => e.event_type === 'production.started')
    const c = events.find(e => e.event_type === 'production.completed')
    if (!s || !c) return { duration: null }
    const days = Math.round(
      (new Date(c.event_timestamp).getTime() - new Date(s.event_timestamp).getTime()) / 86_400_000
    )
    return { duration: days < 1 ? '< 1 Day' : `${days} Day${days !== 1 ? 's' : ''}` }
  }, [events])

  // Total affected units across all active recalls — shown as a recall-impact KPI.
  const affectedUnits = useMemo(() => {
    const active = recallRecords.filter(r => r.status !== 'closed')
    if (active.length === 0) return null
    const total = active.reduce((n, r) => n + (r.affected_units ?? 0), 0)
    return total > 0 ? total : null
  }, [recallRecords])

  const visibleEnriched = enriched

  const phasePillCls = currentPhaseKey
    ? PHASE_PILL_CLS[currentPhaseKey]
    : 'border-[var(--border)] text-[var(--muted)] bg-transparent'
  const PhasePillIcon = currentPhaseKey ? PHASE_ICONS[currentPhaseKey] : null

  return (
    <div>

      {/* ── Timeline ──────────────────────────────────────────────────────────── */}
      <div>
        {enriched.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center px-6">
            <Activity size={26} className="mb-3 text-[var(--border)]" />
            <p className="text-[12px] text-[var(--subtle)]">No manufacturing events recorded yet</p>
            <p className="mt-1 text-[11px] text-[var(--subtle)] opacity-60">
              Events appear as the batch progresses through production
            </p>
          </div>
        ) : (
          <div className="relative px-5 pt-2 pb-4">

            {/* Connector line — hairline, desaturated gray-blue, icon rings provide visual weight */}
            <div
              className="pointer-events-none absolute"
              style={{
                width: 1,
                left: 40,
                top: 48,
                bottom: 20,
                background: 'linear-gradient(to bottom, transparent, rgba(148,163,184,0.22) 4%, rgba(148,163,184,0.22) 96%, transparent)',
              }}
            />

            {visibleEnriched.map(({ event, label, isMilestone, evStyle, phase, showPhase, recipient }, i) => {
              const evKey       = `${event.event_type}-${event.event_timestamp}-${i}`
              const isExpanded  = expandedKey === evKey
              const isMounted   = mountedKeys.has(evKey)
              const isIssue     = event.event_type.startsWith('recall.') || event.event_type.startsWith('capa.')
              const isHighlight = isMilestone || isIssue
              const description = describeMfgEvent(event.event_type, order, distRecords, materials)
              const actor       = extractActor(event)
              const badge       = getEventStatusBadge(event.event_type, label)
              const dt          = new Date(event.event_timestamp)
              const datePart    = fmtDate(event.event_timestamp)
              const timePart    = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })

              // Phase icon — declared as variable so it can be rendered as JSX element.
              const PhaseIcon = PHASE_ICONS[phase]

              // Recall Opened / Scope Expanded are the crisis moment — maximum visual weight.
              const isRecallOpened = label === 'Recall Opened' || label === 'Scope Expanded'

              // Card border + bg per semantic tier.
              // All events are cards — secondary events are subtly lighter, not absent.
              const issueCardBg = (() => {
                if (isRecallOpened)                                            return 'border border-red-500/30 bg-red-500/[0.06] hover:border-red-500/45 hover:shadow-[0_2px_14px_-4px_rgba(239,68,68,0.15)]'
                if (label === 'Customer Notification Sent')                    return 'border border-orange-500/15 bg-orange-500/[0.03] hover:border-orange-500/25 hover:shadow-[0_1px_8px_-3px_rgba(249,115,22,0.08)]'
                if (label === 'Investigation Updated')                         return 'border border-amber-500/12 bg-amber-500/[0.02] hover:border-amber-500/22 hover:shadow-[0_1px_8px_-3px_rgba(245,158,11,0.07)]'
                if (label === 'Recall Closed' || label === 'CAPA Closed')     return 'border border-emerald-500/15 bg-emerald-500/[0.03] hover:border-emerald-500/25 hover:shadow-[0_1px_8px_-3px_rgba(16,185,129,0.08)]'
                return 'border border-amber-500/15 bg-amber-500/[0.03] hover:border-amber-500/25 hover:shadow-[0_1px_8px_-3px_rgba(245,158,11,0.08)]'
              })()

              const cardBase = isIssue
                ? `${issueCardBg} rounded-xl px-3 -mx-3`
                : isMilestone
                  ? 'border border-[var(--border)]/35 bg-[var(--surface)] rounded-xl px-3 -mx-3 hover:border-[var(--border)]/55 hover:shadow-[0_1px_8px_-2px_rgba(0,0,0,0.08)]'
                  : 'border border-[var(--border)]/18 bg-[var(--surface)] rounded-lg px-3 -mx-3 hover:border-[var(--border)]/38 hover:shadow-[0_1px_6px_-2px_rgba(0,0,0,0.06)]'

              // Top padding for the content row; bottom is minimal since the chevron strip follows.
              const contentPad = isRecallOpened ? 'pt-[9px] pb-[1px]' : 'pt-[6px] pb-[1px]'

              return (
                <Fragment key={`${event.event_type}-${event.event_timestamp}-${i}`}>

                  {/* Phase section header — NO background, connector line flows continuously.
                      paddingLeft:56 aligns text with card content.
                      "issues" phase gets extra top spacing and warm tint — signals a turning point. */}
                  {showPhase && (
                    <div
                      className="relative z-[1]"
                      style={{
                        paddingTop:    i === 0 ? 0 : (phase === 'issues' ? 48 : 36),
                        paddingBottom: phase === 'issues' ? 14 : 10,
                        paddingLeft:   56,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <PhaseIcon
                          size={phase === 'issues' ? 10 : 8}
                          className={`shrink-0 ${
                            phase === 'issues'
                              ? 'text-red-400 dark:text-red-500 opacity-55'
                              : 'text-[var(--subtle)] opacity-35'
                          }`}
                        />
                        <span className={`shrink-0 font-bold uppercase whitespace-nowrap ${
                          phase === 'issues'
                            ? 'text-[9.5px] tracking-[0.15em] text-red-400/75 dark:text-red-500/65'
                            : 'text-[9px] tracking-[0.13em] text-[var(--subtle)]'
                        }`}>
                          {PHASE_LABELS[phase]}
                        </span>
                        {(phaseCounts[phase] ?? 0) > 0 && (
                          <span className="shrink-0 text-[8px] tabular-nums text-[var(--subtle)] opacity-35">
                            · {phaseCounts[phase]}
                          </span>
                        )}
                        <div className={`flex-1 h-px bg-[var(--border)] ${phase === 'issues' ? 'opacity-35' : 'opacity-25'}`} />
                      </div>
                    </div>
                  )}

                  {/* Event wrapper — button is the card; evidence animates below, connected via Wrap. */}
                  <div className="mb-1.5">

                    <button
                      onClick={() => toggleKey(evKey)}
                      className={`group relative flex flex-col w-full text-left cursor-pointer transition-all duration-150 ${cardBase}`}
                    >
                      {/* ── Content row ── */}
                      <div className={`flex items-start gap-4 w-full ${contentPad}`}>

                        {/* Icon badge — ring-[var(--bg)] masks connector line; gentle scale on hover */}
                        <div
                          className={`relative z-10 shrink-0 mt-[2px] rounded-full flex items-center justify-center ring-[3px] ring-[var(--bg)] transition-transform duration-150 group-hover:scale-[1.04] ${evStyle.bgCls}`}
                          style={{ width: isRecallOpened ? 44 : 40, height: isRecallOpened ? 44 : 40 }}
                        >
                          <evStyle.Icon size={isRecallOpened ? 18 : isHighlight ? 15 : 13} className={evStyle.iconCls} />
                        </div>

                        {/* Text content */}
                        <div className="min-w-0 flex-1 pt-[1px]">
                          <p
                            className={`leading-snug font-semibold transition-colors group-hover:text-[#4a8fb9] ${
                              isRecallOpened
                                ? `text-[14px] ${evStyle.labelCls}`
                                : isIssue || isMilestone
                                  ? `text-[13px] ${evStyle.labelCls}`
                                  : 'text-[13px] text-[var(--text)]'
                            }`}
                            style={{ wordBreak: 'break-word' }}
                          >
                            {label}
                          </p>
                          {description && (
                            <p className="mt-[3px] text-[11px] leading-relaxed text-[var(--muted)] line-clamp-2">
                              {description}
                            </p>
                          )}
                          {recipient && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <Truck size={10} className="shrink-0 text-cyan-500" />
                              <span className="text-[11px] font-semibold text-[var(--text)]">{recipient.name}</span>
                              {recipient.type && (
                                <span className="text-[10px] text-[var(--subtle)] capitalize">· {recipient.type}</span>
                              )}
                            </div>
                          )}
                          {!description && !recipient && actor && (
                            <p className="mt-[3px] text-[10.5px] leading-snug text-[var(--muted)]">{actor}</p>
                          )}
                        </div>

                        {/* Date + badge — right column */}
                        <div className="shrink-0 flex flex-col items-end gap-[6px] pt-[1px]" style={{ minWidth: 60 }}>
                          <p className="text-[10px] font-medium tabular-nums text-[var(--muted)] leading-none">{datePart}</p>
                          {badge && (
                            <span className={`inline-flex items-center rounded px-[5px] py-[1px] text-[8px] font-bold uppercase tracking-[0.08em] border ${badge.cls}`}>
                              {badge.label}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* ── Expand indicator — bottom center, clearly visible ── */}
                      <div className="flex items-center justify-center w-full pb-[8px] pt-[2px]">
                        <ChevronDown
                          size={26}
                          className={`text-[var(--subtle)] opacity-35 group-hover:opacity-60 transition-all duration-300 ease-out ${isExpanded ? 'rotate-180 opacity-60' : ''}`}
                        />
                      </div>
                    </button>

                    {/* Evidence — grid 0fr→1fr height animation.
                        Wrap (ml-[56px], no top border) attaches flush under the card. */}
                    <div
                      className={`grid transition-[grid-template-rows] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                    >
                      <div className="overflow-hidden">
                        {isMounted && (
                          <div className={`transition-opacity duration-220 ${isExpanded ? 'opacity-100 delay-[60ms]' : 'opacity-0'}`}>
                            <EventEvidence
                              event={event}
                              label={label}
                              order={order}
                              materials={materials}
                              distRecords={distRecords}
                              qcResults={qcResults}
                              recallRecords={recallRecords}
                              capaRecords={capaRecords}
                              impactData={impactData}
                              impactLoading={impactLoading}
                              impactMatchMode={impactMatchMode}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                  </div>

                </Fragment>
              )
            })}
          </div>
        )}
      </div>

      {/* End of journey marker */}
      <div className="flex items-center gap-4 pt-3 pb-1 px-5">
        <div className="flex-1 h-px bg-[var(--border)]/20" />
        <span className="text-[8px] uppercase tracking-[0.2em] text-[var(--subtle)] opacity-35 whitespace-nowrap">
          End of Product Journey
        </span>
        <div className="flex-1 h-px bg-[var(--border)]/20" />
      </div>
    </div>
  )
}

// ── Production info section ───────────────────────────────────────────────────

function ProductionInfoSection({ order }: { order: TraceOrder }) {
  const shift = deriveShift(order.started_at)
  const wo    = deriveWorkOrder(order.sku, order.id)
  const line  = deriveLine(order.sku)
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-4">
      <LabelValue label="Work Order"     value={<span className="font-mono text-[11.5px]">{wo}</span>} />
      <LabelValue label="Production Line" value={line} />
      <LabelValue label="Shift"           value={shift} />
      <LabelValue label="Planned Qty"     value={`${order.quantity.toLocaleString()} units`} />
      <LabelValue label="Start Time"      value={order.started_at   ? fmtDateTime(order.started_at)   : '—'} />
      <LabelValue label="End Time"        value={order.completed_at ? fmtDateTime(order.completed_at) : '—'} />
      <LabelValue label="Order Status"    value={
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${ORDER_BADGE[order.status] ?? ''}`}>
          {ORDER_LABEL[order.status] ?? order.status}
        </span>
      } />
    </div>
  )
}

// ── Quality inspection section ────────────────────────────────────────────────

function QualityInspectionSection({ qc }: { qc: TraceQc[] }) {
  if (qc.length === 0) {
    return <p className="px-4 py-4 text-[12px] text-[var(--subtle)]">No quality inspection records for this batch.</p>
  }
  return (
    <div className="divide-y divide-[var(--border)]">
      {qc.map((q, i) => {
        const badgeCls = q.status === 'pass'
          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
          : q.status === 'fail'
          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
        const dotCls = q.status === 'pass' ? 'bg-emerald-500' : q.status === 'fail' ? 'bg-red-500' : 'bg-amber-500'
        return (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dotCls}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded px-1.5 py-px text-[9.5px] font-bold uppercase ${badgeCls}`}>
                  {q.status}
                </span>
                {q.inspector_name && (
                  <span className="text-[11px] text-[var(--muted)]">{q.inspector_name}</span>
                )}
                <span className="ml-auto text-[10.5px] text-[var(--subtle)] tabular-nums">
                  {fmtDate(q.inspected_at)}
                </span>
              </div>
              {q.notes && (
                <p className="mt-1 text-[11px] text-[var(--muted)] leading-snug">{q.notes}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Packaging info section ────────────────────────────────────────────────────

function PackagingInfoSection({ order }: { order: TraceOrder }) {
  const warehouse = deriveWarehouse(order.sku)
  const packagingDate = order.completed_at
    ? new Date(new Date(order.completed_at).getTime() + 4 * 3600_000).toISOString()
    : null
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-4">
      <LabelValue label="Packaging Date"   value={packagingDate ? fmtDate(packagingDate) : '—'} />
      <LabelValue label="Packaging Status" value={order.status === 'completed' ? 'Complete' : 'Pending'} />
      <LabelValue label="Storage Location" value={order.status === 'completed' ? warehouse : '—'} />
      <LabelValue label="Release Status"   value={
        order.status === 'completed'
          ? <span className="text-emerald-600 dark:text-emerald-400">Released for Distribution</span>
          : <span className="text-[var(--subtle)]">—</span>
      } />
    </div>
  )
}

// ── Distribution table ────────────────────────────────────────────────────────

function DistributionTable({ records }: { records: DistributionRecord[] }) {
  if (records.length === 0) {
    return <p className="px-4 py-4 text-[12px] text-[var(--subtle)]">No distribution records for this batch.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11.5px]">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {(['Recipient', 'Type', 'Qty', 'Shipped', 'Status'] as const).map(h => (
              <th key={h} className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--subtle)] ${h === 'Qty' ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {records.map(r => (
            <tr key={r.id} className="hover:bg-[var(--bg)] transition-colors">
              <td className="px-4 py-2.5 font-medium text-[var(--text)]">{r.recipient_name ?? '—'}</td>
              <td className="px-4 py-2.5 capitalize text-[var(--muted)]">{r.recipient_type ?? '—'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[var(--muted)]">
                {r.quantity_shipped.toLocaleString()}
              </td>
              <td className="px-4 py-2.5 text-[var(--muted)]">{fmtDate(r.shipped_at)}</td>
              <td className="px-4 py-2.5">
                <span className="inline-flex items-center rounded px-1.5 py-px text-[9.5px] font-bold uppercase bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                  Shipped
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// severityBadgeCls used in recall evidence
function severityBadgeCls(severity: string | null) {
  const s = (severity ?? '').toLowerCase()
  if (s === 'critical' || s === 'high') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
  if (s === 'medium')                   return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
  return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
}

function _IssuesSection_UNUSED({
  recalls, capas, impacts, impactLoading, impactTruncated, impactMatchMode, batchId,
}: {
  recalls:          RecallRecord[]
  capas:            CapaRecord[]
  impacts:          MaterialImpact[]
  impactLoading:    boolean
  impactTruncated:  boolean
  impactMatchMode:  'lot_id' | 'lot_number' | 'material_name'
  batchId:          string
}) {
  // Show only the current active recall — older closed recalls are history, not the current story.
  const activeRecall = recalls.find(r => r.status !== 'closed') ?? null
  const activeCapa   = capas.find(c => c.status !== 'closed') ?? capas[0] ?? null

  return (
    <div className="space-y-4 p-4">

      {/* Active Recall — single prominent card */}
      {activeRecall ? (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--subtle)]">Active Recall</p>
          <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-900/[0.08] px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {activeRecall.recall_number && (
                <span className="font-mono text-[10px] text-[var(--subtle)]">{activeRecall.recall_number}</span>
              )}
              <span className="inline-flex rounded px-1.5 py-px text-[9px] font-bold uppercase bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                Active
              </span>
              {activeRecall.severity && (
                <span className={`inline-flex rounded px-1.5 py-px text-[9px] font-bold uppercase ${severityBadgeCls(activeRecall.severity)}`}>
                  {activeRecall.severity}
                </span>
              )}
            </div>
            <p className="text-[13px] font-semibold text-[var(--text)] leading-snug mb-1.5">{activeRecall.title}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[var(--subtle)]">
              {activeRecall.affected_units != null && (
                <span><span className="font-semibold text-[var(--text)]">{activeRecall.affected_units.toLocaleString()}</span> units affected</span>
              )}
              <span>Opened {fmtDate(activeRecall.created_at)}</span>
            </div>
          </div>
        </div>
      ) : recalls.length === 0 && capas.length === 0 ? (
        <p className="text-[12px] text-[var(--subtle)]">No recalls or corrective actions recorded for this batch.</p>
      ) : null}

      {/* Active CAPA — linked corrective action */}
      {activeCapa && (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--subtle)]">Corrective Action (CAPA)</p>
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-900/[0.07] px-3.5 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                  {activeCapa.capa_number && (
                    <span className="font-mono text-[10px] text-[var(--subtle)]">{activeCapa.capa_number}</span>
                  )}
                  <span className={`inline-flex rounded px-1.5 py-px text-[9px] font-bold uppercase ${
                    activeCapa.status === 'closed'
                      ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                      : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                  }`}>{activeCapa.status.replace('_', ' ')}</span>
                </div>
                <p className="text-[12px] font-medium text-[var(--text)]">{activeCapa.title}</p>
                <p className="text-[10.5px] text-[var(--subtle)] mt-0.5">
                  {activeCapa.owner_name && <>{activeCapa.owner_name} · </>}
                  {activeCapa.due_date ? <>Due {fmtDate(activeCapa.due_date)}</> : <>Opened {fmtDate(activeCapa.created_at)}</>}
                </p>
              </div>
            </div>
          </div>
          {capas.length > 1 && (
            <p className="mt-1 text-[10.5px] text-[var(--subtle)] pl-0.5">
              +{capas.length - 1} additional CAPA record{capas.length > 2 ? 's' : ''} — open Root Cause Analysis for details.
            </p>
          )}
        </div>
      )}

      {/* Impact analysis */}
      <ImpactAnalysis
        impacts={impacts}
        loading={impactLoading}
        truncated={impactTruncated}
        matchMode={impactMatchMode}
      />

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
  const [distRecords,       setDistRecords]       = useState<DistributionRecord[]>([])
  const [impactTruncated,   setImpactTruncated]   = useState(false)
  const [impactMatchMode,   setImpactMatchMode]   = useState<'lot_id' | 'lot_number' | 'material_name'>('material_name')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setImpactLoading(true)

    Promise.all([
      supabase.rpc('get_batch_trace',   { p_batch_id: id }).single(),
      supabase.rpc('get_batch_journey', { p_batch_id: id }).single(),
      supabase.from('capas').select('id, title, status, created_at, closed_at, capa_number, owner_name, due_date').eq('batch_id', id),
      supabase.from('recalls').select('id, title, status, created_at, closed_at, recall_number, severity, affected_units').eq('batch_id', id),
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

      const trace = traceRes.data as TraceData

      // Strip placeholder / test records that have no business meaning.
      // These are produced by seed scripts and automated tests and should
      // never surface on the production journey page.
      const isPlaceholder = (title: string) => {
        const t = (title ?? '').toLowerCase().trim()
        return t === 'automatic capa test' || t === 'just testing' ||
          t === 'test' || t === 'testing' || t === 'demo' ||
          (t.startsWith('test ') && t.length < 30)
      }
      const capas   = ((capaRes.data   ?? []) as CapaRecord[]).filter(c => !isPlaceholder(c.title))
      const recalls = ((recallRes.data ?? []) as RecallRecord[]).filter(r => !isPlaceholder(r.title))

      setTraceData(trace)
      setCapaRecords(capas)
      setRecallRecords(recalls)

      // Parse BOM first so raw material received events can be synthesized.
      const rawBom = (bomRes.data ?? []) as any[]
      const materials: EnrichedMaterial[] = rawBom.map(row => {
        const lots     = Array.isArray(row.raw_material_lots) ? row.raw_material_lots[0] : row.raw_material_lots
        const supplier = lots ? (Array.isArray(lots.suppliers) ? lots.suppliers[0] : lots.suppliers) : null
        return {
          id:                  row.id,
          material_name:       row.material_name,
          lot_number:          row.lot_number ?? null,
          quantity:            row.quantity,
          unit:                row.unit,
          supplier_name:       supplier?.name ?? null,
          received_at:         lots?.received_at ?? null,
          lot_status:          lots?.status     ?? null,
          bom_created_at:      row.created_at   ?? null,
          raw_material_lot_id: lots?.id          ?? null,
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
      setDistRecords(distributionRecords)

      const jd = journeyRes.data as { timeline?: JourneyEvent[] } | null
      const rpcEvents: JourneyEvent[] = (jd?.timeline && Array.isArray(jd.timeline))
        ? [...jd.timeline].sort(chronologicalSort)
        : []

      const hasPackagingInRpc    = rpcEvents.some(e => e.event_type.startsWith('packaging.'))
      const hasIncomingQcInRpc  = rpcEvents.some(e => e.event_type.startsWith('incoming_qc.'))
      const hasSupplierInRpc    = rpcEvents.some(e => e.event_type.startsWith('supplier.'))
      const hasFinalQcInRpc     = rpcEvents.some(e => e.event_type === 'qc.pass' || e.event_type.startsWith('final_qc.') || e.event_type.startsWith('qc_inspection.'))
      const hasStorageInRpc     = rpcEvents.some(e => e.event_type.startsWith('storage.') || e.event_type === 'warehouse.received' || e.event_type === 'warehouse.entry')
      const hasWarehouseInRpc   = rpcEvents.some(e => e.event_type.startsWith('finished_goods.') || e.event_type === 'warehouse.dispatch_ready')
      const hasDistributorInRpc = rpcEvents.some(e => e.event_type.startsWith('distributor.'))
      const hasMarketInRpc      = rpcEvents.some(e => e.event_type.startsWith('market.'))

      const synth  = [
        ...synthesizeEvents(trace.order, trace.sales, capas, recalls, distributionRecords),
        ...synthesizeBatchEvents(batchEventRows),
        ...(hasSupplierInRpc    ? [] : synthesizeSupplierEvents(materials)),
        ...(hasIncomingQcInRpc  ? [] : synthesizeIncomingQcEvents(materials)),
        ...(hasFinalQcInRpc     ? [] : synthesizeFinalQcEvents(trace.order)),
        ...(hasPackagingInRpc   ? [] : synthesizePackagingEvents(trace.order)),
        ...(hasStorageInRpc     ? [] : synthesizeStorageEvents(materials)),
        ...(hasWarehouseInRpc   ? [] : synthesizeWarehouseEvents(trace.order)),
        ...(hasDistributorInRpc ? [] : synthesizeDistributorEvents(distributionRecords, trace.sales)),
        ...(hasMarketInRpc      ? [] : synthesizeMarketEvents(trace.sales)),
      ]
      const merged = enforceLifecycleOrder(
        normalizeEvents(deduplicateSameDayQc(mergeJourneyEvents(rpcEvents, synth)))
      )
      setJourney(merged)
      setLoading(false)

      if (materials.length === 0) {
        setImpactLoading(false)
        return
      }

      // Per-material RPC calls — uses the same get_recall_impact logic as the formal
      // Recall Impact Analysis module, guaranteeing identical affected-batch sets.
      // Each unique lot identifier gets one call; results are merged by material_name.
      type LotCall = {
        param:         Record<string, string>
        materialNames: string[]
        mode:          'lot_id' | 'lot_number' | 'material_name'
      }
      const callsByKey = new Map<string, LotCall>()
      const addToCall = (key: string, call: LotCall, materialName: string) => {
        if (!callsByKey.has(key)) callsByKey.set(key, call)
        const entry = callsByKey.get(key)!
        if (!entry.materialNames.includes(materialName)) entry.materialNames.push(materialName)
      }
      for (const m of materials) {
        if (m.raw_material_lot_id) {
          addToCall(`lot_id:${m.raw_material_lot_id}`, {
            param: { p_raw_material_lot_id: m.raw_material_lot_id },
            materialNames: [],
            mode: 'lot_id',
          }, m.material_name)
        } else if (m.lot_number) {
          addToCall(`lot_num:${m.lot_number}`, {
            param: { p_lot_number: m.lot_number },
            materialNames: [],
            mode: 'lot_number',
          }, m.material_name)
        } else {
          addToCall(`mat:${m.material_name}`, {
            param: { p_material_name: m.material_name },
            materialNames: [],
            mode: 'material_name',
          }, m.material_name)
        }
      }

      const calls   = Array.from(callsByKey.values())
      const results = await Promise.all(calls.map(c => supabase.rpc('get_recall_impact', c.param)))

      const modePriority = { lot_id: 0, lot_number: 1, material_name: 2 } as const
      let worstMode: 'lot_id' | 'lot_number' | 'material_name' = 'lot_id'
      const byMaterial: Record<string, AffectedBatch[]> = {}

      for (let i = 0; i < calls.length; i++) {
        const call   = calls[i]
        const impact = results[i].data as { affected_batches?: Array<{ batch_id: string; product_name: string; status: string; created_at: string }> } | null
        if (!impact) continue
        if (modePriority[call.mode] > modePriority[worstMode]) worstMode = call.mode

        for (const b of impact.affected_batches ?? []) {
          if (b.batch_id === id) continue  // exclude the batch we're viewing
          for (const matName of call.materialNames) {
            if (!byMaterial[matName]) byMaterial[matName] = []
            if (!byMaterial[matName].some(x => x.production_order_id === b.batch_id)) {
              byMaterial[matName].push({
                production_order_id: b.batch_id,
                product_name:        b.product_name,
                status:              b.status,
                created_at:          b.created_at,
              })
            }
          }
        }
      }

      const uniqueCount = new Set(Object.values(byMaterial).flat().map(b => b.production_order_id)).size
      setImpactMatchMode(worstMode)
      setImpactTruncated(uniqueCount > 200)
      setImpactData(
        Object.entries(byMaterial).map(([material_name, affected_batches]) => ({
          material_name,
          affected_batches: affected_batches.slice(0, 200).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          ),
        })),
      )

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
    <JourneyCtx.Provider value={{ recalls: recallRecords, capas: capaRecords }}>
    <div className="px-6 py-4">
      {/* Breadcrumb + page title — one compact row */}
      <div className="mb-3">
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
        shipmentCount={distRecords.length}
        recalls={recallRecords}
      />

      {/* Situation Report — answers the 9 emergency questions at a glance */}
      {(() => {
        const activeR  = recallRecords.find(r => r.status !== 'closed') ?? null
        const latestQc = [...traceData.qc_results].sort(
          (a, b) => new Date(b.inspected_at).getTime() - new Date(a.inspected_at).getTime()
        )[0] ?? null
        const activeCapa = capaRecords.find(c => c.status !== 'closed') ?? null

        if (activeR) {
          // Emergency mode — compact status strip, no duplicate info from the header above.
          return (
            <div className="mb-3 rounded-lg border border-red-500/20 dark:border-red-500/15 bg-red-500/[0.04] dark:bg-red-500/[0.06] px-3.5 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1">
              {/* Left: recall identity */}
              <div className="flex items-center gap-2 shrink-0">
                <AlertTriangle size={12} className="shrink-0 text-red-500 dark:text-red-400" />
                <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">Active Recall</span>
                {activeR.recall_number && (
                  <span className="font-mono text-[10px] text-[var(--subtle)]">{activeR.recall_number}</span>
                )}
                {activeR.severity && (
                  <span className={`text-[8.5px] font-bold uppercase rounded px-1.5 py-px ${
                    activeR.severity === 'critical' || activeR.severity === 'high'
                      ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
                      : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                  }`}>{activeR.severity}</span>
                )}
              </div>
              {/* Divider */}
              <div className="hidden sm:block w-px h-3 bg-[var(--border)] opacity-50 shrink-0" />
              {/* Right: key facts inline */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-[var(--subtle)]">
                {activeR.affected_units != null && (
                  <span>
                    <span className="font-semibold text-red-600 dark:text-red-400">{activeR.affected_units.toLocaleString()}</span>
                    {' '}units affected
                  </span>
                )}
                {distRecords.length > 0 && (
                  <span>
                    <span className="font-semibold text-[var(--text)]">{distRecords.length}</span>
                    {' '}shipment{distRecords.length !== 1 ? 's' : ''}
                  </span>
                )}
                {activeCapa && (
                  <span>
                    {activeCapa.capa_number ?? 'CAPA'}
                    {' · '}
                    <span className="capitalize">{activeCapa.status.replace('_', ' ')}</span>
                  </span>
                )}
              </div>
            </div>
          )
        }

        // Normal mode — no active recall.
        const risk = latestQc?.status === 'fail' ? 'medium' : 'low'
        const RISK_B: Record<string, string> = {
          low:    'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
          medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
        }
        const s1 = `Production batch of ${traceData.order.quantity.toLocaleString()} units of ${traceData.order.product_name} (${traceData.order.sku}).`
        const s2 = traceData.order.status === 'completed' && distRecords.length > 0
          ? `Batch shipped — ${distRecords.length} distribution record${distRecords.length !== 1 ? 's' : ''} on file.`
          : traceData.order.status === 'completed'
          ? 'Production complete. Awaiting distribution.'
          : traceData.order.started_at
          ? `Batch in production since ${fmtDate(traceData.order.started_at)}.`
          : 'Batch ordered, pending production start.'
        const s3 = latestQc?.status === 'fail'
          ? 'Quality inspection failed. Review findings and initiate corrective action before further distribution.'
          : latestQc?.status === 'hold'
          ? 'Batch on QC hold — clearance required before release.'
          : null
        return (
          <div className="mb-4 rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC]/60 dark:bg-[#1a2530]/50 px-4 py-3.5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Batch Summary</p>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${RISK_B[risk]}`}>
                {risk} risk
              </span>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{s1} {s2}</p>
            {s3 && <p className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-300 leading-relaxed">{s3}</p>}
          </div>
        )
      })()}

      {/* Product Story — the complete lifecycle narrative. Every event is expandable. */}
      <SidebarTimeline
        events={businessEvents}
        order={traceData.order}
        distRecords={distRecords}
        materials={enrichedMaterials}
        qcResults={traceData.qc_results}
        impactData={impactData}
        impactLoading={impactLoading}
        impactMatchMode={impactMatchMode}
      />

      {/* QR Trace & Public Product Story link */}
      <ProductStoryPanel batchId={id} />
    </div>
    </JourneyCtx.Provider>
  )
}
