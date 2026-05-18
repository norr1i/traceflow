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
import { LogoIcon, LogoLockup } from './Logo'

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
  admin:    'bg-[#5a4690]/20 text-[#9a88d4] border border-[#5a4690]/30',
  manager:  'bg-[#3a6f8f]/20 text-[#7aafcf] border border-[#3a6f8f]/30',
  inspector:'bg-[#2d7a5a]/20 text-[#6abf9a] border border-[#2d7a5a]/30',
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
        bg-[#090F15] border-r border-[#B3B7BA]/[0.08]
        transition-transform duration-200 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0
      `}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-[#B3B7BA]/[0.07]">
        <LogoLockup size="sm" />
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
                  ? 'bg-gradient-to-r from-[#3a6f8f]/22 to-[#3a6f8f]/10 border border-[#B3B7BA]/[0.10] text-[#D3D1CE] shadow-[0_2px_14px_rgba(74,127,165,0.10)]'
                  : 'text-[#6C6D74] hover:bg-[#262E36]/30 hover:text-[#B3B7BA] border border-transparent'}
              `}
            >
              <Icon
                size={16}
                className={`shrink-0 transition-colors ${active ? 'text-[#4a8fb9]' : ''}`}
              />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-[#B3B7BA]/[0.07] space-y-0.5">
        {/* User card */}
        {user && (
          <div className="
            mb-2 px-3 py-2.5 rounded-xl
            bg-[#262E36]/40 border border-[#B3B7BA]/[0.08]
          ">
            <p className="text-[10px] text-[#6C6D74] uppercase tracking-widest font-medium mb-0.5">
              Signed in as
            </p>
            <p className="text-xs text-[#B3B7BA] truncate font-medium">{user.email}</p>
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
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#6C6D74] hover:bg-[#262E36]/30 hover:text-[#B3B7BA] transition-colors"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
          {dark ? 'Light mode' : 'Dark mode'}
        </button>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#6C6D74] hover:bg-[#8a3535]/15 hover:text-[#c47070] transition-colors"
        >
          <LogOut size={16} />
          Sign out
        </button>

        <p className="px-3 pt-1 text-[10px] text-[#6C6D74]/60">TraceFlow v1.0</p>
      </div>
    </aside>
  )

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-[#B3B7BA]/[0.08] bg-[#090F15] px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2.5">
          <LogoIcon size="sm" />
          <span className="text-sm font-bold text-[#D3D1CE]">TraceFlow</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleDark}
            className="rounded-lg p-2 text-[#6C6D74] hover:bg-[#262E36]/30 hover:text-[#B3B7BA] transition-colors"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={() => setOpen(!open)}
            className="rounded-lg p-2 text-[#6C6D74] hover:bg-[#262E36]/30 hover:text-[#B3B7BA] transition-colors"
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
