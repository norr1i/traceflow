'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Role } from './roles'

interface AuthCtx {
  session:     Session | null
  user:        User | null
  role:        Role | null
  companyId:   string | null
  companyName: string | null
  loading:     boolean
  signOut:     () => Promise<void>
}

const AuthContext = createContext<AuthCtx>({
  session: null, user: null, role: null, companyId: null, companyName: null,
  loading: true, signOut: async () => {},
})

type UserInfo = { role: Role; companyId: string | null; companyName: string | null }

const SAFE_DEFAULTS: UserInfo = { role: 'manager', companyId: null, companyName: null }

/** Race a promise (or PromiseLike) against a ms timeout. Resolves with fallback on timeout. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ])
}

async function fetchProfileRow(userId: string) {
  const { data } = await supabase
    .from('user_profiles')
    .select('user_id, role, company_id, companies(name)')
    .eq('user_id', userId)
    .maybeSingle()
  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildInfo(data: any): UserInfo {
  const role       = (data?.role as Role | undefined) ?? 'manager'
  const companyId  = (data?.company_id as string | undefined) ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companyName = (data?.companies as any)?.name ?? null
  return { role, companyId, companyName }
}

/**
 * Load role + company for the signed-in user.
 *
 * Each DB call is capped at 6 s. Callers wrap the entire function in a
 * 20-second outer ceiling so loading always resolves.
 *
 * Flow:
 *  1. Fetch existing profile row.
 *  2a. Profile complete (role + company_id) → return immediately.
 *  2b. No profile at all → upsert bare row; trg_bootstrap_company creates
 *      the company for brand-new users. Re-fetch; if complete → return.
 *  3. Profile exists but company_id is NULL (invited user whose trigger
 *     failed, or partial signup) → call accept_my_invitation().
 *  4. Final re-fetch and return whatever we have.
 *
 * Critical: step 2a MUST check both role AND company_id. Returning early
 * on role alone skips step 3 for invited users with partial profiles.
 */
async function loadUserInfo(userId: string): Promise<UserInfo> {
  const PER_CALL_MS = 6_000

  console.log('[auth] loadUserInfo start, user:', userId)

  const timedFetch = () =>
    withTimeout(fetchProfileRow(userId), PER_CALL_MS, null)

  let data = await timedFetch()
  console.log('[auth] initial fetch:', data)

  // Happy path: profile fully populated — return immediately.
  if (data?.role && data?.company_id) return buildInfo(data)

  if (!data?.role) {
    // No profile row at all. Upsert a bare one; the trg_bootstrap_company
    // trigger fires BEFORE INSERT and may set company_id + role = 'admin'.
    console.log('[auth] no profile row — upserting default')
    await withTimeout(
      supabase
        .from('user_profiles')
        .upsert(
          { user_id: userId, role: 'manager' },
          { onConflict: 'user_id', ignoreDuplicates: true },
        ),
      PER_CALL_MS,
      null,
    )

    data = await timedFetch()
    console.log('[auth] post-upsert fetch:', data)

    if (data?.role && data?.company_id) return buildInfo(data)
  }

  // Profile exists (or was just created) but company_id is still NULL.
  // This happens when:
  //   • User was invited but the trigger ran before the invitation was created
  //   • Invitation expired before the user signed up (>7 days)
  //   • The BEFORE INSERT trigger fired but failed to find the invitation
  // accept_my_invitation() now also checks 'expired' invitations.
  console.log('[auth] profile has no company — calling accept_my_invitation')
  try {
    const result = await withTimeout(
      supabase.rpc('accept_my_invitation'),
      PER_CALL_MS,
      null,
    )
    const acceptedCoId = (result as { data?: string | null } | null)?.data ?? null
    console.log('[auth] accept_my_invitation →', acceptedCoId)
    if (acceptedCoId) {
      data = await timedFetch()
      console.log('[auth] post-invite fetch:', data)
    }
  } catch { /* timeout or network error — proceed with what we have */ }

  return buildInfo(data)
}

/** Clear all Supabase auth tokens from localStorage synchronously. */
function clearLocalAuthState() {
  if (typeof window === 'undefined') return
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('sb-'))
      .forEach(k => localStorage.removeItem(k))
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session,     setSession]     = useState<Session | null>(null)
  const [role,        setRole]        = useState<Role | null>(null)
  const [companyId,   setCompanyId]   = useState<string | null>(null)
  const [companyName, setCompanyName] = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)

  // Track the user ID we last started a fetch for.
  // Prevents a stale async result from a prior user overwriting the current user.
  const activeUserIdRef = useRef<string | null>(null)

  // Mirror of role state that is readable inside the stable onAuthStateChange closure
  // (closure captures the initial null; roleRef always reflects the live value).
  const roleRef = useRef<Role | null>(null)

  function applyUserInfo(info: UserInfo) {
    setRole(info.role)
    roleRef.current = info.role
    setCompanyId(info.companyId)
    setCompanyName(info.companyName)
  }

  function resetUserInfo() {
    setRole(null)
    roleRef.current = null
    setCompanyId(null)
    setCompanyName(null)
  }

  useEffect(() => {
    // Outer safety net: if onAuthStateChange never fires INITIAL_SESSION
    // (e.g. a corrupt localStorage token), clear state after 8 s.
    const outerTimer = setTimeout(() => {
      setLoading(prev => {
        if (prev) {
          console.log('[auth] outer timer fired — clearing stale loading state')
          activeUserIdRef.current = null
          setSession(null)
          resetUserInfo()
          clearLocalAuthState()
        }
        return false
      })
    }, 8_000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, sess) => {
        console.log('[auth] event:', event, 'user:', sess?.user?.id ?? 'none')
        clearTimeout(outerTimer)
        setSession(sess)

        if (!sess?.user) {
          activeUserIdRef.current = null
          resetUserInfo()
          setLoading(false)
          return
        }

        const userId = sess.user.id

        // Token refresh for the same user: skip re-fetching to avoid flicker.
        // roleRef gives us the live value even though this closure is stable.
        if (activeUserIdRef.current === userId && roleRef.current !== null) {
          console.log('[auth] token refresh, same user — skipping re-fetch')
          setLoading(false)
          return
        }

        activeUserIdRef.current = userId
        resetUserInfo()

        // loadUserInfo has per-call timeouts; wrap the whole thing in a final
        // 20-second ceiling so loading ALWAYS resolves no matter what.
        const info = await withTimeout(
          loadUserInfo(userId).catch(err => {
            console.error('[auth] loadUserInfo threw:', err)
            return SAFE_DEFAULTS
          }),
          20_000,
          SAFE_DEFAULTS,
        )

        // Discard if user changed while we were awaiting.
        if (activeUserIdRef.current !== userId) {
          console.log('[auth] user changed during fetch — discarding result')
          return
        }

        console.log('[auth] applying user info:', info)
        applyUserInfo(info)
        setLoading(false)
      }
    )

    return () => {
      clearTimeout(outerTimer)
      subscription.unsubscribe()
    }
    // Intentionally empty deps: the closure must be stable for the lifetime of
    // the provider. roleRef gives us the live role without re-subscribing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signOut() {
    console.log('[auth] signOut')
    activeUserIdRef.current = null
    setSession(null)
    resetUserInfo()
    setLoading(false)
    clearLocalAuthState()
    try { await supabase.auth.signOut() } catch {}
  }

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      role,
      companyId,
      companyName,
      loading,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthCtx {
  return useContext(AuthContext)
}

export function useRole(): Role | null {
  return useContext(AuthContext).role
}
