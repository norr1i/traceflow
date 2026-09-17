'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { LogoIcon } from '../components/Logo'
import { useT } from '../lib/i18n'

type Phase   = 'verifying' | 'ready' | 'invalid' | 'success'
type UrlHint = 'recovery' | 'error' | 'none'
type InitialEvidence = { hint: UrlHint; accessToken: string | null }

// Read the recovery signal straight from the URL. This URL evidence is a
// PRECONDITION, never sufficient on its own — the form is only unlocked after
// the SDK has actually established and validated the recovery session (see the
// readiness effect). Evidence (auth-js 2.105.3, GoTrueClient.js):
//   • Implicit-flow recovery links carry `type=recovery` + tokens in the
//     fragment; `_getSessionFromURL` sets `redirectType: params.type` (L3103),
//     copies the URL access_token into the session (L3066/L3093), and only then
//     emits PASSWORD_RECOVERY (L320).
//   • Expired / consumed links carry `error`/`error_code` instead; the SDK
//     throws before clearing the hash (L3027-3034, L3101 unreached).
//   • `parseParametersFromURL` reads both the fragment and the query string.
function readInitialEvidence(): InitialEvidence {
  if (typeof window === 'undefined') return { hint: 'none', accessToken: null }
  const parse = (s: string) => new URLSearchParams(s.replace(/^[#?]/, ''))
  const hash  = parse(window.location.hash)
  const query = parse(window.location.search)
  const get   = (k: string) => hash.get(k) ?? query.get(k)
  if (get('error') || get('error_code') || get('error_description')) return { hint: 'error', accessToken: null }
  const at = get('access_token')
  if (get('type') === 'recovery' && at) return { hint: 'recovery', accessToken: at }
  return { hint: 'none', accessToken: null }
}

// The SDK clears the recovery fragment after a successful callback
// (_getSessionFromURL sets `location.hash = ''`, L3101). Defensively confirm no
// sensitive param remains once we are ready; if any does, strip ONLY the hash
// via replaceState — no navigation, no reload, no history entry.
function stripSensitiveHash() {
  if (typeof window === 'undefined') return
  if (/access_token|refresh_token|type=recovery/i.test(window.location.hash)) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }
}

// Mirrors the signup strength meter, but with translated labels.
function getPasswordStrength(pw: string, t: (k: string) => string): { bars: number; label: string; color: string } {
  let score = 0
  if (pw.length >= 8)           score++
  if (pw.length >= 12)          score++
  if (/[A-Z]/.test(pw))         score++
  if (/[0-9]/.test(pw))         score++
  if (/[^A-Za-z0-9]/.test(pw))  score++
  const bars = score <= 1 ? 1 : score === 2 ? 2 : score === 3 ? 3 : 4
  if (bars === 1) return { bars, label: t('reset.strength_weak'),   color: 'bg-[#8a3535]' }
  if (bars === 2) return { bars, label: t('reset.strength_fair'),   color: 'bg-[#8a6530]' }
  if (bars === 3) return { bars, label: t('reset.strength_good'),   color: 'bg-[#3a6f8f]' }
  return                 { bars, label: t('reset.strength_strong'), color: 'bg-[#2d7a5a]' }
}

function friendlyResetError(raw: string, t: (k: string) => string): string {
  const m = raw.toLowerCase()
  if (m.includes('different from the old password') || m.includes('should be different'))
    return t('reset.error_same')
  if (m.includes('at least') || m.includes('weak'))
    return t('reset.error_weak')
  if (m.includes('rate limit') || m.includes('over_email_send_rate_limit'))
    return t('reset.error_rate_limit')
  if (m.includes('session') || m.includes('jwt') || m.includes('expired') || m.includes('token'))
    return t('reset.error_session')
  return raw
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const { t }  = useT()

  const [phase, setPhase]           = useState<Phase>('verifying')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [showPw, setShowPw]         = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [signedOut, setSignedOut]   = useState(false)
  const [finishing, setFinishing]   = useState(false)

  const strength        = password ? getPasswordStrength(password, t) : null
  const confirmMismatch = !!confirm && confirm !== password

  // Capture the initial URL evidence ONCE, synchronously, via a lazy state
  // initializer that runs on the first render — before any effect and before
  // the SDK's network-gated hash clear (_getSessionFromURL awaits _getUser() at
  // L3087 before `location.hash = ''` at L3101). Guarded by typeof window so it
  // returns 'none' during SSR; since only 'verifying' is rendered initially,
  // this cannot cause a hydration mismatch. In-memory only — no storage flag.
  const [initial] = useState<InitialEvidence>(() => readInitialEvidence())
  const urlHint = initial.hint

  // The captured recovery access_token lives ONLY here, in component memory,
  // and ONLY for the brief validation window. It is never logged, persisted, or
  // sent anywhere, and is nulled the moment readiness is decided.
  const capturedTokenRef = useRef<string | null>(initial.accessToken)

  // ── Decide readiness from validated recovery evidence only ─────────────────
  // URL evidence is a precondition, not proof. Readiness requires EITHER:
  //   A) a PASSWORD_RECOVERY event whose session is non-null, OR
  //   B) the URL carried type=recovery + access_token AND, after SDK
  //      processing, getSession() returns a session whose access_token exactly
  //      matches the captured URL token AND getUser() succeeds for it.
  // An ordinary/unrelated session never matches (B) and never triggers (A).
  useEffect(() => {
    if (urlHint === 'error') { setPhase('invalid'); return }

    let cancelled = false
    let resolved  = false

    const finishReady = () => {
      if (resolved || cancelled) return
      resolved = true
      capturedTokenRef.current = null   // drop the token — validation is done
      stripSensitiveHash()
      setPhase('ready')
    }
    const finishInvalid = () => {
      if (resolved || cancelled) return
      resolved = true
      capturedTokenRef.current = null
      setPhase('invalid')
    }

    // Path A — a genuine PASSWORD_RECOVERY event WITH a non-null session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) finishReady()
    })

    // Path B — only when the URL itself presented a recovery token. Confirm the
    // SDK established THAT specific recovery session (exact access_token match)
    // and that it is usable (getUser succeeds). getSession() internally awaits
    // the SDK's initialize, so we poll briefly to cover async processing.
    if (urlHint === 'recovery' && capturedTokenRef.current) {
      void (async () => {
        const captured = capturedTokenRef.current
        const validate = async (): Promise<boolean> => {
          const { data: s } = await supabase.auth.getSession()
          const session = s.session
          if (!session || session.access_token !== captured) return false
          const { data: u, error: uErr } = await supabase.auth.getUser()
          return !uErr && !!u.user
        }
        for (let i = 0; i < 8 && !resolved && !cancelled; i++) {
          if (await validate()) { finishReady(); return }
          await new Promise(r => setTimeout(r, 400))
        }
      })()
    }

    // Grace window: no validated recovery session arrived (ordinary session,
    // logged-out/direct visit, or forged/expired hash) → invalid. This bounds
    // how long we wait for recovery evidence; it is NOT an update timeout.
    const timer = setTimeout(finishInvalid, 4000)

    return () => { cancelled = true; subscription.unsubscribe(); clearTimeout(timer) }
  }, [urlHint])

  // ── Auto-redirect only once the local session is actually cleared ──────────
  // If sign-out failed, a live local session remains and AppShell would bounce
  // /login back into the app, so we require an explicit user action instead.
  useEffect(() => {
    if (phase !== 'success' || !signedOut) return
    const timer = setTimeout(() => router.replace('/login'), 2500)
    return () => clearTimeout(timer)
  }, [phase, signedOut, router])

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setError(null)

    // Reuse the same rules enforced at signup.
    if (password.length < 8)  { setError(t('reset.error_weak')); return }
    if (password !== confirm) { setError(t('reset.error_mismatch')); return }

    setSubmitting(true)

    // Update the password. supabase-js returns { error } for auth failures and
    // only throws on transport-level failures (offline / DNS), which the catch
    // handles. We intentionally impose NO artificial client timeout here: a
    // bounded timeout on a non-idempotent mutation could fire while the change
    // actually succeeds server-side, misleading the user into an unsafe retry.
    // The submit guard above prevents duplicate in-flight submissions.
    let updated = false
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) {
        setSubmitting(false)
        setError(friendlyResetError(err.message, t))
        // Recovery session vanished (expired mid-flow) → dedicated invalid screen.
        const m = err.message.toLowerCase()
        if (m.includes('session') && (m.includes('missing') || m.includes('expired'))) setPhase('invalid')
        return
      }
      updated = true
    } catch {
      setSubmitting(false)
      setError(t('reset.error_network'))
      return
    }

    if (!updated) { setSubmitting(false); return }

    // The password change has ALREADY succeeded. From here we never report
    // failure. Sign out only THIS device (scope:'local') — auth-js signOut()
    // defaults to GLOBAL scope (GoTrueClient.js L3173), which would terminate
    // the user's other devices; that is not intended here. signOut returns
    // { error } (not a throw); on a non-swallowed error it returns before
    // removing the local session (L3195 vs L3199-3202), so the session may
    // persist — which the success UI accounts for.
    let localSignedOut = false
    try {
      const { error: signOutErr } = await supabase.auth.signOut({ scope: 'local' })
      localSignedOut = !signOutErr
    } catch {
      localSignedOut = false
    }

    setSubmitting(false)
    setSignedOut(localSignedOut)
    setPhase('success')
  }

  // Manual "continue" used when auto-redirect is unsafe (sign-out failed).
  // Retries a local sign-out; only routes to /login once the local session is
  // gone, otherwise sends the (validly authenticated) user home so AppShell
  // does not bounce them and they are never stuck on this page.
  async function handleFinish() {
    if (finishing) return
    setFinishing(true)
    let ok = signedOut
    if (!ok) {
      try {
        const { error } = await supabase.auth.signOut({ scope: 'local' })
        ok = !error
      } catch {
        ok = false
      }
    }
    router.replace(ok ? '/login' : '/')
  }

  // ── Verifying ──────────────────────────────────────────────────────────────
  if (phase === 'verifying') {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <Loader2 size={26} className="animate-spin text-blue-600 dark:text-[#4a8fb9]" />
          <p className="text-sm text-slate-500 dark:text-[#6C6D74]">{t('reset.verifying')}</p>
        </div>
      </Shell>
    )
  }

  // ── Invalid / expired link ───────────────────────────────────────────────
  if (phase === 'invalid') {
    return (
      <Shell>
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-200 bg-red-50 dark:border-[#8a3535]/30 dark:bg-[#8a3535]/12">
              <AlertCircle size={26} className="text-red-600 dark:text-[#c47070]" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-[#D3D1CE]">{t('reset.invalid_title')}</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-[#6C6D74]">{t('reset.invalid_body')}</p>
          <Link
            href="/forgot-password"
            className="mt-5 flex w-full items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:border-[#4a7fa5]/25 dark:bg-[#3a6f8f]/10 dark:text-[#4a8fb9] dark:hover:bg-[#3a6f8f]/20 dark:hover:text-[#6aafd9] transition-colors"
          >
            {t('reset.request_new')}
          </Link>
        </div>
      </Shell>
    )
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <Shell>
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 dark:border-[#2d7a5a]/30 dark:bg-[#2d7a5a]/12">
              <ShieldCheck size={26} className="text-emerald-600 dark:text-[#6abf9a]" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-[#D3D1CE]">{t('reset.success_title')}</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-[#6C6D74]">{t('reset.success_body')}</p>
          {signedOut ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-[#6C6D74]">{t('reset.success_redirecting')}</p>
          ) : (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-start dark:border-[#8a6530]/30 dark:bg-[#8a6530]/10">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-[#c49a5a]" />
              <p className="text-xs text-amber-700 leading-relaxed dark:text-[#c49a5a]">{t('reset.signout_failed_note')}</p>
            </div>
          )}

          {signedOut ? (
            <Link
              href="/login"
              className="mt-5 flex w-full items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:border-[#4a7fa5]/25 dark:bg-[#3a6f8f]/10 dark:text-[#4a8fb9] dark:hover:bg-[#3a6f8f]/20 dark:hover:text-[#6aafd9] transition-colors"
            >
              {t('reset.go_to_login')}
            </Link>
          ) : (
            <button
              onClick={handleFinish}
              disabled={finishing}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:border-[#4a7fa5]/25 dark:bg-[#3a6f8f]/10 dark:text-[#4a8fb9] dark:hover:bg-[#3a6f8f]/20 dark:hover:text-[#6aafd9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {finishing && <Loader2 size={14} className="animate-spin" />}
              {t('reset.go_to_login')}
            </button>
          )}
        </div>
      </Shell>
    )
  }

  // ── Ready: new-password form ────────────────────────────────────────────────
  return (
    <Shell title={t('reset.title')} subtitle={t('reset.subtitle')}>
      <form onSubmit={handleSubmit} className="space-y-5">

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-[#8a3535]/30 dark:bg-[#8a3535]/10 dark:text-[#c47070]">
            <div className="flex items-start gap-2.5">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#B3B7BA]">{t('reset.password')}</label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('reset.password_placeholder')}
              className="
                w-full rounded-xl border border-slate-300 bg-white dark:border-[#B3B7BA]/[0.12] dark:bg-[#262E36]/50
                px-4 py-2.5 pe-10 text-sm text-slate-900 placeholder-slate-400 dark:text-[#D3D1CE] dark:placeholder-[#6C6D74]
                focus:border-[#4a7fa5]/50 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/20
                transition-colors
              "
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              aria-label={showPw ? t('common.hide_password') : t('common.show_password')}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-[#6C6D74] dark:hover:text-[#B3B7BA] transition-colors"
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
                {t('reset.strength')}: <span className="font-medium text-slate-700 dark:text-[#B3B7BA]">{strength.label}</span>
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#B3B7BA]">{t('reset.confirm')}</label>
          <input
            type={showPw ? 'text' : 'password'}
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t('reset.confirm_placeholder')}
            className={`
              w-full rounded-xl border bg-white dark:bg-[#262E36]/50
              px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 dark:text-[#D3D1CE] dark:placeholder-[#6C6D74]
              focus:outline-none focus:ring-2
              transition-colors
              ${confirmMismatch
                ? 'border-red-400 dark:border-[#8a3535]/40 focus:border-[#8a3535]/50 focus:ring-[#8a3535]/20'
                : 'border-slate-300 dark:border-[#B3B7BA]/[0.12] focus:border-[#4a7fa5]/50 focus:ring-[#4a7fa5]/20'}
            `}
          />
          {confirmMismatch && (
            <p className="mt-1 text-xs text-red-700 dark:text-[#c47070]">{t('reset.error_mismatch')}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || confirmMismatch || !password || !confirm}
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
          {submitting && <Loader2 size={15} className="animate-spin" />}
          {submitting ? t('reset.updating') : t('reset.submit')}
        </button>
      </form>
    </Shell>
  )
}

// Shared card frame so every phase keeps the same login/signup visual language.
function Shell({ children, title, subtitle }: { children: React.ReactNode; title?: string; subtitle?: string }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden bg-slate-50 dark:bg-[#090F15]">
      <div className="pointer-events-none absolute inset-0" style={{
        background: 'radial-gradient(ellipse 1600px 1000px at 20% 10%, rgba(74,127,165,0.05) 0%, transparent 65%)',
      }} />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-5">
            <LogoIcon size="lg" />
          </div>
          {title && (
            <>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-[#D3D1CE] tracking-tight text-center flex items-center gap-2">
                <KeyRound size={20} className="text-blue-600 dark:text-[#4a8fb9]" />
                {title}
              </h1>
              {subtitle && <p className="mt-1.5 text-sm text-slate-500 dark:text-[#6C6D74] text-center">{subtitle}</p>}
            </>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-xl backdrop-blur-xl p-8 dark:border-[#B3B7BA]/[0.09] dark:bg-gradient-to-b dark:from-[#262E36]/85 dark:to-[#1a2230]/80 dark:shadow-[0_24px_60px_rgba(0,0,0,0.50)]">
          {children}
        </div>
      </div>
    </div>
  )
}
