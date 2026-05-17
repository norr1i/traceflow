'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Role } from './roles'

interface AuthCtx {
  session: Session | null
  user:    User | null
  role:    Role | null
  loading: boolean
}

const AuthContext = createContext<AuthCtx>({
  session: null, user: null, role: null, loading: true,
})

/**
 * Fetch the role for the given user ID from user_profiles.
 * If no row exists, upsert a default 'manager' profile and return 'manager'.
 * Never returns a role belonging to a different user.
 */
async function loadRole(userId: string): Promise<Role> {
  const { data } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle()

  if (data?.role) return data.role as Role

  // No profile for this exact user — create one with default role
  const { data: created } = await supabase
    .from('user_profiles')
    .upsert({ user_id: userId, role: 'manager' }, { onConflict: 'user_id' })
    .select('role')
    .maybeSingle()

  return (created?.role as Role | undefined) ?? 'manager'
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role,    setRole]    = useState<Role | null>(null)
  const [loading, setLoading] = useState(true)

  // Track the user we're currently loading a role for so a stale async
  // response from a previous sign-in cannot overwrite the current user's role.
  const activeUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    // Use ONLY onAuthStateChange — it fires INITIAL_SESSION on mount with
    // the persisted session, so there is no need to also call getSession().
    // Using both created a race where two concurrent fetchRole calls could
    // set role in the wrong order.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, sess) => {
        setSession(sess)

        if (!sess?.user) {
          // Signed out — clear role immediately and stop loading
          activeUserIdRef.current = null
          setRole(null)
          setLoading(false)
          return
        }

        const userId = sess.user.id

        // Reset role to null so a stale value from a previous session is
        // never visible while the new role is being fetched.
        activeUserIdRef.current = userId
        setRole(null)

        const freshRole = await loadRole(userId)

        // Guard: if the user changed (rapid sign-out/in) discard this result
        if (activeUserIdRef.current === userId) {
          setRole(freshRole)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, role, loading }}>
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
