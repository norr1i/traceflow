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
import type { Role } from '../lib/roles'
import { ROLE_META } from '../lib/roles'

type NavItem = {
  label: string
  href: string
  icon: React.ElementType
  roles: Role[]
}

const nav: NavItem[] = [
  { label: 'Dashboard',         href: '/',               icon: LayoutDashboard, roles: ['admin', 'manager'] },
  { label: 'Products',          href: '/products',        icon: Package,         roles: ['admin', 'manager'] },
  { label: 'Raw Materials',     href: '/raw-materials',   icon: Boxes,           roles: ['admin', 'manager'] },
  { label: 'Production Orders', href: '/production',      icon: ClipboardList,   roles: ['admin', 'manager', 'inspector'] },
  { label: 'Quality Control',   href: '/quality-control', icon: ShieldCheck,     roles: ['admin', 'manager', 'inspector'] },
  { label: 'Sales',             href: '/sales',           icon: ShoppingCart,    roles: ['admin', 'manager'] },
  { label: 'Recall',            href: '/recall',          icon: AlertTriangle,   roles: ['admin', 'manager'] },
]

const rolePillColor: Record<string, string> = {
  admin:    'bg-violet-500/20 text-violet-300 border border-violet-500/30',
  manager:  'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  inspector:'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
}

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const { user, role, signOut } = useAuth()
  const visibleNav = role ? nav.filter(item => item.roles.includes(role)) : []

  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  function toggleDark() {
    const isDark = document.documentElement.classList.toggle('dark')
    setDark(isDark)
    try { localStorage.setItem('tf-theme', isDark ? 'dark' : 'light') } catch {}
  }

  async function handleLogout() {
    await signOut()
    router.replace('/login')
  }

  const sidebarContent = (
    <aside
      className={`
        fixed top-0 left-0 z-30 h-full w-[220px] flex flex-col
        bg-[#070d1b] border-r border-white/[0.06]
        transition-transform duration-200 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0
      `}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/[0.06]">
        <div className="
          flex h-8 w-8 shrink-0 items-center justify-center rounded-lg
          bg-gradient-to-br from-blue-500 to-violet-600
          shadow-[0_0_14px_rgba(139,92,246,0.5)]
          text-white font-bold text-xs tracking-tight
        ">
          TF
        </div>
        <div>
          <p className="text-sm font-bold tracking-tight leading-none text-white">TraceFlow</p>
          <p className="text-[10px] text-gray-500 mt-0.5 tracking-wide">Manufacturing OS</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {visibleNav.map(({ label, href, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`
                flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150
                ${active
                  ? 'bg-gradient-to-r from-blue-600/25 to-violet-600/20 border border-blue-500/25 text-white shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                  : 'text-gray-400 hover:bg-white/[0.05] hover:text-gray-200 border border-transparent'}
              `}
            >
              <Icon
                size={16}
                className={`shrink-0 transition-colors ${active ? 'text-blue-400' : ''}`}
              />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-white/[0.06] space-y-0.5">
        {/* User card */}
        {user && (
          <div className="
            mb-2 px-3 py-2.5 rounded-xl
            bg-white/[0.04] border border-white/[0.06]
          ">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-medium mb-0.5">
              Signed in as
            </p>
            <p className="text-xs text-gray-300 truncate font-medium">{user.email}</p>
            {role && (
              <span className={`mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${rolePillColor[role] ?? rolePillColor['manager']}`}>
                {ROLE_META[role].label}
              </span>
            )}
          </div>
        )}

        {/* Dark mode */}
        <button
          onClick={toggleDark}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-white/[0.05] hover:text-gray-200 transition-colors"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
          {dark ? 'Light mode' : 'Dark mode'}
        </button>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
        >
          <LogOut size={16} />
          Sign out
        </button>

        <p className="px-3 pt-1 text-[10px] text-gray-600">TraceFlow v1.0</p>
      </div>
    </aside>
  )

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#070d1b] px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 text-white text-xs font-bold">
            TF
          </div>
          <span className="text-sm font-bold text-white">TraceFlow</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleDark}
            className="rounded-lg p-2 text-gray-400 hover:bg-white/[0.06] hover:text-gray-200 transition-colors"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={() => setOpen(!open)}
            className="rounded-lg p-2 text-gray-400 hover:bg-white/[0.06] hover:text-gray-200 transition-colors"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />
      )}

      {sidebarContent}
    </>
  )
}
