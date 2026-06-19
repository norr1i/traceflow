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
  type LucideIcon,
} from 'lucide-react'

// ── Stage groups ────────────────────────────────────────────────────────────
// Events are grouped into manufacturing stages for the visual flow header
// and the stage-transition dividers in the timeline.

export type StageGroup =
  | 'supplier'
  | 'materials'
  | 'incoming_qc'
  | 'production'
  | 'packaging'
  | 'quality'
  | 'distribution'
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
  borderAccent: string   // border-l-* — left accent on event card
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
    borderAccent: 'border-l-blue-400',
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
    borderAccent: 'border-l-blue-500',
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
    borderAccent: 'border-l-emerald-500',
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
    borderAccent: 'border-l-orange-400',
    iconBg:       'bg-orange-50 dark:bg-orange-900/30',
    iconColor:    'text-orange-500 dark:text-orange-400',
    badgeClass:   'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    Icon: Layers,
  },
  qcPassed: {
    key:          'qc_passed',
    label:        'QC Passed',
    stageGroup:   'quality' as StageGroup,
    dotBg:        'bg-emerald-500',
    borderAccent: 'border-l-emerald-500',
    iconBg:       'bg-emerald-50 dark:bg-emerald-900/30',
    iconColor:    'text-emerald-600 dark:text-emerald-400',
    badgeClass:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Icon: ShieldCheck,
  },
  qcFailed: {
    key:          'qc_failed',
    label:        'QC Failed',
    stageGroup:   'quality' as StageGroup,
    dotBg:        'bg-red-500',
    borderAccent: 'border-l-red-500',
    iconBg:       'bg-red-50 dark:bg-red-900/30',
    iconColor:    'text-red-600 dark:text-red-400',
    badgeClass:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    Icon: ShieldX,
  },
  qcHold: {
    key:          'qc_hold',
    label:        'QC Hold',
    stageGroup:   'quality' as StageGroup,
    dotBg:        'bg-amber-400',
    borderAccent: 'border-l-amber-400',
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
    borderAccent: 'border-l-amber-400',
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
    borderAccent: 'border-l-indigo-400',
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
    borderAccent: 'border-l-yellow-500',
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
    borderAccent: 'border-l-amber-400',
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
    borderAccent: 'border-l-red-500',
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
    borderAccent: 'border-l-teal-500',
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
    borderAccent: 'border-l-red-600',
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
    borderAccent: 'border-l-cyan-400',
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
    borderAccent: 'border-l-purple-500',
    iconBg:       'bg-purple-50 dark:bg-purple-900/30',
    iconColor:    'text-purple-600 dark:text-purple-400',
    badgeClass:   'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    Icon: FileWarning,
  },
  system: {
    key:          'system',
    label:        'System Event',
    stageGroup:   'other' as StageGroup,
    dotBg:        'bg-gray-400',
    borderAccent: 'border-l-gray-400',
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
  'raw_material.released':     C.rawMaterial,
  'packaging.completed':       C.packaging,
  'packaging.started':         C.packaging,
  'distribution.shipped':      C.distribution,
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
