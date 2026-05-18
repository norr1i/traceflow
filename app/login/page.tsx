'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react'

function friendlyAuthError(raw: string): string {
  if (raw.includes('Invalid login credentials'))
    return 'Wrong email or password. Please check and try again.'
  if (raw.includes('Email not confirmed'))
    return 'Your email address has not been verified yet.'
  if (raw.includes('User not found') || raw.includes('No user found'))
    return 'No account found with this email address. Try creating one.'
  if (raw.includes('rate limit') || raw.includes('over_email_send_rate_limit'))
    return 'Too many attempts. Please wait a few minutes before trying again.'
  if (raw.includes('Token has expired') || raw.includes('token is expired'))
    return 'Your confirmation link has expired. Request a new one below.'
  return raw
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [rawError, setRawError] = useState('')

  const needsVerification = rawError.includes('Email not confirmed')

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    setRawError('')

    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (err) {
      setRawError(err.message)
      setError(friendlyAuthError(err.message))
      return
    }

    router.replace('/')
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden">
      {/* Gradient background orbs */}
      <div className="pointer-events-none absolute inset-0" style={{
        background: 'radial-gradient(ellipse 1200px 800px at 15% 15%, rgba(59,130,246,0.09) 0%, transparent 65%), radial-gradient(ellipse 900px 700px at 85% 85%, rgba(139,92,246,0.08) 0%, transparent 60%), #070d1b',
      }} />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="
            flex h-14 w-14 items-center justify-center rounded-2xl
            bg-gradient-to-br from-blue-500 to-violet-600
            text-white text-lg font-bold
            shadow-[0_0_32px_rgba(139,92,246,0.5)]
            mb-5
          ">
            TF
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-gray-400">Sign in to your TraceFlow account</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl p-8 shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Error banner */}
            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <div className="flex items-start gap-2.5">
                  <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
                  <span>{error}</span>
                </div>
                {needsVerification && (
                  <Link
                    href={`/verify-email?email=${encodeURIComponent(email)}`}
                    className="mt-2 block font-medium text-red-300 underline underline-offset-2 hover:text-red-200"
                  >
                    Resend confirmation email →
                  </Link>
                )}
              </div>
            )}

            {/* Email */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="
                  w-full rounded-xl border border-white/[0.08] bg-white/[0.05]
                  px-4 py-2.5 text-sm text-white placeholder-gray-500
                  focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                  transition-colors
                "
              />
            </div>

            {/* Password */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="
                    w-full rounded-xl border border-white/[0.08] bg-white/[0.05]
                    px-4 py-2.5 pr-10 text-sm text-white placeholder-gray-500
                    focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                    transition-colors
                  "
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="
                flex w-full items-center justify-center gap-2
                rounded-xl bg-gradient-to-r from-blue-600 to-blue-700
                px-4 py-2.5 text-sm font-semibold text-white
                shadow-[0_0_20px_rgba(59,130,246,0.35)]
                hover:shadow-[0_0_28px_rgba(59,130,246,0.5)]
                hover:from-blue-500 hover:to-blue-600
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200
              "
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-gray-500">
          Don&apos;t have an account?{' '}
          <Link
            href="/signup"
            className="font-semibold text-blue-400 hover:text-blue-300 transition-colors"
          >
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
