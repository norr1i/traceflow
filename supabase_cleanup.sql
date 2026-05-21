-- ============================================================
-- TraceFlow — Orphan Cleanup + Function Fix Migration
--
-- Run AFTER supabase_diagnostic.sql to confirm what exists.
-- Safe to re-run: all DDL uses CREATE OR REPLACE / IF NOT EXISTS,
-- all DML uses WHERE guards to only touch orphaned rows.
--
-- Order of operations:
--   1. Fix get_my_role()      — wrong column (id vs user_id)
--   2. Fix get_my_company()   — create alias for get_my_company_id()
--   3. Rebuild RBAC policies  — using now-correct functions
--   4. Clean orphan profiles  — user deleted from auth.users
--   5. Reassign company owners — owner_id pointing to deleted user
--   6. Expire stale invitations
-- ============================================================

-- ── 1. Fix get_my_role() — was querying wrong column ──────────────────────────
-- Original bug: WHERE id = auth.uid() — 'id' does not exist on user_profiles.
-- The column is 'user_id'. This made get_my_role() always return NULL,
-- silently blocking all RBAC-guarded INSERT/UPDATE/DELETE.

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


-- ── 2. Create get_my_company() — alias for get_my_company_id() ────────────────
-- supabase_rbac.sql referenced get_my_company() but only get_my_company_id()
-- was defined. This caused all SELECT policies in the RBAC file to fail at
-- CREATE time, leaving tables with no authenticated read policy.

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


-- ── 3. Rebuild RBAC policies (clean slate using corrected functions) ───────────
-- Drop all existing split-RBAC policies first, then recreate them.
-- This guarantees the policies are actually installed even if the prior
-- supabase_rbac.sql run failed partway through.

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
      AND policyname IN (
        'co_products_select','co_products_insert','co_products_update','co_products_delete',
        'co_raw_materials_select','co_raw_materials_insert','co_raw_materials_update','co_raw_materials_delete',
        'co_production_orders_select','co_production_orders_insert','co_production_orders_update','co_production_orders_delete',
        'co_bom_select','co_bom_insert','co_bom_update','co_bom_delete',
        'co_qc_results_select','co_qc_results_insert','co_qc_results_update','co_qc_results_delete',
        'co_qi_select','co_qi_insert','co_qi_update','co_qi_delete',
        'co_qd_select','co_qd_insert','co_qd_update','co_qd_delete',
        'co_sales_select','co_sales_insert','co_sales_update','co_sales_delete',
        -- Also drop the old FOR-ALL fallbacks so we get a clean slate
        'co_products','co_raw_materials','co_production_orders',
        'co_quality_inspections','co_quality_defects','co_sales'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END;
$$;

-- Products — admin, manager only for writes
CREATE POLICY "co_products_select" ON products
  FOR SELECT TO authenticated
  USING (company_id = get_my_company());

CREATE POLICY "co_products_insert" ON products
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company() AND get_my_role() IN ('admin', 'manager'));

CREATE POLICY "co_products_update" ON products
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin', 'manager'));

CREATE POLICY "co_products_delete" ON products
  FOR DELETE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin', 'manager'));

-- Raw Materials — admin, manager, warehouse
CREATE POLICY "co_raw_materials_select" ON raw_materials
  FOR SELECT TO authenticated
  USING (company_id = get_my_company());

CREATE POLICY "co_raw_materials_insert" ON raw_materials
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company() AND get_my_role() IN ('admin', 'manager', 'warehouse'));

CREATE POLICY "co_raw_materials_update" ON raw_materials
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin', 'manager', 'warehouse'));

CREATE POLICY "co_raw_materials_delete" ON raw_materials
  FOR DELETE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin', 'manager', 'warehouse'));

-- Production Orders — admin, manager, operations
CREATE POLICY "co_production_orders_select" ON production_orders
  FOR SELECT TO authenticated
  USING (company_id = get_my_company());

CREATE POLICY "co_production_orders_insert" ON production_orders
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company() AND get_my_role() IN ('admin', 'manager', 'operations'));

CREATE POLICY "co_production_orders_update" ON production_orders
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin', 'manager', 'operations'));

CREATE POLICY "co_production_orders_delete" ON production_orders
  FOR DELETE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin', 'manager', 'operations'));

-- Sales — admin, manager, sales
CREATE POLICY "co_sales_select" ON sales
  FOR SELECT TO authenticated
  USING (company_id = get_my_company());

CREATE POLICY "co_sales_insert" ON sales
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company() AND get_my_role() IN ('admin', 'manager', 'sales'));

CREATE POLICY "co_sales_update" ON sales
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin', 'manager', 'sales'));

CREATE POLICY "co_sales_delete" ON sales
  FOR DELETE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin', 'manager', 'sales'));

-- Quality Inspections — admin (override), inspector, qc_inspector
CREATE POLICY "co_qi_select" ON quality_inspections
  FOR SELECT TO authenticated
  USING (company_id = get_my_company());

CREATE POLICY "co_qi_insert" ON quality_inspections
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company() AND get_my_role() IN ('admin', 'inspector', 'qc_inspector'));

CREATE POLICY "co_qi_update" ON quality_inspections
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin', 'inspector', 'qc_inspector'));

CREATE POLICY "co_qi_delete" ON quality_inspections
  FOR DELETE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin', 'inspector', 'qc_inspector'));

-- Quality Defects — inherit from quality_inspections
CREATE POLICY "co_qd_select" ON quality_defects
  FOR SELECT TO authenticated
  USING (company_id = get_my_company());

CREATE POLICY "co_qd_insert" ON quality_defects
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company() AND get_my_role() IN ('admin', 'inspector', 'qc_inspector'));

CREATE POLICY "co_qd_update" ON quality_defects
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin', 'inspector', 'qc_inspector'));

CREATE POLICY "co_qd_delete" ON quality_defects
  FOR DELETE TO authenticated
  USING (company_id = get_my_company() AND get_my_role() IN ('admin', 'inspector', 'qc_inspector'));

-- Bill of Materials (optional table)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'bill_of_materials' AND table_schema = 'public'
  ) THEN
    DROP POLICY IF EXISTS "co_bom_select" ON bill_of_materials;
    DROP POLICY IF EXISTS "co_bom_insert" ON bill_of_materials;
    DROP POLICY IF EXISTS "co_bom_update" ON bill_of_materials;
    DROP POLICY IF EXISTS "co_bom_delete" ON bill_of_materials;
    DROP POLICY IF EXISTS "co_bill_of_materials" ON bill_of_materials;

    EXECUTE $p$
      CREATE POLICY "co_bom_select" ON bill_of_materials
        FOR SELECT TO authenticated
        USING (EXISTS (
          SELECT 1 FROM production_orders po
          WHERE po.id = bill_of_materials.production_order_id
            AND po.company_id = get_my_company()
        ));

      CREATE POLICY "co_bom_insert" ON bill_of_materials
        FOR INSERT TO authenticated
        WITH CHECK (
          get_my_role() IN ('admin', 'manager', 'operations')
          AND EXISTS (
            SELECT 1 FROM production_orders po
            WHERE po.id = bill_of_materials.production_order_id
              AND po.company_id = get_my_company()
          )
        );

      CREATE POLICY "co_bom_update" ON bill_of_materials
        FOR UPDATE TO authenticated
        USING (
          get_my_role() IN ('admin', 'manager', 'operations')
          AND EXISTS (
            SELECT 1 FROM production_orders po
            WHERE po.id = bill_of_materials.production_order_id
              AND po.company_id = get_my_company()
          )
        );

      CREATE POLICY "co_bom_delete" ON bill_of_materials
        FOR DELETE TO authenticated
        USING (
          get_my_role() IN ('admin', 'manager', 'operations')
          AND EXISTS (
            SELECT 1 FROM production_orders po
            WHERE po.id = bill_of_materials.production_order_id
              AND po.company_id = get_my_company()
          )
        );
    $p$;
  END IF;
END;
$$;

-- Batch QC Results (optional table)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'batch_qc_results' AND table_schema = 'public'
  ) THEN
    DROP POLICY IF EXISTS "co_qc_results_select" ON batch_qc_results;
    DROP POLICY IF EXISTS "co_qc_results_insert" ON batch_qc_results;
    DROP POLICY IF EXISTS "co_qc_results_update" ON batch_qc_results;
    DROP POLICY IF EXISTS "co_qc_results_delete" ON batch_qc_results;
    DROP POLICY IF EXISTS "co_batch_qc_results" ON batch_qc_results;

    EXECUTE $p$
      CREATE POLICY "co_qc_results_select" ON batch_qc_results
        FOR SELECT TO authenticated
        USING (EXISTS (
          SELECT 1 FROM production_orders po
          WHERE po.id = batch_qc_results.batch_id
            AND po.company_id = get_my_company()
        ));

      CREATE POLICY "co_qc_results_insert" ON batch_qc_results
        FOR INSERT TO authenticated
        WITH CHECK (
          get_my_role() IN ('admin', 'inspector', 'qc_inspector')
          AND EXISTS (
            SELECT 1 FROM production_orders po
            WHERE po.id = batch_qc_results.batch_id
              AND po.company_id = get_my_company()
          )
        );

      CREATE POLICY "co_qc_results_update" ON batch_qc_results
        FOR UPDATE TO authenticated
        USING (
          get_my_role() IN ('admin', 'inspector', 'qc_inspector')
          AND EXISTS (
            SELECT 1 FROM production_orders po
            WHERE po.id = batch_qc_results.batch_id
              AND po.company_id = get_my_company()
          )
        );

      CREATE POLICY "co_qc_results_delete" ON batch_qc_results
        FOR DELETE TO authenticated
        USING (
          get_my_role() IN ('admin', 'inspector', 'qc_inspector')
          AND EXISTS (
            SELECT 1 FROM production_orders po
            WHERE po.id = batch_qc_results.batch_id
              AND po.company_id = get_my_company()
          )
        );
    $p$;
  END IF;
END;
$$;


-- ── 4. Delete orphaned user_profiles ─────────────────────────────────────────
-- These are rows where the auth.users account was deleted.
-- Deleting them is safe: the user no longer exists so they cannot log in.
-- Business data (products, orders, etc.) is scoped to company_id, not user_id,
-- so it is NOT affected.

DELETE FROM user_profiles
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users au WHERE au.id = user_profiles.user_id
);


-- ── 5. Reassign company owner when owner was deleted ──────────────────────────
-- companies.owner_id is ON DELETE SET NULL, so deleting the owner user
-- leaves owner_id = NULL. The co_owner_update RLS policy becomes
-- "NULL = auth.uid()" which never matches — nobody can update the company.
--
-- Strategy: promote the oldest existing admin or manager in that company.
-- If no admin/manager exists, leave owner_id NULL (no-one should have it).

UPDATE companies c
SET owner_id = (
  SELECT up.user_id
  FROM user_profiles up
  WHERE up.company_id = c.id
    AND up.role IN ('admin', 'manager')
    AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = up.user_id)
  ORDER BY up.created_at ASC
  LIMIT 1
)
WHERE c.owner_id IS NULL
   OR NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = c.owner_id);


-- ── 6. Expire stale pending invitations ──────────────────────────────────────
-- Invitations past their expiry date that are still marked 'pending' are
-- never going to be accepted; mark them expired so they stop appearing.

UPDATE invitations
SET status = 'expired'
WHERE status  = 'pending'
  AND expires_at <= now();


-- ── 7. Verify ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  orphan_count    int;
  null_owner_count int;
  stale_inv_count int;
  role_body       text;
  company_body    text;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM user_profiles
  WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = user_profiles.user_id);

  SELECT COUNT(*) INTO null_owner_count
  FROM companies
  WHERE owner_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = companies.owner_id);

  SELECT COUNT(*) INTO stale_inv_count
  FROM invitations
  WHERE status = 'pending' AND expires_at <= now();

  SELECT prosrc INTO role_body    FROM pg_proc WHERE proname = 'get_my_role';
  SELECT prosrc INTO company_body FROM pg_proc WHERE proname = 'get_my_company';

  RAISE NOTICE '=== TraceFlow Cleanup Migration Complete ===';
  RAISE NOTICE '';
  RAISE NOTICE 'get_my_role() body uses user_id: %',
    (role_body LIKE '%user_id%');
  RAISE NOTICE 'get_my_company() exists: %',
    (company_body IS NOT NULL);
  RAISE NOTICE '';
  RAISE NOTICE 'Remaining orphan user_profiles : %  (should be 0)', orphan_count;
  RAISE NOTICE 'Companies with missing owner   : %  (should be 0)', null_owner_count;
  RAISE NOTICE 'Stale pending invitations      : %  (should be 0)', stale_inv_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Run supabase_diagnostic.sql again to confirm full health.';
END;
$$;
