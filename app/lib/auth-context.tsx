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

/**
 * Fetch role + company info for the given user ID from user_profiles.
 *
 * Rules:
 *  - Only reads the row where user_id = userId (exact match)
 *  - Never overwrites an existing row's role
 *  - If no row exists, inserts a NEW row with default 'manager'
 *    (ignoreDuplicates: true guarantees we skip the update on conflict)
 *  - If INSERT conflicted (row exists but SELECT returned nothing — RLS edge case),
 *    re-fetches the existing row
 *  - Final fallback is 'manager'; inspector is only assigned explicitly by an admin
 */
async function loadUserInfo(userId: string): Promise<UserInfo> {
  console.log('[auth] loadUserInfo → querying user_id:', userId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchRow(): Promise<any> {
    const { data } = await supabase
      .from('user_profiles')
      .select('user_id, role, company_id, companies(name)')
      .eq('user_id', userId)
      .maybeSingle()
    return data
  }

  let data = await fetchRow()
  console.log('[auth] loadUserInfo → query result:', data)

  if (data?.role) {
    return buildInfo(data)
  }

  // No row returned — attempt to insert a default profile.
  // ignoreDuplicates: true → ON CONFLICT DO NOTHING, never overwrites existing role.
  console.log('[auth] loadUserInfo → no row found for', userId, '— inserting default manager profile')

  const { data: inserted } = await supabase
    .from('user_profiles')
    .upsert(
      { user_id: userId, role: 'manager' },
      { onConflict: 'user_id', ignoreDuplicates: true },
    )
    .select('user_id, role, company_id')
    .maybeSingle()

  console.log('[auth] loadUserInfo → insert result:', inserted)

  // Re-fetch regardless: the tf_bootstrap_company trigger runs AFTER INSERT and
  // updates company_id via a separate UPDATE, so the upsert RETURNING won't see it.
  console.log('[auth] loadUserInfo → re-fetching after upsert')
  data = await fetchRow()
  console.log('[auth] loadUserInfo → re-fetch result:', data)

  return buildInfo(data)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildInfo(data: any): UserInfo {
  const role = (data?.role as Role | undefined) ?? 'manager'
  const companyId = (data?.company_id as string | undefined) ?? null
  // PostgREST returns the joined row as an object when there's a many-to-one FK
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companyName = (data?.companies as any)?.name ?? null
  return { role, companyId, companyName }
}

/** Clear all Supabase auth tokens from localStorage synchronously. */
function clearLocalAuthState() {
  if (typeof window === 'undefined') return
  try {
    const keysToRemove = Object.keys(localStorage).filter(k => k.startsWith('sb-'))
    keysToRemove.forEach(k => localStorage.removeItem(k))
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session,     setSession]     = useState<Session | null>(null)
  const [role,        setRole]        = useState<Role | null>(null)
  const [companyId,   setCompanyId]   = useState<string | null>(null)
  const [companyName, setCompanyName] = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)

  // Tracks the user we are currently fetching a role for.
  // Prevents a stale async loadRole() response from a previous user
  // from overwriting the role of the current user.
  const activeUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    // Fallback: if onAuthStateChange never fires INITIAL_SESSION
    // (e.g. corrupt/missing localStorage token), stop the spinner after 6s.
    const fallbackTimer = setTimeout(() => {
      setLoading(prev => {
        if (prev) {
          console.log('[auth] fallback timer fired — clearing stale loading state')
          activeUserIdRef.current = null
          setSession(null)
          setRole(null)
          clearLocalAuthState()
        }
        return false
      })
    }, 6000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, sess) => {
        console.log('[auth] onAuthStateChange →', event, 'user:', sess?.user?.id ?? 'none')
        clearTimeout(fallbackTimer)
        setSession(sess)

        if (!sess?.user) {
          activeUserIdRef.current = null
          setRole(null)
          setCompanyId(null)
          setCompanyName(null)
          setLoading(false)
          return
        }

        const userId = sess.user.id

        // If this is a token refresh for the same user and we already have a role,
        // skip re-fetching to avoid a flicker (role briefly becomes null).
        if (activeUserIdRef.current === userId && role !== null) {
          console.log('[auth] same user token refresh — skipping user info re-fetch, current role:', role)
          setLoading(false)
          return
        }

        // New user (or info not yet loaded) — reset and re-fetch.
        activeUserIdRef.current = userId
        setRole(null)
        setCompanyId(null)
        setCompanyName(null)

        const info = await loadUserInfo(userId)

        // Guard: discard result if user changed during the async fetch.
        if (activeUserIdRef.current === userId) {
          console.log('[auth] setting user info →', info, 'for user:', userId)
          setRole(info.role)
          setCompanyId(info.companyId)
          setCompanyName(info.companyName)
          setLoading(false)
        }
      }
    )

    return () => {
      clearTimeout(fallbackTimer)
      subscription.unsubscribe()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signOut() {
    console.log('[auth] signOut called')
    activeUserIdRef.current = null
    setSession(null)
    setRole(null)
    setCompanyId(null)
    setCompanyName(null)
    setLoading(false)
    clearLocalAuthState()
    try { await supabase.auth.signOut() } catch {}
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, role, companyId, companyName, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthCtx {
  return useContext(AuthContext)
}

/** Convenience hook — returns the current user's role (null while loading). */
export function useRole(): Role | null {
  return useContext(AuthContext).role
}
