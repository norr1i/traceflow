'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '../lib/auth-context'
import { ROLE_META } from '../lib/roles'
import { hasPermission } from '../lib/permissions'
import { Bell, Search, ChevronDown, Sun, Moon, LogOut, Settings, RefreshCw } from 'lucide-react'

const PAGE_TITLES: Record<string, string> = {
  '/':               'Dashboard',
  '/products':       'Products',
  '/raw-materials':  'Raw Materials',
  '/production':     'Production Orders',
  '/quality-control':'Quality Control',
  '/sales':          'Sales',
  '/recall':         'Recall Center',
  '/team':           'Team Management',
}

type TopbarAction = {
  label: string
  icon: React.ElementType
  onClick: () => void
  variant?: 'default' | 'destructive'
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

  const [searchFocused, setSearchFocused] = useState(false)
  const [userMenuOpen,  setUserMenuOpen]  = useState(false)
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  const title    = PAGE_TITLES[pathname] ?? 'TraceFlow'
  const roleMeta = role ? (ROLE_META[role] ?? ROLE_META['manager']) : null
  const initials = user?.email?.[0]?.toUpperCase() ?? '?'
  const username = user?.email?.split('@')[0] ?? ''

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

      {/* Search */}
      <div
        className={`hidden md:flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-all duration-150 cursor-text ${
          searchFocused
            ? 'border-[#4a8fb9]/40 bg-white dark:bg-[#161B22] w-60 shadow-sm'
            : 'border-gray-200 dark:border-white/[0.07] bg-gray-100 dark:bg-white/[0.03] w-44 hover:border-gray-300 dark:hover:border-white/[0.10]'
        }`}
      >
        <Search size={13} className="shrink-0 text-gray-400 dark:text-[#525563]" />
        <input
          type="text"
          placeholder="Search…"
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          className="flex-1 min-w-0 bg-transparent text-[12px] text-gray-700 dark:text-[#C9C7C4] placeholder-gray-400 dark:placeholder-[#525563] outline-none"
        />
        <kbd className="hidden lg:block shrink-0 rounded border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.03] px-1 py-0.5 text-[9px] font-medium text-gray-400 dark:text-[#525563]">
          ⌘K
        </kbd>
      </div>

      {/* Refresh (only when provided) */}
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-gray-500 dark:text-[#6B7280] hover:bg-gray-100 dark:hover:bg-white/[0.05] hover:border-gray-300 dark:hover:border-white/[0.10] disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          <span className="hidden sm:block">Refresh</span>
        </button>
      )}

      {/* Notifications */}
      <button
        className="relative p-2 rounded-lg text-gray-400 dark:text-[#525563] hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:text-gray-600 dark:hover:text-[#A8B3C0] transition-colors"
        title="Notifications"
      >
        <Bell size={15} strokeWidth={1.75} />
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#4a8fb9] ring-1 ring-white dark:ring-[#07090E]" />
      </button>

      {/* User menu */}
      <div className="relative">
        <button
          onClick={() => setUserMenuOpen(o => !o)}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1C2E40] text-[11px] font-bold text-[#4a8fb9] ring-1 ring-[#4a8fb9]/30">
            {initials}
          </div>
          <div className="hidden sm:block text-left min-w-0">
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
            <div className="absolute right-0 top-full z-20 mt-1.5 w-52 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#161B22] shadow-xl shadow-black/10 dark:shadow-black/50 py-1.5 overflow-hidden">
              {/* User info header */}
              <div className="px-3 py-2.5 border-b border-gray-100 dark:border-white/[0.06] mb-1">
                <p className="text-[12px] font-semibold text-gray-800 dark:text-[#E2E8F0] truncate">{user?.email}</p>
                {roleMeta && (
                  <span className={`inline-flex mt-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${roleMeta.color}`}>
                    {roleMeta.label}
                  </span>
                )}
              </div>

              <button
                onClick={toggleDark}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-gray-600 dark:text-[#A8B3C0] hover:bg-gray-50 dark:hover:bg-white/[0.05] transition-colors"
              >
                {dark ? <Sun size={13} /> : <Moon size={13} />}
                {dark ? 'Switch to light' : 'Switch to dark'}
              </button>

              {canManageTeam && (
                <button
                  onClick={() => { setUserMenuOpen(false); router.push('/team') }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-gray-600 dark:text-[#A8B3C0] hover:bg-gray-50 dark:hover:bg-white/[0.05] transition-colors"
                >
                  <Settings size={13} />
                  Team settings
                </button>
              )}

              <div className="my-1 border-t border-gray-100 dark:border-white/[0.06]" />

              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
              >
                <LogOut size={13} />
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
