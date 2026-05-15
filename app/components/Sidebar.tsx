'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Package,
  ClipboardList, ShieldCheck, ShoppingCart,
  Menu, X, Boxes, Sun, Moon, LogOut, AlertTriangle,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'

const nav = [
  { label: 'Dashboard',         href: '/',               icon: LayoutDashboard },
  { label: 'Products',          href: '/products',        icon: Package },
  { label: 'Raw Materials',     href: '/raw-materials',   icon: Boxes },
  { label: 'Production Orders', href: '/production',      icon: ClipboardList },
  { label: 'Quality Control',   href: '/quality-control', icon: ShieldCheck },
  { label: 'Sales',             href: '/sales',           icon: ShoppingCart },
  { label: 'Recall',            href: '/recall',          icon: AlertTriangle },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const { user } = useAuth()

  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  function toggleDark() {
    // Read live DOM state so we never operate on stale React state
    const isDark = document.documentElement.classList.toggle('dark')
    setDark(isDark)
    try { localStorage.setItem('tf-theme', isDark ? 'dark' : 'light') } catch {}
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <>
      {/* ── Mobile top bar ── */}
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white text-xs font-bold">TF</div>
          <span className="text-base font-bold text-gray-900 dark:text-white">TraceFlow</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleDark}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={() => setOpen(!open)}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* ── Mobile overlay ── */}
      {open && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* ── Sidebar panel ── */}
      <aside
        className={`
          fixed top-0 left-0 z-30 h-full w-60 flex flex-col
          bg-gray-950 text-white
          transition-transform duration-200 ease-in-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:relative lg:translate-x-0
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-gray-800">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-xs">
            TF
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight leading-none">TraceFlow</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Manufacturing OS</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {nav.map(({ label, href, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`
                  flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors
                  ${active
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'}
                `}
              >
                <Icon size={17} className="shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-gray-800 space-y-1">
          {/* User email */}
          {user && (
            <div className="px-3 py-2 mb-1">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">Signed in as</p>
              <p className="mt-0.5 text-xs text-gray-300 truncate">{user.email}</p>
            </div>
          )}

          {/* Dark mode toggle */}
          <button
            onClick={toggleDark}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
            {dark ? 'Light mode' : 'Dark mode'}
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-red-900/40 hover:text-red-400 transition-colors"
          >
            <LogOut size={17} />
            Sign out
          </button>

          <p className="px-3 text-[10px] text-gray-600">TraceFlow v1.0</p>
        </div>
      </aside>
    </>
  )
}
