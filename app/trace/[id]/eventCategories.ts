import {
  ClipboardList,
  Play,
  CheckCircle2,
  Layers,
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  Clock,
  Truck,
  AlertTriangle,
  FileWarning,
  Activity,
  Box,
  Award,
  Microscope,
  Archive,
  Warehouse,
  Store,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'

// ── Stage groups ────────────────────────────────────────────────────────────
// Events are grouped into manufacturing stages for the visual flow header
// and the stage-transition dividers in the timeline.

export type StageGroup =
  | 'supplier'
  | 'materials'
  | 'incoming_qc'
  | 'storage'      // pre-production raw materials warehouse
  | 'production'
  | 'final_qc'     // final quality inspection between production and packaging
  | 'quality'      // legacy alias kept for backward compat
  | 'packaging'
  | 'warehouse'    // post-packaging finished goods warehouse
  | 'distribution'
  | 'distributor'
  | 'market'
  | 'compliance'
  | 'other'

export const STAGE_META: Record<
  StageGroup,
  { label: string; dotColor: string; textColor: string; lineColor: string }
> = {
  supplier: {
    label:     'Supplier QC',
    dotColor:  'bg-indigo-400',
    textColor: 'text-indigo-500 dark:text-indigo-400',
    lineColor: 'bg-indigo-200 dark:bg-indigo-800/40',
  },
  materials: {
    label:     'Raw Materials',
    dotColor:  'bg-orange-400',
    textColor: 'text-orange-500 dark:text-orange-400',
    lineColor: 'bg-orange-200 dark:bg-orange-800/40',
  },
  incoming_qc: {
    label:     'Incoming QC',
    dotColor:  'bg-yellow-500',
    textColor: 'text-yellow-600 dark:text-yellow-400',
    lineColor: 'bg-yellow-200 dark:bg-yellow-800/40',
  },
  production: {
    label:     'Production',
    dotColor:  'bg-blue-500',
    textColor: 'text-blue-600 dark:text-blue-400',
    lineColor: 'bg-blue-200 dark:bg-blue-800/40',
  },
  final_qc: {
    label:     'Final QC',
    dotColor:  'bg-emerald-500',
    textColor: 'text-emerald-600 dark:text-emerald-400',
    lineColor: 'bg-emerald-200 dark:bg-emerald-800/40',
  },
  packaging: {
    label:     'Packaging',
    dotColor:  'bg-cyan-500',
    textColor: 'text-cyan-600 dark:text-cyan-400',
    lineColor: 'bg-cyan-200 dark:bg-cyan-800/40',
  },
  quality: {
    label:     'Final QC',
    dotColor:  'bg-emerald-500',
    textColor: 'text-emerald-600 dark:text-emerald-400',
    lineColor: 'bg-emerald-200 dark:bg-emerald-800/40',
  },
  distribution: {
    label:     'Distribution',
    dotColor:  'bg-teal-500',
    textColor: 'text-teal-600 dark:text-teal-400',
    lineColor: 'bg-teal-200 dark:bg-teal-800/40',
  },
  compliance: {
    label:     'Compliance',
    dotColor:  'bg-purple-500',
    textColor: 'text-purple-600 dark:text-purple-400',
    lineColor: 'bg-purple-200 dark:bg-purple-800/40',
  },
  storage: {
    label:     'Warehouse Storage',
    dotColor:  'bg-stone-500',
    textColor: 'text-stone-600 dark:text-stone-400',
    lineColor: 'bg-stone-200 dark:bg-stone-700',
  },
  warehouse: {
    label:     'Warehouse',
    dotColor:  'bg-sky-500',
    textColor: 'text-sky-600 dark:text-sky-400',
    lineColor: 'bg-sky-200 dark:bg-sky-800/40',
  },
  distributor: {
    label:     'Distributor',
    dotColor:  'bg-violet-500',
    textColor: 'text-violet-600 dark:text-violet-400',
    lineColor: 'bg-violet-200 dark:bg-violet-800/40',
  },
  market: {
    label:     'Market Tracking',
    dotColor:  'bg-rose-500',
    textColor: 'text-rose-600 dark:text-rose-400',
    lineColor: 'bg-rose-200 dark:bg-rose-800/40',
  },
  other: {
    label:     'System',
    dotColor:  'bg-gray-400',
    textColor: 'text-gray-500 dark:text-gray-400',
    lineColor: 'bg-gray-200 dark:bg-gray-700',
  },
}

// ── Category type ───────────────────────────────────────────────────────────

export type EventCategory = {
  key:          string
  label:        string
  stageGroup:   StageGroup
  dotBg:        string   // bg-* — connector line and dot
  borderAccent: string   // border-s-* — left accent on event card
  iconBg:       string   // background of icon circle
  iconColor:    string   // icon foreground
  badgeClass:   string   // pill badge
  Icon:         LucideIcon
}

// ── Category definitions ────────────────────────────────────────────────────

const C = {
  productionCreated: {
    key:          'production_created',
    label:        'Production Created',
    stageGroup:   'production' as StageGroup,
    dotBg:        'bg-blue-400',
    borderAccent: 'border-s-blue-400',
    iconBg:       'bg-blue-50 dark:bg-blue-900/30',
    iconColor:    'text-blue-500 dark:text-blue-400',
    badgeClass:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    Icon: ClipboardList,
  },
  productionStarted: {
    key:          'production_started',
    label:        'Production Started',
    stageGroup:   'production' as StageGroup,
    dotBg:        'bg-blue-500',
    borderAccent: 'border-s-blue-500',
    iconBg:       'bg-blue-50 dark:bg-blue-900/30',
    iconColor:    'text-blue-600 dark:text-blue-400',
    badgeClass:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    Icon: Play,
  },
  productionCompleted: {
    key:          'production_completed',
    label:        'Production Completed',
    stageGroup:   'production' as StageGroup,
    dotBg:        'bg-emerald-500',
    borderAccent: 'border-s-emerald-500',
    iconBg:       'bg-emerald-50 dark:bg-emerald-900/30',
    iconColor:    'text-emerald-600 dark:text-emerald-400',
    badgeClass:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
  rawMaterial: {
    key:          'raw_material',
    label:        'Raw Material',
    stageGroup:   'materials' as StageGroup,
    dotBg:        'bg-orange-400',
    borderAccent: 'border-s-orange-400',
    iconBg:       'bg-orange-50 dark:bg-orange-900/30',
    iconColor:    'text-orange-500 dark:text-orange-400',
    badgeClass:   'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    Icon: Layers,
  },
  qcPassed: {
    key:          'qc_passed',
    label:        'QC Passed',
    stageGroup:   'final_qc' as StageGroup,
    dotBg:        'bg-emerald-500',
    borderAccent: 'border-s-emerald-500',
    iconBg:       'bg-emerald-50 dark:bg-emerald-900/30',
    iconColor:    'text-emerald-600 dark:text-emerald-400',
    badgeClass:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Icon: ShieldCheck,
  },
  qcFailed: {
    key:          'qc_failed',
    label:        'QC Failed',
    stageGroup:   'final_qc' as StageGroup,
    dotBg:        'bg-red-500',
    borderAccent: 'border-s-red-500',
    iconBg:       'bg-red-50 dark:bg-red-900/30',
    iconColor:    'text-red-600 dark:text-red-400',
    badgeClass:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    Icon: ShieldX,
  },
  qcHold: {
    key:          'qc_hold',
    label:        'QC Hold',
    stageGroup:   'final_qc' as StageGroup,
    dotBg:        'bg-amber-400',
    borderAccent: 'border-s-amber-400',
    iconBg:       'bg-amber-50 dark:bg-amber-900/30',
    iconColor:    'text-amber-500 dark:text-amber-400',
    badgeClass:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    Icon: ShieldAlert,
  },
  finalQcPassed: {
    key:          'final_qc_passed',
    label:        'Final QC Passed',
    stageGroup:   'final_qc' as StageGroup,
    dotBg:        'bg-emerald-500',
    borderAccent: 'border-s-emerald-500',
    iconBg:       'bg-emerald-50 dark:bg-emerald-900/30',
    iconColor:    'text-emerald-600 dark:text-emerald-400',
    badgeClass:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Icon: ShieldCheck,
  },
  finalQcFailed: {
    key:          'final_qc_failed',
    label:        'Final QC Failed',
    stageGroup:   'final_qc' as StageGroup,
    dotBg:        'bg-red-500',
    borderAccent: 'border-s-red-500',
    iconBg:       'bg-red-50 dark:bg-red-900/30',
    iconColor:    'text-red-600 dark:text-red-400',
    badgeClass:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    Icon: ShieldX,
  },
  finalQcHold: {
    key:          'final_qc_hold',
    label:        'Final QC On Hold',
    stageGroup:   'final_qc' as StageGroup,
    dotBg:        'bg-amber-400',
    borderAccent: 'border-s-amber-400',
    iconBg:       'bg-amber-50 dark:bg-amber-900/30',
    iconColor:    'text-amber-500 dark:text-amber-400',
    badgeClass:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    Icon: ShieldAlert,
  },
  qcCheckpoint: {
    key:          'qc_checkpoint',
    label:        'QC Checkpoint',
    stageGroup:   'quality' as StageGroup,
    dotBg:        'bg-amber-400',
    borderAccent: 'border-s-amber-400',
    iconBg:       'bg-amber-50 dark:bg-amber-900/30',
    iconColor:    'text-amber-500 dark:text-amber-400',
    badgeClass:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    Icon: Clock,
  },
  supplierQualification: {
    key:          'supplier_qualification',
    label:        'Supplier Qualification',
    stageGroup:   'supplier' as StageGroup,
    dotBg:        'bg-indigo-400',
    borderAccent: 'border-s-indigo-400',
    iconBg:       'bg-indigo-50 dark:bg-indigo-900/30',
    iconColor:    'text-indigo-500 dark:text-indigo-400',
    badgeClass:   'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
    Icon: Award,
  },
  incomingQcApproved: {
    key:          'incoming_qc_approved',
    label:        'Incoming Inspection Passed',
    stageGroup:   'incoming_qc' as StageGroup,
    dotBg:        'bg-yellow-500',
    borderAccent: 'border-s-yellow-500',
    iconBg:       'bg-yellow-50 dark:bg-yellow-900/30',
    iconColor:    'text-yellow-600 dark:text-yellow-400',
    badgeClass:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    Icon: Microscope,
  },
  incomingQcConditional: {
    key:          'incoming_qc_conditional',
    label:        'Incoming Inspection — Conditional',
    stageGroup:   'incoming_qc' as StageGroup,
    dotBg:        'bg-amber-400',
    borderAccent: 'border-s-amber-400',
    iconBg:       'bg-amber-50 dark:bg-amber-900/30',
    iconColor:    'text-amber-500 dark:text-amber-400',
    badgeClass:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    Icon: Microscope,
  },
  incomingQcFailed: {
    key:          'incoming_qc_failed',
    label:        'Incoming Inspection Failed',
    stageGroup:   'incoming_qc' as StageGroup,
    dotBg:        'bg-red-500',
    borderAccent: 'border-s-red-500',
    iconBg:       'bg-red-50 dark:bg-red-900/30',
    iconColor:    'text-red-600 dark:text-red-400',
    badgeClass:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    Icon: Microscope,
  },
  distribution: {
    key:          'distribution',
    label:        'Distribution',
    stageGroup:   'distribution' as StageGroup,
    dotBg:        'bg-teal-500',
    borderAccent: 'border-s-teal-500',
    iconBg:       'bg-teal-50 dark:bg-teal-900/30',
    iconColor:    'text-teal-600 dark:text-teal-400',
    badgeClass:   'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
    Icon: Truck,
  },
  recall: {
    key:          'recall',
    label:        'Recall Issued',
    stageGroup:   'compliance' as StageGroup,
    dotBg:        'bg-red-600',
    borderAccent: 'border-s-red-600',
    iconBg:       'bg-red-50 dark:bg-red-900/40',
    iconColor:    'text-red-700 dark:text-red-400',
    badgeClass:   'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 ring-1 ring-inset ring-red-400',
    Icon: AlertTriangle,
  },
  packaging: {
    key:          'packaging',
    label:        'Packaging',
    stageGroup:   'packaging' as StageGroup,
    dotBg:        'bg-cyan-400',
    borderAccent: 'border-s-cyan-400',
    iconBg:       'bg-cyan-50 dark:bg-cyan-900/30',
    iconColor:    'text-cyan-500 dark:text-cyan-400',
    badgeClass:   'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
    Icon: Box,
  },
  capa: {
    key:          'capa',
    label:        'CAPA',
    stageGroup:   'compliance' as StageGroup,
    dotBg:        'bg-purple-500',
    borderAccent: 'border-s-purple-500',
    iconBg:       'bg-purple-50 dark:bg-purple-900/30',
    iconColor:    'text-purple-600 dark:text-purple-400',
    badgeClass:   'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    Icon: FileWarning,
  },
  storageEvent: {
    key:          'storage_event',
    label:        'Warehouse Storage',
    stageGroup:   'storage' as StageGroup,
    dotBg:        'bg-stone-500',
    borderAccent: 'border-s-stone-500',
    iconBg:       'bg-stone-50 dark:bg-stone-800/40',
    iconColor:    'text-stone-500 dark:text-stone-400',
    badgeClass:   'bg-stone-100 text-stone-700 dark:bg-stone-700/40 dark:text-stone-400',
    Icon: Archive,
  },
  warehouseEvent: {
    key:          'warehouse_event',
    label:        'Warehouse',
    stageGroup:   'warehouse' as StageGroup,
    dotBg:        'bg-sky-500',
    borderAccent: 'border-s-sky-500',
    iconBg:       'bg-sky-50 dark:bg-sky-900/30',
    iconColor:    'text-sky-600 dark:text-sky-400',
    badgeClass:   'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
    Icon: Warehouse,
  },
  distributorEvent: {
    key:          'distributor_event',
    label:        'Distributor',
    stageGroup:   'distributor' as StageGroup,
    dotBg:        'bg-violet-500',
    borderAccent: 'border-s-violet-500',
    iconBg:       'bg-violet-50 dark:bg-violet-900/30',
    iconColor:    'text-violet-600 dark:text-violet-400',
    badgeClass:   'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    Icon: Store,
  },
  marketEvent: {
    key:          'market_event',
    label:        'Market Tracking',
    stageGroup:   'market' as StageGroup,
    dotBg:        'bg-rose-500',
    borderAccent: 'border-s-rose-500',
    iconBg:       'bg-rose-50 dark:bg-rose-900/30',
    iconColor:    'text-rose-600 dark:text-rose-400',
    badgeClass:   'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    Icon: TrendingUp,
  },
  system: {
    key:          'system',
    label:        'System Event',
    stageGroup:   'other' as StageGroup,
    dotBg:        'bg-gray-400',
    borderAccent: 'border-s-gray-400',
    iconBg:       'bg-gray-50 dark:bg-gray-700/40',
    iconColor:    'text-gray-500 dark:text-gray-400',
    badgeClass:   'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    Icon: Activity,
  },
} satisfies Record<string, EventCategory>

// ── Exact event-type → category map ────────────────────────────────────────

const EXACT: Record<string, EventCategory> = {
  'production.order_created':  C.productionCreated,
  'production.created':        C.productionCreated,
  'production.started':        C.productionStarted,
  'production.completed':      C.productionCompleted,
  'qc.pass':                   C.qcPassed,
  'qc_inspection.passed':      C.qcPassed,
  'qc.fail':                   C.qcFailed,
  'qc_inspection.failed':      C.qcFailed,
  'qc.hold':                   C.qcHold,
  'qc_inspection.hold':        C.qcHold,
  'incoming_qc.approved':      C.incomingQcApproved,
  'incoming_qc.conditional':   C.incomingQcConditional,
  'incoming_qc.failed':        C.incomingQcFailed,
  'supplier.qualified':        C.supplierQualification,
  'supplier.approved':         C.supplierQualification,
  'supplier.audited':          C.supplierQualification,
  'final_qc.passed':           C.finalQcPassed,
  'final_qc.failed':           C.finalQcFailed,
  'final_qc.hold':             C.finalQcHold,
  'raw_material.released':      C.rawMaterial,
  'storage.entry':              C.storageEvent,
  'storage.release':            C.storageEvent,
  'warehouse.received':         C.storageEvent,
  'warehouse.entry':            C.storageEvent,
  'finished_goods.stored':      C.warehouseEvent,
  'finished_goods.released':    C.warehouseEvent,
  'warehouse.dispatch_ready':   C.warehouseEvent,
  'distributor.received':       C.distributorEvent,
  'distributor.released':       C.distributorEvent,
  'distributor.delivered':      C.distributorEvent,
  'market.listed':                  C.marketEvent,
  'market.active':                  C.marketEvent,
  'market.sold':                    C.marketEvent,
  'market.tracked':                 C.marketEvent,
  'market.registered':              C.marketEvent,
  'market.surveillance_started':    C.marketEvent,
  'market.complaint_received':      C.marketEvent,
  'packaging.completed':        C.packaging,
  'packaging.started':          C.packaging,
  'distribution.shipped':       C.distribution,
  'distribution.created':      C.distribution,
  'distribution.delivered':    C.distribution,
  'recall.issued':             C.recall,
  'recall.created':            C.recall,
  'recall.initiated':          C.recall,
  'recall.closed':             C.recall,
  'capa.created':              C.capa,
  'capa.opened':               C.capa,
  'capa.closed':               C.capa,
}

export function classifyEvent(eventType: string): EventCategory {
  if (EXACT[eventType]) return EXACT[eventType]
  if (eventType === 'production.completed')           return C.productionCompleted
  if (eventType.startsWith('production.'))            return C.productionStarted
  if (eventType.startsWith('raw_material.') ||
      eventType.startsWith('material.'))              return C.rawMaterial
  if (eventType.startsWith('supplier.'))              return C.supplierQualification
  if (eventType.startsWith('incoming_qc.')) {
    if (eventType.includes('approved') || eventType.includes('passed')) return C.incomingQcApproved
    if (eventType.includes('failed'))                 return C.incomingQcFailed
    return C.incomingQcConditional
  }
  if (eventType.startsWith('final_qc.')) {
    if (eventType.includes('passed'))                 return C.finalQcPassed
    if (eventType.includes('failed'))                 return C.finalQcFailed
    return C.finalQcHold
  }
  if (eventType.startsWith('storage.'))               return C.storageEvent
  if (eventType.startsWith('finished_goods.'))        return C.warehouseEvent
  if (eventType.startsWith('distributor.'))           return C.distributorEvent
  if (eventType.startsWith('market.'))                return C.marketEvent
  if (eventType.startsWith('packaging.'))             return C.packaging
  if (eventType.startsWith('qc') &&
      (eventType.includes('pass') || eventType.includes('passed'))) return C.qcPassed
  if (eventType.startsWith('qc') &&
      (eventType.includes('fail') || eventType.includes('failed'))) return C.qcFailed
  if (eventType.startsWith('qc') &&
       eventType.includes('hold'))                    return C.qcHold
  if (eventType.startsWith('qc'))                     return C.qcCheckpoint
  if (eventType.startsWith('distribution.'))          return C.distribution
  if (eventType.startsWith('recall.'))                return C.recall
  if (eventType.startsWith('capa.'))                  return C.capa
  return C.system
}

export function isScanEvent(sourceTable: string): boolean {
  return sourceTable === 'scan_events'
}

// ── Shared trace date/time formatting ─────────────────────────────────────────
// Single implementation used by page.tsx, JourneyMetrics.tsx and EnhancedTimeline.
// Arabic uses an EXPLICIT Gregorian calendar with Latin numerals (project
// convention) so the device locale can never pick a different calendar. Date and
// time are formatted separately and joined with one language-appropriate
// separator to avoid the browser-ICU double-comma artifact. Invalid dates return
// '' so callers can render a neutral unavailable state (never "Invalid Date").

type TraceLang = 'en' | 'ar'

export function traceDateLocale(lang: TraceLang): string {
  return lang === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-US'
}

export function fmtTraceDate(iso: string, lang: TraceLang): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(traceDateLocale(lang), { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fmtTraceDateTime(iso: string, lang: TraceLang): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const loc  = traceDateLocale(lang)
  const date = d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
  return `${date}${lang === 'ar' ? '، ' : ', '}${time}`
}

// ── System-generated vs. customer-authored timeline titles ────────────────────
// `timeline[].title` may be a system-generated English heading OR genuine
// customer free text. For a recognized (non-'system') category we render a
// localized canonical heading (trace.event_title.<key>) in the UI. To avoid
// discarding real customer text, we treat the raw title as CUSTOM (shown as a
// secondary line) unless it matches a known system phrasing for that category —
// in which case it is redundant with the localized heading and hidden.
// Detection is a normalized-string match against known system phrasings; unknown
// phrasings are preserved as customer data. No React hooks here — ids/keys only.

function normTitle(s: string): string {
  return s.toLowerCase().replace(/[.،،]+$/g, '').replace(/\s+/g, ' ').trim()
}

const SYSTEM_TITLE_ALIASES: Record<string, string[]> = {
  production_created:      ['production created', 'production order created', 'production order opened', 'production order', 'order created'],
  production_started:      ['production started', 'production run started', 'production begun'],
  production_completed:    ['production completed', 'production run completed', 'production finished'],
  raw_material:            ['raw material', 'raw material released', 'raw material added', 'material added', 'material released'],
  qc_passed:               ['qc passed', 'quality inspection passed', 'quality control passed', 'quality check passed'],
  qc_failed:               ['qc failed', 'quality inspection failed', 'quality control failed', 'quality check failed'],
  qc_hold:                 ['qc hold', 'qc on hold', 'quality inspection on hold', 'quality hold'],
  final_qc_passed:         ['final qc passed', 'final quality inspection passed', 'final quality check passed'],
  final_qc_failed:         ['final qc failed', 'final quality inspection failed', 'final quality check failed'],
  final_qc_hold:           ['final qc on hold', 'final qc hold', 'final quality inspection on hold'],
  qc_checkpoint:           ['qc checkpoint', 'quality checkpoint'],
  supplier_qualification:  ['supplier qualification', 'supplier qualified', 'supplier approved', 'supplier audited'],
  incoming_qc_approved:    ['incoming inspection passed', 'incoming qc approved', 'incoming inspection approved', 'incoming qc passed'],
  incoming_qc_conditional: ['incoming inspection conditional', 'incoming qc conditional', 'incoming inspection — conditional'],
  incoming_qc_failed:      ['incoming inspection failed', 'incoming qc failed'],
  distribution:            ['distribution', 'distributed', 'shipment created', 'shipped', 'distribution shipped'],
  recall:                  ['recall issued', 'recall created', 'recall initiated', 'recall closed', 'recall'],
  packaging:               ['packaging', 'packaging completed', 'packaging started'],
  capa:                    ['capa', 'capa created', 'capa opened', 'capa closed', 'corrective action'],
  storage_event:           ['warehouse storage', 'storage entry', 'storage release', 'stored', 'warehouse received'],
  warehouse_event:         ['warehouse', 'finished goods stored', 'finished goods released', 'dispatch ready'],
  distributor_event:       ['distributor', 'distributor received', 'distributor released', 'distributor delivered'],
  market_event:            ['market tracking', 'market listed', 'market active', 'market sold', 'market registered'],
}

/** True when the raw timeline title is a known system phrasing for this category. */
export function isCanonicalSystemTitle(categoryKey: string, rawTitle: string): boolean {
  const aliases = SYSTEM_TITLE_ALIASES[categoryKey]
  if (!aliases) return false
  return aliases.includes(normTitle(rawTitle))
}

/** Recognized (non-'system') categories have a localized canonical heading. */
export function hasCanonicalTitle(categoryKey: string): boolean {
  return categoryKey !== 'system' && categoryKey in SYSTEM_TITLE_ALIASES
}
