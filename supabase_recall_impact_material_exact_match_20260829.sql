-- ============================================================
-- TraceFlow — get_recall_impact: exact material-name matching
-- File: supabase_recall_impact_material_exact_match_20260829.sql
-- ============================================================
--
-- WHY
--   The original get_recall_impact implementation matched
--   p_material_name with:
--
--       bom.material_name ILIKE '%' || p_material_name || '%'
--
--   This substring pattern aggregates every BOM row whose
--   material_name contains the search term, combining physically
--   distinct raw materials into a single impact result.
--
--   Example: searching "stainless" silently merged
--     • Stainless Steel 316 Round Bar 25mm
--     • Stainless Nut M12 DIN 934 Bulk
--   into one result — misleading for recall investigations.
--
-- WHAT CHANGES
--   Both material_name matching sites are replaced with an
--   exact case-insensitive, whitespace-trimmed comparison:
--
--       LOWER(TRIM(bom.material_name)) = LOWER(TRIM(p_material_name))
--
--   The frontend Material Impact page now requires the user to
--   select an exact material name from an autocomplete dropdown
--   before analysis runs, so p_material_name always carries a
--   precise stored value.
--
-- WHAT DOES NOT CHANGE
--   • Function name, parameters, return type — identical
--   • SECURITY DEFINER, search_path — identical
--   • GRANT EXECUTE TO authenticated — identical
--   • p_lot_number matching logic — untouched
--   • p_raw_material_lot_id matching logic — untouched
--   • p_batch_id matching logic — untouched
--   • All downstream joins, aggregations, risk calculation — untouched
--
-- COMPATIBILITY
--   Product Journey passes p_material_name = bom.material_name
--   (the exact stored string, read directly from bill_of_materials).
--   LOWER(TRIM(value)) = LOWER(TRIM(value)) is always true for
--   an exact stored string — Product Journey is unaffected.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

-- Drop all overloads so PostgREST can resolve the single canonical signature.
DO $drop_overloads$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM   pg_proc
    WHERE  proname        = 'get_recall_impact'
      AND  pronamespace   = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
    RAISE NOTICE 'Dropped overload: %', r.sig;
  END LOOP;
END;
$drop_overloads$;

CREATE OR REPLACE FUNCTION get_recall_impact(
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
      SELECT bom.company_id
      INTO   v_company_id
      FROM   bill_of_materials bom
      WHERE  bom.lot_number ILIKE '%' || p_lot_number || '%'
      LIMIT  1;

      IF v_company_id IS NULL THEN
        SELECT rml.company_id
        INTO   v_company_id
        FROM   raw_material_lots rml
        WHERE  rml.lot_number ILIKE '%' || p_lot_number || '%'
        LIMIT  1;
      END IF;

    ELSIF p_material_name IS NOT NULL THEN
      -- Exact case-insensitive, trim-safe match (was: ILIKE '%…%')
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
        bom.raw_material_lot_id IN (
          SELECT id
          FROM   raw_material_lots
          WHERE  lot_number ILIKE '%' || p_lot_number || '%'
            AND  company_id = v_company_id
        )
        OR bom.lot_number ILIKE '%' || p_lot_number || '%'
      );

  ELSIF p_material_name IS NOT NULL THEN
    -- Exact case-insensitive, trim-safe match (was: ILIKE '%…%')
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
  RAISE NOTICE '✓ get_recall_impact redeployed — material_name matching is now exact.';
  RAISE NOTICE '  p_material_name: LOWER(TRIM(material_name)) = LOWER(TRIM(p_material_name))';
  RAISE NOTICE '  p_lot_number / p_batch_id / p_raw_material_lot_id: unchanged.';
  RAISE NOTICE '  Smoke test (exact): SELECT get_recall_impact(p_material_name := ''Stainless Steel 316 Round Bar 25mm'');';
  RAISE NOTICE '  Smoke test (lot):   SELECT get_recall_impact(p_lot_number    := ''LOT-2025-SS316-0891'');';
  RAISE NOTICE '  Smoke test (batch): SELECT get_recall_impact(p_batch_id      := ''<uuid>'');';
END;
$$;

-- ── Material name suggestion helper ──────────────────────────────────────────
-- Returns up to LEAST(p_limit, 20) distinct, alphabetically sorted material
-- names from bill_of_materials whose names contain p_query (case-insensitive).
--
-- Deduplication: GROUP BY LOWER(TRIM(material_name)) — same normalisation as
-- get_recall_impact's exact-match WHERE clause, so every suggestion is a valid
-- p_material_name argument for that function.
--
-- Server-side GROUP BY + LIMIT means deduplication is complete before LIMIT is
-- applied — no client-side pagination or scan-budget arithmetic is needed.
--
-- Security: SECURITY INVOKER (caller's auth context flows through).
-- The explicit WHERE company_id = get_my_company_id() adds defence-in-depth
-- on top of the co_bill_of_materials RLS policy. Only material_name is returned.
-- REVOKE PUBLIC + GRANT authenticated matches the project ACL hardening pattern.

CREATE OR REPLACE FUNCTION get_material_name_suggestions(
  p_query text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(material_name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT   MIN(TRIM(bom.material_name))::text AS material_name
  FROM     bill_of_materials bom
  WHERE    bom.company_id         = get_my_company_id()
    AND    bom.material_name      IS NOT NULL
    AND    TRIM(bom.material_name) <> ''
    AND    bom.material_name      ILIKE '%' || p_query || '%'
  GROUP BY LOWER(TRIM(bom.material_name))
  ORDER BY MIN(TRIM(bom.material_name))
  LIMIT    LEAST(p_limit, 20);
$$;

REVOKE ALL     ON FUNCTION public.get_material_name_suggestions(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_material_name_suggestions(text, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_material_name_suggestions(text, integer) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✓ get_material_name_suggestions deployed — server-side DISTINCT, max 20, authenticated only.';
  RAISE NOTICE '  Smoke test: SELECT * FROM get_material_name_suggestions(''Steel'', 10);';
END;
$$;
