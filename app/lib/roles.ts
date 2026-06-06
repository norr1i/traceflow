export type Role =
  | 'admin'
  | 'manager'
  | 'inspector'      // legacy alias — kept for backward compat with existing DB rows
  | 'operations'
  | 'warehouse'
  | 'qc_inspector'
  | 'sales'

// Pages each restricted role may visit (exact match or prefix)
const ROLE_PATHS: Partial<Record<Role, string[]>> = {
  inspector:   ['/', '/production', '/quality-control', '/sfda', '/capa', '/recall'],
  operations:  ['/', '/production', '/recall', '/capa'],
  warehouse:   ['/', '/raw-materials'],
  qc_inspector:['/', '/production', '/quality-control', '/sfda', '/capa', '/recall'],
  sales:       ['/', '/sales', '/products'],
}

export function canVisit(role: Role | null, pathname: string): boolean {
  if (!role) return false
  if (role === 'admin' || role === 'manager') return true
  const allowed = ROLE_PATHS[role] ?? []
  return allowed.some(
    prefix => pathname === prefix || pathname.startsWith(prefix + '/')
  )
}

export function homeFor(role: Role): string {
  const homes: Record<Role, string> = {
    admin:       '/',
    manager:     '/',
    inspector:   '/',
    operations:  '/',
    warehouse:   '/',
    qc_inspector:'/',
    sales:       '/',
  }
  return homes[role] ?? '/'
}

export const ROLE_META: Record<Role, { label: string; color: string }> = {
  admin:       { label: 'Admin',        color: 'bg-red-500/15 text-red-300 border border-red-500/20' },
  manager:     { label: 'Manager',      color: 'bg-blue-500/15 text-blue-300 border border-blue-500/20' },
  inspector:   { label: 'Inspector',    color: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' },
  operations:  { label: 'Operations',   color: 'bg-orange-500/15 text-orange-300 border border-orange-500/20' },
  warehouse:   { label: 'Warehouse',    color: 'bg-amber-500/15 text-amber-300 border border-amber-500/20' },
  qc_inspector:{ label: 'QC Inspector', color: 'bg-teal-500/15 text-teal-300 border border-teal-500/20' },
  sales:       { label: 'Sales',        color: 'bg-purple-500/15 text-purple-300 border border-purple-500/20' },
}

/** Roles that can be assigned when inviting or editing a team member. */
export const ASSIGNABLE_ROLES: Role[] = [
  'admin', 'manager', 'operations', 'warehouse', 'qc_inspector', 'sales',
]
