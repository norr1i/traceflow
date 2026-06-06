import { supabase } from './supabase'

// ── Action type registry ─────────────────────────────────────────────────────
// Pattern: '<entity>.<verb>'

export type ActivityActionType =
  | 'production_order.created'
  | 'production_order.updated'
  | 'production_order.deleted'
  | 'bill_of_materials.deleted'
  | 'qc_result.added'
  | 'qc_result.deleted'
  | 'product.created'
  | 'product.imported'
  | 'product.deleted'
  | 'raw_material.created'
  | 'raw_material.imported'
  | 'raw_material.deleted'
  | 'qc_inspection.created'
  | 'qc_inspection.passed'
  | 'qc_inspection.failed'
  | 'qc_inspection.hold'
  | 'qc_inspection.deleted'
  | 'sale.created'
  | 'sale.imported'
  | 'sale.deleted'
  | 'invitation.created'
  | 'invitation.cancelled'
  | 'team.role_changed'
  | 'team.member_removed'
  | 'capa.opened'
  | 'capa.updated'
  | 'capa.verified'
  | 'capa.closed'
  | 'capa.deleted'
  | 'recall.initiated'
  | 'recall.updated'
  | 'recall.closed'
  | 'recall.deleted'

// ── Role-based action type filter ────────────────────────────────────────────
// Used by the dashboard feed to show only relevant activity per role.

export const ACTION_TYPES_BY_SECTION = {
  production: [
    'production_order.created',
    'production_order.updated',
    'production_order.deleted',
    'bill_of_materials.deleted',
    'qc_result.added',
    'qc_result.deleted',
  ] as ActivityActionType[],
  quality: [
    'qc_inspection.created',
    'qc_inspection.passed',
    'qc_inspection.failed',
    'qc_inspection.hold',
    'qc_inspection.deleted',
    'qc_result.added',
  ] as ActivityActionType[],
  inventory: [
    'raw_material.created',
    'raw_material.imported',
    'raw_material.deleted',
  ] as ActivityActionType[],
  sales: [
    'sale.created',
    'sale.imported',
    'sale.deleted',
  ] as ActivityActionType[],
  admin: [
    'invitation.created',
    'invitation.cancelled',
    'team.role_changed',
    'team.member_removed',
  ] as ActivityActionType[],
}

// ── Core helper ──────────────────────────────────────────────────────────────

export interface LogActivityParams {
  companyId:    string
  actorUserId?: string | null
  actorEmail?:  string | null
  actionType:   ActivityActionType
  entityType:   string
  entityId?:    string | null
  message:      string
  metadata?:    Record<string, unknown>
}

/**
 * Fire-and-forget activity log insert.
 * Call as: logActivity({...}).catch(err => console.error('[logActivity]', err))
 * Never await inside a user-facing code path — a logging failure should
 * never block or revert a successful business operation.
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
  const { error } = await supabase.from('activity_logs').insert({
    company_id:    params.companyId,
    actor_user_id: params.actorUserId  ?? null,
    actor_email:   params.actorEmail   ?? null,
    action_type:   params.actionType,
    entity_type:   params.entityType,
    entity_id:     params.entityId     ?? null,
    message:       params.message,
    metadata:      params.metadata     ?? null,
  })

  if (error) {
    console.error('[logActivity] insert failed:', error.code, error.message)
    throw error
  }
}

// ── Display helpers ──────────────────────────────────────────────────────────

/** Returns the first part of an email address as a display name. */
export function actorName(email: string | null | undefined): string {
  if (!email) return 'Someone'
  return email.split('@')[0]
}
