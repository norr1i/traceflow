'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { ROLE_META, ASSIGNABLE_ROLES, type Role } from '../lib/roles'
import { hasPermission } from '../lib/permissions'
import {
  Users, Plus, Trash2, X, Check, AlertTriangle,
  Mail, Clock, Pencil, ShieldAlert, Copy,
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

function RoleBadge({ role }: { role: string }) {
  const meta = ROLE_META[role as Role]
  if (!meta) return (
    <span className="inline-flex items-center rounded-full border border-[#B3B7BA]/20 bg-[#262E36]/60 px-2.5 py-0.5 text-xs font-semibold text-[#B3B7BA]">
      {role}
    </span>
  )
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.color}`}>
      {meta.label}
    </span>
  )
}

function StatusBadge({ status }: { status: 'active' | 'pending' }) {
  if (status === 'active') return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      Active
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
      <Clock size={10} />
      Pending
    </span>
  )
}

const inputClass = `
  w-full rounded-xl border border-[#B3B7BA]/[0.12] bg-[#262E36]/50
  px-3 py-2 text-sm text-[#D3D1CE] placeholder-[#6C6D74]
  focus:border-[#4a7fa5]/50 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/20
  transition-colors
`

const selectClass = `
  w-full rounded-xl border border-[#B3B7BA]/[0.12] bg-[#262E36]/50
  px-3 py-2 text-sm text-[#D3D1CE]
  focus:border-[#4a7fa5]/50 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/20
  transition-colors appearance-none
`

// ── Main component ─────────────────────────────────────────────────────────

export default function TeamClient() {
  const { user, role } = useAuth()
  const toast    = useToast()
  const confirm  = useConfirm()
  const assignableRoles = hasPermission(role as Role | null, 'invite:admin')
    ? ASSIGNABLE_ROLES
    : ASSIGNABLE_ROLES.filter((r) => r !== 'admin')

  const [members,        setMembers]        = useState<TeamMember[]>([])
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState<string | null>(null)

  // Invite modal state
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

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveRole(m: TeamMember) {
    setSavingRole(true)
    const { error: err } = await supabase.rpc('update_member_role', {
      p_user_id:  m.user_id,
      p_new_role: editRole,
    })
    setSavingRole(false)

    if (err) {
      toast.error(err.message)
      return
    }

    toast.success('Role updated')
    setEditingId(null)
    loadMembers()
  }

  // ── Remove member ────────────────────────────────────────────────────────

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

  // ── Cancel invitation ────────────────────────────────────────────────────

  async function handleCancelInvite(m: TeamMember) {
    const ok = await confirm({
      title: 'Cancel invitation?',
      message: `The pending invite to ${m.email} will be revoked.`,
      confirmLabel: 'Cancel Invite',
    })
    if (!ok) return

    const { error: err } = await supabase.rpc('cancel_invitation', {
      p_invitation_id: m.invitation_id,
    })
    if (err) { toast.error(err.message); return }
    toast.success('Invitation cancelled')
    loadMembers()
  }

  // ── Copy signup link ─────────────────────────────────────────────────────

  function copySignupLink() {
    const url = typeof window !== 'undefined'
      ? `${window.location.origin}/signup`
      : '/signup'
    navigator.clipboard.writeText(url).then(() => toast.success('Signup link copied'))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const activeCount  = members.filter(m => m.status === 'active').length
  const pendingCount = members.filter(m => m.status === 'pending').length

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)] p-6">

      {/* ── Invite modal ───────────────────────────────────────────────── */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#B3B7BA]/[0.10] bg-[#141e28] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.60)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Invite team member</h2>
              <button onClick={closeInvite} className="text-[#6C6D74] hover:text-[#B3B7BA] transition-colors">
                <X size={18} />
              </button>
            </div>

            {invitedEmail ? (
              /* ── Success state ── */
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3.5">
                  <Check size={18} className="mt-0.5 shrink-0 text-emerald-400" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-300">Invitation created</p>
                    <p className="mt-0.5 text-xs text-emerald-400/80">
                      Ask <span className="font-medium">{invitedEmail}</span> to sign up using their email address.
                      They&apos;ll automatically join your company.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-[#B3B7BA]/[0.08] bg-[#262E36]/40 p-3">
                  <p className="mb-1.5 text-xs font-semibold text-[#6C6D74] uppercase tracking-wider">
                    Share signup link
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-lg bg-[#090F15] px-2.5 py-1.5 text-xs text-[#4a8fb9]">
                      {typeof window !== 'undefined' ? `${window.location.origin}/signup` : '/signup'}
                    </code>
                    <button
                      onClick={copySignupLink}
                      className="rounded-lg border border-[#B3B7BA]/[0.12] bg-[#262E36]/60 p-1.5 text-[#6C6D74] hover:text-[#B3B7BA] transition-colors"
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => { setInvitedEmail(null); setInviteEmail(''); setInviteError(null) }}
                    className="flex-1 rounded-xl border border-[#B3B7BA]/[0.10] bg-[#262E36]/50 py-2 text-sm font-medium text-[#B3B7BA] hover:bg-[#262E36] transition-colors"
                  >
                    Invite another
                  </button>
                  <button
                    onClick={closeInvite}
                    className="flex-1 rounded-xl bg-[#3a6f8f] hover:bg-[#2d5a74] py-2 text-sm font-medium text-white transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              /* ── Invite form ── */
              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#B3B7BA]">Email address</label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6C6D74]" />
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
                  <label className="mb-1.5 block text-sm font-medium text-[#B3B7BA]">Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as Role)}
                    className={selectClass}
                  >
                    {assignableRoles.map(r => (
                      <option key={r} value={r}>{ROLE_META[r].label}</option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-[#6C6D74]">
                    {inviteRole === 'admin' || inviteRole === 'manager'
                      ? 'Can manage team, view all pages, and edit all data.'
                      : inviteRole === 'operations'  ? 'Access to Production Orders only.'
                      : inviteRole === 'warehouse'   ? 'Access to Raw Materials only.'
                      : inviteRole === 'qc_inspector'? 'Access to Production and Quality Control.'
                      : inviteRole === 'sales'       ? 'Access to Sales only.'
                      : ''}
                  </p>
                </div>

                {inviteError && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    {inviteError}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={closeInvite}
                    className="flex-1 rounded-xl border border-[#B3B7BA]/[0.10] bg-[#262E36]/50 py-2 text-sm font-medium text-[#B3B7BA] hover:bg-[#262E36] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={inviting}
                    className="flex-1 rounded-xl bg-[#3a6f8f] hover:bg-[#2d5a74] py-2 text-sm font-medium text-white disabled:opacity-60 transition-colors shadow-[0_0_16px_rgba(74,127,165,0.22)]"
                  >
                    {inviting ? 'Creating…' : 'Create invitation'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Team</h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Manage your company&apos;s members and access roles.
          </p>
        </div>
        <button
          onClick={openInvite}
          className="flex items-center gap-1.5 rounded-xl bg-[#3a6f8f] hover:bg-[#2d5a74] px-4 py-2 text-sm font-medium text-white shadow-[0_0_16px_rgba(74,127,165,0.22)] transition-colors"
        >
          <Plus size={15} />
          Invite member
        </button>
      </div>

      {/* ── Stats row ─────────────────────────────────────────────────── */}
      {!loading && members.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.09] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-4 py-2.5">
            <span className="text-xs text-gray-500 dark:text-gray-400">Active members</span>
            <span className="ml-2 text-sm font-semibold text-gray-900 dark:text-white">{activeCount}</span>
          </div>
          {pendingCount > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5">
              <span className="text-xs text-amber-400">Pending invitations</span>
              <span className="ml-2 text-sm font-semibold text-amber-300">{pendingCount}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Error banner ──────────────────────────────────────────────── */}
      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* ── Team table ────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.09] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm">

        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-200 dark:bg-[#262E36]/55" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
            <Users size={40} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">No team members yet</p>
            <p className="mt-1 text-xs">Invite your first colleague to get started.</p>
            <button
              onClick={openInvite}
              className="mt-5 flex items-center gap-1.5 rounded-xl bg-[#3a6f8f] hover:bg-[#2d5a74] px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              <Plus size={14} /> Invite member
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-[#B3B7BA]/[0.08] bg-[#D1CFC9]/50 dark:bg-[#262E36]/55 text-left text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  <th className="px-5 py-3">Member</th>
                  <th className="px-5 py-3 hidden sm:table-cell">Role</th>
                  <th className="px-5 py-3 hidden md:table-cell">Status</th>
                  <th className="px-5 py-3 hidden lg:table-cell">Joined</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-[#B3B7BA]/[0.06]">
                {members.map((m) => {
                  const isMe      = m.user_id === user?.id
                  const isPending = m.status === 'pending'
                  const rowKey    = m.user_id ?? m.invitation_id ?? m.email
                  const isEditing = editingId === m.user_id && !isPending

                  return (
                    <tr
                      key={rowKey}
                      className={`hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/22 transition-colors ${isPending ? 'opacity-75' : ''}`}
                    >
                      {/* Member */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#262E36]/60 text-xs font-semibold text-[#B3B7BA] border border-[#B3B7BA]/[0.10]">
                            {m.email[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            {m.full_name && (
                              <p className="truncate text-xs font-semibold text-gray-900 dark:text-white">{m.full_name}</p>
                            )}
                            <p className={`truncate text-xs ${m.full_name ? 'text-gray-400 dark:text-gray-500' : 'font-medium text-gray-700 dark:text-gray-300'}`}>
                              {m.email}
                            </p>
                            {isMe && (
                              <span className="text-[10px] text-[#4a8fb9] font-medium">You</span>
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
                            className="rounded-lg border border-[#B3B7BA]/[0.12] bg-[#262E36]/50 px-2 py-1 text-xs text-[#D3D1CE] focus:outline-none focus:ring-1 focus:ring-[#4a7fa5]/30"
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
                      <td className="px-5 py-3.5 hidden lg:table-cell text-xs text-gray-400 dark:text-gray-500">
                        {new Date(m.joined_at).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isPending ? (
                            /* Cancel invite */
                            <button
                              onClick={() => handleCancelInvite(m)}
                              title="Cancel invitation"
                              className="rounded-lg p-1.5 text-gray-400 dark:text-gray-600 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : isMe ? (
                            /* Self — cannot edit own role */
                            <span
                              title="You cannot change your own role"
                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[#6C6D74]"
                            >
                              <ShieldAlert size={12} /> You
                            </span>
                          ) : isEditing ? (
                            /* Save / cancel role edit */
                            <>
                              <button
                                onClick={() => saveRole(m)}
                                disabled={savingRole}
                                title="Save role"
                                className="rounded-lg p-1.5 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                onClick={cancelEdit}
                                title="Cancel"
                                className="rounded-lg p-1.5 text-gray-400 hover:bg-[#262E36]/40 transition-colors"
                              >
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            /* Normal actions */
                            <>
                              <button
                                onClick={() => startEdit(m)}
                                title="Edit role"
                                className="rounded-lg p-1.5 text-gray-400 dark:text-gray-600 hover:bg-blue-500/10 hover:text-blue-400 transition-colors"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() => handleRemove(m)}
                                title="Remove from company"
                                className="rounded-lg p-1.5 text-gray-400 dark:text-gray-600 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                              >
                                <Trash2 size={14} />
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

        {/* Footer note */}
        {!loading && members.length > 0 && (
          <div className="border-t border-gray-100 dark:border-[#B3B7BA]/[0.07] px-5 py-3 text-xs text-gray-400 dark:text-gray-500">
            {activeCount} active · {pendingCount} pending ·{' '}
            <button
              onClick={copySignupLink}
              className="inline-flex items-center gap-1 text-[#4a8fb9] hover:underline"
            >
              <Copy size={10} /> Copy signup link
            </button>
          </div>
        )}
      </div>

      {/* Pending invite info box */}
      {!loading && pendingCount > 0 && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-400/90">
          <Clock size={15} className="mt-0.5 shrink-0" />
          <span>
            Pending invitations expire after 7 days. Share the{' '}
            <button onClick={copySignupLink} className="font-medium underline underline-offset-2">
              signup link
            </button>{' '}
            with invited members and ask them to register with their invited email address.
          </span>
        </div>
      )}
    </div>
  )
}
