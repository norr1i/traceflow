/**
 * TraceFlow — Centralized RBAC permission map.
 *
 * Permission strings follow the pattern "<action>:<module>".
 *
 * Three layers of control:
 *  1. Sidebar visibility     — view:<module>
 *  2. Dashboard sections     — view:dashboard.<section>
 *  3. In-page write actions  — edit:<module>, manage:<resource>
 *
 * Enforcement contract:
 *  • UI layer  → use the helpers below (hasPermission, canView, canEdit, canManage)
 *  • DB layer  → RLS policies in supabase_rbac.sql / supabase_cleanup.sql
 *    Both must agree; the DB is always the final authority.
 */
import type { Role } from './roles'

// ── Permission registry ───────────────────────────────────────────────────────

export type Permission =
  // Sidebar / page access
  | 'view:dashboard'
  | 'view:products'
  | 'view:raw-materials'
  | 'view:production'
  | 'view:quality-control'
  | 'view:sales'
  | 'view:recall'
  | 'view:capa'
  | 'view:team'

  // Dashboard widget groups
  // Each section is a logical slice of the dashboard surface:
  //   .production → production pipeline, batch KPIs, failed QC list, recall risk banner
  //   .quality    → QC trend chart, pass rate KPI, QC breakdown, recent inspections
  //   .tracing    → QR scan activity chart, most-scanned batches, recent scan events
  | 'view:dashboard.production'
  | 'view:dashboard.quality'
  | 'view:dashboard.tracing'
  | 'view:dashboard.inventory'
  | 'view:dashboard.sales'

  // In-page write capabilities
  | 'edit:products'
  | 'edit:raw-materials'
  | 'edit:production'
  | 'edit:quality-control'
  | 'edit:sales'

  // Traceability
  | 'view:product-journey'

  // Compliance
  | 'view:sfda'
  | 'edit:sfda'
  | 'edit:capa'
  | 'edit:recall'

  // Administrative
  | 'manage:team'   // invite, remove, change roles (except promoting to admin)
  | 'invite:admin'  // elevated: only an existing admin may invite another admin
  | 'override:qc'   // admin emergency toggle — enables QC editing after explicit opt-in

// ── Role → permission mapping ─────────────────────────────────────────────────
//
// Reading guide
//   admin       full access including emergency QC override; read-only on QC by default
//   manager     full operational access; cannot invite admins or override QC
//   operations  production-focused; dashboard limited to production + recall risk
//   qc_inspector quality-focused; dashboard limited to QC metrics; sees production (read)
//   inspector   legacy alias for qc_inspector; identical permissions
//   sales       revenue-focused; dashboard shows sales prompt + recall risk
//   warehouse   inventory-focused; dashboard limited to production pipeline (batch context)

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {

  admin: [
    // Full sidebar access
    'view:dashboard', 'view:products', 'view:raw-materials', 'view:production',
    'view:quality-control', 'view:sales', 'view:recall', 'view:capa', 'view:team',
    // Traceability
    'view:product-journey',
    // Compliance
    'view:sfda', 'edit:sfda', 'edit:capa', 'edit:recall',
    // Full dashboard surface
    'view:dashboard.production', 'view:dashboard.quality', 'view:dashboard.tracing',
    'view:dashboard.inventory', 'view:dashboard.sales',
    // Full write access (QC excluded by default — override:qc unlocks it via UI toggle)
    'edit:products', 'edit:raw-materials', 'edit:production', 'edit:sales',
    // Admin-only capabilities
    'manage:team', 'invite:admin', 'override:qc',
  ],

  manager: [
    // Full sidebar access
    'view:dashboard', 'view:products', 'view:raw-materials', 'view:production',
    'view:quality-control', 'view:sales', 'view:recall', 'view:capa', 'view:team',
    // Traceability
    'view:product-journey',
    // Compliance
    'view:sfda', 'edit:sfda', 'edit:capa', 'edit:recall',
    // Full dashboard surface
    'view:dashboard.production', 'view:dashboard.quality', 'view:dashboard.tracing',
    'view:dashboard.inventory', 'view:dashboard.sales',
    // Full write access (cannot edit QC or override it)
    'edit:products', 'edit:raw-materials', 'edit:production', 'edit:sales',
    'manage:team',
  ],

  operations: [
    // Sidebar: dashboard + production + recall (read) + CAPA (read) + journey
    'view:dashboard', 'view:production', 'view:recall', 'view:capa', 'view:product-journey',
    // Dashboard: full production pipeline + scan tracing activity
    'view:dashboard.production', 'view:dashboard.tracing',
    // Write: production orders
    'edit:production',
  ],

  qc_inspector: [
    // Sidebar: dashboard + QC + production (read-only) + CAPA + recall + journey
    'view:dashboard', 'view:quality-control', 'view:production', 'view:capa', 'view:recall', 'view:product-journey',
    // Compliance (read-only)
    'view:sfda',
    // Dashboard: QC metrics + scan tracing for inspected batches
    'view:dashboard.quality', 'view:dashboard.tracing',
    // Write: quality inspections, defects, CAPAs
    'edit:quality-control', 'edit:capa',
  ],

  // Legacy alias — identical to qc_inspector
  inspector: [
    'view:dashboard', 'view:quality-control', 'view:production', 'view:capa', 'view:recall', 'view:product-journey',
    // Compliance (read-only)
    'view:sfda',
    'view:dashboard.quality', 'view:dashboard.tracing',
    'edit:quality-control', 'edit:capa',
  ],

  sales: [
    // Sidebar: dashboard + sales + products (catalog reference)
    'view:dashboard', 'view:sales', 'view:products',
    // Dashboard: sales overview + recall risk awareness via production
    'view:dashboard.production', 'view:dashboard.sales',
    // Write: sales records
    'edit:sales',
  ],

  warehouse: [
    // Sidebar: dashboard + raw materials
    'view:dashboard', 'view:raw-materials',
    // Dashboard: inventory status + production demand context
    'view:dashboard.production', 'view:dashboard.inventory',
    // Write: raw material records
    'edit:raw-materials',
  ],
}

// ── Core helpers ──────────────────────────────────────────────────────────────

/** Returns all permissions held by a role. Null role → empty array. */
export function getPermissions(role: Role | null): Permission[] {
  if (!role) return []
  return ROLE_PERMISSIONS[role] ?? []
}

/** Returns true if role holds the given permission. Null role → always false. */
export function hasPermission(role: Role | null, permission: Permission): boolean {
  if (!role) return false
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission)
}

/** True if role can see the given module in the sidebar or access the page. */
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
