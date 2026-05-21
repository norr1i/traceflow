-- ============================================================
-- TraceFlow — Full Recovery Migration
--
-- Scenario: original admin/owner account deleted from Supabase Auth.
-- Symptoms: owner_id NULL, invited users stuck as pending,
--           data missing, dashboard partial, login slow.
--
-- Run this ENTIRE file in one paste in the Supabase SQL Editor.
-- Idempotent: safe to re-run if interrupted.
-- ============================================================


-- ── STEP 0: Pre-flight snapshot ───────────────────────────────────────────────
-- Shows you what you're working with BEFORE any changes are made.

DO $$
DECLARE
  companies_total      int;
  companies_no_owner   int;
  profiles_total       int;
  profiles_no_company  int;
  orphan_profiles      int;
  invitations_pending  int;
  invitations_expired  int;
BEGIN
  SELECT COUNT(*)                            INTO companies_total     FROM companies;
  SELECT COUNT(*) FROM companies
    WHERE owner_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = companies.owner_id)
                                             INTO companies_no_owner;
  SELECT COUNT(*)                            INTO profiles_total      FROM user_profiles;
  SELECT COUNT(*) FROM user_profiles WHERE company_id IS NULL
                                             INTO profiles_no_company;
  SELECT COUNT(*) FROM user_profiles
    WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id = user_profiles.user_id)
                                             INTO orphan_profiles;
  SELECT COUNT(*) FROM invitations WHERE status = 'pending'
                                             INTO invitations_pending;
  SELECT COUNT(*) FROM invitations WHERE status = 'expired'
                                             INTO invitations_expired;

  RAISE NOTICE '=== PRE-FLIGHT SNAPSHOT ===';
  RAISE NOTICE 'companies total      : %', companies_total;
  RAISE NOTICE 'companies no owner   : %  ← target for recovery', companies_no_owner;
  RAISE NOTICE 'user_profiles total  : %', profiles_total;
  RAISE NOTICE 'profiles no company  : %  ← invited users stuck here', profiles_no_company;
  RAISE NOTICE 'orphan profiles      : %  ← user deleted from auth.users', orphan_profiles;
  RAISE NOTICE 'invitations pending  : %', invitations_pending;
  RAISE NOTICE 'invitations expired  : %  ← may include users who signed up late', invitations_expired;
END;
$$;


-- ── STEP 1: Delete orphaned user_profiles ────────────────────────────────────
-- Rows where the auth account no longer exists.
-- Safe: business data is scoped to company_id, not user_id.

DELETE FROM user_profiles
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users au WHERE au.id = user_profiles.user_id
);

RAISE NOTICE 'Step 1 complete: orphaned user_profiles removed.';


-- ── STEP 2: Link signed-up invited users to their company ────────────────────
-- Covers users who signed up after their invitation expired (>7 days)
-- AND users whose trigger failed silently (pre-existing profile row).
-- Looks at ALL invitation statuses so no invited user is left unlinked.
--
-- Safety guards:
--   • Only touches profiles where company_id IS NULL
--   • Never overwrites an existing company assignment
--   • Uses the most recent invitation per email if multiple exist

WITH ranked_invitations AS (
  SELECT
    i.*,
    ROW_NUMBER() OVER (PARTITION BY lower(i.email) ORDER BY i.created_at DESC) AS rn
  FROM invitations i
),
best_invitation AS (
  SELECT * FROM ranked_invitations WHERE rn = 1
)
INSERT INTO user_profiles (user_id, company_id, role)
SELECT
  au.id          AS user_id,
  bi.company_id,
  bi.role
FROM best_invitation bi
JOIN auth.users au ON lower(au.email) = lower(bi.email)
LEFT JOIN user_profiles up ON up.user_id = au.id
WHERE
  -- User has signed up
  au.id IS NOT NULL
  -- Either no profile yet, or profile exists but has no company
  AND (up.user_id IS NULL OR up.company_id IS NULL)
ON CONFLICT (user_id)
DO UPDATE SET
  company_id = excluded.company_id,
  role       = excluded.role
WHERE user_profiles.company_id IS NULL;   -- never overwrite an existing company

-- Mark those invitations as accepted now that the user is linked
UPDATE invitations i
SET status = 'accepted'
FROM auth.users au
WHERE lower(au.email) = lower(i.email)
  AND i.status != 'accepted'
  AND EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.user_id = au.id
      AND up.company_id = i.company_id
  );

RAISE NOTICE 'Step 2 complete: invited users linked to their companies.';


-- ── STEP 3: Reassign company owner + promote to admin ────────────────────────
-- For every company whose owner_id is NULL or points to a deleted auth user:
--   • Find the oldest surviving member with a real auth account
--   • Set owner_id to that user
--   • Promote them to 'admin' (company always needs at least one admin)
--
-- If ALL members are gone (company is empty), leave owner_id NULL —
-- there is no one to own it.

DO $$
DECLARE
  co        RECORD;
  new_owner uuid;
  promoted  int := 0;
BEGIN
  FOR co IN
    SELECT id, name, owner_id
    FROM companies
    WHERE owner_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = companies.owner_id)
    ORDER BY created_at
  LOOP
    -- Prefer existing admins; fall back to any manager; then any member
    SELECT up.user_id INTO new_owner
    FROM user_profiles up
    WHERE up.company_id = co.id
      AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = up.user_id)
    ORDER BY
      CASE up.role
        WHEN 'admin'   THEN 1
        WHEN 'manager' THEN 2
        ELSE 3
      END,
      up.created_at ASC
    LIMIT 1;

    IF new_owner IS NOT NULL THEN
      -- Promote to admin if they aren't already
      UPDATE user_profiles
      SET role = 'admin'
      WHERE user_id = new_owner AND role != 'admin';

      -- Assign as company owner
      UPDATE companies SET owner_id = new_owner WHERE id = co.id;

      promoted := promoted + 1;
      RAISE NOTICE 'Company "%" → new owner: %', co.name, new_owner;
    ELSE
      RAISE WARNING 'Company "%" has no surviving members — left unowned.', co.name;
    END IF;
  END LOOP;

  RAISE NOTICE 'Step 3 complete: % company/companies assigned a new owner.', promoted;
END;
$$;


-- ── STEP 4: Ensure every company has at least one admin ──────────────────────
-- Edge case: a company where everyone is 'manager' after the original admin
-- was deleted. The oldest manager becomes admin.

DO $$
DECLARE
  co        RECORD;
  new_admin uuid;
  fixed     int := 0;
BEGIN
  FOR co IN
    SELECT c.id, c.name
    FROM companies c
    WHERE NOT EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.company_id = c.id AND up.role = 'admin'
        AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = up.user_id)
    )
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.company_id = c.id
        AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = up.user_id)
    )
  LOOP
    SELECT up.user_id INTO new_admin
    FROM user_profiles up
    WHERE up.company_id = co.id
      AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = up.user_id)
    ORDER BY up.created_at ASC
    LIMIT 1;

    IF new_admin IS NOT NULL THEN
      UPDATE user_profiles SET role = 'admin' WHERE user_id = new_admin;
      fixed := fixed + 1;
      RAISE NOTICE 'Company "%" — promoted user % to admin (no admin existed).', co.name, new_admin;
    END IF;
  END LOOP;

  RAISE NOTICE 'Step 4 complete: % company/companies given an admin.', fixed;
END;
$$;


-- ── STEP 5: Fix accept_my_invitation() ───────────────────────────────────────
-- Original version only looked at status = 'pending'. If an invitation expired
-- (>7 days) but the user has now signed up, they couldn't be linked.
-- Updated to also accept 'expired' invitations so late sign-ups still work.

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

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN RETURN NULL; END IF;

  -- Idempotent: if user already belongs to a company, return it
  SELECT company_id INTO v_company
  FROM user_profiles
  WHERE user_id = v_uid AND company_id IS NOT NULL;

  IF v_company IS NOT NULL THEN RETURN v_company; END IF;

  -- Find the most recent invitation for this email.
  -- Include 'expired' status: an invitation that timed out before the user
  -- signed up should still be honoured — the admin's intent was clear.
  -- Exclude none; 'accepted' means already linked (handled above).
  SELECT * INTO v_inv
  FROM invitations
  WHERE lower(email) = lower(v_email)
    AND status IN ('pending', 'expired')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_inv IS NULL THEN RETURN NULL; END IF;

  -- Upsert user_profiles:
  --   a) no row yet → INSERT (trg_bootstrap_company may have already run; idempotent)
  --   b) row exists with company_id NULL → UPDATE
  INSERT INTO user_profiles (user_id, company_id, role)
  VALUES (v_uid, v_inv.company_id, v_inv.role)
  ON CONFLICT (user_id)
  DO UPDATE SET
    company_id = excluded.company_id,
    role       = excluded.role
  WHERE user_profiles.company_id IS NULL;

  -- Mark invitation as accepted
  UPDATE invitations
  SET status = 'accepted'
  WHERE id = v_inv.id;

  RETURN v_inv.company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION accept_my_invitation() TO authenticated;

RAISE NOTICE 'Step 5 complete: accept_my_invitation() updated.';


-- ── STEP 6: Fix get_my_role() and create get_my_company() ────────────────────
-- Defensive re-apply in case supabase_cleanup.sql was not yet run.
-- get_my_role() had a bug: WHERE id instead of WHERE user_id.

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM user_profiles WHERE user_id = auth.uid() LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION get_my_role() TO authenticated;

CREATE OR REPLACE FUNCTION get_my_company()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT company_id FROM user_profiles WHERE user_id = auth.uid() LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION get_my_company() TO authenticated;

RAISE NOTICE 'Step 6 complete: helper functions corrected.';


-- ── STEP 7: Defensive trigger — auto-reassign owner on deletion ───────────────
-- When auth.users deletes a row, Postgres cascades:
--   companies.owner_id → SET NULL  (triggers this BEFORE UPDATE)
--   user_profiles.user_id → CASCADE DELETE (row gone before this trigger fires,
--     but OTHER users in the company are still present)
--
-- This trigger intercepts the SET NULL and immediately reassigns ownership
-- to the oldest surviving admin/manager in the company, so deleting a user
-- from Supabase Auth never leaves a company without an owner.

CREATE OR REPLACE FUNCTION tf_protect_company_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_owner uuid;
BEGIN
  -- Only act when owner_id is transitioning to NULL
  IF OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL THEN
    SELECT up.user_id INTO new_owner
    FROM user_profiles up
    WHERE up.company_id = NEW.id
      AND up.user_id   != OLD.owner_id   -- skip the user being deleted
      AND up.role      IN ('admin', 'manager')
      AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = up.user_id)
    ORDER BY
      CASE up.role WHEN 'admin' THEN 1 ELSE 2 END,
      up.created_at ASC
    LIMIT 1;

    IF new_owner IS NOT NULL THEN
      NEW.owner_id := new_owner;
      -- Ensure they are admin
      UPDATE user_profiles
      SET role = 'admin'
      WHERE user_id = new_owner AND role != 'admin';
    END IF;
    -- If no replacement exists (last member deleted) → owner_id stays NULL; that's correct.
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_company_owner ON companies;
CREATE TRIGGER trg_protect_company_owner
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION tf_protect_company_owner();

RAISE NOTICE 'Step 7 complete: owner-protection trigger installed.';


-- ── STEP 8: Fix RLS — company update policy ───────────────────────────────────
-- The original co_owner_update policy: USING (owner_id = auth.uid())
-- When owner_id was NULL, this evaluated to NULL = auth.uid() → always false.
-- After Step 3 reassigned the owner, the policy works again.
-- But we also add: allow admin members to update company settings.

DROP POLICY IF EXISTS "co_owner_update" ON companies;

CREATE POLICY "co_owner_update" ON companies
  FOR UPDATE TO authenticated
  USING (
    -- Owner can always update
    owner_id = auth.uid()
    OR
    -- Company admin members can also update (covers the owner-reassignment window)
    (id = get_my_company() AND get_my_role() = 'admin')
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR
    (id = get_my_company() AND get_my_role() = 'admin')
  );

RAISE NOTICE 'Step 8 complete: company RLS policy updated.';


-- ── STEP 9: Expire stale pending invitations ──────────────────────────────────
-- Clean up invitations that are past their expiry and haven't been used.

UPDATE invitations
SET status = 'expired'
WHERE status = 'pending'
  AND expires_at < now();

RAISE NOTICE 'Step 9 complete: stale invitations expired.';


-- ── STEP 10: Rebuild RBAC policies (idempotent) ───────────────────────────────
-- Drop and recreate all RBAC write policies using the now-fixed functions.
-- This is safe because:
--   • get_my_role() and get_my_company() are now correct
--   • DROP IF EXISTS never errors
--   • Re-creating them from scratch guarantees correctness

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'products','raw_materials','production_orders',
        'bill_of_materials','batch_qc_results',
        'quality_inspections','quality_defects','sales'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END;
$$;

-- Products
CREATE POLICY "co_products_select" ON products
  FOR SELECT TO authenticated USING (company_id = get_my_company());
CREATE POLICY "co_products_insert" ON products
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company() AND get_my_role() IN ('admin','manager'));
CREATE POLICY "co_products_update" ON products
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin','manager'));
CREATE POLICY "co_products_delete" ON products
  FOR DELETE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin','manager'));

-- Raw Materials
CREATE POLICY "co_raw_materials_select" ON raw_materials
  FOR SELECT TO authenticated USING (company_id = get_my_company());
CREATE POLICY "co_raw_materials_insert" ON raw_materials
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company() AND get_my_role() IN ('admin','manager','warehouse'));
CREATE POLICY "co_raw_materials_update" ON raw_materials
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin','manager','warehouse'));
CREATE POLICY "co_raw_materials_delete" ON raw_materials
  FOR DELETE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin','manager','warehouse'));

-- Production Orders
CREATE POLICY "co_production_orders_select" ON production_orders
  FOR SELECT TO authenticated USING (company_id = get_my_company());
CREATE POLICY "co_production_orders_insert" ON production_orders
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company() AND get_my_role() IN ('admin','manager','operations'));
CREATE POLICY "co_production_orders_update" ON production_orders
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin','manager','operations'));
CREATE POLICY "co_production_orders_delete" ON production_orders
  FOR DELETE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin','manager','operations'));

-- Sales
CREATE POLICY "co_sales_select" ON sales
  FOR SELECT TO authenticated USING (company_id = get_my_company());
CREATE POLICY "co_sales_insert" ON sales
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company() AND get_my_role() IN ('admin','manager','sales'));
CREATE POLICY "co_sales_update" ON sales
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin','manager','sales'));
CREATE POLICY "co_sales_delete" ON sales
  FOR DELETE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin','manager','sales'));

-- Quality Inspections
CREATE POLICY "co_qi_select" ON quality_inspections
  FOR SELECT TO authenticated USING (company_id = get_my_company());
CREATE POLICY "co_qi_insert" ON quality_inspections
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company() AND get_my_role() IN ('admin','inspector','qc_inspector'));
CREATE POLICY "co_qi_update" ON quality_inspections
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin','inspector','qc_inspector'));
CREATE POLICY "co_qi_delete" ON quality_inspections
  FOR DELETE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin','inspector','qc_inspector'));

-- Quality Defects
CREATE POLICY "co_qd_select" ON quality_defects
  FOR SELECT TO authenticated USING (company_id = get_my_company());
CREATE POLICY "co_qd_insert" ON quality_defects
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company() AND get_my_role() IN ('admin','inspector','qc_inspector'));
CREATE POLICY "co_qd_update" ON quality_defects
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin','inspector','qc_inspector'));
CREATE POLICY "co_qd_delete" ON quality_defects
  FOR DELETE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin','inspector','qc_inspector'));

-- Bill of Materials (optional)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='bill_of_materials' AND table_schema='public') THEN
    EXECUTE $p$
      CREATE POLICY "co_bom_select" ON bill_of_materials FOR SELECT TO authenticated
        USING (EXISTS (SELECT 1 FROM production_orders po WHERE po.id = bill_of_materials.production_order_id AND po.company_id = get_my_company()));
      CREATE POLICY "co_bom_write" ON bill_of_materials FOR ALL TO authenticated
        USING (get_my_role() IN ('admin','manager','operations')
          AND EXISTS (SELECT 1 FROM production_orders po WHERE po.id = bill_of_materials.production_order_id AND po.company_id = get_my_company()))
        WITH CHECK (get_my_role() IN ('admin','manager','operations')
          AND EXISTS (SELECT 1 FROM production_orders po WHERE po.id = bill_of_materials.production_order_id AND po.company_id = get_my_company()));
    $p$;
  END IF;
END;
$$;

-- Batch QC Results (optional)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='batch_qc_results' AND table_schema='public') THEN
    EXECUTE $p$
      CREATE POLICY "co_qc_results_select" ON batch_qc_results FOR SELECT TO authenticated
        USING (EXISTS (SELECT 1 FROM production_orders po WHERE po.id = batch_qc_results.batch_id AND po.company_id = get_my_company()));
      CREATE POLICY "co_qc_results_write" ON batch_qc_results FOR ALL TO authenticated
        USING (get_my_role() IN ('admin','inspector','qc_inspector')
          AND EXISTS (SELECT 1 FROM production_orders po WHERE po.id = batch_qc_results.batch_id AND po.company_id = get_my_company()))
        WITH CHECK (get_my_role() IN ('admin','inspector','qc_inspector')
          AND EXISTS (SELECT 1 FROM production_orders po WHERE po.id = batch_qc_results.batch_id AND po.company_id = get_my_company()));
    $p$;
  END IF;
END;
$$;

RAISE NOTICE 'Step 10 complete: all RBAC policies rebuilt.';


-- ── STEP 11: Post-recovery verification ──────────────────────────────────────

DO $$
DECLARE
  companies_no_owner   int;
  profiles_no_company  int;
  orphan_profiles      int;
  companies_no_admin   int;
  pending_with_user    int;
BEGIN
  SELECT COUNT(*) INTO companies_no_owner
  FROM companies
  WHERE owner_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = companies.owner_id);

  SELECT COUNT(*) INTO profiles_no_company
  FROM user_profiles up
  WHERE up.company_id IS NULL
    AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = up.user_id);

  SELECT COUNT(*) INTO orphan_profiles
  FROM user_profiles
  WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id = user_profiles.user_id);

  -- Companies with no admin at all (should be 0)
  SELECT COUNT(*) INTO companies_no_admin
  FROM companies c
  WHERE NOT EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.company_id = c.id AND up.role = 'admin'
      AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = up.user_id)
  )
  AND EXISTS (
    SELECT 1 FROM user_profiles up WHERE up.company_id = c.id
  );

  -- Pending invitations where the user already signed up (should be 0)
  SELECT COUNT(*) INTO pending_with_user
  FROM invitations i
  WHERE i.status = 'pending'
    AND EXISTS (SELECT 1 FROM auth.users au WHERE lower(au.email) = lower(i.email));

  RAISE NOTICE '';
  RAISE NOTICE '=== POST-RECOVERY VERIFICATION ===';
  RAISE NOTICE 'Companies with no valid owner  : %  (target: 0)', companies_no_owner;
  RAISE NOTICE 'Companies with no admin member : %  (target: 0)', companies_no_admin;
  RAISE NOTICE 'Profiles missing company_id    : %  (target: 0)', profiles_no_company;
  RAISE NOTICE 'Orphaned user_profiles         : %  (target: 0)', orphan_profiles;
  RAISE NOTICE 'Pending invites for known users: %  (target: 0)', pending_with_user;
  RAISE NOTICE '';
  RAISE NOTICE 'If all targets are 0, recovery is complete.';
  RAISE NOTICE 'Sign out and back in to pick up the new role + company_id.';
END;
$$;


-- ── Full state dump ───────────────────────────────────────────────────────────
-- Run this manually if you want to verify specific rows:

SELECT
  au.email,
  up.role,
  c.name                        AS company,
  c.owner_id = au.id            AS is_owner,
  up.company_id IS NOT NULL     AS has_company
FROM auth.users au
LEFT JOIN user_profiles up ON up.user_id = au.id
LEFT JOIN companies c      ON c.id = up.company_id
ORDER BY au.created_at;
