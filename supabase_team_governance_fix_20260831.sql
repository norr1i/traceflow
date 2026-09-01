-- ============================================================
-- TraceFlow — Team Management Admin Role Governance Fix
-- File: supabase_team_governance_fix_20260831.sql
-- Created: 2026-08-31
--
-- SCOPE
-- -----
-- Replaces three SECURITY DEFINER functions in-place to enforce
-- the approved admin-role governance policy:
--
--   1. invite_member(text, text)
--   2. update_member_role(uuid, text)
--   3. remove_team_member(uuid)
--
-- POLICY ENFORCED
-- ---------------
--   • Only an admin may invite another user as admin.
--   • Only an admin may assign/promote someone to admin.
--   • Only an admin may modify (role-change) an admin-role member.
--   • Only an admin may remove an admin-role member.
--   • A company must never transition from ≥1 admin to 0 admins.
--
-- WHAT DOES NOT CHANGE
-- --------------------
--   • Function signatures (name, parameters, return types)
--   • SECURITY DEFINER / SET search_path = public
--   • Authentication gate (auth.uid() check)
--   • Caller-role gate (admin/manager only)
--   • Self-edit/self-remove prohibition
--   • Company scope check (cross-company blocked)
--   • Role enum validation
--   • Existing last-admin/manager safeguard (defense-in-depth)
--   • Invitation expiry, schema, accept flow
--   • Soft-removal behavior (company_id = NULL, role = NULL)
--   • cancel_invitation, get_team_members, accept_my_invitation,
--     lookup_invitation — untouched
--   • invitations table schema/RLS
--   • auth.users — never modified
--   • Grants — re-stated for idempotency; no new access granted
--
-- HOW TO RUN
-- ----------
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
--   Safe to re-run: CREATE OR REPLACE is idempotent.
-- ============================================================


-- ── 1. invite_member(p_email, p_role) ────────────────────────────────────────
-- Governance addition: only admins may invite with role = 'admin'.
-- All other logic is identical to supabase_team_management.sql.
CREATE OR REPLACE FUNCTION invite_member(p_email text, p_role text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid         uuid := auth.uid();
  caller_role text;
  caller_co   uuid;
  inv_id      uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT role, company_id INTO caller_role, caller_co
  FROM user_profiles WHERE user_id = uid;

  IF caller_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Only admins and managers can invite team members';
  END IF;

  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF p_role NOT IN ('admin', 'manager', 'operations', 'warehouse', 'qc_inspector', 'sales') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  -- GOVERNANCE: only admins may send admin invitations
  IF p_role = 'admin' AND caller_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can invite users with the admin role';
  END IF;

  -- Check if email already belongs to a member of this company
  IF EXISTS (
    SELECT 1 FROM user_profiles up
    JOIN auth.users au ON au.id = up.user_id
    WHERE lower(au.email) = lower(trim(p_email))
      AND up.company_id = caller_co
  ) THEN
    RAISE EXCEPTION 'This email is already a member of your company';
  END IF;

  -- Expire any prior pending invitation for this email+company
  UPDATE invitations
  SET status = 'expired'
  WHERE lower(email) = lower(trim(p_email))
    AND company_id = caller_co
    AND status = 'pending';

  -- Create new invitation
  INSERT INTO invitations (email, role, company_id, invited_by)
  VALUES (lower(trim(p_email)), p_role, caller_co, uid)
  RETURNING id INTO inv_id;

  RETURN inv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION invite_member(text, text) TO authenticated;


-- ── 2. update_member_role(p_user_id, p_new_role) ─────────────────────────────
-- Governance additions:
--   A. Only admins may assign role = 'admin'.
--   B. Only admins may modify a member who currently has role = 'admin'.
--   C. Demoting the last admin is blocked (admin-count invariant).
-- The existing last-admin/manager safeguard is retained as defense-in-depth.
CREATE OR REPLACE FUNCTION update_member_role(p_user_id uuid, p_new_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid          uuid := auth.uid();
  caller_role  text;
  caller_co    uuid;
  target_co    uuid;
  target_role  text;   -- current role of the target member
  admin_count  int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT role, company_id INTO caller_role, caller_co
  FROM user_profiles WHERE user_id = uid;

  IF caller_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_user_id = uid THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;

  IF p_new_role NOT IN ('admin', 'manager', 'operations', 'warehouse', 'qc_inspector', 'sales') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  -- Fetch target's current company and role together
  SELECT company_id, role INTO target_co, target_role
  FROM user_profiles WHERE user_id = p_user_id;

  IF target_co IS DISTINCT FROM caller_co THEN
    RAISE EXCEPTION 'User is not a member of your company';
  END IF;

  -- GOVERNANCE A: only admins may promote someone to admin
  IF p_new_role = 'admin' AND caller_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can assign the admin role';
  END IF;

  -- GOVERNANCE B: only admins may edit a member who is currently an admin
  IF target_role = 'admin' AND caller_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can modify the role of another admin';
  END IF;

  -- GOVERNANCE C: admin-count invariant — demoting an admin must not leave the
  -- company with zero admins.  Counts admins OTHER than the target.
  IF target_role = 'admin' AND p_new_role != 'admin' THEN
    SELECT COUNT(*) INTO admin_count
    FROM user_profiles
    WHERE company_id = caller_co
      AND role       = 'admin'
      AND user_id   != p_user_id;

    IF admin_count = 0 THEN
      RAISE EXCEPTION 'Cannot demote the last admin — promote another member to admin first';
    END IF;
  END IF;

  -- EXISTING SAFEGUARD (defense-in-depth): at least one admin or manager must
  -- remain after any demotion to a non-privileged role.
  IF p_new_role NOT IN ('admin', 'manager') THEN
    SELECT COUNT(*) INTO admin_count
    FROM user_profiles
    WHERE company_id = caller_co
      AND role IN ('admin', 'manager')
      AND user_id != p_user_id;

    IF admin_count = 0 THEN
      RAISE EXCEPTION 'Cannot demote the last admin/manager — promote another member first';
    END IF;
  END IF;

  UPDATE user_profiles SET role = p_new_role WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_member_role(uuid, text) TO authenticated;


-- ── 3. remove_team_member(p_user_id) ─────────────────────────────────────────
-- Governance additions:
--   A. Only admins may remove a member who currently has role = 'admin'.
--   B. Removing the last admin is blocked (admin-count invariant).
-- The existing last-admin/manager safeguard is retained as defense-in-depth.
-- Soft-removal behavior unchanged: company_id = NULL, role = NULL.
-- auth.users is never modified.
CREATE OR REPLACE FUNCTION remove_team_member(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid          uuid := auth.uid();
  caller_role  text;
  caller_co    uuid;
  target_co    uuid;
  target_role  text;
  admin_count  int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT role, company_id INTO caller_role, caller_co
  FROM user_profiles WHERE user_id = uid;

  IF caller_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_user_id = uid THEN
    RAISE EXCEPTION 'You cannot remove yourself from the company';
  END IF;

  SELECT company_id, role INTO target_co, target_role
  FROM user_profiles WHERE user_id = p_user_id;

  IF target_co IS DISTINCT FROM caller_co THEN
    RAISE EXCEPTION 'User is not a member of your company';
  END IF;

  -- GOVERNANCE A: only admins may remove another admin
  IF target_role = 'admin' AND caller_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can remove other admins';
  END IF;

  -- GOVERNANCE B: admin-count invariant — removing an admin must not leave the
  -- company with zero admins.  Counts admins OTHER than the target.
  IF target_role = 'admin' THEN
    SELECT COUNT(*) INTO admin_count
    FROM user_profiles
    WHERE company_id = caller_co
      AND role       = 'admin'
      AND user_id   != p_user_id;

    IF admin_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last admin';
    END IF;
  END IF;

  -- EXISTING SAFEGUARD (defense-in-depth): at least one admin or manager must
  -- remain after removing any privileged member.
  IF target_role IN ('admin', 'manager') THEN
    SELECT COUNT(*) INTO admin_count
    FROM user_profiles
    WHERE company_id = caller_co
      AND role IN ('admin', 'manager')
      AND user_id != p_user_id;

    IF admin_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last admin/manager';
    END IF;
  END IF;

  -- Detach from company; the auth account remains intact
  UPDATE user_profiles
  SET company_id = NULL, role = NULL
  WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_team_member(uuid) TO authenticated;


-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '=== TraceFlow Team Governance Fix (2026-08-31) ===';
  RAISE NOTICE 'invite_member():      admin-invite guard added';
  RAISE NOTICE 'update_member_role(): promote-to-admin guard added';
  RAISE NOTICE 'update_member_role(): edit-admin-row guard added';
  RAISE NOTICE 'update_member_role(): last-admin invariant added';
  RAISE NOTICE 'remove_team_member(): remove-admin caller guard added';
  RAISE NOTICE 'remove_team_member(): last-admin invariant added';
  RAISE NOTICE 'All existing safeguards and behavior preserved.';
  RAISE NOTICE '';
  RAISE NOTICE 'POLICY: Only admins may invite/assign/edit/remove admins.';
  RAISE NOTICE 'POLICY: Company must always retain >= 1 admin.';
END;
$$;
