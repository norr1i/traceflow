'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '../lib/auth-context'
import { ROLE_META } from '../lib/roles'
import { hasPermission } from '../lib/permissions'
import { useT } from '../lib/i18n'
import { Search, ChevronDown, Sun, Moon, LogOut, Settings, RefreshCw, Globe } from 'lucide-react'
import NotificationPanel from './NotificationPanel'
import GlobalSearch from './GlobalSearch'

const PAGE_TITLE_KEYS: Record<string, string> = {
  '/':               'page_title./',
  '/products':       'page_title./products',
  '/raw-materials':  'page_title./raw-materials',
  '/production':     'page_title./production',
  '/quality-control':'page_title./quality-control',
  '/sales':          'page_title./sales',
  '/recall':         'page_title./recall',
  '/team':           'page_title./team',
}

export default function Topbar({
  onRefresh,
  refreshing,
}: {
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const pathname  = usePathname()
  const router    = useRouter()
  const { user, role, companyName, signOut } = useAuth()
  const { t, lang, setLang } = useT()

  const [searchOpen,    setSearchOpen]    = useState(false)
  const [userMenuOpen,  setUserMenuOpen]  = useState(false)
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  const titleKey  = PAGE_TITLE_KEYS[pathname] ?? 'page_title./'
  const title     = t(titleKey)
  const roleMeta  = role ? (ROLE_META[role] ?? ROLE_META['manager']) : null
  const initials  = user?.email?.[0]?.toUpperCase() ?? '?'
  const username  = user?.email?.split('@')[0] ?? ''

  // ⌘K / Ctrl+K shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(o => !o)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  function toggleDark() {
    const isDark = document.documentElement.classList.toggle('dark')
    setDark(isDark)
    try { localStorage.setItem('tf-theme', isDark ? 'dark' : 'light') } catch {}
  }

  async function handleLogout() {
    setUserMenuOpen(false)
    await signOut()
    router.replace('/login')
  }

  const canManageTeam = hasPermission(role, 'view:team')

  return (
    <>
      <header className="topbar-surface relative z-20 flex h-14 shrink-0 items-center gap-3 px-5">

        {/* Page title */}
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <h1 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-[#E2E8F0] truncate">
            {title}
          </h1>
          {companyName && (
            <span className="hidden sm:inline-flex items-center rounded-md border border-gray-200 dark:border-white/[0.07] bg-gray-100 dark:bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:text-[#525563] truncate max-w-[180px]">
              {companyName}
            </span>
          )}
        </div>

        {/* Search trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          className="hidden md:flex items-center gap-2 rounded-lg border border-gray-200 dark:border-white/[0.07] bg-gray-100 dark:bg-white/[0.03] px-3 py-1.5 w-44 hover:border-gray-300 dark:hover:border-white/[0.10] hover:bg-gray-50 dark:hover:bg-white/[0.05] transition-all duration-150 cursor-text"
        >
          <Search size={13} className="shrink-0 text-gray-400 dark:text-[#525563]" />
          <span className="flex-1 text-start text-[12px] text-gray-400 dark:text-[#525563]">
            {t('topbar.search_placeholder')}
          </span>
          <kbd className="hidden lg:block shrink-0 rounded border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.03] px-1 py-0.5 text-[9px] font-medium text-gray-400 dark:text-[#525563]">
            ⌘K
          </kbd>
        </button>

        {/* Refresh */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-gray-500 dark:text-[#6B7280] hover:bg-gray-100 dark:hover:bg-white/[0.05] hover:border-gray-300 dark:hover:border-white/[0.10] disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:block">{t('topbar.refresh')}</span>
          </button>
        )}

        {/* Notifications */}
        <NotificationPanel />

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(o => !o)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1C2E40] text-[11px] font-bold text-[#4a8fb9] ring-1 ring-[#4a8fb9]/30">
              {initials}
            </div>
            <div className="hidden sm:block text-start min-w-0">
              <p className="text-[12px] font-medium text-gray-700 dark:text-[#C9C7C4] truncate max-w-[100px] leading-none">
                {username}
              </p>
              {roleMeta && (
                <p className={`text-[10px] truncate leading-none mt-0.5 ${roleMeta.color.split(' ').find(c => c.startsWith('text-')) ?? 'text-gray-400'}`}>
                  {roleMeta.label}
                </p>
              )}
            </div>
            <ChevronDown
              size={12}
              className={`hidden sm:block shrink-0 text-gray-400 dark:text-[#525563] transition-transform duration-150 ${userMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Dropdown */}
          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
              <div className="absolute end-0 top-full z-20 mt-1.5 w-52 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#161B22] shadow-xl shadow-black/10 dark:shadow-black/50 py-1.5 overflow-hidden">

                {/* User info */}
                <div className="px-3 py-2.5 border-b border-gray-100 dark:border-white/[0.06] mb-1">
                  <p className="text-[12px] font-semibold text-gray-800 dark:text-[#E2E8F0] truncate">{user?.email}</p>
                  {roleMeta && (
                    <span className={`inline-flex mt-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${roleMeta.color}`}>
                      {roleMeta.label}
                    </span>
                  )}
                </div>

                {/* Theme toggle */}
                <button
                  onClick={toggleDark}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-gray-600 dark:text-[#A8B3C0] hover:bg-gray-50 dark:hover:bg-white/[0.05] transition-colors"
                >
                  {dark ? <Sun size={13} /> : <Moon size={13} />}
                  {dark ? t('topbar.switch_light') : t('topbar.switch_dark')}
                </button>

                {/* Language toggle */}
                <button
                  onClick={() => { setLang(lang === 'en' ? 'ar' : 'en'); setUserMenuOpen(false) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-gray-600 dark:text-[#A8B3C0] hover:bg-gray-50 dark:hover:bg-white/[0.05] transition-colors"
                >
                  <Globe size={13} />
                  {t('topbar.language_toggle')}
                </button>

                {/* Team settings */}
                {canManageTeam && (
                  <button
                    onClick={() => { setUserMenuOpen(false); router.push('/team') }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-gray-600 dark:text-[#A8B3C0] hover:bg-gray-50 dark:hover:bg-white/[0.05] transition-colors"
                  >
                    <Settings size={13} />
                    {t('topbar.team_settings')}
                  </button>
                )}

                <div className="my-1 border-t border-gray-100 dark:border-white/[0.06]" />

                {/* Sign out */}
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                >
                  <LogOut size={13} />
                  {t('topbar.sign_out')}
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Global search modal */}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}
