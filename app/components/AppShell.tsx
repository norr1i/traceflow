'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AlertCircle, Loader2, LogOut } from 'lucide-react'
import { useAuth } from '../lib/auth-context'
import { canVisit, homeFor } from '../lib/roles'
import { useT } from '../lib/i18n'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { LogoIcon } from './Logo'

function LoadingScreen() {
  return (
    <div
      className="flex h-screen items-center justify-center bg-[#07090E]"
      style={{
        background:
          'radial-gradient(ellipse 1600px 1000px at 20% 10%, rgba(74,127,165,0.05) 0%, transparent 65%), #07090E',
      }}
    >
      <div className="flex flex-col items-center gap-6">
        <LogoIcon size="lg" />
        <div className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-[#1C2333] border-t-[#4a8fb9]" />
      </div>
    </div>
  )
}

// Fail-closed screen shown when the profile/company status could NOT be
// determined (fetch/RPC failed or timed out). We never assume "no company"
// here — the user retries (a full reload re-runs auth with a warm fetch) or
// signs out. This never routes to onboarding.
function ProfileErrorScreen({
  t, onRetry, onSignOut,
}: {
  t: (k: string) => string
  onRetry: () => void
  onSignOut: () => void
}) {
  return (
    <div
      className="flex h-screen items-center justify-center px-4 bg-[#07090E]"
      style={{
        background:
          'radial-gradient(ellipse 1600px 1000px at 20% 10%, rgba(74,127,165,0.05) 0%, transparent 65%), #07090E',
      }}
    >
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex justify-center"><LogoIcon size="lg" /></div>
        <div className="rounded-2xl border border-[#B3B7BA]/[0.09] bg-gradient-to-b from-[#262E36]/85 to-[#1a2230]/80 backdrop-blur-xl p-8 shadow-[0_24px_60px_rgba(0,0,0,0.50)]">
          <div className="mb-4 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#8a3535]/30 bg-[#8a3535]/12">
              <AlertCircle size={26} className="text-[#c47070]" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-[#D3D1CE]">{t('auth.profile_error_title')}</h1>
          <p className="mt-2 text-sm text-[#6C6D74]">{t('auth.profile_error_body')}</p>

          <button
            onClick={onRetry}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#3a6f8f] hover:bg-[#2d5a74] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_rgba(74,127,165,0.25)] hover:shadow-[0_0_28px_rgba(74,127,165,0.35)] transition-all duration-200"
          >
            <Loader2 size={15} />
            {t('auth.retry')}
          </button>
          <button
            onClick={onSignOut}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#B3B7BA]/[0.12] bg-[#262E36]/40 px-4 py-2.5 text-sm font-medium text-[#B3B7BA] hover:bg-[#262E36]/60 hover:text-[#D3D1CE] transition-colors"
          >
            <LogOut size={14} />
            {t('auth.sign_out')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading, role, companyId, companyStatus, signOut } = useAuth()
  const pathname = usePathname()
  const router   = useRouter()
  const { t }    = useT()

  // Page categories
  const isAuthPage      = pathname === '/login' || pathname === '/signup'
  const isVerifyPage    = pathname === '/verify-email'
  const isTracePage     = pathname.startsWith('/trace/')
  const isOnboardingPage = pathname === '/onboarding'
  // Password recovery pages. /reset-password is anon (not isAuthPage) on
  // purpose: a Supabase recovery link auto-establishes a session via
  // detectSessionInUrl, and treating it as an auth page would bounce the
  // recovering user to home before they can set a new password.
  const isRecoveryPage  = pathname === '/forgot-password' || pathname === '/reset-password'

  // Public marketing homepage — EXACT `/` only (never prefix-matched). Open to
  // everyone (logged out AND logged in); it is never redirected and never wrapped
  // in the dashboard shell. The authenticated dashboard now lives at /dashboard.
  const isPublicHome = pathname === '/'

  // Pages that require no auth at all (anon-accessible)
  const isAnonPage = isAuthPage || isVerifyPage || isTracePage || isRecoveryPage || isPublicHome

  useEffect(() => {
    if (loading) return

    // ── Auth-only pages: redirect away if already signed in ──────────────────
    if (isAuthPage && session) {
      router.replace(role ? homeFor(role) : '/dashboard')
      return
    }

    // ── Unauthenticated: send to login ────────────────────────────────────────
    if (!isAnonPage && !session) {
      router.replace('/login')
      return
    }

    // ── Company status UNKNOWN (fetch/RPC failed or timed out): do NOT route to
    //    onboarding. Hold on the fail-closed error/retry screen (see render). ──
    if (session && companyStatus === 'error') return

    // ── Onboarding: leave only once a company is CONFIRMED present ────────────
    if (isOnboardingPage && session && companyStatus === 'present') {
      router.replace(role ? homeFor(role) : '/dashboard')
      return
    }

    // ── CONFIRMED no company → onboarding. Never triggered by a timeout/unknown.
    if (!isAnonPage && !isOnboardingPage && session && companyStatus === 'none') {
      router.replace('/onboarding')
      return
    }

    // ── Role-based page guard (admin/manager can see all, inspector limited) ──
    if (!isAnonPage && !isOnboardingPage && session && companyStatus === 'present'
        && role && !canVisit(role, pathname)) {
      router.replace(homeFor(role))
    }
  }, [session, loading, role, companyId, companyStatus, isAuthPage, isAnonPage, isOnboardingPage, pathname, router])

  // ── Render ────────────────────────────────────────────────────────────────

  // Fully public pages: no auth, no sidebar
  if (isAnonPage) {
    return <>{children}</>
  }

  // Company status could not be determined — fail-closed error/retry screen.
  // Never falls through to onboarding or the app.
  if (session && companyStatus === 'error') {
    return <ProfileErrorScreen t={t} onRetry={() => window.location.reload()} onSignOut={() => { void signOut() }} />
  }

  // Onboarding: needs auth but no sidebar
  if (isOnboardingPage) {
    if (loading || !session) return <LoadingScreen />
    // Company confirmed present — wait for useEffect to redirect to home
    if (companyStatus === 'present') return <LoadingScreen />
    // Render the workspace form ONLY for a CONFIRMED no-company user
    if (companyStatus === 'none') return <>{children}</>
    // 'loading' — still resolving; hold
    return <LoadingScreen />
  }

  // Normal app: needs auth + a CONFIRMED company
  if (loading || !session || companyStatus !== 'present' || !companyId) return <LoadingScreen />

  // Role guard: hold the render while useEffect fires the redirect
  if (role && !canVisit(role, pathname)) return <LoadingScreen />

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
