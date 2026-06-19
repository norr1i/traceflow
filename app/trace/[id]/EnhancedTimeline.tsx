import { Fragment, useState } from 'react'
import {
  Layers, ClipboardList, ShieldCheck, Truck, FileWarning, Activity,
  ChevronRight, Award, Microscope, Box,
  Archive, Warehouse, Store, TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import {
  classifyEvent, STAGE_META,
  type EventCategory, type StageGroup,
} from './eventCategories'

// ── Types ───────────────────────────────────────────────────────────────────

export type JourneyEvent = {
  event_type:      string
  event_timestamp: string
  title:           string
  description:     string | null
  source_table:    string
  metadata:        Record<string, unknown> | null
}

export type DistributionRecord = {
  customer_name: string | null
  quantity:      number
  sold_at:       string
}

// ── Constants ────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  production_orders:    'Production',
  bill_of_materials:    'Materials',
  batch_qc_results:     'QC Results',
  quality_inspections:  'QC Inspection',
  distribution_records: 'Distribution',
  batch_journey_events: 'Journey Log',
  raw_materials:        'Raw Materials',
}

const STAGE_ICONS: Record<StageGroup, LucideIcon> = {
  supplier:     Award,
  materials:    Layers,
  incoming_qc:  Microscope,
  storage:      Archive,
  production:   ClipboardList,
  quality:      ShieldCheck,
  packaging:    Box,
  warehouse:    Warehouse,
  distribution: Truck,
  distributor:  Store,
  market:       TrendingUp,
  compliance:   FileWarning,
  other:        Activity,
}

// Stage color definitions — kept inline so Tailwind includes all classes
const STAGE_COLORS: Record<StageGroup, {
  bg: string; border: string; text: string; subtext: string
  dotColor: string; connectorBg: string; iconBg: string; iconColor: string
}> = {
  supplier: {
    bg:          'bg-indigo-50 dark:bg-indigo-900/10',
    border:      'border-indigo-200 dark:border-indigo-800/30',
    text:        'text-indigo-700 dark:text-indigo-400',
    subtext:     'text-indigo-500 dark:text-indigo-500',
    dotColor:    'bg-indigo-400',
    connectorBg: 'bg-indigo-200 dark:bg-indigo-800/40',
    iconBg:      'bg-indigo-100 dark:bg-indigo-900/30',
    iconColor:   'text-indigo-600 dark:text-indigo-400',
  },
  materials: {
    bg:          'bg-orange-50 dark:bg-orange-900/10',
    border:      'border-orange-200 dark:border-orange-800/30',
    text:        'text-orange-700 dark:text-orange-400',
    subtext:     'text-orange-500 dark:text-orange-500',
    dotColor:    'bg-orange-400',
    connectorBg: 'bg-orange-200 dark:bg-orange-800/40',
    iconBg:      'bg-orange-100 dark:bg-orange-900/30',
    iconColor:   'text-orange-600 dark:text-orange-400',
  },
  incoming_qc: {
    bg:          'bg-yellow-50 dark:bg-yellow-900/10',
    border:      'border-yellow-200 dark:border-yellow-800/30',
    text:        'text-yellow-700 dark:text-yellow-400',
    subtext:     'text-yellow-500 dark:text-yellow-500',
    dotColor:    'bg-yellow-500',
    connectorBg: 'bg-yellow-200 dark:bg-yellow-800/40',
    iconBg:      'bg-yellow-100 dark:bg-yellow-900/30',
    iconColor:   'text-yellow-600 dark:text-yellow-400',
  },
  production: {
    bg:          'bg-blue-50 dark:bg-blue-900/10',
    border:      'border-blue-200 dark:border-blue-800/30',
    text:        'text-blue-700 dark:text-blue-400',
    subtext:     'text-blue-500 dark:text-blue-500',
    dotColor:    'bg-blue-500',
    connectorBg: 'bg-blue-200 dark:bg-blue-800/40',
    iconBg:      'bg-blue-100 dark:bg-blue-900/30',
    iconColor:   'text-blue-600 dark:text-blue-400',
  },
  packaging: {
    bg:          'bg-cyan-50 dark:bg-cyan-900/10',
    border:      'border-cyan-200 dark:border-cyan-800/30',
    text:        'text-cyan-700 dark:text-cyan-400',
    subtext:     'text-cyan-500 dark:text-cyan-500',
    dotColor:    'bg-cyan-500',
    connectorBg: 'bg-cyan-200 dark:bg-cyan-800/40',
    iconBg:      'bg-cyan-100 dark:bg-cyan-900/30',
    iconColor:   'text-cyan-600 dark:text-cyan-400',
  },
  quality: {
    bg:          'bg-emerald-50 dark:bg-emerald-900/10',
    border:      'border-emerald-200 dark:border-emerald-800/30',
    text:        'text-emerald-700 dark:text-emerald-400',
    subtext:     'text-emerald-500 dark:text-emerald-500',
    dotColor:    'bg-emerald-500',
    connectorBg: 'bg-emerald-200 dark:bg-emerald-800/40',
    iconBg:      'bg-emerald-100 dark:bg-emerald-900/30',
    iconColor:   'text-emerald-600 dark:text-emerald-400',
  },
  distribution: {
    bg:          'bg-teal-50 dark:bg-teal-900/10',
    border:      'border-teal-200 dark:border-teal-800/30',
    text:        'text-teal-700 dark:text-teal-400',
    subtext:     'text-teal-500 dark:text-teal-500',
    dotColor:    'bg-teal-500',
    connectorBg: 'bg-teal-200 dark:bg-teal-800/40',
    iconBg:      'bg-teal-100 dark:bg-teal-900/30',
    iconColor:   'text-teal-600 dark:text-teal-400',
  },
  compliance: {
    bg:          'bg-purple-50 dark:bg-purple-900/10',
    border:      'border-purple-200 dark:border-purple-800/30',
    text:        'text-purple-700 dark:text-purple-400',
    subtext:     'text-purple-500 dark:text-purple-500',
    dotColor:    'bg-purple-500',
    connectorBg: 'bg-purple-200 dark:bg-purple-800/40',
    iconBg:      'bg-purple-100 dark:bg-purple-900/30',
    iconColor:   'text-purple-600 dark:text-purple-400',
  },
  storage: {
    bg:          'bg-stone-50 dark:bg-stone-900/20',
    border:      'border-stone-200 dark:border-stone-700/40',
    text:        'text-stone-700 dark:text-stone-400',
    subtext:     'text-stone-500 dark:text-stone-500',
    dotColor:    'bg-stone-500',
    connectorBg: 'bg-stone-200 dark:bg-stone-700',
    iconBg:      'bg-stone-100 dark:bg-stone-800/40',
    iconColor:   'text-stone-600 dark:text-stone-400',
  },
  warehouse: {
    bg:          'bg-sky-50 dark:bg-sky-900/10',
    border:      'border-sky-200 dark:border-sky-800/30',
    text:        'text-sky-700 dark:text-sky-400',
    subtext:     'text-sky-500 dark:text-sky-500',
    dotColor:    'bg-sky-500',
    connectorBg: 'bg-sky-200 dark:bg-sky-800/40',
    iconBg:      'bg-sky-100 dark:bg-sky-900/30',
    iconColor:   'text-sky-600 dark:text-sky-400',
  },
  distributor: {
    bg:          'bg-violet-50 dark:bg-violet-900/10',
    border:      'border-violet-200 dark:border-violet-800/30',
    text:        'text-violet-700 dark:text-violet-400',
    subtext:     'text-violet-500 dark:text-violet-500',
    dotColor:    'bg-violet-500',
    connectorBg: 'bg-violet-200 dark:bg-violet-800/40',
    iconBg:      'bg-violet-100 dark:bg-violet-900/30',
    iconColor:   'text-violet-600 dark:text-violet-400',
  },
  market: {
    bg:          'bg-rose-50 dark:bg-rose-900/10',
    border:      'border-rose-200 dark:border-rose-800/30',
    text:        'text-rose-700 dark:text-rose-400',
    subtext:     'text-rose-500 dark:text-rose-500',
    dotColor:    'bg-rose-500',
    connectorBg: 'bg-rose-200 dark:bg-rose-800/40',
    iconBg:      'bg-rose-100 dark:bg-rose-900/30',
    iconColor:   'text-rose-600 dark:text-rose-400',
  },
  other: {
    bg:          'bg-gray-50 dark:bg-gray-800/40',
    border:      'border-gray-200 dark:border-gray-700',
    text:        'text-gray-600 dark:text-gray-400',
    subtext:     'text-gray-400 dark:text-gray-500',
    dotColor:    'bg-gray-400',
    connectorBg: 'bg-gray-200 dark:bg-gray-700',
    iconBg:      'bg-gray-100 dark:bg-gray-700/40',
    iconColor:   'text-gray-500 dark:text-gray-400',
  },
}

const LIFECYCLE_ORDER: StageGroup[] = [
  'supplier', 'materials', 'incoming_qc', 'storage',
  'production', 'quality', 'packaging', 'warehouse',
  'distribution', 'distributor', 'market',
  'compliance', 'other',
]

// Stages included in the "always show" flow — distribution is always rendered
const ALWAYS_SHOW: Set<StageGroup> = new Set(['distribution'])

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSourceLabel(s: string): string {
  return SOURCE_LABELS[s] ?? s.replace(/_/g, ' ')
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function extractActor(event: JourneyEvent): string | null {
  const m = event.metadata
  if (!m) return null
  if (typeof m.inspector_name === 'string' && m.inspector_name) return m.inspector_name
  if (typeof m.performed_by   === 'string' && m.performed_by)   return m.performed_by
  if (typeof m.created_by     === 'string' && m.created_by)     return m.created_by
  if (typeof m.user_name      === 'string' && m.user_name)      return m.user_name
  if (typeof m.inspector_id   === 'string' && m.inspector_id)
    return `Inspector ···${m.inspector_id.slice(-6)}`
  return null
}

// ── Stage flow header ─────────────────────────────────────────────────────────
// Pills at the top showing the lifecycle. Distribution is always included.

function StageFlowHeader({
  presentStages,
}: {
  presentStages: Set<StageGroup>
}) {
  const stages = LIFECYCLE_ORDER.filter(
    s => s !== 'other' && s !== 'compliance',
  )

  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5">
      {stages.map((stage, i) => {
        const meta    = STAGE_META[stage]
        const hasData = presentStages.has(stage)
        return (
          <Fragment key={stage}>
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 border shadow-sm transition-opacity ${
                hasData
                  ? 'border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800/60'
                  : 'border-dashed border-gray-200 dark:border-gray-700 bg-transparent opacity-40'
              }`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dotColor} ${hasData ? '' : 'opacity-50'}`} />
              <span className={`text-[10px] font-bold uppercase tracking-wider ${meta.textColor} ${hasData ? '' : 'opacity-60'}`}>
                {meta.label}
              </span>
            </div>
            {i < stages.length - 1 && (
              <span className="text-[10px] text-gray-300 dark:text-gray-600 select-none">→</span>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

// ── Stage header card ─────────────────────────────────────────────────────────
// A prominent checkpoint card marking each manufacturing stage.

function StageHeader({
  group,
  eventCount,
  isFirst,
  prevConnectorBg,
  isExpanded,
  onToggle,
}: {
  group:            StageGroup
  eventCount:       number
  isFirst:          boolean
  prevConnectorBg?: string
  isExpanded:       boolean
  onToggle:         () => void
}) {
  const sc   = STAGE_COLORS[group]
  const Icon = STAGE_ICONS[group]

  return (
    <div className="flex gap-3">
      {/* Left column: bridge connector + diamond dot */}
      <div className="flex shrink-0 flex-col items-center" style={{ width: 36 }}>
        {!isFirst && (
          <div
            className={`w-0.5 ${prevConnectorBg ?? 'bg-gray-200 dark:bg-gray-700'}`}
            style={{ height: 16 }}
          />
        )}
        <div
          className={`h-3.5 w-3.5 rotate-45 shrink-0 rounded-sm border-2 border-white dark:border-gray-900 shadow-sm ${sc.dotColor}`}
        />
        <div
          className={`mt-1 w-0.5 flex-1 ${sc.connectorBg}`}
          style={{ minHeight: 12 }}
        />
      </div>

      {/* Stage header card — clickable to expand/collapse */}
      <button
        type="button"
        onClick={onToggle}
        className={`flex-1 flex items-center justify-between gap-3 rounded-xl px-4 py-3 mb-3 ${sc.bg} border ${sc.border} text-left cursor-pointer transition-all duration-150 hover:brightness-[1.02] active:scale-[0.995]`}
      >
        {/* Left: icon + label */}
        <div className="flex items-center gap-2.5">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${sc.iconBg}`}>
            <Icon size={14} className={sc.iconColor} />
          </div>
          <p className={`text-xs font-bold uppercase tracking-widest ${sc.text}`}>
            {STAGE_META[group].label}
          </p>
        </div>
        {/* Right: event count + chevron */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] font-medium ${sc.subtext}`}>
            {eventCount > 0
              ? `${eventCount} event${eventCount !== 1 ? 's' : ''}`
              : group === 'distribution' ? 'No records' : ''}
          </span>
          <ChevronRight
            size={13}
            className={`${sc.text} opacity-60 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
          />
        </div>
      </button>
    </div>
  )
}

// ── Attribution chip ──────────────────────────────────────────────────────────

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 text-[10px] font-medium">
      <span className="text-gray-400 dark:text-gray-500">{label}</span>
      <span className="text-gray-600 dark:text-gray-300">{value}</span>
    </span>
  )
}

// ── Event card ────────────────────────────────────────────────────────────────

function EventCard({
  event,
  category,
  isLastInTimeline,
  stageConnectorBg,
}: {
  event:            JourneyEvent
  category:         EventCategory
  isLastInTimeline: boolean
  stageConnectorBg: string
}) {
  const [showDetails, setShowDetails] = useState(false)
  const actor  = extractActor(event)
  const source = getSourceLabel(event.source_table)
  const { Icon, iconBg, iconColor, badgeClass, borderAccent, label: categoryLabel } = category

  return (
    <div className="flex gap-3 group">
      {/* Left column: icon + connector */}
      <div className="flex shrink-0 flex-col items-center" style={{ width: 36 }}>
        <div
          className={`relative z-10 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-white dark:border-gray-900 shadow-sm ${iconBg} transition-transform duration-150 group-hover:scale-110`}
        >
          <Icon size={15} className={iconColor} />
        </div>
        {!isLastInTimeline && (
          <div
            className={`mt-1 w-0.5 flex-1 ${stageConnectorBg}`}
            style={{ minHeight: 20 }}
          />
        )}
      </div>

      {/* Event card */}
      <div
        className={`min-w-0 flex-1 rounded-xl border border-gray-100 dark:border-gray-700/60 border-l-2 ${borderAccent} bg-white dark:bg-gray-800/60 px-3.5 py-3 shadow-sm transition-shadow duration-150 group-hover:shadow-md ${
          isLastInTimeline ? 'mb-0.5' : 'mb-3'
        }`}
      >
        {/* Title + badge */}
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">
            {event.title}
          </p>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
            {categoryLabel}
          </span>
        </div>

        {/* Description */}
        {event.description && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {event.description}
          </p>
        )}

        {/* Timestamp */}
        <p className="mt-2 text-[10px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">
          {fmtDateTime(event.event_timestamp)}
        </p>

        {/* Details toggle */}
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowDetails(v => !v)}
            className="text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {showDetails ? 'Hide details ↑' : 'Details ↓'}
          </button>
          {showDetails && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Chip label="Actor"    value={actor ?? 'System'} />
              <Chip label="Source"   value={source} />
              <Chip label="Category" value={categoryLabel} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Distribution placeholder ──────────────────────────────────────────────────
// Shown when the journey has no distribution_records events.

function DistributionCard({ record, isLast }: {
  record: DistributionRecord
  isLast: boolean
}) {
  const sc = STAGE_COLORS.distribution
  return (
    <div className="flex gap-3 group">
      <div className="flex shrink-0 flex-col items-center" style={{ width: 36 }}>
        <div className={`relative z-10 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-white dark:border-gray-900 shadow-sm ${sc.iconBg}`}>
          <Truck size={15} className={sc.iconColor} />
        </div>
        {!isLast && (
          <div className={`mt-1 w-0.5 flex-1 ${sc.connectorBg}`} style={{ minHeight: 20 }} />
        )}
      </div>
      <div className={`min-w-0 flex-1 rounded-xl border border-gray-100 dark:border-gray-700/60 border-l-2 border-l-teal-500 bg-white dark:bg-gray-800/60 px-3.5 py-3 shadow-sm ${isLast ? 'mb-0.5' : 'mb-3'}`}>
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">
            Shipped — {record.customer_name ?? 'Customer'}
          </p>
          <span className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
            Distribution
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {record.quantity.toLocaleString()} units dispatched
        </p>
        <p className="mt-2 text-[10px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">
          {fmtDateTime(record.sold_at)}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip label="Actor"    value="System" />
          <Chip label="Source"   value="Distribution" />
          <Chip label="Category" value="Distribution" />
        </div>
      </div>
    </div>
  )
}

function DistributionEmpty() {
  const sc = STAGE_COLORS.distribution
  return (
    <div className="flex gap-3">
      <div className="flex shrink-0 flex-col items-center" style={{ width: 36 }}>
        <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-teal-200 dark:border-teal-800/50 opacity-50 ${sc.iconBg}`}>
          <Truck size={15} className={sc.iconColor} />
        </div>
      </div>
      <div className="min-w-0 flex-1 rounded-xl border border-dashed border-teal-200 dark:border-teal-800/40 bg-teal-50/40 dark:bg-teal-900/5 px-3.5 py-3 mb-0.5">
        <p className="text-xs text-teal-600/70 dark:text-teal-500/60 italic">
          No distribution records available for this batch.
        </p>
      </div>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function TimelineSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading timeline">
      {/* Flow header skeleton */}
      <div className="mb-5 flex items-center gap-2">
        {[64, 52, 80, 56].map((w, i) => (
          <Fragment key={i}>
            <div className="h-6 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" style={{ width: w }} />
            {i < 3 && <div className="h-2 w-3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />}
          </Fragment>
        ))}
      </div>
      {/* Stage header skeleton */}
      <div className="flex gap-3 mb-3">
        <div className="flex shrink-0 flex-col items-center pt-1" style={{ width: 36 }}>
          <div className="h-3.5 w-3.5 rotate-45 rounded-sm bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div className="mt-1 w-0.5 flex-1 bg-gray-200 dark:bg-gray-700" style={{ minHeight: 20 }} />
        </div>
        <div className="flex-1 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>
      {/* Event skeletons */}
      {[55, 70, 45].map((w, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex shrink-0 flex-col items-center" style={{ width: 36 }}>
            <div className="mt-0.5 h-9 w-9 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
            {i < 2 && <div className="mt-1 w-0.5 flex-1 bg-gray-200 dark:bg-gray-700" style={{ minHeight: 44 }} />}
          </div>
          <div className={`flex-1 rounded-xl border border-gray-100 dark:border-gray-700/60 border-l-2 border-l-gray-200 dark:border-l-gray-700 bg-white dark:bg-gray-800/60 px-3.5 py-3 shadow-sm ${i < 2 ? 'mb-3' : 'mb-0.5'} space-y-2`}>
            <div className="flex items-start justify-between gap-2">
              <div className="h-3.5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" style={{ width: `${w}%` }} />
              <div className="h-4 w-20 shrink-0 rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />
            </div>
            <div className="h-2.5 w-4/5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="h-2 w-1/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="flex gap-1.5">
              {[28, 36, 32].map((bw, bi) => (
                <div key={bi} className="h-4 rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" style={{ width: `${bw}%` }} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── EnhancedTimeline (public export) ─────────────────────────────────────────

export function EnhancedTimeline({
  events,
  isLoading,
  distributionFallback,
}: {
  events:               JourneyEvent[]
  isLoading:            boolean
  distributionFallback?: DistributionRecord[]
}) {
  const [expandedStages, setExpandedStages] = useState<Set<StageGroup>>(new Set())

  function toggleStage(stage: StageGroup) {
    setExpandedStages(prev => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
  }

  if (isLoading) return <TimelineSkeleton />

  // Classify and group every event by stage
  const classified = events.map(e => ({ event: e, category: classifyEvent(e.event_type) }))

  const groups = new Map<StageGroup, typeof classified>()
  for (const item of classified) {
    const list = groups.get(item.category.stageGroup) ?? []
    list.push(item)
    groups.set(item.category.stageGroup, list)
  }

  // Sort each group by timestamp ascending
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        new Date(a.event.event_timestamp).getTime() -
        new Date(b.event.event_timestamp).getTime(),
    )
  }

  // Determine stages to render: all stages that have events + always-show set
  const stagesToRender = LIFECYCLE_ORDER.filter(
    s => groups.has(s) || ALWAYS_SHOW.has(s),
  )

  // Present stages for the flow header (stages that actually have events)
  const presentStages = new Set(LIFECYCLE_ORDER.filter(s => groups.has(s)))

  // Compute global "is last event in entire timeline" for connector logic
  // Find the last stage that has any event content
  const lastStageWithContent = [...stagesToRender].reverse().find(s => {
    if (groups.has(s) && (groups.get(s)?.length ?? 0) > 0) return true
    if (ALWAYS_SHOW.has(s)) return true // distribution placeholder counts
    return false
  })

  if (stagesToRender.length === 0 && (distributionFallback?.length ?? 0) === 0) {
    return (
      <p className="text-sm italic text-gray-400 dark:text-gray-500">
        No manufacturing events recorded for this batch.
      </p>
    )
  }

  return (
    <div className="pt-0.5">
      {/* Stage progression pills */}
      <StageFlowHeader presentStages={presentStages} />

      {stagesToRender.map((stage, stageIdx) => {
        const stageEvents = groups.get(stage) ?? []
        const sc          = STAGE_COLORS[stage]
        const isFirstStage = stageIdx === 0
        const prevStage    = stageIdx > 0 ? stagesToRender[stageIdx - 1] : null
        const prevSc       = prevStage ? STAGE_COLORS[prevStage] : null

        // For distribution: use journey events if any, else fallback from sales, else empty
        const isDistribution     = stage === 'distribution'
        const hasJourneyEvents   = stageEvents.length > 0
        const hasFallbackRecords = isDistribution && !hasJourneyEvents && (distributionFallback?.length ?? 0) > 0
        const isEmptyDistrib     = isDistribution && !hasJourneyEvents && !hasFallbackRecords

        // Total events shown in this stage (for the header count)
        const displayCount = hasJourneyEvents
          ? stageEvents.length
          : hasFallbackRecords
          ? (distributionFallback?.length ?? 0)
          : 0

        const isLastStage      = stage === lastStageWithContent
        const totalEventsInStage =
          hasJourneyEvents      ? stageEvents.length
          : hasFallbackRecords  ? (distributionFallback?.length ?? 0)
          : 0

        return (
          <Fragment key={stage}>
            {/* Stage checkpoint header — click to expand/collapse */}
            <StageHeader
              group={stage}
              eventCount={displayCount}
              isFirst={isFirstStage}
              prevConnectorBg={prevSc?.connectorBg}
              isExpanded={expandedStages.has(stage)}
              onToggle={() => toggleStage(stage)}
            />

            {/* Events — only rendered when stage is expanded */}
            {expandedStages.has(stage) && hasJourneyEvents && stageEvents.map((item, i) => {
              const isLastEvent  = i === stageEvents.length - 1
              const isLastInAll  = isLastStage && isLastEvent
              return (
                <EventCard
                  key={`${item.event.event_type}-${item.event.event_timestamp}-${i}`}
                  event={item.event}
                  category={item.category}
                  isLastInTimeline={isLastInAll}
                  stageConnectorBg={sc.connectorBg}
                />
              )
            })}

            {/* Distribution fallback: sorted by date, only when expanded */}
            {expandedStages.has(stage) && hasFallbackRecords && [...distributionFallback!]
              .sort((a, b) => new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime())
              .map((rec, i, arr) => (
                <DistributionCard
                  key={`dist-fallback-${i}`}
                  record={rec}
                  isLast={i === arr.length - 1}
                />
              ))}

            {/* Distribution empty state — only when expanded */}
            {expandedStages.has(stage) && isEmptyDistrib && <DistributionEmpty />}
          </Fragment>
        )
      })}
    </div>
  )
}
