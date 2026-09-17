'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { ROLE_META } from '../lib/roles'
import type { Role } from '../lib/roles'
import { Eye, EyeOff, AlertCircle, Loader2, Building2, User, CheckCircle2 } from 'lucide-react'
import { LogoIcon } from '../components/Logo'
import { useT } from '../lib/i18n'

function getPasswordStrength(pw: string, t: (k: string) => string): { bars: number; label: string; color: string } {
  let score = 0
  if (pw.length >= 8)           score++
  if (pw.length >= 12)          score++
  if (/[A-Z]/.test(pw))         score++
  if (/[0-9]/.test(pw))         score++
  if (/[^A-Za-z0-9]/.test(pw))  score++
  const bars = score <= 1 ? 1 : score === 2 ? 2 : score === 3 ? 3 : 4
  if (bars === 1) return { bars, label: t('signup.strength_weak'),   color: 'bg-[#8a3535]' }
  if (bars === 2) return { bars, label: t('signup.strength_fair'),   color: 'bg-[#8a6530]' }
  if (bars === 3) return { bars, label: t('signup.strength_good'),   color: 'bg-[#3a6f8f]' }
  return                 { bars, label: t('signup.strength_strong'), color: 'bg-[#2d7a5a]' }
}

function friendlySignupError(raw: string, t: (k: string) => string): string {
  if (raw.includes('User already registered') || raw.includes('already been registered'))
    return t('signup.err_exists_generic')
  if (raw.includes('Unable to validate email') || raw.includes('invalid format'))
    return t('signup.err_invalid_email')
  if (raw.includes('Password should be at least'))
    return t('signup.err_password_min')
  if (raw.includes('rate limit') || raw.includes('over_email_send_rate_limit'))
    return t('signup.err_rate_limit')
  return t('signup.err_generic')
}

type InviteInfo = {
  company_name: string
  role: string
  expires_at: string
}

const inputClass = `
  w-full rounded-xl border border-slate-300 bg-white dark:border-[#B3B7BA]/[0.12] dark:bg-[#262E36]/50
  px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 dark:text-[#D3D1CE] dark:placeholder-[#6C6D74]
  focus:border-[#4a7fa5]/50 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/20
  transition-colors
`

function SignupContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { t }        = useT()

  const [companyName, setCompanyName] = useState('')
  const [fullName,    setFullName]    = useState('')
  const [email,       setEmail]       = useState('')
  const [password,    setPassword]    = useState('')
  const [confirm,     setConfirm]     = useState('')
  const [showPw,      setShowPw]      = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [alreadyExists, setAlreadyExists] = useState(false)

  // Invitation state
  const [invite,        setInvite]        = useState<InviteInfo | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteChecked, setInviteChecked] = useState(false)

  const strength        = password ? getPasswordStrength(password, t) : null
  const confirmMismatch = !!confirm && confirm !== password
  const isInvited       = !!invite

  // Look up invitation for the given email
  const checkInvitation = useCallback(async (emailToCheck: string) => {
    const trimmed = emailToCheck.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      setInvite(null)
      setInviteChecked(false)
      return
    }
    setInviteLoading(true)
    const { data } = await supabase.rpc('lookup_invitation', { p_email: trimmed })
    setInviteLoading(false)
    setInviteChecked(true)
    const rows = data as InviteInfo[] | null
    setInvite(rows && rows.length > 0 ? rows[0] : null)
  }, [])

  // Pre-fill email from URL param and auto-check invitation
  useEffect(() => {
    const emailParam = searchParams.get('email')
    if (emailParam) {
      setEmail(emailParam)
      checkInvitation(emailParam)
    }
  }, [searchParams, checkInvitation])

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    if (!isInvited && !companyName.trim()) {
      setError(t('signup.err_company_required'))
      return
    }
    if (!fullName.trim()) { setError(t('signup.err_name_required')); return }
    if (password !== confirm) { setError(t('signup.mismatch')); return }
    if (password.length < 8)  { setError(t('signup.err_password_short')); return }

    setLoading(true)
    setError(null)
    setAlreadyExists(false)

    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/` : '/',
        data: {
          full_name:    fullName.trim(),
          // Only pass company_name when creating a new workspace (not for invites)
          ...(isInvited ? {} : { company_name: companyName.trim() }),
        },
      },
    })

    if (signUpErr) {
      setError(friendlySignupError(signUpErr.message, t))
      setLoading(false)
      return
    }

    // Supabase silently returns identities:[] when the email is already registered.
    if (data.user?.identities?.length === 0) {
      setAlreadyExists(true)
      setError(
        isInvited
          ? t('signup.err_exists_invited', { company: invite!.company_name })
          : t('signup.err_exists_signin')
      )
      setLoading(false)
      return
    }

    if (data.session) {
      // Session returned immediately (email confirmation disabled).
      // If the user is accepting an invitation, do it now before navigating.
      if (isInvited) {
        await supabase.rpc('accept_my_invitation')
      }
      router.replace('/dashboard')
      return
    }

    // Email confirmation required — tell the user to check their inbox.
    const verifyUrl = new URL('/verify-email', window.location.origin)
    verifyUrl.searchParams.set('email', email.trim())
    if (isInvited) verifyUrl.searchParams.set('company', invite!.company_name)
    router.replace(verifyUrl.pathname + verifyUrl.search)
  }

  const roleMeta = invite ? (ROLE_META[invite.role as Role] ?? null) : null

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10 overflow-hidden bg-slate-50 dark:bg-[#090F15]">
      <div className="pointer-events-none absolute inset-0" style={{
        background: 'radial-gradient(ellipse 1600px 1000px at 20% 10%, rgba(74,127,165,0.05) 0%, transparent 65%)',
      }} />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-5">
            <LogoIcon size="lg" />
          </div>
          {isInvited ? (
            <>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-[#D3D1CE] tracking-tight text-center">
                {t('signup.title_join', { company: invite.company_name })}
              </h1>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-[#6C6D74] text-center">
                {t('signup.subtitle_join')}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-[#D3D1CE] tracking-tight">{t('signup.title_setup')}</h1>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-[#6C6D74]">{t('signup.subtitle_setup')}</p>
            </>
          )}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xl backdrop-blur-xl p-8 dark:border-[#B3B7BA]/[0.09] dark:bg-gradient-to-b dark:from-[#262E36]/85 dark:to-[#1a2230]/80 dark:shadow-[0_24px_60px_rgba(0,0,0,0.50)]">
          <form onSubmit={handleSubmit} className="space-y-5">

            {error && (
              <div className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-[#8a3535]/30 dark:bg-[#8a3535]/10 dark:text-[#c47070]">
                <div className="flex items-start gap-2.5">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  {error}
                </div>
                {alreadyExists && (
                  <Link
                    href={`/login?email=${encodeURIComponent(email.trim())}`}
                    className="ml-6 font-semibold underline underline-offset-2 hover:text-red-800 dark:hover:text-[#d98080] transition-colors"
                  >
                    {t('signup.go_to_sign_in')}
                  </Link>
                )}
              </div>
            )}

            {/* Invitation banner */}
            {isInvited && (
              <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3.5">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-emerald-300">{t('signup.invite_found')}</p>
                  <p className="mt-0.5 text-xs text-emerald-400/80">
                    {t('signup.invite_join_before')} <span className="font-medium">{invite.company_name}</span> {t('signup.invite_join_after')}{' '}
                    {roleMeta ? (
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${roleMeta.color}`}>
                        {t('role.' + invite.role)}
                      </span>
                    ) : (
                      <span className="font-medium">{invite.role}</span>
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* Workspace section — hidden for invited users */}
            {!isInvited && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 mb-3">
                  <Building2 size={13} className="text-blue-600 dark:text-[#4a8fb9]" />
                  <span className="text-xs font-semibold text-blue-600 dark:text-[#4a8fb9] uppercase tracking-wider">{t('signup.section_workspace')}</span>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#B3B7BA]">{t('signup.company_label')}</label>
                  <input
                    type="text"
                    required={!isInvited}
                    autoComplete="organization"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder={t('signup.company_placeholder')}
                    className={inputClass}
                  />
                </div>
              </div>
            )}

            {/* Account section */}
            <div className="space-y-1.5">
              {!isInvited && (
                <div className="flex items-center gap-1.5 mb-3">
                  <User size={13} className="text-blue-600 dark:text-[#4a8fb9]" />
                  <span className="text-xs font-semibold text-blue-600 dark:text-[#4a8fb9] uppercase tracking-wider">{t('signup.section_account')}</span>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#B3B7BA]">{t('signup.full_name_label')}</label>
                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t('signup.full_name_placeholder')}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#B3B7BA]">{t('signup.email_label')}</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={(e) => checkInvitation(e.target.value)}
                  placeholder="you@company.com"
                  className={`${inputClass} ${isInvited ? 'opacity-70 cursor-not-allowed' : ''}`}
                  readOnly={isInvited}
                />
                {inviteLoading && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-500 dark:text-[#6C6D74]">
                    <Loader2 size={10} className="animate-spin" /> {t('signup.checking_invitation')}
                  </p>
                )}
                {inviteChecked && !inviteLoading && !isInvited && email.includes('@') && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-[#6C6D74]">{t('signup.no_invitation')}</p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#B3B7BA]">{t('signup.password_label')}</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('signup.password_placeholder')}
                    className={`${inputClass} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    aria-label={showPw ? t('common.hide_password') : t('common.show_password')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-[#6C6D74] dark:hover:text-[#B3B7BA] transition-colors"
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                {strength && (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map(i => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                            i <= strength.bars ? strength.color : 'bg-slate-200 dark:bg-[#B3B7BA]/10'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-[#6C6D74]">
                      {t('signup.strength_label')}: <span className="font-medium text-slate-700 dark:text-[#B3B7BA]">{strength.label}</span>
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#B3B7BA]">{t('signup.confirm_label')}</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={t('signup.confirm_placeholder')}
                  className={`${inputClass} ${
                    confirmMismatch ? 'border-red-400 dark:border-[#8a3535]/40 focus:ring-[#8a3535]/20' : ''
                  }`}
                />
                {confirmMismatch && (
                  <p className="mt-1 text-xs text-red-700 dark:text-[#c47070]">{t('signup.mismatch')}</p>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || confirmMismatch}
              className="
                flex w-full items-center justify-center gap-2
                rounded-xl bg-[#3a6f8f] hover:bg-[#2d5a74]
                px-4 py-2.5 text-sm font-semibold text-white
                shadow-[0_0_20px_rgba(74,127,165,0.25)]
                hover:shadow-[0_0_28px_rgba(74,127,165,0.35)]
                focus:outline-none focus:ring-2 focus:ring-[#4a7fa5] focus:ring-offset-2 focus:ring-offset-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200
              "
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading
                ? isInvited ? t('signup.joining') : t('signup.creating')
                : isInvited ? t('signup.accept') : t('signup.create')
              }
            </button>

            {!isInvited && (
              <p className="text-center text-xs text-slate-500 dark:text-[#6C6D74] leading-relaxed">
                {t('signup.isolation_note')}
              </p>
            )}
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500 dark:text-[#6C6D74]">
          {t('signup.have_account')}{' '}
          <Link href="/login" className="font-semibold text-blue-600 hover:text-blue-500 dark:text-[#4a8fb9] dark:hover:text-[#6aafd9] transition-colors">
            {t('signup.sign_in')}
          </Link>
        </p>
      </div>
    </div>
  )
}

function SignupFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-[#090F15]">
      <Loader2 size={24} className="animate-spin text-blue-600 dark:text-[#4a8fb9]" />
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={<SignupFallback />}>
      <SignupContent />
    </Suspense>
  )
}
