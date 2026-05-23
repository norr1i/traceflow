'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { ROLE_META, ASSIGNABLE_ROLES, type Role } from '../lib/roles'
import { hasPermission } from '../lib/permissions'
import { logActivity, actorName } from '../lib/activity'
import {
  Users, Plus, Trash2, X, Check, AlertTriangle,
  Mail, Clock, Pencil, ShieldAlert, Copy, UserCheck,
  UserX, Shield,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

type TeamMember = {
  user_id:       string | null
  invitation_id: string | null
  email:         string
  full_name:     string | null
  role:          string
  status:        'active' | 'pending'
  joined_at:     string
}

// ── Helpers ────────────────────────────────────────────────────────────────

const inputClass = `
  w-full rounded-lg border border-gray-200 dark:border-white/[0.09] bg-white dark:bg-[#161B22]
  px-3 py-2 text-sm text-gray-800 dark:text-[#D3D1CE] placeholder-gray-400 dark:placeholder-[#525563]
  focus:border-[#4a8fb9]/50 focus:outline-none focus:ring-2 focus:ring-[#4a8fb9]/15
  transition-colors
`

const selectClass = `
  w-full rounded-lg border border-gray-200 dark:border-white/[0.09] bg-white dark:bg-[#161B22]
  px-3 py-2 text-sm text-gray-800 dark:text-[#D3D1CE]
  focus:border-[#4a8fb9]/50 focus:outline-none focus:ring-2 focus:ring-[#4a8fb9]/15
  transition-colors appearance-none
`

function RoleBadge({ role }: { role: string }) {
  const meta = ROLE_META[role as Role]
  if (!meta) return (
    <span className="inline-flex items-center rounded-md border border-gray-200 dark:border-white/[0.09] bg-gray-100 dark:bg-white/[0.05] px-2 py-0.5 text-[11px] font-semibold text-gray-500 dark:text-[#6B7280]">
      {role}
    </span>
  )
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${meta.color}`}>
      {meta.label}
    </span>
  )
}

function StatusBadge({ status }: { status: 'active' | 'pending' }) {
  if (status === 'active') return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Active
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
      <Clock size={9} />
      Pending
    </span>
  )
}

function MemberAvatar({ email, size = 'md' }: { email: string; size?: 'sm' | 'md' }) {
  const initial = email[0]?.toUpperCase() ?? '?'
  const dim = size === 'sm'
    ? 'h-7 w-7 text-[11px]'
    : 'h-9 w-9 text-[12px]'
  return (
    <div className={`${dim} shrink-0 flex items-center justify-center rounded-full bg-[#1C2E40] font-bold text-[#4a8fb9] ring-1 ring-[#4a8fb9]/20`}>
      {initial}
    </div>
  )
}

// ── Role distribution bar ──────────────────────────────────────────────────

function RoleDistribution({ members }: { members: TeamMember[] }) {
  const active = members.filter(m => m.status === 'active')
  if (active.length === 0) return null

  const roleColors: Record<string, string> = {
    admin:        'bg-red-500',
    manager:      'bg-[#4a8fb9]',
    operations:   'bg-orange-400',
    warehouse:    'bg-amber-400',
    qc_inspector: 'bg-violet-500',
    sales:        'bg-emerald-500',
  }

  const counts = ASSIGNABLE_ROLES.reduce<Record<string, number>>((acc, r) => {
    acc[r] = active.filter(m => m.role === r).length
    return acc
  }, {})

  const total = active.length

  return (
    <div className="space-y-2.5">
      {/* Stacked bar */}
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.05]">
        {ASSIGNABLE_ROLES.map(r => {
          const count = counts[r]
          if (count === 0) return null
          const pct = (count / total) * 100
          return (
            <div
              key={r}
              className={`h-full transition-all duration-700 ${roleColors[r] ?? 'bg-gray-400'}`}
              style={{ width: `${pct}%` }}
              title={`${ROLE_META[r]?.label ?? r}: ${count}`}
            />
          )
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {ASSIGNABLE_ROLES.filter(r => counts[r] > 0).map(r => (
          <div key={r} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-sm ${roleColors[r] ?? 'bg-gray-400'}`} />
            <span className="text-[11px] text-gray-500 dark:text-[#525563]">
              {ROLE_META[r]?.label ?? r} <span className="font-semibold text-gray-700 dark:text-[#A8B3C0]">{counts[r]}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function TeamClient() {
  const { user, role, companyId } = useAuth()
  const toast    = useToast()
  const confirm  = useConfirm()
  const assignableRoles = hasPermission(role as Role | null, 'invite:admin')
    ? ASSIGNABLE_ROLES
    : ASSIGNABLE_ROLES.filter((r) => r !== 'admin')

  const [members,        setMembers]        = useState<TeamMember[]>([])
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState<string | null>(null)

  // Invite panel state
  const [showInvite,     setShowInvite]     = useState(false)
  const [inviteEmail,    setInviteEmail]    = useState('')
  const [inviteRole,     setInviteRole]     = useState<Role>('manager')
  const [inviting,       setInviting]       = useState(false)
  const [inviteError,    setInviteError]    = useState<string | null>(null)
  const [invitedEmail,   setInvitedEmail]   = useState<string | null>(null)

  // Inline role-edit state
  const [editingId,      setEditingId]      = useState<string | null>(null)
  const [editRole,       setEditRole]       = useState<Role>('manager')
  const [savingRole,     setSavingRole]     = useState(false)

  const loadMembers = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase.rpc('get_team_members')
    if (err) {
      setError(err.message)
    } else {
      setMembers((data as TeamMember[]) ?? [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadMembers() }, [loadMembers])

  // ── Invite ───────────────────────────────────────────────────────────────

  function openInvite() {
    setInviteEmail('')
    setInviteRole('manager')
    setInviteError(null)
    setInvitedEmail(null)
    setShowInvite(true)
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteError(null)

    const { error: err } = await supabase.rpc('invite_member', {
      p_email: inviteEmail.trim().toLowerCase(),
      p_role:  inviteRole,
    })

    setInviting(false)

    if (err) {
      setInviteError(err.message)
      return
    }

    setInvitedEmail(inviteEmail.trim().toLowerCase())
    setInviteEmail('')
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType: 'invitation.created', entityType: 'invitation',
      message: `${actorName(user?.email)} invited ${inviteEmail.trim().toLowerCase()} as ${inviteRole}`,
      metadata: { invited_email: inviteEmail.trim().toLowerCase(), role: inviteRole },
    }).catch(() => {})
    loadMembers()
  }

  function closeInvite() {
    setShowInvite(false)
    setInvitedEmail(null)
    setInviteError(null)
  }

  // ── Edit role ────────────────────────────────────────────────────────────

  function startEdit(m: TeamMember) {
    setEditingId(m.user_id)
    setEditRole((m.role as Role) ?? 'manager')
  }

  function cancelEdit() { setEditingId(null) }

  async function saveRole(m: TeamMember) {
    setSavingRole(true)
    const { error: err } = await supabase.rpc('update_member_role', {
      p_user_id:  m.user_id,
      p_new_role: editRole,
    })
    setSavingRole(false)

    if (err) { toast.error(err.message); return }

    toast.success('Role updated')
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType: 'team.role_changed', entityType: 'team_member', entityId: m.user_id,
      message: `${actorName(user?.email)} changed ${m.email}'s role to ${editRole}`,
      metadata: { old_role: m.role, new_role: editRole, member_email: m.email },
    }).catch(() => {})
    setEditingId(null)
    loadMembers()
  }

  // ── Remove / cancel invite ────────────────────────────────────────────────

  async function handleRemove(m: TeamMember) {
    const ok = await confirm({
      title: 'Remove team member?',
      message: `${m.email} will lose access to all company data. Their account is not deleted.`,
      confirmLabel: 'Remove',
    })
    if (!ok) return
    const { error: err } = await supabase.rpc('remove_team_member', { p_user_id: m.user_id })
    if (err) { toast.error(err.message); return }
    toast.success('Member removed')
    loadMembers()
  }

  async function handleCancelInvite(m: TeamMember) {
    const ok = await confirm({
      title: 'Cancel invitation?',
      message: `The pending invite to ${m.email} will be revoked.`,
      confirmLabel: 'Cancel Invite',
    })
    if (!ok) return
    const { error: err } = await supabase.rpc('cancel_invitation', { p_invitation_id: m.invitation_id })
    if (err) { toast.error(err.message); return }
    toast.success('Invitation cancelled')
    loadMembers()
  }

  // ── Copy signup link ─────────────────────────────────────────────────────

  function copySignupLink(invitedEmail?: string) {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const url  = invitedEmail
      ? `${base}/signup?email=${encodeURIComponent(invitedEmail)}`
      : `${base}/signup`
    navigator.clipboard.writeText(url).then(() => toast.success('Invite link copied'))
  }

  function signupUrl(email: string) {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    return `${base}/signup?email=${encodeURIComponent(email)}`
  }

  // ── Derived stats ─────────────────────────────────────────────────────────

  const activeCount  = members.filter(m => m.status === 'active').length
  const pendingCount = members.filter(m => m.status === 'pending').length
  const roleCount    = new Set(members.filter(m => m.status === 'active').map(m => m.role)).size

  // ── Role description ──────────────────────────────────────────────────────

  const roleDescription: Record<string, string> = {
    admin:        'Can manage team, view all pages, and edit all data.',
    manager:      'Can manage team, view all pages, and edit all data.',
    operations:   'Access to Production Orders only.',
    warehouse:    'Access to Raw Materials only.',
    qc_inspector: 'Access to Production and Quality Control.',
    sales:        'Access to Sales only.',
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto space-y-5">

      {/* ── Invite modal ─────────────────────────────────────────────────── */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-gray-200 dark:border-white/[0.09] bg-white dark:bg-[#0D1117] shadow-2xl shadow-black/20 dark:shadow-black/60">

            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-white/[0.07] px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a8fb9]/10">
                  <Mail size={14} className="text-[#4a8fb9]" />
                </div>
                <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white">Invite team member</h2>
              </div>
              <button onClick={closeInvite} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:text-[#525563] dark:hover:text-[#A8B3C0] hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="p-5">
              {invitedEmail ? (
                /* ── Success state ── */
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3.5">
                    <Check size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Invitation created</p>
                      <p className="mt-0.5 text-[12px] text-emerald-700/80 dark:text-emerald-400/80">
                        Ask <span className="font-medium">{invitedEmail}</span> to sign up using their email address.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.03] p-3">
                    <p className="mb-2 text-[11px] font-semibold text-gray-400 dark:text-[#525563] uppercase tracking-wider">
                      Personalised invite link
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded-md bg-white dark:bg-[#161B22] border border-gray-200 dark:border-white/[0.07] px-2.5 py-1.5 text-[11px] text-[#4a8fb9]">
                        {signupUrl(invitedEmail)}
                      </code>
                      <button
                        onClick={() => copySignupLink(invitedEmail ?? undefined)}
                        className="shrink-0 rounded-lg border border-gray-200 dark:border-white/[0.09] bg-white dark:bg-[#161B22] p-1.5 text-gray-400 hover:text-gray-600 dark:text-[#525563] dark:hover:text-[#A8B3C0] transition-colors"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2.5">
                    <button
                      onClick={() => { setInvitedEmail(null); setInviteEmail(''); setInviteError(null) }}
                      className="flex-1 rounded-lg border border-gray-200 dark:border-white/[0.09] bg-white dark:bg-[#161B22] py-2.5 text-sm font-medium text-gray-700 dark:text-[#C9C7C4] hover:bg-gray-50 dark:hover:bg-white/[0.05] transition-colors"
                    >
                      Invite another
                    </button>
                    <button
                      onClick={closeInvite}
                      className="flex-1 rounded-lg bg-[#3a6f8f] hover:bg-[#2d5a74] py-2.5 text-sm font-medium text-white transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Invite form ── */
                <form onSubmit={handleInvite} className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-[12px] font-semibold text-gray-600 dark:text-[#8B9BAA]">Email address</label>
                    <div className="relative">
                      <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#525563]" />
                      <input
                        required
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="colleague@company.com"
                        className={`${inputClass} pl-9`}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[12px] font-semibold text-gray-600 dark:text-[#8B9BAA]">Role</label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as Role)}
                      className={selectClass}
                    >
                      {assignableRoles.map(r => (
                        <option key={r} value={r}>{ROLE_META[r].label}</option>
                      ))}
                    </select>
                    {roleDescription[inviteRole] && (
                      <p className="mt-1.5 text-[11px] text-gray-400 dark:text-[#525563]">
                        {roleDescription[inviteRole]}
                      </p>
                    )}
                  </div>

                  {inviteError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      {inviteError}
                    </div>
                  )}

                  <div className="flex gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={closeInvite}
                      className="flex-1 rounded-lg border border-gray-200 dark:border-white/[0.09] py-2.5 text-sm font-medium text-gray-600 dark:text-[#8B9BAA] hover:bg-gray-50 dark:hover:bg-white/[0.05] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={inviting}
                      className="flex-1 rounded-lg bg-[#3a6f8f] hover:bg-[#2d5a74] py-2.5 text-sm font-medium text-white disabled:opacity-60 transition-colors"
                    >
                      {inviting ? 'Sending…' : 'Send invitation'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Stats row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Total members */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#525563]">Members</p>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#4a8fb9]/10">
              <Users size={14} className="text-[#4a8fb9]" />
            </span>
          </div>
          <p className="text-3xl font-bold tabular-nums text-gray-900 dark:text-[#E2E8F0]">{activeCount}</p>
          <p className="mt-1 text-[11px] text-gray-400 dark:text-[#525563]">active accounts</p>
        </div>

        {/* Pending invitations */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#525563]">Pending</p>
            <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${pendingCount > 0 ? 'bg-amber-500/10' : 'bg-gray-100 dark:bg-white/[0.04]'}`}>
              <Clock size={14} className={pendingCount > 0 ? 'text-amber-500' : 'text-gray-400 dark:text-[#525563]'} />
            </span>
          </div>
          <p className={`text-3xl font-bold tabular-nums ${pendingCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-[#E2E8F0]'}`}>
            {pendingCount}
          </p>
          <p className="mt-1 text-[11px] text-gray-400 dark:text-[#525563]">awaiting signup</p>
        </div>

        {/* Roles */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#525563]">Roles</p>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10">
              <Shield size={14} className="text-violet-500" />
            </span>
          </div>
          <p className="text-3xl font-bold tabular-nums text-gray-900 dark:text-[#E2E8F0]">{roleCount}</p>
          <p className="mt-1 text-[11px] text-gray-400 dark:text-[#525563]">distinct roles assigned</p>
        </div>

        {/* Verified */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#525563]">Verified</p>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
              <UserCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
            </span>
          </div>
          <p className="text-3xl font-bold tabular-nums text-gray-900 dark:text-[#E2E8F0]">{activeCount}</p>
          <p className="mt-1 text-[11px] text-gray-400 dark:text-[#525563]">confirmed users</p>
        </div>
      </div>

      {/* ── Role distribution ─────────────────────────────────────────────── */}
      {!loading && activeCount > 0 && (
        <div className="glass-card rounded-xl px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-gray-800 dark:text-[#E2E8F0]">Role Distribution</p>
            <p className="text-[11px] text-gray-400 dark:text-[#525563]">{activeCount} active member{activeCount !== 1 ? 's' : ''}</p>
          </div>
          <RoleDistribution members={members} />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2.5 rounded-xl border border-red-200 dark:border-red-500/25 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {/* ── Members table ────────────────────────────────────────────────── */}
      <div className="glass-card overflow-hidden rounded-xl">
        {/* Table header */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 dark:border-white/[0.06] px-5 py-3.5">
          <div>
            <h2 className="text-[13px] font-semibold text-gray-900 dark:text-[#E2E8F0]">Team Members</h2>
            {!loading && (
              <p className="mt-0.5 text-[11px] text-gray-400 dark:text-[#525563]">
                {activeCount} active · {pendingCount} pending invitation{pendingCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button
            onClick={openInvite}
            className="flex items-center gap-1.5 rounded-lg bg-[#3a6f8f] hover:bg-[#2d5a74] px-3.5 py-2 text-[12px] font-medium text-white transition-colors"
          >
            <Plus size={13} />
            Invite member
          </button>
        </div>

        {loading ? (
          <div className="space-y-0">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-gray-50 dark:border-white/[0.04] px-5 py-4 last:border-0">
                <div className="h-9 w-9 animate-pulse rounded-full bg-gray-200 dark:bg-white/[0.05]" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-48 animate-pulse rounded bg-gray-200 dark:bg-white/[0.05]" />
                  <div className="h-2.5 w-32 animate-pulse rounded bg-gray-100 dark:bg-white/[0.03]" />
                </div>
                <div className="h-6 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-white/[0.05]" />
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-[#525563]">
            <UserX size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-medium text-gray-600 dark:text-[#6B7280]">No team members yet</p>
            <p className="mt-1 text-[12px]">Invite your first colleague to get started.</p>
            <button
              onClick={openInvite}
              className="mt-5 flex items-center gap-1.5 rounded-lg bg-[#3a6f8f] hover:bg-[#2d5a74] px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              <Plus size={14} /> Invite member
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-50 dark:border-white/[0.05] bg-gray-50/50 dark:bg-white/[0.01]">
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#525563]">Member</th>
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#525563] hidden sm:table-cell">Role</th>
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#525563] hidden md:table-cell">Status</th>
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#525563] hidden lg:table-cell">Joined</th>
                  <th className="px-5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#525563]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                {members.map((m) => {
                  const isMe      = m.user_id === user?.id
                  const isPending = m.status === 'pending'
                  const rowKey    = m.user_id ?? m.invitation_id ?? m.email
                  const isEditing = editingId === m.user_id && !isPending

                  return (
                    <tr
                      key={rowKey}
                      className={`transition-colors hover:bg-gray-50/80 dark:hover:bg-white/[0.02] ${isPending ? 'opacity-70' : ''}`}
                    >
                      {/* Member */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <MemberAvatar email={m.email} />
                          <div className="min-w-0">
                            {m.full_name && (
                              <p className="text-[13px] font-semibold text-gray-900 dark:text-[#E2E8F0] truncate">{m.full_name}</p>
                            )}
                            <p className={`truncate text-[12px] ${m.full_name ? 'text-gray-400 dark:text-[#525563]' : 'font-medium text-gray-700 dark:text-[#C9C7C4]'}`}>
                              {m.email}
                            </p>
                            {isMe && (
                              <span className="text-[10px] font-medium text-[#4a8fb9]">You</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-5 py-3.5 hidden sm:table-cell">
                        {isEditing ? (
                          <select
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value as Role)}
                            className="rounded-lg border border-gray-200 dark:border-white/[0.09] bg-white dark:bg-[#161B22] px-2.5 py-1 text-[12px] text-gray-700 dark:text-[#D3D1CE] focus:outline-none focus:ring-2 focus:ring-[#4a8fb9]/20"
                            autoFocus
                          >
                            {ASSIGNABLE_ROLES.map(r => (
                              <option key={r} value={r}>{ROLE_META[r].label}</option>
                            ))}
                          </select>
                        ) : (
                          <RoleBadge role={m.role} />
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3.5 hidden md:table-cell">
                        <StatusBadge status={m.status} />
                      </td>

                      {/* Joined */}
                      <td className="px-5 py-3.5 hidden lg:table-cell text-[12px] text-gray-400 dark:text-[#525563]">
                        {new Date(m.joined_at).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isPending ? (
                            <>
                              <button
                                onClick={() => copySignupLink(m.email)}
                                title="Copy invite link"
                                className="rounded-lg p-1.5 text-gray-400 dark:text-[#525563] hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                              >
                                <Copy size={13} />
                              </button>
                              <button
                                onClick={() => handleCancelInvite(m)}
                                title="Cancel invitation"
                                className="rounded-lg p-1.5 text-gray-400 dark:text-[#525563] hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          ) : isMe ? (
                            <span className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-gray-400 dark:text-[#525563]">
                              <ShieldAlert size={12} /> You
                            </span>
                          ) : isEditing ? (
                            <>
                              <button
                                onClick={() => saveRole(m)}
                                disabled={savingRole}
                                title="Save role"
                                className="rounded-lg p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
                              >
                                <Check size={13} />
                              </button>
                              <button
                                onClick={cancelEdit}
                                title="Cancel"
                                className="rounded-lg p-1.5 text-gray-400 dark:text-[#525563] hover:bg-gray-100 dark:hover:bg-white/[0.05] transition-colors"
                              >
                                <X size={13} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEdit(m)}
                                title="Edit role"
                                className="rounded-lg p-1.5 text-gray-400 dark:text-[#525563] hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => handleRemove(m)}
                                title="Remove from company"
                                className="rounded-lg p-1.5 text-gray-400 dark:text-[#525563] hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table footer */}
        {!loading && members.length > 0 && (
          <div className="flex items-center justify-between border-t border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-white/[0.01] px-5 py-3">
            <p className="text-[11px] text-gray-400 dark:text-[#525563]">
              {activeCount} active · {pendingCount} pending
            </p>
            <button
              onClick={() => copySignupLink()}
              className="flex items-center gap-1.5 text-[11px] text-[#4a8fb9] hover:underline"
            >
              <Copy size={10} /> Copy signup link
            </button>
          </div>
        )}
      </div>

      {/* ── Pending invite guidance ───────────────────────────────────────── */}
      {!loading && pendingCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.06] px-4 py-3.5">
          <Clock size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-[12px] text-amber-800 dark:text-amber-400/90">
            Pending invitations expire after 7 days. Share the{' '}
            <button onClick={() => copySignupLink()} className="font-semibold underline underline-offset-2">
              signup link
            </button>{' '}
            and ask invited members to register with their invited email address.
          </p>
        </div>
      )}

    </div>
  )
}
