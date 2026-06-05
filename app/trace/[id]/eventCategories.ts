import {
  PackagePlus,
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
  type LucideIcon,
} from 'lucide-react'

export type EventCategory = {
  key: string
  label: string
  dotBg: string
  iconBg: string
  iconColor: string
  badgeClass: string
  Icon: LucideIcon
}

const C = {
  productionCreated: {
    key: 'production_created',
    label: 'Production Created',
    dotBg: 'bg-blue-400',
    iconBg: 'bg-blue-50 dark:bg-blue-900/30',
    iconColor: 'text-blue-500 dark:text-blue-400',
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    Icon: PackagePlus,
  },
  productionStarted: {
    key: 'production_started',
    label: 'Production Started',
    dotBg: 'bg-blue-500',
    iconBg: 'bg-blue-50 dark:bg-blue-900/30',
    iconColor: 'text-blue-600 dark:text-blue-400',
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    Icon: Play,
  },
  productionCompleted: {
    key: 'production_completed',
    label: 'Production Completed',
    dotBg: 'bg-emerald-500',
    iconBg: 'bg-emerald-50 dark:bg-emerald-900/30',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
  rawMaterial: {
    key: 'raw_material',
    label: 'Raw Material',
    dotBg: 'bg-orange-400',
    iconBg: 'bg-orange-50 dark:bg-orange-900/30',
    iconColor: 'text-orange-500 dark:text-orange-400',
    badgeClass: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    Icon: Layers,
  },
  qcPassed: {
    key: 'qc_passed',
    label: 'QC Passed',
    dotBg: 'bg-emerald-500',
    iconBg: 'bg-emerald-50 dark:bg-emerald-900/30',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Icon: ShieldCheck,
  },
  qcFailed: {
    key: 'qc_failed',
    label: 'QC Failed',
    dotBg: 'bg-red-500',
    iconBg: 'bg-red-50 dark:bg-red-900/30',
    iconColor: 'text-red-600 dark:text-red-400',
    badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    Icon: ShieldX,
  },
  qcHold: {
    key: 'qc_hold',
    label: 'QC Hold',
    dotBg: 'bg-amber-400',
    iconBg: 'bg-amber-50 dark:bg-amber-900/30',
    iconColor: 'text-amber-500 dark:text-amber-400',
    badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    Icon: ShieldAlert,
  },
  qcCheckpoint: {
    key: 'qc_checkpoint',
    label: 'QC Checkpoint',
    dotBg: 'bg-amber-400',
    iconBg: 'bg-amber-50 dark:bg-amber-900/30',
    iconColor: 'text-amber-500 dark:text-amber-400',
    badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    Icon: Clock,
  },
  distribution: {
    key: 'distribution',
    label: 'Distribution',
    dotBg: 'bg-teal-500',
    iconBg: 'bg-teal-50 dark:bg-teal-900/30',
    iconColor: 'text-teal-600 dark:text-teal-400',
    badgeClass: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
    Icon: Truck,
  },
  recall: {
    key: 'recall',
    label: 'Recall Issued',
    dotBg: 'bg-red-600',
    iconBg: 'bg-red-50 dark:bg-red-900/40',
    iconColor: 'text-red-700 dark:text-red-400',
    badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 ring-1 ring-inset ring-red-400',
    Icon: AlertTriangle,
  },
  capa: {
    key: 'capa',
    label: 'CAPA',
    dotBg: 'bg-purple-500',
    iconBg: 'bg-purple-50 dark:bg-purple-900/30',
    iconColor: 'text-purple-600 dark:text-purple-400',
    badgeClass: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    Icon: FileWarning,
  },
  system: {
    key: 'system',
    label: 'System Event',
    dotBg: 'bg-gray-400',
    iconBg: 'bg-gray-50 dark:bg-gray-700/40',
    iconColor: 'text-gray-500 dark:text-gray-400',
    badgeClass: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    Icon: Activity,
  },
} satisfies Record<string, EventCategory>

const EXACT: Record<string, EventCategory> = {
  'production.created':      C.productionCreated,
  'production.started':      C.productionStarted,
  'production.completed':    C.productionCompleted,
  'qc.pass':                 C.qcPassed,
  'qc_inspection.passed':    C.qcPassed,
  'qc.fail':                 C.qcFailed,
  'qc_inspection.failed':    C.qcFailed,
  'qc.hold':                 C.qcHold,
  'qc_inspection.hold':      C.qcHold,
  'distribution.shipped':    C.distribution,
  'distribution.created':    C.distribution,
  'recall.issued':           C.recall,
  'recall.created':          C.recall,
  'capa.created':            C.capa,
  'capa.opened':             C.capa,
  'capa.closed':             C.capa,
}

export function classifyEvent(eventType: string): EventCategory {
  if (EXACT[eventType]) return EXACT[eventType]
  if (eventType === 'production.completed')         return C.productionCompleted
  if (eventType.startsWith('production.'))          return C.productionStarted
  if (eventType.startsWith('raw_material.') ||
      eventType.startsWith('material.'))            return C.rawMaterial
  if (eventType.startsWith('qc') &&
      (eventType.includes('pass') || eventType.includes('passed'))) return C.qcPassed
  if (eventType.startsWith('qc') &&
      (eventType.includes('fail') || eventType.includes('failed'))) return C.qcFailed
  if (eventType.startsWith('qc') &&
      eventType.includes('hold'))                   return C.qcHold
  if (eventType.startsWith('qc'))                   return C.qcCheckpoint
  if (eventType.startsWith('distribution.'))        return C.distribution
  if (eventType.startsWith('recall.'))              return C.recall
  if (eventType.startsWith('capa.'))                return C.capa
  return C.system
}

export function isScanEvent(sourceTable: string): boolean {
  return sourceTable === 'scan_events'
}
