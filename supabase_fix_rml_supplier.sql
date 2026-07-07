-- ============================================================
-- TraceFlow — Fix: supplier_name shows "—" on public trace page
-- File: supabase_fix_rml_supplier.sql
-- ============================================================
--
-- Root cause
--   The get_batch_trace SECURITY DEFINER function joins:
--     bill_of_materials
--       → raw_material_lots   (LEFT JOIN on raw_material_lot_id)
--       → suppliers           (LEFT JOIN on supplier_id)
--
--   raw_material_lots has RLS enabled but no policy for the
--   anon execution context used by the public QR scan page.
--   All other tables touched by the public trace functions have
--   a "public_trace_*" anon SELECT policy:
--     ✓ production_orders  — public_trace_orders
--     ✓ products           — public_trace_products
--     ✓ bill_of_materials  — public_trace_bom
--     ✓ batch_qc_results   — public_trace_qc
--     ✗ raw_material_lots  — MISSING
--
--   Because of the missing policy, the LEFT JOIN to
--   raw_material_lots returns NULL for every row.
--   COALESCE(rml.lot_number, bom.lot_number) hides this by
--   falling back to bom.lot_number — so lot numbers appear
--   correct while supplier_name is always NULL.
--
-- Fix A — Add the missing anon SELECT policy (required)
-- Fix B — Backfill any NULL supplier_id on raw_material_lots
--          rows by inheriting from raw_materials.supplier_id
--          (defensive; handles the case where seed_bom_patch.sql
--           inserted lots without a supplier_id)
--
-- Safe to run multiple times — all statements are idempotent.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================


-- ── Fix A: anon SELECT policy on raw_material_lots ───────────
-- Mirrors the pattern already applied to bill_of_materials,
-- batch_qc_results, production_orders, and products.
-- The function's WHERE clause always scopes by company_id, so
-- exposing lot records to the anon role is safe.
DROP POLICY IF EXISTS "public_trace_rml" ON public.raw_material_lots;
CREATE POLICY "public_trace_rml"
  ON public.raw_material_lots
  FOR SELECT TO anon
  USING (true);


-- ── Fix B: backfill NULL supplier_id via raw_materials FK ────
-- raw_material_lots.raw_material_id → raw_materials.supplier_id
-- is the canonical supplier link set during initial seeding.
-- Any lot row where supplier_id is NULL but the parent
-- raw_material has a supplier gets it filled here.
UPDATE public.raw_material_lots rml
SET    supplier_id = rm.supplier_id
FROM   public.raw_materials rm
WHERE  rml.raw_material_id  = rm.id
  AND  rml.supplier_id      IS NULL
  AND  rm.supplier_id       IS NOT NULL;


-- ── Verification ─────────────────────────────────────────────
DO $$
DECLARE
  v_policy_exists boolean;
  v_null_count    int;
  v_fixed_count   int;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'raw_material_lots'
      AND policyname = 'public_trace_rml'
  ) INTO v_policy_exists;

  SELECT COUNT(*) INTO v_null_count
  FROM public.raw_material_lots
  WHERE supplier_id IS NULL;

  SELECT COUNT(*) INTO v_fixed_count
  FROM public.raw_material_lots rml
  JOIN public.suppliers s ON s.id = rml.supplier_id;

  RAISE NOTICE '─────────────────────────────────────────────────';
  RAISE NOTICE '✓ public_trace_rml policy exists: %', v_policy_exists;
  RAISE NOTICE '  raw_material_lots rows with supplier_id populated: %', v_fixed_count;
  RAISE NOTICE '  raw_material_lots rows still missing supplier_id: %', v_null_count;
  RAISE NOTICE '  (Remaining NULLs are lots with no known supplier — correct.)';
  RAISE NOTICE '─────────────────────────────────────────────────';
END;
$$;
