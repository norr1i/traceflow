-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- SCHEMA RECOVERY NOTE — this file is NOT superseded and remains valid.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- PostgreSQL grants EXECUTE to PUBLIC by default when a function is created.
-- This file intentionally grants EXECUTE to anon and authenticated so that
-- the /signup invitation flow works for unauthenticated users. However, it
-- does NOT revoke the PostgreSQL default PUBLIC EXECUTE grant.
--
-- After running this file for schema recovery, you MUST also run:
--   supabase_lookup_invitation_hardening_20260821.sql
--
-- That file revokes PUBLIC EXECUTE while preserving anon and authenticated
-- EXECUTE. Failure to run it leaves PUBLIC EXECUTE enabled on
-- public.lookup_invitation(text), which is unnecessary and was revoked
-- in the live database on 2026-08-21.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

-- ============================================================
-- TraceFlow — Invitation Acceptance Functions
-- Run AFTER supabase_team_management.sql
--
-- Adds two new RPC functions:
--   1. lookup_invitation(p_email)  — anon-accessible, used by signup
--      page to detect a pending invitation before the user has an account.
--   2. accept_my_invitation()       — authenticated, called after signup
--      to reliably claim a pending invite. Acts as a fallback for the
--      tf_bootstrap_company BEFORE INSERT trigger on user_profiles.
-- ============================================================

-- ── 1. lookup_invitation ──────────────────────────────────────────────────────
-- Callable by anon users (before signup).
-- Returns company name, role, and expiry for the most recent pending
-- invitation matching the given email. Returns 0 rows if no invite.

CREATE OR REPLACE FUNCTION lookup_invitation(p_email text)
RETURNS TABLE (
  company_name text,
  role         text,
  expires_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.name::text,
    i.role::text,
    i.expires_at
  FROM invitations i
  JOIN companies c ON c.id = i.company_id
  WHERE lower(i.email) = lower(trim(p_email))
    AND i.status   = 'pending'
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
  LIMIT 1;
END;
$$;

-- Anon can call this so the signup page works before the user exists
GRANT EXECUTE ON FUNCTION lookup_invitation(text) TO anon, authenticated;


-- ── 2. accept_my_invitation ───────────────────────────────────────────────────
-- Called by the auth context after every login when company_id is NULL.
-- Also called directly by the signup page when a session is returned
-- immediately (email confirmation disabled).
--
-- Returns the company_id that was accepted, or NULL if no pending
-- invitation was found (caller can distinguish "already has company"
-- vs "truly needs onboarding").

CREATE OR REPLACE FUNCTION accept_my_invitation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text;
  v_inv     RECORD;
  v_company uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  -- Get the current user's email from auth.users
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN RETURN NULL; END IF;

  -- If user already belongs to a company, return that company (idempotent)
  SELECT company_id INTO v_company
  FROM user_profiles
  WHERE user_id = v_uid AND company_id IS NOT NULL;

  IF v_company IS NOT NULL THEN RETURN v_company; END IF;

  -- Find the most recent live pending invitation for this email
  SELECT * INTO v_inv
  FROM invitations
  WHERE lower(email) = lower(v_email)
    AND status       = 'pending'
    AND expires_at   > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_inv IS NULL THEN RETURN NULL; END IF;

  -- Upsert user_profiles: handles both cases:
  --   a) row doesn't exist yet → INSERT (trigger may have fired already, idempotent)
  --   b) row exists but company_id is NULL → UPDATE
  INSERT INTO user_profiles (user_id, company_id, role)
  VALUES (v_uid, v_inv.company_id, v_inv.role)
  ON CONFLICT (user_id)
  DO UPDATE SET
    company_id = excluded.company_id,
    role       = excluded.role
  WHERE user_profiles.company_id IS NULL;  -- never overwrite an existing company

  -- Mark invitation as accepted
  UPDATE invitations
  SET status = 'accepted'
  WHERE id = v_inv.id;

  RETURN v_inv.company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION accept_my_invitation() TO authenticated;


-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '=== TraceFlow Invite Accept Migration Complete ===';
  RAISE NOTICE 'lookup_invitation()    — anon-accessible, reads pending invites by email';
  RAISE NOTICE 'accept_my_invitation() — accepts invite for current authenticated user';
END;
$$;
