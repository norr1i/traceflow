'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell, Check, XCircle, ShieldCheck, ClipboardList,
  Boxes, ShoppingCart, Users, Inbox, RefreshCw,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { useRole } from '../lib/auth-context'
import { hasPermission, type Permission } from '../lib/permissions'
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
import { useT, fmtNum, type Lang } from '../lib/i18n'

// ── Helpers ────────────────────────────────────────────────────────────────

type TFn = (key: string, vars?: Record<string, string | number>) => string

function timeAgo(iso: string, t: TFn, lang: Lang): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)  return t('common.just_now')
  if (mins < 60) return t('common.time_ago_m', { n: fmtNum(mins, lang) })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return t('common.time_ago_h', { n: fmtNum(hrs, lang) })
  const days = Math.floor(hrs / 24)
  if (days === 1) return t('common.yesterday')
  return t('common.time_ago_d', { n: fmtNum(days, lang) })
}

// entity_type value → app route
const ENTITY_ROUTE: Record<string, string> = {
  production_order: '/production',
  raw_material:     '/raw-materials',
  product:          '/products',
  qc_inspection:    '/quality-control',
  qc_result:        '/quality-control',
  sale:             '/sales',
  recall:           '/recall',
  team_member:      '/team',
  invitation:       '/team',
}

// route → permission required to navigate there
const ROUTE_PERMISSION: Record<string, Permission> = {
  '/production':      'view:production',
  '/raw-materials':   'view:raw-materials',
  '/products':        'view:products',
  '/quality-control': 'view:quality-control',
  '/sales':           'view:sales',
  '/recall':          'view:recall',
  '/team':            'view:team',
}

// ── Category icon map ──────────────────────────────────────────────────────

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
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${cfg.iconBg}`}>
      <Icon size={13} strokeWidth={1.75} className={cfg.iconColor} />
    </span>
  )
}

// ── Types ──────────────────────────────────────────────────────────────────

type Filter = 'all' | 'unread'

type ActivityLogRow = {
  id: string
  action_type: string
  message: string
  actor_email: string | null
  created_at: string
  entity_type: string | null
  entity_id: string | null
}

// ── Main component ─────────────────────────────────────────────────────────

export default function NotificationPanel() {
  const panelRef      = useRef<HTMLDivElement>(null)
  const bellRef       = useRef<HTMLSpanElement>(null)
  const { companyId } = useAuth()
  const role          = useRole()
  const router        = useRouter()
  const { t, lang }   = useT()

  // Persists across renders; seeded by the initial fetch so realtime
  // reconnect replays for already-loaded rows are silently dropped.
  const seenIds = useRef(new Set<string>())

  const [open, setOpen]                   = useState(false)
  const [filter, setFilter]               = useState<Filter>('all')
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading]             = useState(false)
  const [lastReadAt, setLastReadAtState]  = useState<Date>(() => new Date(0))

  // Init read-state from localStorage (client-only)
  useEffect(() => {
    setLastReadAtState(getLastReadAt())
  }, [])

  // ── Initial fetch ──────────────────────────────────────────────────────────

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('id, action_type, message, actor_email, created_at, entity_type, entity_id')
        .in('action_type', NOTIFICATION_ACTION_TYPES)
        .order('created_at', { ascending: false })
        .limit(40)

      if (!error && data) {
        const mapped = data
          .map(mapLogToNotification)
          .filter((n): n is AppNotification => n !== null)

        mapped.forEach(n => seenIds.current.add(n.id))
        setNotifications(mapped)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])
  useEffect(() => { if (open) fetchNotifications() }, [open, fetchNotifications])

  // ── Realtime subscription ──────────────────────────────────────────────────

  useEffect(() => {
    if (!companyId) return

    const channel = supabase
      .channel(`activity_logs:company:${companyId}`)
      .on<ActivityLogRow>(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'activity_logs',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const row = payload.new

          if (!NOTIFICATION_ACTION_TYPES.includes(row.action_type)) return
          if (seenIds.current.has(row.id)) return
          seenIds.current.add(row.id)

          const notif = mapLogToNotification(row)
          if (!notif) return

          setNotifications(prev => [notif, ...prev])

          // Animate the bell — add class, then remove after animation completes
          if (bellRef.current) {
            bellRef.current.classList.remove('bell-ring')
            // Force reflow so re-adding the class re-triggers the animation
            void bellRef.current.offsetWidth
            bellRef.current.classList.add('bell-ring')
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [companyId])

  // ── Click-outside / Escape ─────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // ── Mark all read ──────────────────────────────────────────────────────────

  function markAllRead() {
    const now = new Date()
    setLastReadAt(now)
    setLastReadAtState(now)
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function handleNotifClick(notif: AppNotification) {
    const route = ENTITY_ROUTE[notif.entity_type ?? '']
    if (!route) return
    const perm = ROUTE_PERMISSION[route]
    if (perm && !hasPermission(role, perm)) return  // silently respect RBAC
    const url = notif.entity_id ? `${route}?highlight=${notif.entity_id}` : route
    router.push(url)
    setOpen(false)
  }

  function isNavigable(notif: AppNotification): boolean {
    const route = ENTITY_ROUTE[notif.entity_type ?? '']
    if (!route) return false
    const perm = ROUTE_PERMISSION[route]
    return !perm || hasPermission(role, perm)
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
    const label = d >= today ? t('notifications.today') : d >= yesterday ? t('notifications.yesterday') : t('notifications.earlier')
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(n)
    else groups.push({ label, items: [n] })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div ref={panelRef} className="relative">

      {/* Bell button */}
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
        {/* ref on the icon span so the animation is isolated from the button */}
        <span ref={bellRef} className="block">
          <Bell size={15} strokeWidth={1.75} />
        </span>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white ring-1 ring-white dark:ring-[#07090E] leading-none">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 flex flex-col rounded-xl border border-gray-200/70 dark:border-white/[0.07] bg-white/95 dark:bg-[#0D1117]/98 backdrop-blur-md shadow-2xl shadow-black/[0.12] dark:shadow-black/60"
          style={{ width: 'min(376px, 100vw - 24px)' }}
        >

          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 dark:border-white/[0.05] px-4 py-3">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold tracking-[-0.01em] text-gray-900 dark:text-[#E2E8F0]">
                {t('notifications.title')}
              </p>
              {unreadCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400 leading-none">
                  {unreadCount} {t('notifications.new')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {loading && <RefreshCw size={11} className="animate-spin text-gray-300 dark:text-[#3D4451]" />}
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#4a8fb9] hover:bg-[#4a8fb9]/10 transition-colors"
                >
                  <Check size={10} /> {t('notifications.mark_all_read')}
                </button>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex border-b border-gray-100 dark:border-white/[0.05] px-4">
            {(['all', 'unread'] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`py-2 mr-5 text-[11.5px] font-medium transition-colors border-b-2 -mb-px ${
                  filter === f
                    ? 'border-[#4a8fb9] text-[#4a8fb9]'
                    : 'border-transparent text-gray-400 dark:text-[#525563] hover:text-gray-600 dark:hover:text-[#8B9BAA]'
                }`}
              >
                {f === 'all' ? t('notifications.all') : t('notifications.unread')}
                {f === 'unread' && unreadCount > 0 && (
                  <span className="ml-1.5 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-red-500/15 px-0.5 text-[9px] font-bold text-red-600 dark:text-red-400 leading-none">
                    {badgeCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Notification list */}
          <div className="max-h-[420px] overflow-y-auto overscroll-contain">
            {groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-10 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-white/[0.04]">
                  <Inbox size={17} strokeWidth={1.5} className="text-gray-400 dark:text-[#525563]" />
                </div>
                <div>
                  <p className="text-[12.5px] font-medium text-gray-600 dark:text-[#8B9BAA]">
                    {filter === 'unread' ? t('notifications.all_caught_up') : t('notifications.no_notifications')}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-400 dark:text-[#525563]">
                    {filter === 'unread' ? t('notifications.no_unread') : t('notifications.activity_appears')}
                  </p>
                </div>
                {filter === 'unread' && notifications.length > 0 && (
                  <button onClick={() => setFilter('all')} className="text-[11px] text-[#4a8fb9] hover:underline">
                    {t('notifications.view_all')}
                  </button>
                )}
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  {/* Date group header */}
                  <div className="sticky top-0 z-10 bg-gray-50/90 dark:bg-[#0B0F17]/90 backdrop-blur-sm border-b border-gray-100/80 dark:border-white/[0.03] px-4 py-1">
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-[#3D4451]">
                      {group.label}
                    </p>
                  </div>

                  {/* Notification rows */}
                  <div className="divide-y divide-gray-100/70 dark:divide-white/[0.03]">
                    {group.items.map((notif) => {
                      const isUnread   = new Date(notif.created_at) > lastReadAt
                      const severity   = SEVERITY_CONFIG[notif.severity]
                      const navigable  = isNavigable(notif)

                      return (
                        <div
                          key={notif.id}
                          onClick={() => handleNotifClick(notif)}
                          className={[
                            'group relative flex gap-2.5 px-4 py-2.5 transition-colors duration-150',
                            navigable ? 'cursor-pointer' : 'cursor-default',
                            isUnread
                              ? 'bg-[#4a8fb9]/[0.025] dark:bg-[#4a8fb9]/[0.035] hover:bg-[#4a8fb9]/[0.05] dark:hover:bg-[#4a8fb9]/[0.06]'
                              : 'hover:bg-gray-50/80 dark:hover:bg-white/[0.015]',
                          ].join(' ')}
                        >
                          {/* Severity left bar — visible only when unread */}
                          <div
                            className={`absolute start-0 top-2.5 bottom-2.5 w-[2.5px] rounded-e-full transition-opacity ${
                              isUnread ? `${severity.borderColor} opacity-100` : 'opacity-0'
                            }`}
                          />

                          {/* Category icon */}
                          <div className="mt-0.5 shrink-0">
                            <NotificationIcon category={notif.category} />
                          </div>

                          {/* Content */}
                          <div className="min-w-0 flex-1">
                            {/* Title row */}
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[10.5px] font-semibold uppercase tracking-[0.06em] leading-none ${severity.labelColor}`}>
                                {notif.title}
                              </span>
                              {isUnread && (
                                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${severity.dotColor}`} />
                              )}
                            </div>

                            {/* Message */}
                            <p className="mt-0.5 text-[12px] leading-[1.45] text-gray-700 dark:text-[#B8BCC8] line-clamp-2">
                              {notif.message}
                            </p>

                            {/* Meta row */}
                            <div className="mt-1 flex items-center gap-1 text-[10px] text-gray-400 dark:text-[#3D4451]">
                              {notif.actor && (
                                <>
                                  <span className="truncate max-w-[110px] font-medium">{notif.actor.split('@')[0]}</span>
                                  <span className="text-gray-300 dark:text-[#2D3340]">·</span>
                                </>
                              )}
                              <span className="shrink-0">{timeAgo(notif.created_at, t, lang)}</span>
                              {navigable && (
                                <>
                                  <span className="text-gray-300 dark:text-[#2D3340]">·</span>
                                  <span className="shrink-0 text-[#4a8fb9] opacity-0 group-hover:opacity-100 transition-opacity">
                                    {t('notifications.view')}
                                  </span>
                                </>
                              )}
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
          <div className="border-t border-gray-100 dark:border-white/[0.05] px-4 py-2 flex items-center justify-between">
            <p className="text-[10.5px] text-gray-400 dark:text-[#3D4451]">
              {notifications.length} {notifications.length !== 1 ? t('notifications.events_live') : t('notifications.event_live')}
            </p>
            <button
              onClick={() => fetchNotifications()}
              className="flex items-center gap-1 text-[10.5px] text-gray-400 dark:text-[#3D4451] hover:text-gray-600 dark:hover:text-[#6B7280] transition-colors"
            >
              <RefreshCw size={9} /> {t('notifications.refresh')}
            </button>
          </div>

        </div>
      )}
    </div>
  )
}
