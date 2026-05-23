'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Package,
  ClipboardList, ShieldCheck, ShoppingCart,
  Menu, X, Boxes, AlertTriangle, Users,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../lib/auth-context'
import { hasPermission, type Permission } from '../lib/permissions'
import { LogoIcon } from './Logo'

type NavItem = {
  label: string
  href: string
  icon: React.ElementType
  permission: Permission
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard, permission: 'view:dashboard' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { label: 'Products',     href: '/products',        icon: Package,       permission: 'view:products'        },
      { label: 'Materials',    href: '/raw-materials',   icon: Boxes,         permission: 'view:raw-materials'   },
      { label: 'Production',   href: '/production',      icon: ClipboardList, permission: 'view:production'      },
      { label: 'Quality',      href: '/quality-control', icon: ShieldCheck,   permission: 'view:quality-control' },
      { label: 'Sales',        href: '/sales',           icon: ShoppingCart,  permission: 'view:sales'           },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Recall', href: '/recall', icon: AlertTriangle, permission: 'view:recall' },
      { label: 'Team',   href: '/team',   icon: Users,         permission: 'view:team'   },
    ],
  },
]

function NavLink({
  item,
  pathname,
  onClick,
}: {
  item: NavItem
  pathname: string
  onClick?: () => void
}) {
  const active = pathname === item.href
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`
        group relative flex items-center gap-2.5 rounded-lg px-3 py-[7px]
        text-[13px] font-medium transition-all duration-100
        ${active
          ? 'bg-[#1C2333] text-[#E2E8F0]'
          : 'text-[#6B7280] hover:text-[#A8B3C0] hover:bg-white/[0.04]'}
      `}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full bg-[#4a8fb9]" />
      )}
      <item.icon
        size={14}
        strokeWidth={active ? 2 : 1.75}
        className={`shrink-0 transition-colors ${active ? 'text-[#4a8fb9]' : ''}`}
      />
      {item.label}
    </Link>
  )
}

export default function Sidebar() {
  const pathname  = usePathname()
  const { role }  = useAuth()

  const [open, setOpen] = useState(false)

  const visibleGroups = NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item =>
      role ? hasPermission(role, item.permission) : false
    ),
  })).filter(group => group.items.length > 0)

  const sidebarContent = (
    <aside
      className={`
        fixed top-0 left-0 z-30 h-full w-[200px] flex flex-col
        bg-[#07090E] border-r border-white/[0.06]
        transition-transform duration-200 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0
      `}
    >
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-white/[0.06] px-4">
        <LogoIcon size="sm" />
        <p className="text-[13px] font-semibold leading-none tracking-tight text-[#D3D1CE]">
          <span className="font-normal text-[#6a9fc0]">Trace</span>Flow
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-4">
        {visibleGroups.map(group => (
          <div key={group.label}>
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-[#2D3748]">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  onClick={() => setOpen(false)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer — minimal: just version/branding */}
      <div className="shrink-0 border-t border-white/[0.05] px-4 py-3">
        <p className="text-[10px] text-[#2D3748]">TraceFlow · Manufacturing SaaS</p>
      </div>
    </aside>
  )

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#07090E] px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2.5">
          <LogoIcon size="sm" />
          <span className="text-[13px] font-semibold text-[#D3D1CE] tracking-tight">TraceFlow</span>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="rounded-lg p-2 text-[#525563] hover:bg-white/[0.06] hover:text-[#8B9BAA] transition-colors"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {sidebarContent}
    </>
  )
}
