'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react'

function getPasswordStrength(pw: string): { bars: number; label: string; color: string } {
  let score = 0
  if (pw.length >= 8)           score++
  if (pw.length >= 12)          score++
  if (/[A-Z]/.test(pw))         score++
  if (/[0-9]/.test(pw))         score++
  if (/[^A-Za-z0-9]/.test(pw))  score++
  const bars = score <= 1 ? 1 : score === 2 ? 2 : score === 3 ? 3 : 4
  if (bars === 1) return { bars, label: 'Weak',   color: 'bg-red-500' }
  if (bars === 2) return { bars, label: 'Fair',   color: 'bg-amber-500' }
  if (bars === 3) return { bars, label: 'Good',   color: 'bg-blue-500' }
  return                 { bars, label: 'Strong', color: 'bg-emerald-500' }
}

function friendlySignupError(raw: string): string {
  if (raw.includes('User already registered') || raw.includes('already been registered'))
    return 'An account with this email already exists. Try signing in instead.'
  if (raw.includes('Unable to validate email') || raw.includes('invalid format'))
    return 'Please enter a valid email address.'
  if (raw.includes('Password should be at least'))
    return 'Password must be at least 8 characters long.'
  if (raw.includes('rate limit') || raw.includes('over_email_send_rate_limit'))
    return 'Too many sign-up attempts. Please wait a few minutes and try again.'
  return raw
}

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const strength = password ? getPasswordStrength(password) : null
  const confirmMismatch = !!confirm && confirm !== password

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return }

    setLoading(true)
    setError(null)

    const { data, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/` : '/',
      },
    })

    if (signUpErr) {
      setError(friendlySignupError(signUpErr.message))
      setLoading(false)
      return
    }

    if (data.session) {
      router.replace('/')
      return
    }

    router.replace(`/verify-email?email=${encodeURIComponent(email)}`)
  }

  const inputClass = `
    w-full rounded-xl border border-white/[0.08] bg-white/[0.05]
    px-4 py-2.5 text-sm text-white placeholder-gray-500
    focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20
    transition-colors
  `

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden">
      {/* Background */}
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
          <h1 className="text-2xl font-bold text-white tracking-tight">Create your account</h1>
          <p className="mt-1.5 text-sm text-gray-400">Start using TraceFlow today</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl p-8 shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
          <form onSubmit={handleSubmit} className="space-y-5">

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
                {error}
              </div>
            )}

            {/* Email */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">Email</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={inputClass}
              />
            </div>

            {/* Password + strength meter */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
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
                          i <= strength.bars ? strength.color : 'bg-white/10'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">
                    Strength: <span className="font-medium text-gray-300">{strength.label}</span>
                  </p>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">Confirm password</label>
              <input
                type={showPw ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                className={`${inputClass} ${
                  confirmMismatch ? 'border-red-500/40 focus:ring-red-500/20' : ''
                }`}
              />
              {confirmMismatch && (
                <p className="mt-1 text-xs text-red-400">Passwords do not match.</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || confirmMismatch}
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
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-blue-400 hover:text-blue-300 transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
