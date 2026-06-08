'use client'

import { Fragment, useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { classifyEvent } from '../trace/[id]/eventCategories'
import {
  Search, Package, Layers, ShieldCheck, Truck, ClipboardList,
  FileWarning, RefreshCw, X, Activity, Loader2,
  User, Calendar, Hash, BarChart3, GitBranch, AlertTriangle,
  ArrowUpRight, ChevronDown, CheckCircle2,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type BatchResult = {
  id:           string
  product_name: string
  sku:          string
  status:       string
  quantity:     number
  created_at:   string
}

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

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function fmtDateTime(iso: string): string {
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

function computeCompletion(
  events:   JourneyEvent[],
  order:    TraceOrder,
  salesLen: number,
): number {
  if (order.status === 'cancelled') return 0
  const groups = new Set(events.map(e => classifyEvent(e.event_type).stageGroup))
  let pct = 0
  if (groups.has('materials'))                         pct += 20
  if (groups.has('production'))                        pct += 30
  if (groups.has('quality'))                           pct += 25
  if (groups.has('distribution') || salesLen > 0)     pct += 25
  if (pct === 0 && order.status === 'in_progress')    pct  = 15
  if (pct === 0 && order.status === 'completed')      pct  = 80
  return Math.min(pct, 100)
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
  { key: 'materials',    label: 'Raw Materials', dot: 'bg-orange-400', text: 'text-orange-500 dark:text-orange-400' },
  { key: 'production',   label: 'Production',    dot: 'bg-blue-500',   text: 'text-blue-600 dark:text-blue-400'    },
  { key: 'quality',      label: 'Quality Control', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'distribution', label: 'Distribution',  dot: 'bg-teal-500',   text: 'text-teal-600 dark:text-teal-400'   },
] as const

function StageFlow({ events }: { events: JourneyEvent[] }) {
  const present = new Set(events.map(e => classifyEvent(e.event_type).stageGroup))
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5">
      {STAGES.map((s, i) => {
        const has = present.has(s.key)
        return (
          <Fragment key={s.key}>
            <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 shadow-sm transition-opacity ${has ? 'border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800/60' : 'border-dashed border-gray-200 dark:border-gray-700 bg-transparent opacity-40'}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot} ${has ? '' : 'opacity-50'}`} />
              <span className={`text-[10px] font-bold uppercase tracking-wider ${s.text} ${has ? '' : 'opacity-60'}`}>{s.label}</span>
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
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
            {catLabel}
          </span>
        </div>

        {event.description && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{event.description}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">
            {fmtDateTime(event.event_timestamp)}
          </span>
          {actor && (
            <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-300">
              <User size={9} />
              {actor}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Journey timeline skeleton ─────────────────────────────────────────────────

function TimelineSkeleton() {
  return (
    <div className="space-y-0">
      {[65, 80, 55, 70].map((w, i) => (
        <div key={i} className="flex gap-3 mb-3">
          <div className="flex shrink-0 flex-col items-center" style={{ width: 36 }}>
            <div className="mt-0.5 h-9 w-9 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
            {i < 3 && <div className="mt-1 w-0.5 flex-1 bg-gray-200 dark:bg-gray-700" style={{ minHeight: 40 }} />}
          </div>
          <div className="flex-1 rounded-xl border border-gray-100 dark:border-gray-700/60 border-l-2 border-l-gray-200 dark:border-l-gray-700 bg-white dark:bg-gray-800/60 px-3.5 py-3 shadow-sm space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="h-3.5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" style={{ width: `${w}%` }} />
              <div className="h-4 w-20 shrink-0 rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />
            </div>
            <div className="h-2.5 w-4/5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="h-2 w-1/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Journey health panel ──────────────────────────────────────────────────────

function HealthRow({
  label, value, valueClass,
}: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 dark:border-gray-700/60 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`text-sm font-semibold ${valueClass ?? 'text-gray-900 dark:text-white'}`}>{value}</span>
    </div>
  )
}

function HealthPanel({
  order, qcResults, events, sales, capaCount, recallCount,
}: {
  order:       TraceOrder
  qcResults:   TraceQc[]
  events:      JourneyEvent[]
  sales:       TraceSale[]
  capaCount:   number
  recallCount: number
}) {
  const completion  = computeCompletion(events, order, sales.length)
  const latestQc    = qcResults[0] ?? null
  const openIssues  = qcResults.filter(r => r.status === 'fail').length
  const stageLabel  = ORDER_LABEL[order.status] ?? order.status.replace(/_/g, ' ')
  const qcLabel     = latestQc ? QC_LABEL[latestQc.status] : 'No inspections'
  const qcTextClass = latestQc ? QC_TEXT[latestQc.status] : 'text-gray-400 dark:text-gray-500'

  return (
    <div className="space-y-4">
      {/* Completion card */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Journey Completion
          </span>
          <span className="text-lg font-bold text-gray-900 dark:text-white">{completion}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${completion === 100 ? 'bg-emerald-500' : completion >= 50 ? 'bg-blue-500' : 'bg-amber-400'}`}
            style={{ width: `${completion}%` }}
          />
        </div>
        {completion === 100 && (
          <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={11} />
            Complete lifecycle recorded
          </p>
        )}
      </div>

      {/* Status card */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Journey Health
        </p>
        <HealthRow label="Current Stage"   value={stageLabel} />
        <HealthRow label="Quality Status"  value={qcLabel} valueClass={qcTextClass} />
        <HealthRow
          label="Open Issues"
          value={openIssues > 0 ? `${openIssues} failed QC` : 'None'}
          valueClass={openIssues > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}
        />
        <HealthRow
          label="CAPAs Linked"
          value={String(capaCount)}
          valueClass={capaCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}
        />
        <HealthRow
          label="Recalls Linked"
          value={String(recallCount)}
          valueClass={recallCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}
        />
      </div>

      {/* Traceability links */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Navigate To
        </p>
        <div className="space-y-0.5">
          {[
            { label: 'Production Orders',  href: '/production',      icon: ClipboardList },
            { label: 'Quality Control',    href: '/quality-control', icon: ShieldCheck   },
            { label: 'CAPA Center',        href: '/capa',            icon: FileWarning   },
            { label: 'Recall Center',      href: '/recall',          icon: AlertTriangle },
          ].map(({ label, href, icon: Icon }) => (
            <a
              key={href}
              href={href}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/40 hover:text-gray-900 dark:hover:text-white transition-colors group"
            >
              <span className="flex items-center gap-2">
                <Icon size={13} className="shrink-0" />
                {label}
              </span>
              <ArrowUpRight size={12} className="opacity-0 group-hover:opacity-60 transition-opacity" />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Batch header ──────────────────────────────────────────────────────────────

function BatchHeader({
  order, qcResults, materials, sales,
}: {
  order:     TraceOrder
  qcResults: TraceQc[]
  materials: TraceMaterial[]
  sales:     TraceSale[]
}) {
  const latestQc = qcResults[0] ?? null

  return (
    <div className="mb-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      {/* Top row: product name + badges */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
            {order.product_name}
          </h2>
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

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-gray-50 dark:bg-gray-700/40 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
            <Calendar size={9} />Production Date
          </p>
          <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(order.created_at)}</p>
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-gray-700/40 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
            <Hash size={9} />Batch Quantity
          </p>
          <p className="text-sm font-bold text-gray-900 dark:text-white">{order.quantity.toLocaleString()} units</p>
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-gray-700/40 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
            <Layers size={9} />Raw Materials
          </p>
          <p className="text-sm font-bold text-gray-900 dark:text-white">{materials.length}</p>
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-gray-700/40 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
            <Truck size={9} />Distribution
          </p>
          <p className="text-sm font-bold text-gray-900 dark:text-white">
            {sales.length} {sales.length === 1 ? 'shipment' : 'shipments'}
          </p>
        </div>
      </div>

      {/* Batch reference */}
      <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2">
        <Hash size={11} className="shrink-0 text-gray-400" />
        <span className="text-[10px] text-gray-400 mr-1.5">Batch Reference</span>
        <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400 break-all">···{order.id.slice(-16)}</span>
      </div>
    </div>
  )
}

// ── Traceability summary ──────────────────────────────────────────────────────

function TraceabilitySummary({
  qcResults, materials, sales, events,
}: {
  qcResults: TraceQc[]
  materials: TraceMaterial[]
  sales:     TraceSale[]
  events:    JourneyEvent[]
}) {
  const groups = new Set(events.map(e => classifyEvent(e.event_type).stageGroup))

  const items = [
    { icon: Layers,       label: 'Raw Materials',    value: materials.length,  color: 'text-orange-600 dark:text-orange-400' },
    { icon: ShieldCheck,  label: 'QC Inspections',   value: qcResults.length,  color: 'text-emerald-600 dark:text-emerald-400' },
    { icon: Truck,        label: 'Distributions',    value: sales.length,      color: 'text-teal-600 dark:text-teal-400' },
    { icon: Activity,     label: 'Journey Events',   value: events.length,     color: 'text-blue-600 dark:text-blue-400' },
    { icon: GitBranch,    label: 'Stages Covered',   value: groups.size,       color: 'text-violet-600 dark:text-violet-400' },
  ] as const

  return (
    <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-5">
      {items.map(({ icon: Icon, label, value, color }) => (
        <div
          key={label}
          className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-center shadow-sm"
        >
          <div className="flex justify-center mb-1">
            <Icon size={14} className={color} />
          </div>
          <p className={`text-xl font-bold leading-tight ${color}`}>{value}</p>
          <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">{label}</p>
        </div>
      ))}
    </div>
  )
}

// ── Search bar ────────────────────────────────────────────────────────────────

function BatchSearchBar({
  batches,
  query,
  onQueryChange,
  onSelect,
  loading,
}: {
  batches:       BatchResult[]
  query:         string
  onQueryChange: (q: string) => void
  onSelect:      (b: BatchResult) => void
  loading:       boolean
}) {
  const [open, setOpen] = useState(false)
  const ref             = useRef<HTMLDivElement>(null)

  const filtered = batches.filter(b => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      b.product_name.toLowerCase().includes(q) ||
      b.sku.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q)
    )
  }).slice(0, 8)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative max-w-2xl">
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 shadow-sm focus-within:border-[#3a6f8f] focus-within:ring-2 focus-within:ring-[#3a6f8f]/20 transition-all">
        {loading ? (
          <Loader2 size={16} className="shrink-0 animate-spin text-gray-400" />
        ) : (
          <Search size={16} className="shrink-0 text-gray-400" />
        )}
        <input
          type="text"
          placeholder="Search by product name, SKU, or batch ID…"
          value={query}
          onChange={e => { onQueryChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => { onQueryChange(''); setOpen(false) }}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden">
          {filtered.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => { onSelect(b); setOpen(false); onQueryChange(b.product_name) }}
              className={`w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors ${i < filtered.length - 1 ? 'border-b border-gray-100 dark:border-gray-700/60' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{b.product_name}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate">
                  {b.sku} · ···{b.id.slice(-8)}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <span className="text-[10px] text-gray-400">{fmtDate(b.created_at)}</span>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${ORDER_BADGE[b.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {ORDER_LABEL[b.status] ?? b.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({
  batches, onSelect,
}: {
  batches:  BatchResult[]
  onSelect: (b: BatchResult) => void
}) {
  const recent = batches.slice(0, 6)

  if (recent.length === 0) {
    return (
      <div className="mt-16 flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
          <Package size={28} className="text-gray-300 dark:text-gray-600" />
        </div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">No production batches found</h3>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 max-w-xs">
          Create a production order to start tracking product journeys end-to-end.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        Recent Batches
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {recent.map(b => (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelect(b)}
            className="text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm hover:border-[#3a6f8f]/50 hover:shadow-md transition-all group"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight group-hover:text-[#3a6f8f] transition-colors">
                {b.product_name}
              </p>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${ORDER_BADGE[b.status] ?? 'bg-gray-100 text-gray-600'}`}>
                {ORDER_LABEL[b.status] ?? b.status}
              </span>
            </div>
            <p className="font-mono text-[11px] text-gray-400 dark:text-gray-500">{b.sku} · {b.quantity.toLocaleString()} units</p>
            <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{fmtDate(b.created_at)}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ProductJourneyClient() {
  const { companyId } = useAuth()

  const [batches,       setBatches]       = useState<BatchResult[]>([])
  const [batchLoading,  setBatchLoading]  = useState(false)
  const [searchQuery,   setSearchQuery]   = useState('')
  const [selectedId,    setSelectedId]    = useState<string | null>(null)
  const [traceData,     setTraceData]     = useState<TraceData | null>(null)
  const [journey,       setJourney]       = useState<JourneyEvent[]>([])
  const [dataLoading,   setDataLoading]   = useState(false)
  const [capaCount,     setCapaCount]     = useState(0)
  const [recallCount,   setRecallCount]   = useState(0)

  // Load recent batches
  const loadBatches = useCallback(async () => {
    if (!companyId) return
    setBatchLoading(true)
    const { data } = await supabase
      .from('production_orders')
      .select('id, quantity, status, created_at, products(name, sku)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (data) {
      type Row = {
        id: string; quantity: number; status: string; created_at: string
        products: { name: string; sku: string } | { name: string; sku: string }[] | null
      }
      setBatches(
        (data as unknown as Row[]).map(r => {
          const prod = Array.isArray(r.products) ? r.products[0] : r.products
          return {
            id:           r.id,
            product_name: prod?.name ?? 'Unknown Product',
            sku:          prod?.sku  ?? '—',
            status:       r.status,
            quantity:     r.quantity,
            created_at:   r.created_at,
          }
        })
      )
    }
    setBatchLoading(false)
  }, [companyId])

  useEffect(() => { loadBatches() }, [loadBatches])

  // Load batch journey data
  const loadBatchData = useCallback(async (batchId: string) => {
    setDataLoading(true)
    setTraceData(null)
    setJourney([])
    setCapaCount(0)
    setRecallCount(0)

    const [traceRes, journeyRes, capaRes, recallRes] = await Promise.all([
      supabase.rpc('get_batch_trace', { p_batch_id: batchId }).single(),
      supabase.rpc('get_batch_journey', { p_batch_id: batchId }).single(),
      supabase.from('capas').select('id', { count: 'exact', head: true }).eq('batch_id', batchId),
      supabase.from('recalls').select('id', { count: 'exact', head: true }).eq('batch_id', batchId),
    ])

    if (traceRes.data)  setTraceData(traceRes.data as TraceData)
    if (journeyRes.data) {
      const jd = journeyRes.data as { timeline?: JourneyEvent[] }
      if (Array.isArray(jd.timeline)) {
        const sorted = [...jd.timeline].sort(
          (a, b) =>
            new Date(a.event_timestamp).getTime() -
            new Date(b.event_timestamp).getTime(),
        )
        setJourney(sorted)
      }
    }
    setCapaCount(capaRes.count ?? 0)
    setRecallCount(recallRes.count ?? 0)
    setDataLoading(false)
  }, [])

  function handleSelect(b: BatchResult) {
    setSelectedId(b.id)
    setSearchQuery(b.product_name)
    loadBatchData(b.id)
  }

  function handleClear() {
    setSelectedId(null)
    setTraceData(null)
    setJourney([])
    setSearchQuery('')
    setCapaCount(0)
    setRecallCount(0)
  }

  const hasBatch = !!selectedId && !!traceData

  return (
    <div className="px-6 py-5">
      {/* Page header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Product Journey</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Trace any batch from raw material receipt to final distribution
          </p>
        </div>
        {hasBatch && (
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors shadow-sm"
          >
            <X size={13} />
            Clear
          </button>
        )}
      </div>

      {/* Search bar */}
      <div className="mb-5">
        <BatchSearchBar
          batches={batches}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onSelect={handleSelect}
          loading={batchLoading}
        />
      </div>

      {/* Main content */}
      {hasBatch ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: timeline + header */}
          <div className="lg:col-span-8">
            <BatchHeader
              order={traceData.order}
              qcResults={traceData.qc_results}
              materials={traceData.materials}
              sales={traceData.sales}
            />

            <TraceabilitySummary
              qcResults={traceData.qc_results}
              materials={traceData.materials}
              sales={traceData.sales}
              events={journey}
            />

            {/* Timeline section */}
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-700 px-4 py-3">
                <Activity size={15} className="text-gray-400 dark:text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Product Journey Timeline</h2>
                {!dataLoading && journey.length > 0 && (
                  <span className="ml-auto rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                    {journey.length} events
                  </span>
                )}
              </div>

              <div className="px-4 py-4">
                {dataLoading ? (
                  <TimelineSkeleton />
                ) : journey.length === 0 ? (
                  <div className="py-8 text-center">
                    <Activity size={32} className="mx-auto mb-3 text-gray-200 dark:text-gray-700" />
                    <p className="text-sm text-gray-400 dark:text-gray-500">No journey events recorded for this batch.</p>
                    <p className="mt-1 text-xs text-gray-300 dark:text-gray-600">
                      Events appear as production, QC, and distribution activities are recorded.
                    </p>
                  </div>
                ) : (
                  <div>
                    <StageFlow events={journey} />
                    {journey.map((event, i) => (
                      <TimelineEvent
                        key={`${event.event_type}-${event.event_timestamp}-${i}`}
                        event={event}
                        isLast={i === journey.length - 1}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: health panel */}
          <div className="lg:col-span-4">
            {dataLoading ? (
              <div className="space-y-4">
                {[120, 200, 180].map((h, i) => (
                  <div key={i} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 animate-pulse" style={{ height: h }} />
                ))}
              </div>
            ) : (
              <HealthPanel
                order={traceData.order}
                qcResults={traceData.qc_results}
                events={journey}
                sales={traceData.sales}
                capaCount={capaCount}
                recallCount={recallCount}
              />
            )}
          </div>
        </div>
      ) : dataLoading ? (
        <div className="mt-16 flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-[#3a6f8f]" />
          <p className="text-sm text-gray-400 dark:text-gray-500">Loading batch journey…</p>
        </div>
      ) : (
        <EmptyState batches={batches} onSelect={handleSelect} />
      )}
    </div>
  )
}
