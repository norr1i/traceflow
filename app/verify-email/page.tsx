'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { Mail, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''

  const [resending, setResending]       = useState(false)
  const [resendStatus, setResendStatus] = useState<'idle' | 'sent' | 'error'>('idle')
  const [resendError, setResendError]   = useState<string | null>(null)
  const [cooldown, setCooldown]         = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function handleResend() {
    if (resending || cooldown > 0 || !email) return
    setResending(true)
    setResendStatus('idle')
    setResendError(null)

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/` : '/',
      },
    })

    setResending(false)

    if (error) {
      const msg = error.message.includes('rate limit') || error.message.includes('over_email_send_rate_limit')
        ? 'Too many requests. Please wait a few minutes before resending.'
        : error.message
      setResendError(msg)
      setResendStatus('error')
      return
    }

    setResendStatus('sent')
    setCooldown(60)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden">
      <div className="pointer-events-none absolute inset-0" style={{
        background: 'radial-gradient(ellipse 1200px 800px at 15% 15%, rgba(59,130,246,0.09) 0%, transparent 65%), radial-gradient(ellipse 900px 700px at 85% 85%, rgba(139,92,246,0.08) 0%, transparent 60%), #070d1b',
      }} />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <div className="
            flex h-14 w-14 items-center justify-center rounded-2xl
            bg-gradient-to-br from-blue-500 to-violet-600
            text-white text-lg font-bold
            shadow-[0_0_32px_rgba(139,92,246,0.5)]
          ">
            TF
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl p-8 shadow-[0_24px_64px_rgba(0,0,0,0.5)] text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-500/20 bg-blue-500/10">
              <Mail size={26} className="text-blue-400" />
            </div>
          </div>

          <h1 className="text-xl font-bold text-white">Check your email</h1>
          <p className="mt-2 text-sm text-gray-400">
            We sent a confirmation link to{' '}
            {email
              ? <span className="font-medium text-gray-200">{email}</span>
              : 'your email address'
            }.
            {' '}Click it to activate your account.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Don&apos;t see it? Check your spam or junk folder.
          </p>

          {/* Status messages */}
          {resendStatus === 'sent' && (
            <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              <CheckCircle2 size={15} className="shrink-0" />
              Confirmation email resent successfully.
            </div>
          )}
          {resendStatus === 'error' && resendError && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 text-left">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {resendError}
            </div>
          )}

          {/* Resend button */}
          <button
            onClick={handleResend}
            disabled={resending || cooldown > 0 || !email}
            className="
              mt-5 flex w-full items-center justify-center gap-2
              rounded-xl border border-white/[0.08] bg-white/[0.05]
              px-4 py-2.5 text-sm font-medium text-gray-300
              hover:bg-white/[0.09] hover:text-white
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors
            "
          >
            {resending && <Loader2 size={14} className="animate-spin" />}
            {cooldown > 0
              ? `Resend in ${cooldown}s`
              : resending
                ? 'Sending…'
                : 'Resend confirmation email'}
          </button>
        </div>

        <p className="mt-6 text-center text-sm text-gray-500">
          Already confirmed?{' '}
          <Link href="/login" className="font-semibold text-blue-400 hover:text-blue-300 transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  )
}
