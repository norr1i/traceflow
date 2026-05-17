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

  // Tick the cooldown timer down every second using a recursive setTimeout
  // so we can clean up on unmount without a setInterval leak.
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white text-lg font-bold shadow-lg">
            TF
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 shadow-sm text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-900/20">
              <Mail size={28} className="text-blue-600 dark:text-blue-400" />
            </div>
          </div>

          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Check your email
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            We sent a confirmation link to{' '}
            {email
              ? <span className="font-medium text-gray-700 dark:text-gray-300">{email}</span>
              : 'your email address'
            }.
            {' '}Click it to activate your account.
          </p>
          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
            Don&apos;t see it? Check your spam or junk folder.
          </p>

          {/* Resend status messages */}
          {resendStatus === 'sent' && (
            <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 size={15} className="shrink-0" />
              Confirmation email resent successfully.
            </div>
          )}
          {resendStatus === 'error' && resendError && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400 text-left">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {resendError}
            </div>
          )}

          {/* Resend button */}
          <button
            onClick={handleResend}
            disabled={resending || cooldown > 0 || !email}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {resending && <Loader2 size={14} className="animate-spin" />}
            {cooldown > 0
              ? `Resend in ${cooldown}s`
              : resending
                ? 'Sending…'
                : 'Resend confirmation email'}
          </button>
        </div>

        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Already confirmed?{' '}
          <Link
            href="/login"
            className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
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
