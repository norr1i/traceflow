-- ============================================================
-- TraceFlow — get_recall_impact: exact lot-number matching
-- File: supabase_recall_impact_lot_exact_match_20260904.sql
-- ============================================================
--
-- PREDECESSOR
--   supabase_recall_impact_material_exact_match_20260829.sql
--   (fixed p_material_name from ILIKE '%…%' to LOWER(TRIM) exact match)
--
-- WHY
--   The 2026-08-29 migration left p_lot_number using substring matching:
--
--       column ILIKE '%' || p_lot_number || '%'
--
--   This allows a search for 'L001' to match rows where lot_number is
--   'XL0010', 'LOT-L001-A', or any superset string — returning results
--   for lots that are physically unrelated to the queried lot.
--
--   For recall investigations this is a precision defect: affected-batch
--   scope must be bounded by the exact lot, not by any lot whose number
--   happens to contain the search term as a substring.
--
-- WHAT CHANGES
--   All four p_lot_number comparison sites are replaced with an exact
--   case-insensitive, whitespace-trimmed comparison:
--
--       LOWER(TRIM(column)) = LOWER(TRIM(p_lot_number))
--
--   The four sites are:
--     1. Company resolution — bill_of_materials fallback
--     2. Company resolution — raw_material_lots fallback
--     3. Batch ID resolution — raw_material_lots subquery
--     4. Batch ID resolution — bill_of_materials text fallback
--
-- WHAT DOES NOT CHANGE
--   • Function name, parameters, return type — identical
--   • SECURITY DEFINER, search_path — identical
--   • GRANT EXECUTE TO authenticated — identical
--   • REVOKE FROM PUBLIC — identical
--   • REVOKE FROM anon — identical
--   • p_material_name matching logic — identical (already exact from 2026-08-29)
--   • p_raw_material_lot_id matching logic — identical (always was exact FK)
--   • p_batch_id matching logic — identical
--   • All downstream joins, aggregations, risk calculation — untouched
--
-- COMPATIBILITY
--   Callers passing a full stored lot_number string are unaffected.
--   Callers relying on partial substring searches will receive 0 results
--   instead of over-inclusive results — this is the correct narrowing.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

-- CREATE OR REPLACE is safe here: the live DB has exactly one overload with the
-- same 4-parameter signature (text, text, uuid, uuid). PostgreSQL replaces the
-- function body in place without removing the callable RPC.
CREATE OR REPLACE FUNCTION public.get_recall_impact(
  p_lot_number          text DEFAULT NULL,
  p_material_name       text DEFAULT NULL,
  p_batch_id            uuid DEFAULT NULL,
  p_raw_material_lot_id uuid DEFAULT NULL   -- exact FK match; takes priority over p_lot_number
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id      uuid;
  v_batch_ids       uuid[];   -- production_orders.id
  v_dist_batch_ids  uuid[];   -- batches.id (resolved via batches.production_order_id)
  v_products        jsonb;
  v_batches         jsonb;
  v_distribution    jsonb;
  v_total_units       bigint  := 0;
  v_unique_recipients bigint  := 0;
  v_has_recall        boolean := false;
BEGIN
  -- ── Step 1: resolve via session (normal authenticated path) ──────
  v_company_id := get_my_company_id();

  -- ── Steps 2-4: fallback for SQL Editor / service-role callers ────
  IF v_company_id IS NULL THEN
    IF p_batch_id IS NOT NULL THEN
      SELECT company_id
      INTO   v_company_id
      FROM   production_orders
      WHERE  id = p_batch_id
      LIMIT  1;

    ELSIF p_raw_material_lot_id IS NOT NULL THEN
      SELECT rml.company_id
      INTO   v_company_id
      FROM   raw_material_lots rml
      WHERE  rml.id = p_raw_material_lot_id
      LIMIT  1;

    ELSIF p_lot_number IS NOT NULL THEN
      -- Site 1: company resolution from bill_of_materials
      -- OLD: bom.lot_number ILIKE '%' || p_lot_number || '%'
      -- NEW: exact case-insensitive, whitespace-trimmed comparison
      SELECT bom.company_id
      INTO   v_company_id
      FROM   bill_of_materials bom
      WHERE  LOWER(TRIM(bom.lot_number)) = LOWER(TRIM(p_lot_number))
      LIMIT  1;

      IF v_company_id IS NULL THEN
        -- Site 2: company resolution fallback from raw_material_lots
        -- OLD: rml.lot_number ILIKE '%' || p_lot_number || '%'
        -- NEW: exact case-insensitive, whitespace-trimmed comparison
        SELECT rml.company_id
        INTO   v_company_id
        FROM   raw_material_lots rml
        WHERE  LOWER(TRIM(rml.lot_number)) = LOWER(TRIM(p_lot_number))
        LIMIT  1;
      END IF;

    ELSIF p_material_name IS NOT NULL THEN
      -- Exact case-insensitive, trim-safe match (fixed 2026-08-29; unchanged here)
      SELECT bom.company_id
      INTO   v_company_id
      FROM   bill_of_materials bom
      WHERE  LOWER(TRIM(bom.material_name)) = LOWER(TRIM(p_material_name))
      LIMIT  1;
    END IF;
  END IF;

  -- ── Step 5: still no company → give up ───────────────────────────
  IF v_company_id IS NULL THEN RETURN NULL; END IF;

  -- ── Resolve batch IDs (production_orders.id) ─────────────────────
  IF p_raw_material_lot_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id)
    INTO   v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id          = v_company_id
      AND  bom.raw_material_lot_id  = p_raw_material_lot_id;

  ELSIF p_batch_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT id)
    INTO   v_batch_ids
    FROM   production_orders
    WHERE  id         = p_batch_id
      AND  company_id = v_company_id;

  ELSIF p_lot_number IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id)
    INTO   v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id = v_company_id
      AND  (
        -- Site 3: raw_material_lots subquery — FK path
        -- OLD: lot_number ILIKE '%' || p_lot_number || '%'
        -- NEW: exact case-insensitive, whitespace-trimmed comparison
        bom.raw_material_lot_id IN (
          SELECT id
          FROM   raw_material_lots
          WHERE  LOWER(TRIM(lot_number)) = LOWER(TRIM(p_lot_number))
            AND  company_id = v_company_id
        )
        -- Site 4: bill_of_materials text fallback
        -- OLD: bom.lot_number ILIKE '%' || p_lot_number || '%'
        -- NEW: exact case-insensitive, whitespace-trimmed comparison
        OR LOWER(TRIM(bom.lot_number)) = LOWER(TRIM(p_lot_number))
      );

  ELSIF p_material_name IS NOT NULL THEN
    -- Exact case-insensitive, trim-safe match (fixed 2026-08-29; unchanged here)
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id)
    INTO   v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id                            = v_company_id
      AND  LOWER(TRIM(bom.material_name)) = LOWER(TRIM(p_material_name));
  END IF;

  -- ── No matches → return empty result ─────────────────────────────
  IF v_batch_ids IS NULL OR array_length(v_batch_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'affected_products',     '[]'::jsonb,
      'affected_batches',      '[]'::jsonb,
      'affected_distributors', '[]'::jsonb,
      'total_affected_units',  0,
      'total_batches',         0,
      'total_products',        0,
      'total_distributors',    0,
      'total_shipments',       0,
      'risk_level',            'none',
      'has_open_recall',       false
    );
  END IF;

  -- ── Resolve batches.id for the distribution join ─────────────────
  SELECT ARRAY_AGG(DISTINCT b.id)
  INTO   v_dist_batch_ids
  FROM   batches b
  WHERE  b.production_order_id = ANY(v_batch_ids)
    AND  b.company_id          = v_company_id;

  -- ── Affected batches ─────────────────────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'batch_id',     po.id,
        'product_name', COALESCE(p.name, 'Unknown'),
        'sku',          COALESCE(p.sku,  ''),
        'quantity',     po.quantity,
        'status',       po.status,
        'created_at',   po.created_at,
        'completed_at', po.completed_at
      ) ORDER BY po.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_batches
  FROM  production_orders po
  LEFT  JOIN products p ON p.id = po.product_id
  WHERE po.id         = ANY(v_batch_ids)
    AND po.company_id = v_company_id;

  -- ── Affected products ─────────────────────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_name',      sub.product_name,
        'sku',               sub.sku,
        'produced_units',    sub.produced_units,
        'distributed_units', sub.distributed_units,
        'batch_count',       sub.batch_count
      ) ORDER BY sub.distributed_units DESC
    ),
    '[]'::jsonb
  )
  INTO v_products
  FROM (
    SELECT
      p.name                                  AS product_name,
      p.sku                                   AS sku,
      SUM(po.quantity)::bigint                AS produced_units,
      COALESCE(SUM(dist.shipped), 0)::bigint  AS distributed_units,
      COUNT(DISTINCT po.id)                   AS batch_count
    FROM  production_orders po
    JOIN  products          p    ON p.id = po.product_id
    LEFT  JOIN (
      SELECT b.production_order_id, SUM(d.quantity_shipped) AS shipped
      FROM   distribution_records d
      JOIN   batches              b ON b.id = d.batch_id
      WHERE  d.batch_id   = ANY(v_dist_batch_ids)
        AND  d.company_id = v_company_id
      GROUP  BY b.production_order_id
    ) dist ON dist.production_order_id = po.id
    WHERE po.id         = ANY(v_batch_ids)
      AND po.company_id = v_company_id
    GROUP BY p.id, p.name, p.sku
  ) sub;

  -- ── Downstream distribution ───────────────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'batch_id',       dr.batch_id,
        'recipient_name', dr.recipient_name,
        'recipient_type', dr.recipient_type::text,
        'quantity',       dr.quantity_shipped,
        'shipped_at',     dr.shipped_at,
        'notes',          dr.notes
      ) ORDER BY dr.shipped_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_distribution
  FROM  distribution_records dr
  WHERE dr.company_id = v_company_id
    AND dr.batch_id   = ANY(v_dist_batch_ids);

  -- Total distributed units
  SELECT COALESCE(SUM(dr.quantity_shipped), 0)
  INTO   v_total_units
  FROM   distribution_records dr
  WHERE  dr.company_id = v_company_id
    AND  dr.batch_id   = ANY(v_dist_batch_ids);

  -- Unique recipients
  SELECT COALESCE(COUNT(DISTINCT dr.recipient_name), 0)
  INTO   v_unique_recipients
  FROM   distribution_records dr
  WHERE  dr.company_id = v_company_id
    AND  dr.batch_id   = ANY(v_dist_batch_ids);

  -- ── Open recall check ────────────────────────────────────────────
  SELECT EXISTS(
    SELECT 1 FROM recalls
    WHERE  batch_id   = ANY(v_batch_ids)
      AND  company_id = v_company_id
      AND  status    <> 'closed'
  ) INTO v_has_recall;

  -- ── Return full impact document ──────────────────────────────────
  RETURN jsonb_build_object(
    'affected_products',     v_products,
    'affected_batches',      v_batches,
    'affected_distributors', v_distribution,
    'total_affected_units',  v_total_units,
    'total_batches',         jsonb_array_length(v_batches),
    'total_products',        jsonb_array_length(v_products),
    'total_distributors',    v_unique_recipients,
    'total_shipments',       jsonb_array_length(v_distribution),
    'risk_level',            CASE
                               WHEN v_has_recall AND v_total_units > 0 THEN 'critical'
                               WHEN v_has_recall                       THEN 'high'
                               WHEN v_total_units > 100                THEN 'high'
                               WHEN v_total_units > 0                  THEN 'medium'
                               WHEN jsonb_array_length(v_batches) > 0  THEN 'low'
                               ELSE                                         'none'
                             END,
    'has_open_recall',       v_has_recall
  );
END;
$$;

GRANT  EXECUTE ON FUNCTION public.get_recall_impact(text, text, uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_recall_impact(text, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_recall_impact(text, text, uuid, uuid) FROM anon;

DO $$
BEGIN
  RAISE NOTICE '✓ get_recall_impact redeployed — lot_number matching is now exact.';
  RAISE NOTICE '  p_lot_number:          LOWER(TRIM(lot_number)) = LOWER(TRIM(p_lot_number))';
  RAISE NOTICE '  p_material_name:       LOWER(TRIM(material_name)) = LOWER(TRIM(p_material_name))';
  RAISE NOTICE '  p_raw_material_lot_id: exact FK = (unchanged)';
  RAISE NOTICE '  p_batch_id:            exact UUID = (unchanged)';
  RAISE NOTICE '  Sites changed: 4 (2 company-resolution, 2 batch-resolution)';
  RAISE NOTICE '';
  RAISE NOTICE '  Smoke test (exact lot):  SELECT get_recall_impact(p_lot_number    := ''LOT-2025-SS316-0891'');';
  RAISE NOTICE '  Smoke test (partial):    SELECT get_recall_impact(p_lot_number    := ''SS316'');  -- expect NULL / empty';
  RAISE NOTICE '  Smoke test (material):   SELECT get_recall_impact(p_material_name := ''Stainless Steel 316 Round Bar 25mm'');';
  RAISE NOTICE '  Smoke test (batch):      SELECT get_recall_impact(p_batch_id      := ''<uuid>'');';
  RAISE NOTICE '  Smoke test (lot id):     SELECT get_recall_impact(p_raw_material_lot_id := ''<uuid>'');';
END;
$$;
