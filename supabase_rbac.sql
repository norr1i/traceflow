-- ============================================================
-- TraceFlow RBAC — Role-based RLS policies
-- Run AFTER supabase_multitenancy_v2.sql and supabase_team_management.sql
-- ============================================================

-- ── Helper: current user's role ───────────────────────────────────────────────
-- SECURITY DEFINER so it bypasses RLS on user_profiles (no infinite recursion).

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

-- ── Products ──────────────────────────────────────────────────────────────────
-- Writable by: admin, manager only

DROP POLICY IF EXISTS "co_products" ON products;

CREATE POLICY "co_products_select" ON products
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

CREATE POLICY "co_products_insert" ON products
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'manager')
  );

CREATE POLICY "co_products_update" ON products
  FOR UPDATE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'manager')
  );

CREATE POLICY "co_products_delete" ON products
  FOR DELETE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'manager')
  );

-- ── Raw Materials ─────────────────────────────────────────────────────────────
-- Writable by: admin, manager, warehouse

DROP POLICY IF EXISTS "co_raw_materials" ON raw_materials;

CREATE POLICY "co_raw_materials_select" ON raw_materials
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

CREATE POLICY "co_raw_materials_insert" ON raw_materials
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'manager', 'warehouse')
  );

CREATE POLICY "co_raw_materials_update" ON raw_materials
  FOR UPDATE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'manager', 'warehouse')
  );

CREATE POLICY "co_raw_materials_delete" ON raw_materials
  FOR DELETE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'manager', 'warehouse')
  );

-- ── Production Orders ─────────────────────────────────────────────────────────
-- Writable by: admin, manager, operations

DROP POLICY IF EXISTS "co_production_orders" ON production_orders;

CREATE POLICY "co_production_orders_select" ON production_orders
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

CREATE POLICY "co_production_orders_insert" ON production_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'manager', 'operations')
  );

CREATE POLICY "co_production_orders_update" ON production_orders
  FOR UPDATE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'manager', 'operations')
  );

CREATE POLICY "co_production_orders_delete" ON production_orders
  FOR DELETE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'manager', 'operations')
  );

-- ── Bill of Materials ─────────────────────────────────────────────────────────
-- Writable by: admin, manager, operations (same as production orders)

DROP POLICY IF EXISTS "co_bill_of_materials" ON bill_of_materials;

CREATE POLICY "co_bom_select" ON bill_of_materials
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM production_orders po
      WHERE po.id = bill_of_materials.production_order_id
        AND po.company_id = get_my_company_id()
    )
  );

CREATE POLICY "co_bom_insert" ON bill_of_materials
  FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() IN ('admin', 'manager', 'operations')
    AND EXISTS (
      SELECT 1 FROM production_orders po
      WHERE po.id = bill_of_materials.production_order_id
        AND po.company_id = get_my_company_id()
    )
  );

CREATE POLICY "co_bom_update" ON bill_of_materials
  FOR UPDATE TO authenticated
  USING (
    get_my_role() IN ('admin', 'manager', 'operations')
    AND EXISTS (
      SELECT 1 FROM production_orders po
      WHERE po.id = bill_of_materials.production_order_id
        AND po.company_id = get_my_company_id()
    )
  );

CREATE POLICY "co_bom_delete" ON bill_of_materials
  FOR DELETE TO authenticated
  USING (
    get_my_role() IN ('admin', 'manager', 'operations')
    AND EXISTS (
      SELECT 1 FROM production_orders po
      WHERE po.id = bill_of_materials.production_order_id
        AND po.company_id = get_my_company_id()
    )
  );

-- ── Batch QC Results ──────────────────────────────────────────────────────────
-- Writable by: admin (override:qc), inspector, qc_inspector
-- Admin included here because the UI override:qc capability must reach the DB.

DROP POLICY IF EXISTS "co_batch_qc_results" ON batch_qc_results;

CREATE POLICY "co_qc_results_select" ON batch_qc_results
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM production_orders po
      WHERE po.id = batch_qc_results.batch_id
        AND po.company_id = get_my_company_id()
    )
  );

CREATE POLICY "co_qc_results_insert" ON batch_qc_results
  FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() IN ('admin', 'inspector', 'qc_inspector')
    AND EXISTS (
      SELECT 1 FROM production_orders po
      WHERE po.id = batch_qc_results.batch_id
        AND po.company_id = get_my_company_id()
    )
  );

CREATE POLICY "co_qc_results_update" ON batch_qc_results
  FOR UPDATE TO authenticated
  USING (
    get_my_role() IN ('admin', 'inspector', 'qc_inspector')
    AND EXISTS (
      SELECT 1 FROM production_orders po
      WHERE po.id = batch_qc_results.batch_id
        AND po.company_id = get_my_company_id()
    )
  );

CREATE POLICY "co_qc_results_delete" ON batch_qc_results
  FOR DELETE TO authenticated
  USING (
    get_my_role() IN ('admin', 'inspector', 'qc_inspector')
    AND EXISTS (
      SELECT 1 FROM production_orders po
      WHERE po.id = batch_qc_results.batch_id
        AND po.company_id = get_my_company_id()
    )
  );

-- ── Quality Inspections ───────────────────────────────────────────────────────
-- Writable by: admin (override:qc), inspector, qc_inspector

DROP POLICY IF EXISTS "co_quality_inspections" ON quality_inspections;

CREATE POLICY "co_qi_select" ON quality_inspections
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

CREATE POLICY "co_qi_insert" ON quality_inspections
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'inspector', 'qc_inspector')
  );

CREATE POLICY "co_qi_update" ON quality_inspections
  FOR UPDATE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'inspector', 'qc_inspector')
  );

CREATE POLICY "co_qi_delete" ON quality_inspections
  FOR DELETE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'inspector', 'qc_inspector')
  );

-- ── Quality Defects ───────────────────────────────────────────────────────────
-- Writable by: admin (override:qc), inspector, qc_inspector

DROP POLICY IF EXISTS "co_quality_defects" ON quality_defects;

CREATE POLICY "co_qd_select" ON quality_defects
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

CREATE POLICY "co_qd_insert" ON quality_defects
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'inspector', 'qc_inspector')
  );

CREATE POLICY "co_qd_update" ON quality_defects
  FOR UPDATE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'inspector', 'qc_inspector')
  );

CREATE POLICY "co_qd_delete" ON quality_defects
  FOR DELETE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'inspector', 'qc_inspector')
  );

-- ── Sales ─────────────────────────────────────────────────────────────────────
-- Writable by: admin, manager, sales

DROP POLICY IF EXISTS "co_sales" ON sales;

CREATE POLICY "co_sales_select" ON sales
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

CREATE POLICY "co_sales_insert" ON sales
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'manager', 'sales')
  );

CREATE POLICY "co_sales_update" ON sales
  FOR UPDATE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'manager', 'sales')
  );

CREATE POLICY "co_sales_delete" ON sales
  FOR DELETE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND get_my_role() IN ('admin', 'manager', 'sales')
  );
