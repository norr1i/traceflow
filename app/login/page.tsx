'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react'
import { LogoIcon } from '../components/Logo'

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
    <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden bg-[#090F15]">
      {/* Subtle depth haze */}
      <div className="pointer-events-none absolute inset-0" style={{
        background: 'radial-gradient(ellipse 1600px 1000px at 20% 10%, rgba(74,127,165,0.05) 0%, transparent 65%)',
      }} />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-5">
            <LogoIcon size="lg" />
          </div>
          <h1 className="text-2xl font-bold text-[#D3D1CE] tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-[#6C6D74]">Sign in to your TraceFlow account</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[#B3B7BA]/[0.09] bg-gradient-to-b from-[#262E36]/85 to-[#1a2230]/80 backdrop-blur-xl p-8 shadow-[0_24px_60px_rgba(0,0,0,0.50)]">
          <form onSubmit={handleSubmit} className="space-y-5">

            {error && (
              <div className="rounded-xl border border-[#8a3535]/30 bg-[#8a3535]/10 px-4 py-3 text-sm text-[#c47070]">
                <div className="flex items-start gap-2.5">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
                {needsVerification && (
                  <Link
                    href={`/verify-email?email=${encodeURIComponent(email)}`}
                    className="mt-2 block font-medium underline underline-offset-2 hover:text-[#d98080]"
                  >
                    Resend confirmation email →
                  </Link>
                )}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#B3B7BA]">Email</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="
                  w-full rounded-xl border border-[#B3B7BA]/[0.12] bg-[#262E36]/50
                  px-4 py-2.5 text-sm text-[#D3D1CE] placeholder-[#6C6D74]
                  focus:border-[#4a7fa5]/50 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/20
                  transition-colors
                "
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#B3B7BA]">Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="
                    w-full rounded-xl border border-[#B3B7BA]/[0.12] bg-[#262E36]/50
                    px-4 py-2.5 pr-10 text-sm text-[#D3D1CE] placeholder-[#6C6D74]
                    focus:border-[#4a7fa5]/50 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/20
                    transition-colors
                  "
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6C6D74] hover:text-[#B3B7BA] transition-colors"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
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
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-[#6C6D74]">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-semibold text-[#4a8fb9] hover:text-[#6aafd9] transition-colors">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
