/**
 * Centralized RBAC for TraceFlow.
 *
 * Permission strings follow the pattern "<action>:<module>".
 * Use hasPermission(), canView(), canEdit(), canManage() in components
 * to gate UI actions. Backend enforcement is done via RLS policies in
 * supabase_rbac.sql — these helpers only control the UI layer.
 */
import type { Role } from './roles'

// ── Permission registry ───────────────────────────────────────────────────────

export type Permission =
  // Module visibility
  | 'view:dashboard'
  | 'view:products'
  | 'view:raw-materials'
  | 'view:production'
  | 'view:quality-control'
  | 'view:sales'
  | 'view:recall'
  | 'view:team'
  // Write / edit capabilities
  | 'edit:products'
  | 'edit:raw-materials'
  | 'edit:production'
  | 'edit:quality-control'
  | 'edit:sales'
  // Administrative
  | 'manage:team'   // invite, remove, change roles (except inviting admins)
  | 'invite:admin'  // escalated: only admin can invite another admin
  | 'override:qc'   // admin emergency capability — enables QC editing after explicit opt-in

// ── Role → permission mapping ─────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'view:dashboard', 'view:products', 'view:raw-materials', 'view:production',
    'view:quality-control', 'view:sales', 'view:recall', 'view:team',
    'edit:products', 'edit:raw-materials', 'edit:production', 'edit:sales',
    'manage:team', 'invite:admin',
    // Admin is read-only on QC by default; 'override:qc' enables an explicit opt-in
    // 'edit:quality-control' is intentionally absent — use override:qc to unlock it
    'override:qc',
  ],

  manager: [
    'view:dashboard', 'view:products', 'view:raw-materials', 'view:production',
    'view:quality-control', 'view:sales', 'view:recall',
    'edit:products', 'edit:raw-materials', 'edit:production', 'edit:sales',
    'manage:team',
    // manager cannot: invite:admin, edit:quality-control, override:qc
  ],

  inspector: [  // legacy alias — behaves like qc_inspector
    'view:production', 'view:quality-control',
    'edit:quality-control',
  ],

  operations: [
    'view:production',
    'edit:production',
  ],

  warehouse: [
    'view:raw-materials',
    'edit:raw-materials',
  ],

  qc_inspector: [
    'view:quality-control', 'view:production',
    'edit:quality-control',
  ],

  sales: [
    'view:sales',
    'edit:sales',
  ],
}

// ── Core helper ───────────────────────────────────────────────────────────────

export function hasPermission(role: Role | null, permission: Permission): boolean {
  if (!role) return false
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission)
}

// ── Convenience shorthands ────────────────────────────────────────────────────

/** True if role can see the given module (sidebar / page access). */
export function canView(role: Role | null, module: string): boolean {
  return hasPermission(role, `view:${module}` as Permission)
}

/** True if role can create / edit / delete records in the given module. */
export function canEdit(role: Role | null, module: string): boolean {
  return hasPermission(role, `edit:${module}` as Permission)
}

/** True if role can perform administrative actions on the given resource. */
export function canManage(role: Role | null, resource: string): boolean {
  return hasPermission(role, `manage:${resource}` as Permission)
}
