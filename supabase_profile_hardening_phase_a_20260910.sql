-- ══════════════════════════════════════════════════════════════════════════════
-- TraceFlow — Profile Hardening Phase A
-- supabase_profile_hardening_phase_a_20260910.sql
--
-- Applied to production on 2026-09-10.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS FILE DOES
--   Creates ensure_my_profile() SECURITY DEFINER RPC.
--   No privilege changes. Backward-compatible with existing app code.
--   After this file is applied, the direct browser upsert continues to work
--   (INSERT privilege not yet revoked). Phase C revokes it.
--
-- DEPLOYMENT ORDER — critical, never reverse:
--   Phase A  → apply this file
--   App      → deploy auth-context.tsx with rpc('ensure_my_profile')
--              and verify in production
--   Phase C  → apply phase_c file (REVOKE + policy + recall fix)
--
-- ADVISORY LOCK DESIGN
--   The original browser upsert used ON CONFLICT DO NOTHING, which means
--   PostgreSQL fires BEFORE ROW INSERT triggers before the speculative
--   conflict detection. When tf_bootstrap_company fires for a row that is
--   subsequently discarded by DO NOTHING (e.g., during a concurrent retry),
--   it has already committed a company to the database — an orphan with no
--   member.
--
--   ensure_my_profile() eliminates this race using:
--     pg_advisory_xact_lock(hashtextextended(uid::text, 0))
--   Requires PostgreSQL 11+ (hashtextextended). Supabase runs PostgreSQL 14+.
--
--   The lock is transaction-scoped (released at commit or rollback). It
--   serializes concurrent calls for the same user without blocking other users.
--
--   Under the lock:
--     • If the profile exists → return without INSERT. tf_bootstrap_company
--       does not fire. No orphan risk.
--     • If the profile is absent → plain INSERT (no ON CONFLICT). The BEFORE
--       INSERT trigger tf_bootstrap_company fires exactly once. Under the lock
--       this INSERT cannot race with an identical concurrent INSERT from the
--       same user.
--
-- AUTH.USERS SIGNUP GUARANTEE
--   ensure_my_profile() is called only from auth-context.tsx loadUserInfo(),
--   which runs from onAuthStateChange(). onAuthStateChange fires only when a
--   JWT session exists. Supabase Auth issues JWTs only after auth.users is
--   committed. Therefore auth.users is guaranteed to contain the user's row
--   before any call to this RPC reaches the database, and tf_bootstrap_company's
--   SELECT FROM auth.users WHERE id = NEW.user_id is reliable.
--
-- EXECUTE GRANTS
--   PostgreSQL grants EXECUTE to PUBLIC by default on CREATE [OR REPLACE].
--   This file explicitly revokes the PUBLIC grant before granting to authenticated.
--   After this file: PUBLIC = denied, anon = denied, authenticated = allowed.
--
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Prerequisites ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_profiles'
  ) THEN
    RAISE EXCEPTION 'ABORT Phase A: user_profiles table not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'tf_bootstrap_company'
  ) THEN
    RAISE EXCEPTION 'ABORT Phase A: tf_bootstrap_company() not found';
  END IF;
  RAISE NOTICE 'Phase A prerequisites: OK';
END;
$$;


-- ── ensure_my_profile() ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  -- Reject unauthenticated callers.
  -- auth.uid() reads request.jwt.claims->>'sub', which is set by PostgREST
  -- from the bearer JWT. It is NULL in the SQL Editor, for service-role
  -- requests (no sub claim), and for anon callers. This RPC is only
  -- meaningful for a user who has an authenticated session; callers without
  -- one must not be allowed to create profiles.
  IF uid IS NULL THEN
    RAISE EXCEPTION 'ensure_my_profile: caller is not authenticated';
  END IF;

  -- Acquire a transaction-scoped advisory lock keyed to this user.
  -- Serializes concurrent calls for the same user. A second concurrent
  -- request blocks here until the first commits (at which point the
  -- EXISTS check below will see the newly created profile). Within the same
  -- session the lock is re-entrant (no self-deadlock).
  -- The lock is released automatically at transaction end.
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  -- Under the lock: check whether the profile already exists.
  -- If it does, return without INSERT. This prevents tf_bootstrap_company
  -- from firing for a row that would go unused, which is the root cause of
  -- the orphan-company race.
  IF EXISTS (SELECT 1 FROM user_profiles WHERE user_id = uid) THEN
    RETURN;
  END IF;

  -- Plain INSERT (no ON CONFLICT DO NOTHING).
  -- Under the advisory lock no concurrent call for this uid can reach this
  -- point simultaneously. tf_bootstrap_company BEFORE INSERT trigger fires
  -- exactly once and assigns company + role via the invitation flow or by
  -- creating a new company.
  INSERT INTO user_profiles (user_id, role)
  VALUES (uid, 'manager');
END;
$$;


-- ── EXECUTE grants ────────────────────────────────────────────────────────────
-- Order matters: revoke PUBLIC before granting authenticated, so there is
-- no window where PUBLIC has access and authenticated does not.
REVOKE ALL   ON FUNCTION public.ensure_my_profile() FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.ensure_my_profile() FROM anon;
GRANT  EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated;


-- ── Post-apply verification ───────────────────────────────────────────────────
DO $$
DECLARE
  public_has_execute bool;
BEGIN
  -- 1. Function exists
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ensure_my_profile'
  ), 'FAIL: ensure_my_profile() not found';

  -- 2. authenticated has EXECUTE
  ASSERT has_function_privilege(
    'authenticated', 'public.ensure_my_profile()', 'EXECUTE'
  ), 'FAIL: authenticated does not have EXECUTE on ensure_my_profile()';

  -- 3. anon does NOT have EXECUTE
  ASSERT NOT has_function_privilege(
    'anon', 'public.ensure_my_profile()', 'EXECUTE'
  ), 'FAIL: anon has EXECUTE on ensure_my_profile() — REVOKE did not take effect';

  -- 4. PUBLIC does NOT have EXECUTE
  -- Two-part check: proacl must be explicitly set (non-NULL means the
  -- default PUBLIC grant was overridden), and no entry with grantee OID 0
  -- (which represents PUBLIC in pg_catalog ACL entries) for EXECUTE.
  SELECT
    (p.proacl IS NULL)
    OR EXISTS (
      SELECT 1
      FROM   aclexplode(p.proacl) AS ace(grantor, grantee, privilege_type, grantable)
      WHERE  ace.grantee        = 0  -- OID 0 = PUBLIC
        AND  ace.privilege_type = 'EXECUTE'
    )
  INTO public_has_execute
  FROM   pg_proc p
  JOIN   pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'ensure_my_profile';

  ASSERT NOT public_has_execute,
    'FAIL: PUBLIC has EXECUTE on ensure_my_profile() — REVOKE FROM PUBLIC did not take effect';

  RAISE NOTICE '';
  RAISE NOTICE '=== Phase A Complete ===';
  RAISE NOTICE 'ensure_my_profile()     created';
  RAISE NOTICE '  SECURITY DEFINER      postgres (function owner)';
  RAISE NOTICE '  auth.uid() guard      rejects unauthenticated callers';
  RAISE NOTICE '  advisory lock         pg_advisory_xact_lock(hashtextextended(uid, 0))';
  RAISE NOTICE '  orphan-company race   eliminated (lock + EXISTS + plain INSERT)';
  RAISE NOTICE '  PUBLIC EXECUTE        REVOKED';
  RAISE NOTICE '  anon EXECUTE          REVOKED';
  RAISE NOTICE '  authenticated EXECUTE GRANTED';
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT: deploy app change (auth-context.tsx uses rpc(''ensure_my_profile''))';
  RAISE NOTICE 'Verify app stability, then apply phase_c.';
END;
$$;

COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK Phase A
-- Apply ONLY after the app has been redeployed to NOT call rpc('ensure_my_profile').
-- Calling this before redeploying causes login failures (function not found).
-- ══════════════════════════════════════════════════════════════════════════════
/*

BEGIN;
REVOKE EXECUTE ON FUNCTION public.ensure_my_profile() FROM authenticated;
DROP FUNCTION IF EXISTS public.ensure_my_profile();
DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ensure_my_profile'
  ), 'Rollback failed: ensure_my_profile() still exists';
  RAISE NOTICE 'Phase A rollback complete: ensure_my_profile() removed.';
END;
$$;
COMMIT;

*/
