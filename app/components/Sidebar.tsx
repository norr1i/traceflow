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
import { useT } from '../lib/i18n'
import { LogoIcon } from './Logo'

type NavItem = {
  labelKey: string
  href: string
  icon: React.ElementType
  permission: Permission
}

const NAV_GROUPS: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: 'nav_group.overview',
    items: [
      { labelKey: 'nav.dashboard', href: '/', icon: LayoutDashboard, permission: 'view:dashboard' },
    ],
  },
  {
    labelKey: 'nav_group.workspace',
    items: [
      { labelKey: 'nav.products',    href: '/products',        icon: Package,       permission: 'view:products'        },
      { labelKey: 'nav.materials',   href: '/raw-materials',   icon: Boxes,         permission: 'view:raw-materials'   },
      { labelKey: 'nav.production',  href: '/production',      icon: ClipboardList, permission: 'view:production'      },
      { labelKey: 'nav.quality',     href: '/quality-control', icon: ShieldCheck,   permission: 'view:quality-control' },
      { labelKey: 'nav.sales',       href: '/sales',           icon: ShoppingCart,  permission: 'view:sales'           },
    ],
  },
  {
    labelKey: 'nav_group.system',
    items: [
      { labelKey: 'nav.recall', href: '/recall', icon: AlertTriangle, permission: 'view:recall' },
      { labelKey: 'nav.team',   href: '/team',   icon: Users,         permission: 'view:team'   },
    ],
  },
]

function NavLink({
  item,
  pathname,
  onClick,
  label,
}: {
  item: NavItem
  pathname: string
  onClick?: () => void
  label: string
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
        <span className="absolute start-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-e-full bg-[#4a8fb9]" />
      )}
      <item.icon
        size={14}
        strokeWidth={active ? 2 : 1.75}
        className={`shrink-0 transition-colors ${active ? 'text-[#4a8fb9]' : ''}`}
      />
      {label}
    </Link>
  )
}

export default function Sidebar() {
  const pathname  = usePathname()
  const { role }  = useAuth()
  const { t, dir } = useT()

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
        fixed top-0 z-30 h-full w-[200px] flex flex-col
        bg-[#07090E] border-e border-white/[0.06]
        transition-transform duration-200 ease-in-out
        ${dir === 'rtl' ? 'right-0' : 'left-0'}
        ${open
          ? 'translate-x-0'
          : dir === 'rtl' ? 'translate-x-full' : '-translate-x-full'}
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
          <div key={group.labelKey}>
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-[#2D3748]">
              {t(group.labelKey)}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  label={t(item.labelKey)}
                  onClick={() => setOpen(false)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/[0.05] px-4 py-3">
        <p className="text-[10px] text-[#2D3748]">{t('sidebar.footer')}</p>
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
