'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Role } from './roles'

/**
 * Company-resolution status for route guards:
 *   'loading' — profile still being fetched (hold; never route)
 *   'present' — profile read succeeded AND the user has a company
 *   'none'    — profile read succeeded AND the user genuinely has no company
 *               (the ONLY state that may route to /onboarding)
 *   'error'   — profile fetch/RPC failed or timed out; company status UNKNOWN.
 *               Fail closed: never onboarding, never a phantom role.
 */
export type CompanyStatus = 'loading' | 'present' | 'none' | 'error'

interface AuthCtx {
  session:       Session | null
  user:          User | null
  role:          Role | null
  companyId:     string | null
  companyName:   string | null
  companyStatus: CompanyStatus
  loading:       boolean
  signOut:       () => Promise<void>
}

const AuthContext = createContext<AuthCtx>({
  session: null, user: null, role: null, companyId: null, companyName: null,
  companyStatus: 'loading', loading: true, signOut: async () => {},
})

type UserInfo = { role: Role | null; companyId: string | null; companyName: string | null }

// A shaped profile row, or null when the row is confirmed absent.
type ProfileRow = {
  role?: Role | null
  company_id?: string | null
  companies?: { name?: string | null } | null
} | null

// Result of reading the profile row. Distinguishes a successful read (row may
// be null = confirmed absent) from a failed/timed-out read (indeterminate).
type FetchResult =
  | { ok: true;  row: ProfileRow }
  | { ok: false }

// Outcome of resolving role + company for routing. Never conflates "no company"
// with "could not determine".
type LoadResult =
  | { kind: 'ok';         role: Role | null; companyId: string; companyName: string | null }
  | { kind: 'no_company'; role: Role | null }
  | { kind: 'error' }

const LOAD_ERROR: LoadResult = { kind: 'error' }

/** Race a promise (or PromiseLike) against a ms timeout. Resolves with fallback on timeout. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ])
}

async function fetchProfileRow(userId: string): Promise<FetchResult> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, role, company_id, companies(name)')
    .eq('user_id', userId)
    .maybeSingle()
  // A Postgrest error means we could NOT read the row (network / RLS / etc.).
  // maybeSingle() returns { data: null, error: null } for a confirmed-absent row.
  if (error) return { ok: false }
  return { ok: true, row: (data as ProfileRow) ?? null }
}

function buildInfo(row: ProfileRow): UserInfo {
  const role        = (row?.role as Role | undefined) ?? null
  const companyId   = (row?.company_id as string | undefined) ?? null
  const companyName = row?.companies?.name ?? null
  return { role, companyId, companyName }
}

/**
 * Resolve role + company for the signed-in user, fail-closed.
 *
 * Each DB call is capped at 6 s; callers add a 20 s outer ceiling. The result
 * explicitly distinguishes three outcomes so route guards never confuse them:
 *   • 'ok'         — read succeeded and the user has a company.
 *   • 'no_company' — read succeeded and the user genuinely has no company.
 *   • 'error'      — a read/RPC failed or timed out; status is UNKNOWN.
 *
 * Rules:
 *   • A failed/timed-out read is NEVER treated as "no profile" and NEVER
 *     triggers ensure_my_profile(). We only create/bootstrap on a CONFIRMED
 *     absent row, and only accept invitations on a CONFIRMED company-less row.
 *   • Any indeterminate step returns 'error' (fail closed) — no phantom role,
 *     no phantom company, no onboarding.
 */
async function loadUserInfo(userId: string): Promise<LoadResult> {
  const PER_CALL_MS = 6_000
  const UNREADABLE: FetchResult = { ok: false }
  const timedFetch = () => withTimeout(fetchProfileRow(userId), PER_CALL_MS, UNREADABLE)

  const okResult = (row: ProfileRow): LoadResult => {
    const info = buildInfo(row)
    return { kind: 'ok', role: info.role, companyId: info.companyId as string, companyName: info.companyName }
  }

  // 1. Initial read. A failed/timed-out read is UNKNOWN.
  let res = await timedFetch()
  if (!res.ok) return LOAD_ERROR

  // 2a. Complete profile with a company.
  if (res.row?.role && res.row?.company_id) return okResult(res.row)

  // 2b. CONFIRMED no profile row → create it (genuine new signup / invited user).
  //     ensure_my_profile() is SECURITY DEFINER; tf_bootstrap_company fires
  //     inside it and assigns company + role via invitation or new-company creation.
  if (res.ok && res.row === null) {
    const rpc = await withTimeout(supabase.rpc('ensure_my_profile'), PER_CALL_MS, null)
    if (!rpc || rpc.error) {
      if (rpc?.error) console.error('[auth] ensure_my_profile failed:', rpc.error.message)
      return LOAD_ERROR                         // could not create/confirm → UNKNOWN
    }
    res = await timedFetch()
    if (!res.ok) return LOAD_ERROR
    if (res.row?.role && res.row?.company_id) return okResult(res.row)
  }

  // 3. CONFIRMED profile row without a company → try invitation acceptance.
  //    Reached only from a successful read, never from a timeout.
  //    accept_my_invitation() also handles 'expired' invitations.
  if (res.ok && res.row && !res.row.company_id) {
    const accept = await withTimeout(supabase.rpc('accept_my_invitation'), PER_CALL_MS, null)
    if (!accept || accept.error) return LOAD_ERROR   // indeterminate → fail closed
    if (accept.data) {
      res = await timedFetch()
      if (!res.ok) return LOAD_ERROR
    }
  }

  // 4. Final classification — must come from a confirmed read.
  if (!res.ok) return LOAD_ERROR
  if (res.row?.role && res.row?.company_id) return okResult(res.row)
  if (res.row && !res.row.company_id) {
    return { kind: 'no_company', role: (res.row.role as Role | undefined) ?? null }
  }
  // No row even after ensure_my_profile → anomalous; fail closed.
  return LOAD_ERROR
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
  const [companyStatus, setCompanyStatus] = useState<CompanyStatus>('loading')
  const [loading,     setLoading]     = useState(true)

  // Track the user ID we last started a fetch for.
  // Prevents a stale async result from a prior user overwriting the current user.
  const activeUserIdRef = useRef<string | null>(null)

  // Mirror of role state that is readable inside the stable onAuthStateChange closure
  // (closure captures the initial null; roleRef always reflects the live value).
  const roleRef = useRef<Role | null>(null)

  // ── Realtime: re-apply profile whenever user_profiles row changes ──────────
  // This propagates role changes made by an admin immediately, without sign-out.
  // If Supabase Realtime is not enabled on user_profiles the channel silently
  // stays unsubscribed — no error, no crash.
  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) return

    const channel = supabase
      .channel(`profile:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_profiles', filter: `user_id=eq.${userId}` },
        () => {
          fetchProfileRow(userId).then(res => {
            if (!res.ok || !res.row || activeUserIdRef.current !== userId) return
            const info = buildInfo(res.row)
            setRole(info.role)
            roleRef.current = info.role
            setCompanyId(info.companyId)
            setCompanyName(info.companyName)
            setCompanyStatus(info.companyId ? 'present' : 'none')
          }).catch(() => {})
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [session?.user?.id])

  function applyResult(result: LoadResult) {
    if (result.kind === 'ok') {
      setRole(result.role)
      roleRef.current = result.role
      setCompanyId(result.companyId)
      setCompanyName(result.companyName)
      setCompanyStatus('present')
      return
    }
    if (result.kind === 'no_company') {
      setRole(result.role)
      roleRef.current = result.role
      setCompanyId(null)
      setCompanyName(null)
      setCompanyStatus('none')
      return
    }
    // 'error' — UNKNOWN. Fail closed: no company, and NO phantom role.
    setRole(null)
    roleRef.current = null
    setCompanyId(null)
    setCompanyName(null)
    setCompanyStatus('error')
  }

  function resetUserInfo() {
    setRole(null)
    roleRef.current = null
    setCompanyId(null)
    setCompanyName(null)
    setCompanyStatus('loading')
  }

  useEffect(() => {
    // Outer safety net: if onAuthStateChange never fires INITIAL_SESSION
    // (e.g. a corrupt localStorage token), clear state after 8 s.
    const outerTimer = setTimeout(() => {
      setLoading(prev => {
        if (prev) {
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
        clearTimeout(outerTimer)
        setSession(sess)

        if (!sess?.user) {
          activeUserIdRef.current = null
          resetUserInfo()
          setLoading(false)
          return
        }

        const userId = sess.user.id

        // Same user already loaded: don't re-run the full login flow.
        // On TOKEN_REFRESHED, silently re-check in case an admin changed the role.
        if (activeUserIdRef.current === userId && roleRef.current !== null) {
          setLoading(false)
          if (event === 'TOKEN_REFRESHED') {
            fetchProfileRow(userId)
              .then(res => {
                if (!res.ok || !res.row || activeUserIdRef.current !== userId) return
                const newRole = (res.row.role as Role | undefined) ?? null
                if (newRole && newRole !== roleRef.current) {
                  const info = buildInfo(res.row)
                  setRole(info.role)
                  roleRef.current = info.role
                  setCompanyId(info.companyId)
                  setCompanyName(info.companyName)
                  setCompanyStatus(info.companyId ? 'present' : 'none')
                }
              })
              .catch(() => {})
          }
          return
        }

        activeUserIdRef.current = userId
        resetUserInfo()
        // Hold route guards while the profile loads. Without this, a sign-in
        // that occurs after `loading` has already gone false (e.g. after a
        // sign-out, as in password recovery) would let AppShell evaluate a null
        // companyId and bounce the user to /onboarding before the profile
        // resolves. Keeping loading=true makes this path behave like a refresh.
        setLoading(true)

        // loadUserInfo has per-call timeouts; wrap the whole thing in a final
        // 20-second ceiling so loading ALWAYS resolves. A ceiling hit or a throw
        // yields an UNKNOWN result (fail closed) — never a phantom company/role.
        const result = await withTimeout(
          loadUserInfo(userId).catch(err => {
            console.error('[auth] loadUserInfo threw:', err)
            return LOAD_ERROR
          }),
          20_000,
          LOAD_ERROR,
        )

        // Discard if user changed while we were awaiting.
        if (activeUserIdRef.current !== userId) return

        applyResult(result)
        setLoading(false)
      }
    )

    return () => {
      clearTimeout(outerTimer)
      subscription.unsubscribe()
    }
    // Intentionally empty deps: the closure must be stable for the lifetime of
    // the provider. roleRef gives us the live role without re-subscribing.
  }, [])

  async function signOut() {
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
      companyStatus,
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
