import { Fragment, useState } from 'react'
import {
  Layers, ClipboardList, ShieldCheck, Truck, FileWarning, Activity,
  ChevronRight, Award, Microscope, Box,
  Archive, Warehouse, Store, TrendingUp,
  CheckCircle2,
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
  description?:    string | null
  source_table?:   string
  metadata?:       Record<string, unknown> | null
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
  final_qc:     ShieldCheck,
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
  final_qc: {
    bg:          'bg-emerald-50 dark:bg-emerald-900/10',
    border:      'border-emerald-200 dark:border-emerald-800/30',
    text:        'text-emerald-700 dark:text-emerald-400',
    subtext:     'text-emerald-500 dark:text-emerald-500',
    dotColor:    'bg-emerald-500',
    connectorBg: 'bg-emerald-200 dark:bg-emerald-800/40',
    iconBg:      'bg-emerald-100 dark:bg-emerald-900/30',
    iconColor:   'text-emerald-600 dark:text-emerald-400',
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
  'production', 'final_qc', 'quality', 'packaging', 'warehouse',
  'distribution', 'distributor', 'market',
  'compliance', 'other',
]

// Stages included in the "always show" flow — distribution is always rendered
const ALWAYS_SHOW: Set<StageGroup> = new Set(['distribution'])

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSourceLabel(s: string | undefined): string {
  if (!s) return 'System'
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
  if (typeof m.performed_by === 'string' && m.performed_by) return m.performed_by
  if (typeof m.created_by   === 'string' && m.created_by)   return m.created_by
  if (typeof m.user_name    === 'string' && m.user_name)    return m.user_name
  return null
}

// ── Lifecycle phase groupings ─────────────────────────────────────────────────
// Four high-level phases that map onto the 12 granular stages.
// Consumers understand "Materials → Manufacturing → Distribution → Market"
// instantly; the granular sub-stages are revealed on demand via expand.

const PHASES: Array<{ key: string; label: string; stages: StageGroup[] }> = [
  {
    key:    'materials',
    label:  'Materials',
    stages: ['supplier', 'materials', 'incoming_qc'],
  },
  {
    key:    'manufacturing',
    label:  'Manufacturing',
    stages: ['storage', 'production', 'final_qc', 'quality', 'packaging', 'warehouse'],
  },
  {
    key:    'distribution',
    label:  'Distribution',
    stages: ['distribution', 'distributor'],
  },
  {
    key:    'market',
    label:  'Market',
    stages: ['market'],
  },
]

// ── Phase context: structured location/handler per phase ─────────────────────

const PHASE_CONTEXT: Record<string, { primary: string; secondary: string }> = {
  materials:     { primary: 'Supplier Sourcing',  secondary: 'Raw material procurement & incoming inspection' },
  manufacturing: { primary: 'Production Floor',   secondary: 'Active manufacturing & quality control' },
  distribution:  { primary: 'Outbound Logistics', secondary: 'In transit to distribution network' },
  market:        { primary: 'Market Delivery',    secondary: 'Product delivered and consumer-available' },
}

// ── Stage flow header — Concept 4: Hero + Phase Grid ──────────────────────────
//
// One card, three priority tiers:
//   1. What stage?  Phase name, 30px bold — the dominant element
//   2. Where now?   "Current location" — bold handler · muted descriptor
//   3. What's next? Stage icon + name after a ruled divider
//
// Phase grid (bottom of same card, 2×2):
//   ✓ Materials      ✓ Manufacturing
//   ● Distribution   ○ Market
//      (Current)
//
// Phase state is always derived: everything left of active = completed,
// active node itself = active, everything right = future.

function StageFlowHeader({
  presentStages,
  activeStage,
  productStatus,
}: {
  presentStages: Set<StageGroup>
  activeStage?:  StageGroup
  productStatus?: string
}) {
  const stages      = LIFECYCLE_ORDER.filter(s => s !== 'other' && s !== 'compliance') as StageGroup[]
  const activePhase = activeStage ? PHASES.find(p => p.stages.includes(activeStage)) : null
  const ctx         = activePhase ? PHASE_CONTEXT[activePhase.key] : null

  const activeIdx = activeStage ? stages.indexOf(activeStage) : -1
  const nextStage = activeIdx >= 0 && activeIdx < stages.length - 1
    ? stages[activeIdx + 1]
    : null
  const NextIcon = nextStage ? STAGE_ICONS[nextStage] : null

  // Phase index drives the derived-state rule:
  // everything before the active phase = completed, active = active, after = future
  const activePhaseIdx = activePhase ? PHASES.indexOf(activePhase) : -1

  function getPhaseState(phase: { stages: StageGroup[] }, phaseIdx: number): 'completed' | 'active' | 'future' {
    if (activePhaseIdx < 0) {
      // No active stage — fall back to event-based presence
      if (phase.stages.some(s => presentStages.has(s))) return 'completed'
      return 'future'
    }
    if (phaseIdx < activePhaseIdx)  return 'completed'
    if (phaseIdx === activePhaseIdx) return 'active'
    return 'future'
  }

  return (
    <div className="mb-5 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 px-4 py-4">

      {/* ── Tier 1: eyebrow + stage headline ───────────────────────────── */}
      <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
        Active Stage
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-3xl font-bold leading-none tracking-tight text-gray-900 dark:text-white">
          {activePhase?.label ?? '—'}
        </span>
        <span className="h-px w-4 shrink-0 self-center bg-gray-400 dark:bg-gray-500" />
        <span className="rounded-lg bg-gray-100 dark:bg-gray-700/80 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300">
          {productStatus === 'completed' ? 'Completed' : 'In Progress'}
        </span>
      </div>

      {/* ── Tier 2: current location ────────────────────────────────────── */}
      {ctx ? (
        <div className="mb-5">
          <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
            Current location
          </p>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            <span className="font-semibold text-gray-800 dark:text-gray-200">{ctx.primary}</span>
            {' · '}
            <span>{ctx.secondary}</span>
          </p>
        </div>
      ) : (
        <p className="mb-5 text-sm text-gray-400 dark:text-gray-500">Location not recorded</p>
      )}

      {/* ── Tier 3: next step ───────────────────────────────────────────── */}
      {nextStage ? (
        <div className="mb-4">
          <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
            Next
          </p>
          <div className="flex items-center gap-2">
            {NextIcon && <NextIcon size={16} className="shrink-0 text-gray-500 dark:text-gray-400" />}
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {STAGE_META[nextStage]?.label ?? nextStage}
            </span>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-sm text-gray-400 dark:text-gray-500">Final stage</p>
      )}

      {/* ── Phase strip: single linear sequence ────────────────────────────
           Track runs left-to-right through all 4 gaps in order.
           Circles use justify-between so they stay on one row at any width.
           Labels mirror the same justify-between so they track their circles.
           The completed-fill width uses the same geometry as justify-between:
           nth circle center = 14px + n/3 × (W−28px), so
           fill width = calc(n/3 × (100% − 28px)) — self-calibrating. */}
      <div className="border-t border-gray-100 dark:border-gray-700/50 pt-3">
        <div className="relative">

          {/* Background track at circle-center height (top-3.5 = 14px = h-7/2) */}
          <div className="absolute left-3.5 right-3.5 top-3.5 h-px bg-gray-200 dark:bg-gray-700" />

          {/* Completed portion — advances to center of active node */}
          {activePhaseIdx > 0 && (
            <div
              className="absolute left-3.5 top-3.5 h-px bg-emerald-500/35 dark:bg-emerald-500/50"
              style={{ width: `calc(${(activePhaseIdx / (PHASES.length - 1)).toFixed(4)} * (100% - 28px))` }}
            />
          )}

          {/* Circles — always one row, evenly distributed */}
          <div className="relative z-10 flex justify-between">
            {PHASES.map((phase, phaseIdx) => {
              const state = getPhaseState(phase, phaseIdx)
              return (
                <div key={phase.key} className="shrink-0">
                  {state === 'completed' ? (
                    /* bg-white punches through the track line behind the ring */
                    <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-emerald-500/50 dark:border-emerald-500/60 bg-white dark:bg-gray-800/60">
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="text-emerald-500 dark:text-emerald-400" aria-hidden="true">
                        <path d="M1.5 4L4 6.5L8.5 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  ) : state === 'active' ? (
                    /* Solid fill — the single brightest element on the strip */
                    <div className="relative flex h-7 w-7 items-center justify-center">
                      <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-20" />
                      <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-emerald-500/25">
                        <span className="h-2 w-2 rounded-full bg-white" />
                      </div>
                    </div>
                  ) : (
                    <div className="h-7 w-7 rounded-full border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800/60" />
                  )}
                </div>
              )
            })}
          </div>

          {/* Labels — w-7 containers mirror circle positions; text overflows
              visibly so "Manufacturing" centers correctly under its node.
              First aligns left, last aligns right, middles center. */}
          <div className="mt-2 flex justify-between">
            {PHASES.map((phase, phaseIdx) => {
              const state   = getPhaseState(phase, phaseIdx)
              const isFirst = phaseIdx === 0
              const isLast  = phaseIdx === PHASES.length - 1
              return (
                <p
                  key={phase.key}
                  className={`w-7 text-[10px] leading-tight whitespace-nowrap ${
                    isFirst ? 'text-left' : isLast ? 'text-right' : 'text-center'
                  } ${
                    state === 'active'
                      ? 'font-semibold text-emerald-500 dark:text-emerald-400'
                      : state === 'completed'
                      ? 'font-medium text-gray-500 dark:text-gray-400'
                      : 'font-medium text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {phase.label}
                </p>
              )
            })}
          </div>

        </div>
      </div>

    </div>
  )
}

// ── Stage header card ─────────────────────────────────────────────────────────
// A prominent checkpoint card marking each manufacturing stage.
// stageState drives three distinct visual treatments:
//   active    — pulsing dot on diamond + pulsing indicator in card, border-2, elevated shadow
//   completed — checkmark replaces icon, full opacity, normal border
//   upcoming  — normal card identical to completed minus the checkmark; no fading

function StageHeader({
  group,
  eventCount,
  isFirst,
  prevConnectorBg,
  isExpanded,
  onToggle,
  stageState,
}: {
  group:            StageGroup
  eventCount:       number
  isFirst:          boolean
  prevConnectorBg?: string
  isExpanded:       boolean
  onToggle:         () => void
  stageState:       'completed' | 'active' | 'upcoming'
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
        {/* Diamond — pulsing ring when active */}
        <div className="relative flex items-center justify-center">
          {stageState === 'active' && (
            <span className={`absolute h-6 w-6 rounded-full ${sc.dotColor} opacity-25 animate-ping`} />
          )}
          <div
            className={`rotate-45 shrink-0 rounded-sm border-2 border-white dark:border-gray-900 ${
              isFirst ? 'h-4 w-4' : 'h-3.5 w-3.5'
            } ${sc.dotColor} ${stageState === 'active' ? 'shadow-lg' : 'shadow-sm'}`}
          />
        </div>
        <div
          className={`mt-1 w-0.5 flex-1 ${sc.connectorBg}`}
          style={{ minHeight: 12 }}
        />
      </div>

      {/* Stage header card — clickable to expand/collapse */}
      <button
        type="button"
        onClick={onToggle}
        className={`flex-1 flex items-center justify-between gap-3 rounded-xl px-4 py-3 mb-3 ${sc.bg} border ${sc.border} text-left cursor-pointer transition-all duration-150 active:scale-[0.995] hover:brightness-[1.02] ${
          stageState === 'active'
            ? 'border-2 shadow-md hover:brightness-[1.04]'
            : 'shadow-sm'
        }`}
      >
        {/* Left: icon/check + label */}
        <div className="flex items-center gap-2.5">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${sc.iconBg}`}>
            {stageState === 'completed' ? (
              <CheckCircle2 size={14} className="text-emerald-500 dark:text-emerald-400" />
            ) : (
              <Icon size={14} className={sc.iconColor} />
            )}
          </div>
          <p className={`text-xs font-bold uppercase tracking-widest ${sc.text}`}>
            {STAGE_META[group].label}
          </p>
        </div>

        {/* Right: pulsing dot (active only) + event count + chevron */}
        <div className="flex items-center gap-1.5 shrink-0">
          {stageState === 'active' && (
            <span className="relative flex h-2 w-2 mr-0.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${sc.dotColor} opacity-60`} />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${sc.dotColor}`} />
            </span>
          )}
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
  const source = getSourceLabel(event.source_table ?? undefined)
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
  productStatus,
}: {
  events:         JourneyEvent[]
  isLoading:      boolean
  productStatus?: string
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

  // Active stage = last present stage in lifecycle order (most recent progress checkpoint)
  const orderedPresent = LIFECYCLE_ORDER.filter(s => presentStages.has(s))
  const activeStage    = orderedPresent.length > 0 ? orderedPresent[orderedPresent.length - 1] : undefined

  // Compute global "is last event in entire timeline" for connector logic
  // Find the last stage that has any event content
  const lastStageWithContent = [...stagesToRender].reverse().find(s => {
    if (groups.has(s) && (groups.get(s)?.length ?? 0) > 0) return true
    if (ALWAYS_SHOW.has(s)) return true // distribution placeholder counts
    return false
  })

  if (stagesToRender.length === 0) {
    return (
      <p className="text-sm italic text-gray-400 dark:text-gray-500">
        No manufacturing events recorded for this batch.
      </p>
    )
  }

  return (
    <div className="pt-0.5">
      {/* Stage progression pills */}
      <StageFlowHeader presentStages={presentStages} activeStage={activeStage} productStatus={productStatus} />

      {stagesToRender.map((stage, stageIdx) => {
        const stageEvents = groups.get(stage) ?? []
        const sc          = STAGE_COLORS[stage]
        const isFirstStage = stageIdx === 0
        const prevStage    = stageIdx > 0 ? stagesToRender[stageIdx - 1] : null
        const prevSc       = prevStage ? STAGE_COLORS[prevStage] : null

        const isDistribution   = stage === 'distribution'
        const hasJourneyEvents = stageEvents.length > 0
        const isEmptyDistrib   = isDistribution && !hasJourneyEvents

        const displayCount = stageEvents.length

        const isLastStage = stage === lastStageWithContent

        // Determine this stage's position in the journey
        const stageState: 'completed' | 'active' | 'upcoming' =
          stage === activeStage    ? 'active'
          : presentStages.has(stage) ? 'completed'
          : 'upcoming'

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
              stageState={stageState}
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

            {/* Distribution empty state — only when expanded */}
            {expandedStages.has(stage) && isEmptyDistrib && <DistributionEmpty />}
          </Fragment>
        )
      })}
    </div>
  )
}
