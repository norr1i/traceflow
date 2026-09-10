'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '../lib/auth-context'
import { canVisit, homeFor } from '../lib/roles'
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

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading, role, companyId } = useAuth()
  const pathname = usePathname()
  const router   = useRouter()

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

  // Pages that require no auth at all (anon-accessible)
  const isAnonPage = isAuthPage || isVerifyPage || isTracePage || isRecoveryPage

  useEffect(() => {
    if (loading) return

    // ── Auth-only pages: redirect away if already signed in ──────────────────
    if (isAuthPage && session) {
      router.replace(role ? homeFor(role) : '/')
      return
    }

    // ── Unauthenticated: send to login ────────────────────────────────────────
    if (!isAnonPage && !session) {
      router.replace('/login')
      return
    }

    // ── Onboarding: redirect to home if user already has a company ───────────
    if (isOnboardingPage && session && companyId) {
      router.replace(role ? homeFor(role) : '/')
      return
    }

    // ── Authenticated but no company: must complete onboarding first ─────────
    if (!isAnonPage && !isOnboardingPage && session && companyId === null) {
      router.replace('/onboarding')
      return
    }

    // ── Role-based page guard (admin/manager can see all, inspector limited) ──
    if (!isAnonPage && !isOnboardingPage && session && role && !canVisit(role, pathname)) {
      router.replace(homeFor(role))
    }
  }, [session, loading, role, companyId, isAuthPage, isAnonPage, isOnboardingPage, pathname, router])

  // ── Render ────────────────────────────────────────────────────────────────

  // Fully public pages: no auth, no sidebar
  if (isAnonPage) {
    return <>{children}</>
  }

  // Onboarding: needs auth but no sidebar
  if (isOnboardingPage) {
    if (loading || !session) return <LoadingScreen />
    // Already has a company — wait for useEffect to redirect to home
    if (companyId) return <LoadingScreen />
    return <>{children}</>
  }

  // Normal app: needs auth + company
  if (loading || !session || !companyId) return <LoadingScreen />

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
