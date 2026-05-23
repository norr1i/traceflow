'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Bell, Check, XCircle, ShieldCheck, ClipboardList,
  Boxes, ShoppingCart, Users, Inbox, RefreshCw, FlaskConical,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import {
  mapLogToNotification,
  NOTIFICATION_ACTION_TYPES,
  SEVERITY_CONFIG,
  CATEGORY_CONFIG,
  getLastReadAt,
  setLastReadAt,
  countUnread,
  type AppNotification,
  type NotificationCategory,
} from '../lib/notifications'

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

const CATEGORY_ICON: Record<NotificationCategory, React.ElementType> = {
  qc_failure:  XCircle,
  qc_activity: ShieldCheck,
  production:  ClipboardList,
  inventory:   Boxes,
  sales:       ShoppingCart,
  team:        Users,
}

function NotificationIcon({ category }: { category: NotificationCategory }) {
  const cfg  = CATEGORY_CONFIG[category]
  const Icon = CATEGORY_ICON[category]
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cfg.iconBg}`}>
      <Icon size={14} strokeWidth={1.75} className={cfg.iconColor} />
    </span>
  )
}

// ── Types ──────────────────────────────────────────────────────────────────

type Filter   = 'all' | 'unread'
type DiagLine = { kind: 'ok' | 'err' | 'info'; text: string }

// ── Main component ─────────────────────────────────────────────────────────

export default function NotificationPanel() {
  const panelRef            = useRef<HTMLDivElement>(null)
  const { companyId }       = useAuth()

  const [open, setOpen]                   = useState(false)
  const [filter, setFilter]               = useState<Filter>('all')
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading]             = useState(false)
  const [lastReadAt, setLastReadAtState]  = useState<Date>(() => new Date(0))
  const [diagLines, setDiagLines]         = useState<DiagLine[]>([])
  const [diagRunning, setDiagRunning]     = useState(false)

  // Init read-state from localStorage (client-only)
  useEffect(() => {
    setLastReadAtState(getLastReadAt())
  }, [])

  // Fetch notifications from activity_logs
  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('id, action_type, message, actor_email, created_at')
        .in('action_type', NOTIFICATION_ACTION_TYPES)
        .order('created_at', { ascending: false })
        .limit(40)

      if (!error && data) {
        setNotifications(
          data.map(mapLogToNotification).filter((n): n is AppNotification => n !== null)
        )
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])
  useEffect(() => { if (open) fetchNotifications() }, [open, fetchNotifications])

  // Click-outside to close
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  function markAllRead() {
    const now = new Date()
    setLastReadAt(now)
    setLastReadAtState(now)
  }

  async function runDiagnostic() {
    setDiagRunning(true)
    setDiagLines([])
    const lines: DiagLine[] = []

    function push(kind: DiagLine['kind'], text: string) {
      lines.push({ kind, text })
      console.log(`[diag][${kind}]`, text)
      // update state incrementally so user sees progress
      setDiagLines([...lines])
    }

    // Step 1 — auth state
    const { data: { user: authUser } } = await supabase.auth.getUser()
    push('info', `auth.uid: ${authUser?.id ?? 'null'}`)
    push('info', `auth.email: ${authUser?.email ?? 'null'}`)
    push('info', `useAuth companyId: ${companyId ?? 'null'}`)

    // Step 2 — DB-side company
    const { data: rpcData, error: rpcErr } = await supabase.rpc('get_my_company_id')
    if (rpcErr) push('err', `get_my_company_id() → ${rpcErr.message} (${rpcErr.code})`)
    else        push('ok',  `get_my_company_id() → ${rpcData ?? 'null'}`)

    const cid = companyId ?? rpcData ?? null

    // Step 3 — build payload
    const payload = {
      company_id:    cid,
      actor_user_id: authUser?.id    ?? null,
      actor_email:   authUser?.email ?? null,
      action_type:   'test.notification',
      entity_type:   'debug',
      entity_id:     null,
      message:       'Test notification from current session',
      metadata:      null,
    }
    push('info', `payload.company_id: ${cid ?? 'null'}`)

    // Step 4 — INSERT
    const { data: inserted, error: insErr } = await supabase
      .from('activity_logs')
      .insert(payload)
      .select()
      .single()

    if (insErr) {
      push('err', `INSERT failed [${insErr.code}]: ${insErr.message}`)
      if (insErr.hint)    push('err', `  hint: ${insErr.hint}`)
      if (insErr.details) push('err', `  details: ${insErr.details}`)
    } else {
      push('ok', `INSERT success → id: ${inserted?.id}`)
    }

    // Step 5 — SELECT back
    const { data: fetched, error: fetchErr } = await supabase
      .from('activity_logs')
      .select('id, action_type, message, created_at')
      .in('action_type', NOTIFICATION_ACTION_TYPES)
      .order('created_at', { ascending: false })
      .limit(10)

    if (fetchErr) {
      push('err', `SELECT failed [${fetchErr.code}]: ${fetchErr.message}`)
    } else {
      push('ok', `SELECT → ${fetched?.length ?? 0} row(s)`)
      fetched?.slice(0, 3).forEach((r, i) =>
        push('info', `  [${i}] ${r.action_type} @ ${r.created_at}`)
      )
    }

    setDiagRunning(false)
    fetchNotifications()
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const unreadCount = countUnread(notifications, lastReadAt)
  const badgeCount  = Math.min(unreadCount, 99)

  const displayed = filter === 'unread'
    ? notifications.filter(n => new Date(n.created_at) > lastReadAt)
    : notifications

  type Group = { label: string; items: AppNotification[] }
  const groups: Group[] = []
  const today     = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)

  for (const n of displayed) {
    const d = new Date(n.created_at); d.setHours(0, 0, 0, 0)
    const label = d >= today ? 'Today' : d >= yesterday ? 'Yesterday' : 'Earlier'
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(n)
    else groups.push({ label, items: [n] })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div ref={panelRef} className="relative">

      {/* ── Bell button ── */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`relative p-2 rounded-lg transition-colors ${
          open
            ? 'bg-gray-100 dark:bg-white/[0.08] text-gray-700 dark:text-[#E2E8F0]'
            : 'text-gray-400 dark:text-[#525563] hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:text-gray-600 dark:hover:text-[#A8B3C0]'
        }`}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell size={15} strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white ring-1 ring-white dark:ring-[#07090E] leading-none">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 flex flex-col rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#0D1117] shadow-xl shadow-black/10 dark:shadow-black/50"
          style={{ width: 'min(380px, 100vw - 24px)' }}
        >

          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 dark:border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <p className="text-[13px] font-semibold text-gray-900 dark:text-[#E2E8F0]">
                Notifications
              </p>
              {unreadCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {loading && <RefreshCw size={12} className="animate-spin text-gray-400 dark:text-[#525563]" />}
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#4a8fb9] hover:bg-[#4a8fb9]/10 transition-colors"
                >
                  <Check size={11} /> Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex border-b border-gray-100 dark:border-white/[0.06] px-4">
            {(['all', 'unread'] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`pb-2.5 pt-2.5 mr-5 text-[12px] font-medium transition-colors border-b-2 -mb-px ${
                  filter === f
                    ? 'border-[#4a8fb9] text-[#4a8fb9]'
                    : 'border-transparent text-gray-400 dark:text-[#525563] hover:text-gray-600 dark:hover:text-[#8B9BAA]'
                }`}
              >
                {f === 'all' ? 'All' : 'Unread'}
                {f === 'unread' && unreadCount > 0 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500/15 px-0.5 text-[9px] font-bold text-red-600 dark:text-red-400">
                    {badgeCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── DIAGNOSTIC SECTION — always visible ── */}
          <div className="border-b border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.06] px-4 py-3">
            <button
              onClick={runDiagnostic}
              disabled={diagRunning}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300 dark:border-amber-500/40 bg-white dark:bg-amber-500/10 px-3 py-2 text-[12px] font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
            >
              <FlaskConical size={13} />
              {diagRunning ? 'Running pipeline test…' : 'Run pipeline test'}
            </button>

            {diagLines.length > 0 && (
              <div className="mt-2 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-900 p-2 max-h-[200px] overflow-y-auto">
                {diagLines.map((l, i) => (
                  <p
                    key={i}
                    className={`font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all ${
                      l.kind === 'err'  ? 'text-red-400'
                      : l.kind === 'ok' ? 'text-emerald-400'
                      :                   'text-gray-400'
                    }`}
                  >
                    {l.kind === 'err' ? '✗ ' : l.kind === 'ok' ? '✓ ' : '· '}{l.text}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-[360px] overflow-y-auto">
            {groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-white/[0.05]">
                  <Inbox size={20} strokeWidth={1.5} className="text-gray-400 dark:text-[#525563]" />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-gray-600 dark:text-[#8B9BAA]">
                    {filter === 'unread' ? "You're all caught up" : 'No notifications yet'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-400 dark:text-[#525563]">
                    {filter === 'unread'
                      ? 'No unread notifications.'
                      : 'Activity events will appear here.'}
                  </p>
                </div>
                {filter === 'unread' && notifications.length > 0 && (
                  <button
                    onClick={() => setFilter('all')}
                    className="text-[11px] text-[#4a8fb9] hover:underline"
                  >
                    View all notifications
                  </button>
                )}
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  <div className="sticky top-0 z-10 bg-gray-50 dark:bg-[#0D1117] border-b border-gray-100 dark:border-white/[0.04] px-4 py-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#525563]">
                      {group.label}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                    {group.items.map((notif) => {
                      const isUnread = new Date(notif.created_at) > lastReadAt
                      const severity = SEVERITY_CONFIG[notif.severity]
                      return (
                        <div
                          key={notif.id}
                          className={`relative flex gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02] ${
                            isUnread ? 'bg-[#4a8fb9]/[0.03] dark:bg-[#4a8fb9]/[0.04]' : ''
                          }`}
                        >
                          <div
                            className={`absolute left-0 top-3 bottom-3 w-[2.5px] rounded-r-full ${
                              isUnread ? severity.borderColor : 'bg-transparent'
                            }`}
                          />
                          <div className="mt-0.5 shrink-0">
                            <NotificationIcon category={notif.category} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[11px] font-semibold uppercase tracking-wide ${severity.labelColor}`}>
                                {notif.title}
                              </span>
                              {isUnread && (
                                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${severity.dotColor}`} />
                              )}
                            </div>
                            <p className="mt-0.5 text-[12px] leading-snug text-gray-700 dark:text-[#C9C7C4] line-clamp-2">
                              {notif.message}
                            </p>
                            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-[#525563]">
                              {notif.actor && (
                                <>
                                  <span className="truncate max-w-[120px]">{notif.actor}</span>
                                  <span>·</span>
                                </>
                              )}
                              <span className="shrink-0">{timeAgo(notif.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 dark:border-white/[0.06] px-4 py-2.5 flex items-center justify-between">
            <p className="text-[11px] text-gray-400 dark:text-[#525563]">
              {notifications.length} notification{notifications.length !== 1 ? 's' : ''} · last 7 days
            </p>
            <button
              onClick={() => fetchNotifications()}
              className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-[#525563] hover:text-gray-600 dark:hover:text-[#8B9BAA] transition-colors"
            >
              <RefreshCw size={10} /> Refresh
            </button>
          </div>

        </div>
      )}
    </div>
  )
}
