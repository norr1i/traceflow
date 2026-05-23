// ── Notification system ───────────────────────────────────────────────────
// Derives UI notifications from the activity_logs table.
// Read state is tracked entirely in localStorage — no backend required.

export type NotificationSeverity = 'critical' | 'warning' | 'info'

export type NotificationCategory =
  | 'qc_failure'
  | 'qc_activity'
  | 'production'
  | 'inventory'
  | 'sales'
  | 'team'

export type AppNotification = {
  id: string
  category: NotificationCategory
  severity: NotificationSeverity
  title: string
  message: string
  actor: string | null
  created_at: string
  action_type: string
}

// ── Action type → notification metadata ──────────────────────────────────

type NotificationMeta = {
  category: NotificationCategory
  severity: NotificationSeverity
  title: string
}

const ACTION_META: Record<string, NotificationMeta> = {
  // QC
  'qc_inspection.created':   { category: 'qc_activity', severity: 'info',     title: 'Inspection Started' },
  'qc_inspection.passed':    { category: 'qc_activity', severity: 'info',     title: 'QC Passed'          },
  'qc_inspection.failed':    { category: 'qc_failure',  severity: 'critical', title: 'QC Failure'         },
  'qc_inspection.hold':      { category: 'qc_activity', severity: 'warning',  title: 'QC On Hold'         },
  'qc_result.added':         { category: 'qc_activity', severity: 'info',     title: 'QC Result Added'    },
  // Inventory
  'raw_material.created':    { category: 'inventory',   severity: 'info',     title: 'Material Added'     },
  'raw_material.imported':   { category: 'inventory',   severity: 'info',     title: 'Inventory Import'   },
  // Production
  'product.created':         { category: 'production',  severity: 'info',     title: 'Product Added'      },
  'product.imported':        { category: 'production',  severity: 'info',     title: 'Product Import'     },
  'production_order.created':{ category: 'production',  severity: 'info',     title: 'New Order'          },
  'production_order.updated':{ category: 'production',  severity: 'info',     title: 'Order Updated'      },
  // Sales
  'sale.created':            { category: 'sales',       severity: 'info',     title: 'New Sale'           },
  'sale.imported':           { category: 'sales',       severity: 'info',     title: 'Sales Import'       },
  // Team
  'invitation.created':      { category: 'team',        severity: 'info',     title: 'Team Invitation'    },
  'team.role_changed':       { category: 'team',        severity: 'warning',  title: 'Role Changed'       },
}

// Only these action types generate notifications (high-signal events only)
export const NOTIFICATION_ACTION_TYPES = Object.keys(ACTION_META)

// ── Severity UI config ────────────────────────────────────────────────────

export const SEVERITY_CONFIG: Record<NotificationSeverity, {
  dotColor: string
  borderColor: string
  labelColor: string
}> = {
  critical: {
    dotColor:    'bg-red-500',
    borderColor: 'border-red-500',
    labelColor:  'text-red-600 dark:text-red-400',
  },
  warning: {
    dotColor:    'bg-amber-400',
    borderColor: 'border-amber-400',
    labelColor:  'text-amber-600 dark:text-amber-400',
  },
  info: {
    dotColor:    'bg-[#4a8fb9]',
    borderColor: 'border-[#4a8fb9]',
    labelColor:  'text-[#4a8fb9]',
  },
}

// ── Category UI config ────────────────────────────────────────────────────

export const CATEGORY_CONFIG: Record<NotificationCategory, {
  iconBg: string
  iconColor: string
  label: string
}> = {
  qc_failure:  { iconBg: 'bg-red-500/10',      iconColor: 'text-red-500 dark:text-red-400',           label: 'QC'         },
  qc_activity: { iconBg: 'bg-emerald-500/10',   iconColor: 'text-emerald-600 dark:text-emerald-400',   label: 'QC'         },
  production:  { iconBg: 'bg-orange-500/10',    iconColor: 'text-orange-500 dark:text-orange-400',     label: 'Production' },
  inventory:   { iconBg: 'bg-amber-500/10',     iconColor: 'text-amber-600 dark:text-amber-400',       label: 'Inventory'  },
  sales:       { iconBg: 'bg-violet-500/10',    iconColor: 'text-violet-600 dark:text-violet-400',     label: 'Sales'      },
  team:        { iconBg: 'bg-[#4a8fb9]/10',     iconColor: 'text-[#4a8fb9]',                           label: 'Team'       },
}

// ── Log → Notification mapper ─────────────────────────────────────────────

export function mapLogToNotification(log: {
  id: string
  action_type: string
  message: string
  actor_email: string | null
  created_at: string
}): AppNotification | null {
  const meta = ACTION_META[log.action_type]
  if (!meta) return null
  return {
    id: log.id,
    category: meta.category,
    severity: meta.severity,
    title: meta.title,
    message: log.message,
    actor: log.actor_email,
    created_at: log.created_at,
    action_type: log.action_type,
  }
}

// ── localStorage read-state helpers ──────────────────────────────────────

const LS_KEY = 'tf-notif-read-at'
const DEFAULT_LOOKBACK_DAYS = 7

export function getLastReadAt(): Date {
  try {
    const stored = localStorage.getItem(LS_KEY)
    if (stored) return new Date(stored)
  } catch {}
  // First visit: treat everything older than 7 days as read
  const d = new Date()
  d.setDate(d.getDate() - DEFAULT_LOOKBACK_DAYS)
  return d
}

export function setLastReadAt(date: Date = new Date()): void {
  try { localStorage.setItem(LS_KEY, date.toISOString()) } catch {}
}

export function countUnread(notifications: AppNotification[], lastReadAt: Date): number {
  return notifications.filter(n => new Date(n.created_at) > lastReadAt).length
}
