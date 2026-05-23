import { supabase } from './supabase'

// ── Action type registry ─────────────────────────────────────────────────────
// Pattern: '<entity>.<verb>'

export type ActivityActionType =
  | 'production_order.created'
  | 'production_order.updated'
  | 'qc_result.added'
  | 'product.created'
  | 'product.imported'
  | 'raw_material.created'
  | 'raw_material.imported'
  | 'qc_inspection.created'
  | 'qc_inspection.passed'
  | 'qc_inspection.failed'
  | 'qc_inspection.hold'
  | 'sale.created'
  | 'sale.imported'
  | 'invitation.created'
  | 'team.role_changed'

// ── Role-based action type filter ────────────────────────────────────────────
// Used by the dashboard feed to show only relevant activity per role.

export const ACTION_TYPES_BY_SECTION = {
  production: [
    'production_order.created',
    'production_order.updated',
    'qc_result.added',
  ] as ActivityActionType[],
  quality: [
    'qc_inspection.created',
    'qc_inspection.passed',
    'qc_inspection.failed',
    'qc_inspection.hold',
    'qc_result.added',
  ] as ActivityActionType[],
  inventory: [
    'raw_material.created',
    'raw_material.imported',
  ] as ActivityActionType[],
  sales: [
    'sale.created',
    'sale.imported',
  ] as ActivityActionType[],
  admin: [
    'invitation.created',
    'team.role_changed',
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
  console.log('[logActivity] →', params.actionType, '| company:', params.companyId, '| msg:', params.message)

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
    console.error('[logActivity] ✗ INSERT FAILED', {
      code:    error.code,
      message: error.message,
      hint:    error.hint,
      details: error.details,
      action:  params.actionType,
      company: params.companyId,
    })
    throw error
  }

  console.log('[logActivity] ✓', params.actionType)
}

// ── Display helpers ──────────────────────────────────────────────────────────

/** Returns the first part of an email address as a display name. */
export function actorName(email: string | null | undefined): string {
  if (!email) return 'Someone'
  return email.split('@')[0]
}
