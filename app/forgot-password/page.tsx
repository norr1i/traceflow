'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { AlertCircle, ArrowLeft, Clock, Loader2, Mail } from 'lucide-react'
import { LogoIcon } from '../components/Logo'
import { useT } from '../lib/i18n'

export default function ForgotPasswordPage() {
  const { t, dir } = useT()

  const [email, setEmail]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent]             = useState(false)
  const [sentTo, setSentTo]         = useState('')
  const [error, setError]           = useState<string | null>(null)
  const [cooldown, setCooldown]     = useState(0)

  // Resend cooldown timer.
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  // Core send routine. Reused by the initial submit and the resend button.
  // Guarded against repeated submission (submitting) and rapid resends (cooldown).
  async function sendReset(target: string) {
    if (submitting || cooldown > 0) return
    const normalized = target.trim().toLowerCase()
    if (!normalized) return

    setSubmitting(true)
    setError(null)

    // Explicit redirectTo built from the current origin + the exact reset route,
    // so the recovery link always returns the user to /reset-password on the
    // same deployment they requested it from (localhost, preview, or production).
    const redirectTo = `${window.location.origin}/reset-password`

    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(normalized, { redirectTo })
      if (err) {
        // Never reveal whether an account exists for this email. Only surface
        // operational failures (rate limiting, network). resetPasswordForEmail
        // itself does not disclose account existence.
        const raw = err.message.toLowerCase()
        setError(
          raw.includes('rate limit') || raw.includes('over_email_send_rate_limit')
            ? t('forgot.error_rate_limit')
            : t('forgot.error_generic'),
        )
        setSubmitting(false)
        return
      }
    } catch {
      // Network / timeout — surface a generic, non-enumerating error.
      setError(t('forgot.error_generic'))
      setSubmitting(false)
      return
    }

    // Neutral success shown regardless of whether the email exists.
    setSentTo(normalized)
    setSent(true)
    setSubmitting(false)
    setCooldown(60)
  }

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    sendReset(email)
  }

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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-[#D3D1CE] tracking-tight text-center">{t('forgot.title')}</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-[#6C6D74] text-center">{t('forgot.subtitle')}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-xl backdrop-blur-xl p-8 dark:border-[#B3B7BA]/[0.09] dark:bg-gradient-to-b dark:from-[#262E36]/85 dark:to-[#1a2230]/80 dark:shadow-[0_24px_60px_rgba(0,0,0,0.50)]">
          {!sent ? (
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
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#B3B7BA]">{t('forgot.email')}</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="
                    w-full rounded-xl border border-slate-300 bg-white dark:border-[#B3B7BA]/[0.12] dark:bg-[#262E36]/50
                    px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 dark:text-[#D3D1CE] dark:placeholder-[#6C6D74]
                    focus:border-[#4a7fa5]/50 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/20
                    transition-colors
                  "
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
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
                {submitting ? t('forgot.sending') : t('forgot.submit')}
              </button>
            </form>
          ) : (
            <div className="text-center">
              <div className="flex justify-center mb-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 dark:border-[#3a6f8f]/25 dark:bg-[#3a6f8f]/12">
                  <Mail size={26} className="text-blue-600 dark:text-[#4a8fb9]" />
                </div>
              </div>

              <h2 className="text-xl font-bold text-slate-900 dark:text-[#D3D1CE]">{t('forgot.sent_title')}</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-[#6C6D74]">
                {t('forgot.sent_body', { email: sentTo })}
              </p>

              <div className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-3 text-start dark:border-[#B3B7BA]/[0.08] dark:bg-[#262E36]/40">
                <Clock size={13} className="mt-0.5 shrink-0 text-slate-400 dark:text-[#6C6D74]" />
                <p className="text-xs text-slate-500 dark:text-[#6C6D74] leading-relaxed">{t('forgot.delivery_note')}</p>
              </div>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-[#8a3535]/30 dark:bg-[#8a3535]/10 dark:text-[#c47070] text-start">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              <button
                onClick={() => sendReset(sentTo)}
                disabled={submitting || cooldown > 0}
                className="
                  mt-5 flex w-full items-center justify-center gap-2
                  rounded-xl border border-slate-300 bg-white dark:border-[#B3B7BA]/[0.12] dark:bg-[#262E36]/40
                  px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-[#B3B7BA]
                  hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-[#262E36]/60 dark:hover:text-[#D3D1CE]
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-colors
                "
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {cooldown > 0
                  ? t('forgot.resend_in', { n: cooldown })
                  : submitting
                    ? t('forgot.sending')
                    : t('forgot.submit')}
              </button>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-slate-500 dark:text-[#6C6D74]">
          <Link href="/login" className="inline-flex items-center gap-1.5 font-semibold text-blue-600 hover:text-blue-500 dark:text-[#4a8fb9] dark:hover:text-[#6aafd9] transition-colors">
            <ArrowLeft size={14} className={dir === 'rtl' ? '-scale-x-100' : ''} />
            {t('forgot.back_to_login')}
          </Link>
        </p>
      </div>
    </div>
  )
}
