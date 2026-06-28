-- ============================================================
-- TraceFlow — Recall Impact Analysis RPC
-- File: supabase_recall_impact_rpc.sql
-- ============================================================
--
-- Creates:
--   get_recall_impact(
--     p_lot_number          text DEFAULT NULL,
--     p_material_name       text DEFAULT NULL,
--     p_batch_id            uuid DEFAULT NULL,
--     p_raw_material_lot_id uuid DEFAULT NULL   -- exact FK; takes priority over p_lot_number
--   ) RETURNS jsonb
--
-- Supply exactly one of the four parameters.
-- p_raw_material_lot_id is preferred when available — it is an exact FK match
-- against bill_of_materials.raw_material_lot_id and avoids fuzzy lot-number matching.
--
-- Company resolution order (allows SQL Editor smoke tests):
--   1. get_my_company_id()  — normal app path (authenticated session)
--   2. production_orders    — if p_batch_id provided and step 1 is NULL
--   3. bill_of_materials / raw_material_lots
--                           — if p_lot_number provided and step 1 is NULL
--   4. bill_of_materials    — if p_material_name provided and step 1 is NULL
--   5. Return NULL          — company still unresolvable
--
-- DISTRIBUTION JOIN CHAIN
--   production_orders.id (v_batch_ids)
--     → batches.production_order_id → batches.id (v_dist_batch_ids)
--       → distribution_records.batch_id
--
--   distribution_records.batch_id is a UUID FK to batches.id, not to
--   production_orders.id.  The intermediate batches table must be resolved
--   before joining distribution.  Without this step, affected_distributors
--   is always empty even when distribution records exist.
--
-- SCHEMA NOTES (live DB confirmed from seed_lifecycle_demo.sql)
--   batches.production_order_id    — uuid FK → production_orders.id
--   distribution_records.batch_id  — uuid FK → batches.id
--   distribution_records.recipient_name  — text NOT NULL
--   distribution_records.quantity_shipped — integer NOT NULL
--   distribution_records.recipient_type  — recipient_type ENUM NOT NULL
--   distribution_records.notes           — text
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

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
      SELECT bom.company_id
      INTO   v_company_id
      FROM   bill_of_materials bom
      WHERE  bom.material_name ILIKE '%' || p_material_name || '%'
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
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id)
    INTO   v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id   = v_company_id
      AND  bom.material_name ILIKE '%' || p_material_name || '%';
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
  -- distribution_records.batch_id is a FK to batches.id, not to
  -- production_orders.id.  Without this step, the distribution join
  -- always misses because it compares batches.id against production
  -- order UUIDs — two different UUID spaces.
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

  -- ── Affected products — produced_units (made) vs distributed_units (in field)
  -- produced_units  = SUM(production_orders.quantity)  — total manufactured
  -- distributed_units = SUM(distribution_records.quantity_shipped) per product
  -- These are intentionally different: produced − distributed = still in facility
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
      -- Pre-aggregate distributed qty per production order to avoid fan-out
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
  -- Join path: production_orders.id → batches.production_order_id
  --            → batches.id → distribution_records.batch_id
  --
  -- v_dist_batch_ids may be NULL when no batches rows exist for the
  -- affected production orders (e.g. before seeding).  The ANY(NULL)
  -- predicate safely returns no rows without erroring.
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

  -- Unique recipients to notify (distinct names, not shipment row count)
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

GRANT EXECUTE ON FUNCTION get_recall_impact(text, text, uuid, uuid) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✓ get_recall_impact(text, text, uuid, uuid) redeployed.';
  RAISE NOTICE '  Parameters: p_lot_number, p_material_name, p_batch_id, p_raw_material_lot_id';
  RAISE NOTICE '  Distribution join: production_orders → batches → distribution_records';
  RAISE NOTICE '  Smoke test (lot_id):   SELECT get_recall_impact(p_raw_material_lot_id := ''<uuid>'');';
  RAISE NOTICE '  Smoke test (lot):      SELECT get_recall_impact(p_lot_number    := ''LOT-2025-SS316-0891'');';
  RAISE NOTICE '  Smoke test (material): SELECT get_recall_impact(p_material_name := ''Steel'');';
  RAISE NOTICE '  Smoke test (batch):    SELECT get_recall_impact(p_batch_id      := ''74d19d61-b61f-42ad-b1df-84a954361e6b'');';
END;
$$;
