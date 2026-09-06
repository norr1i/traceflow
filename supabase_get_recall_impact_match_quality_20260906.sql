-- ============================================================
-- TraceFlow — get_recall_impact: match-quality + ambiguity metadata
-- File: supabase_get_recall_impact_match_quality_20260906.sql
-- ============================================================
--
-- PREDECESSOR
--   supabase_recall_impact_lot_exact_match_20260904.sql  (P0-A)
--   (replaced all four p_lot_number comparison sites with
--    LOWER(TRIM) exact-string matching — already deployed)
--
-- WHY (P0-E1 objective)
--   P0-A ensures the right rows are matched, but treats all results
--   uniformly: callers cannot tell whether an affected batch was
--   reached via a raw_material_lot FK relationship or via a legacy
--   BOM text match.  When the same lot-number string appears across
--   multiple materials (ambiguity), callers also receive no signal
--   that the returned scope may span unrelated materials.
--
--   P0-E1 adds transparency metadata only.  It does not change which
--   batches are returned, does not change risk calculations, does not
--   change matching strings, and does not modify the schema.
--
-- WHAT CHANGES (additive only)
--
--   Three new top-level JSON fields in every returned document:
--
--   scope_quality  text
--     Reflects how the query was initiated.  Allowed values:
--
--       'exact_uuid_lot'       p_raw_material_lot_id was supplied
--       'batch_exact'          p_batch_id was supplied
--       'text_lot_unambiguous' p_lot_number supplied; one material context
--       'text_lot_ambiguous'   p_lot_number supplied; multiple material contexts
--       'material_scope'       p_material_name was supplied
--
--     CRITICAL: text_lot_unambiguous is still NON-EXACT.
--     A text lot search never establishes a verified relational lot
--     boundary even when only one material context is found, because
--     no database constraint prevents another material from using the
--     same lot-number string in the future.  Only exact_uuid_lot is a
--     relationally exact lot scope.
--
--     Risk level and scope quality are independent.  A 'critical'
--     risk_level with scope_quality = 'text_lot_ambiguous' means
--     the situation is severe but the lot scope is not precisely
--     bounded — both signals must be communicated to the user.
--
--   ambiguity_detected  boolean
--     true when p_lot_number is supplied and the normalized lot-number
--     string resolves to more than one distinct material context,
--     combining formal-lot material contexts (Source A) and all
--     BOM lot_number text-path material contexts (Source B).
--     Always false for other parameter paths.
--
--   ambiguous_materials  jsonb  (array of text)
--     User-readable material names involved when ambiguous.
--     One canonical representative name per distinct normalized context,
--     sorted alphabetically.  Empty array when ambiguity_detected = false.
--     No supplier inference.  No IDs.
--
--   One new per-element field inside affected_batches:
--
--   match_source  text | null
--     'exact_fk'    the production order has at least one BOM row whose
--                   raw_material_lot_id FK joins to a raw_material_lots
--                   row whose normalized lot_number equals p_lot_number.
--     'text_match'  the production order is in the p_lot_number result set
--                   but has NO FK path to the queried lot.  It was included
--                   via bom.lot_number text comparison (Site 4).  The BOM
--                   row may have raw_material_lot_id IS NULL (legacy) or
--                   non-null pointing to a different lot.
--     null          for batch_exact and material_scope paths, where the
--                   result is not derived from a lot relationship.
--
--     exact_fk takes precedence: if the same production order has both an
--     FK-linked BOM row for the queried lot and a text-only BOM row, it
--     is labeled exact_fk.
--
-- AMBIGUITY DETECTION DESIGN
--   Material contexts are collected from two sources, both scoped to
--   v_company_id, using LOWER(TRIM) normalization:
--
--   Source A — formal lots:
--     raw_material_lots JOIN raw_materials ON rm.id = rml.raw_material_id
--     WHERE normalized rml.lot_number matches
--     Material context: rm.name
--
--   Source B — all BOM rows where bom.lot_number text matches (mirrors Site 4):
--     bill_of_materials WHERE normalized bom.lot_number matches.
--     Covers legacy unlinked rows (raw_material_lot_id IS NULL) and rows
--     linked to a different lot whose denormalized text happens to match.
--     Material context: bom.material_name
--
--   bill_of_materials has NO raw_material_id column — do not invent one.
--   Supplier context is not used; ambiguity is resolved at material-name level.
--
--   NULL or empty-after-TRIM material names are excluded from counting.
--   Case/whitespace variants that normalize to the same string are treated
--   as one context.  Ambiguous = DISTINCT normalized contexts > 1.
--
--   ambiguous_materials contains one user-readable name per distinct
--   normalized context (lexicographically first original-case value
--   within each normalized group), sorted alphabetically.
--
-- RESULT-SET PRESERVATION
--   The set of production_order IDs in affected_batches is identical
--   to P0-A.  The affected-batch resolution for p_lot_number still uses
--   the same Sites 3 + 4 OR logic as P0-A.  P0-E1 separately tracks
--   which IDs came from the FK path (v_exact_batch_ids) for labeling
--   only; this does not alter the final result set.
--
-- WHAT DOES NOT CHANGE
--   • Function name, parameters, RETURNS type — identical
--   • SECURITY DEFINER, SET search_path — identical
--   • GRANT/REVOKE — identical
--   • Company resolution logic — identical (Steps 1–5)
--   • All four P0-A LOWER(TRIM) lot-number comparisons — preserved verbatim
--   • No '%' || p_lot_number || '%' substring matching reintroduced
--   • p_material_name matching — identical (LOWER(TRIM) exact)
--   • risk_level calculation — identical
--   • has_open_recall logic — identical
--   • Downstream distribution joins — identical
--   • affected_products output — identical
--   • affected_distributors output — identical
--   • All total calculations — identical
--   • No schema changes, no index changes, no RLS changes
--   • No historical data modified
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
--   DO NOT run until explicitly instructed.
-- ============================================================

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
  -- ── Existing variables (unchanged from P0-A) ──────────────────────────
  v_company_id          uuid;
  v_batch_ids           uuid[];   -- production_orders.id (combined result set)
  v_dist_batch_ids      uuid[];   -- batches.id (resolved via batches.production_order_id)
  v_products            jsonb;
  v_batches             jsonb;
  v_distribution        jsonb;
  v_total_units         bigint  := 0;
  v_unique_recipients   bigint  := 0;
  v_has_recall          boolean := false;

  -- ── New for P0-E1: transparency metadata ─────────────────────────────
  v_scope_quality       text;               -- derived after ambiguity detection
  v_ambiguity_detected  boolean := false;   -- default: not ambiguous
  v_ambiguous_materials jsonb   := '[]'::jsonb;  -- default: empty array
  v_exact_batch_ids     uuid[];  -- production_order IDs reached via FK path only;
                                 -- used for per-batch match_source labeling
BEGIN

  -- ── Step 1: resolve company via session (normal authenticated path) ──
  v_company_id := get_my_company_id();

  -- ── Steps 2–4: fallback for SQL Editor / service-role callers ────────
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
      -- Site 1: company resolution from bill_of_materials (P0-A verbatim)
      SELECT bom.company_id
      INTO   v_company_id
      FROM   bill_of_materials bom
      WHERE  LOWER(TRIM(bom.lot_number)) = LOWER(TRIM(p_lot_number))
      LIMIT  1;

      IF v_company_id IS NULL THEN
        -- Site 2: company resolution fallback from raw_material_lots (P0-A verbatim)
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

  -- ── Step 5: still no company → give up ───────────────────────────────
  IF v_company_id IS NULL THEN RETURN NULL; END IF;

  -- ── Resolve batch IDs (production_orders.id) ─────────────────────────
  IF p_raw_material_lot_id IS NOT NULL THEN
    -- Exact FK match (P0-A verbatim).
    -- All matched batches are exact_fk for match_source purposes, so
    -- v_exact_batch_ids mirrors v_batch_ids for this path.
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id)
    INTO   v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id          = v_company_id
      AND  bom.raw_material_lot_id = p_raw_material_lot_id;

    v_exact_batch_ids := v_batch_ids;

  ELSIF p_batch_id IS NOT NULL THEN
    -- Exact batch UUID (P0-A verbatim).
    -- match_source is not lot-derived for this path; v_exact_batch_ids
    -- is left NULL and match_source will be NULL in the output.
    SELECT ARRAY_AGG(DISTINCT id)
    INTO   v_batch_ids
    FROM   production_orders
    WHERE  id         = p_batch_id
      AND  company_id = v_company_id;

  ELSIF p_lot_number IS NOT NULL THEN

    -- ── P0-E1 addition: track FK-path IDs separately (for match_source) ─
    -- These are production orders where a BOM row is formally linked to a
    -- raw_material_lots entry whose normalized lot_number matches.
    -- Only rows with a non-null raw_material_lot_id qualify.
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id)
    INTO   v_exact_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id = v_company_id
      AND  bom.raw_material_lot_id IN (
             SELECT id
             FROM   raw_material_lots
             WHERE  LOWER(TRIM(lot_number)) = LOWER(TRIM(p_lot_number))
               AND  company_id = v_company_id
           );

    -- ── P0-A Sites 3 + 4 combined (verbatim — result set unchanged) ────
    -- Site 3: FK-linked rows whose lot resolves to the searched lot_number
    -- Site 4: BOM text fallback (normalized exact, no substring matching)
    -- DISTINCT on production_order_id deduplicates as in P0-A.
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id)
    INTO   v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id = v_company_id
      AND  (
        -- Site 3 (P0-A verbatim)
        bom.raw_material_lot_id IN (
          SELECT id
          FROM   raw_material_lots
          WHERE  LOWER(TRIM(lot_number)) = LOWER(TRIM(p_lot_number))
            AND  company_id = v_company_id
        )
        -- Site 4 (P0-A verbatim)
        OR LOWER(TRIM(bom.lot_number)) = LOWER(TRIM(p_lot_number))
      );

    -- ── P0-E1 addition: ambiguity detection ────────────────────────────
    -- Combines two material-context sources, both scoped to v_company_id.
    --
    -- Source A — formal lots:
    --   raw_material_lots JOIN raw_materials where normalized lot_number
    --   matches.  Material context = rm.name.
    --
    -- Source B — all BOM rows where lot_number text matches (mirrors Site 4):
    --   Covers legacy unlinked rows AND rows linked to a different lot.
    --   Material context = bom.material_name.
    --   (bill_of_materials has no raw_material_id column.)
    --
    -- Normalization: LOWER(TRIM(...)) for both context and lot_number.
    -- NULL or empty-after-TRIM contexts are excluded before counting.
    -- DISTINCT ON (norm_ctx) selects one canonical representative
    -- (lexicographically first raw_name) per normalized group.
    -- ambiguity_detected = COUNT(distinct normalized contexts) > 1.
    -- ambiguous_materials contains each canonical name, sorted alphabetically.
    WITH material_contexts AS (
      -- Source A: formal raw_material_lots entries
      SELECT
        LOWER(TRIM(rm.name)) AS norm_ctx,
        TRIM(rm.name)        AS raw_name
      FROM   raw_material_lots rml
      JOIN   raw_materials     rm  ON rm.id = rml.raw_material_id
      WHERE  rml.company_id              = v_company_id
        AND  LOWER(TRIM(rml.lot_number)) = LOWER(TRIM(p_lot_number))
        AND  rm.name IS NOT NULL
        AND  TRIM(rm.name) <> ''

      UNION ALL

      -- Source B: all BOM rows with matching lot_number text (mirrors Site 4)
      SELECT
        LOWER(TRIM(bom.material_name)) AS norm_ctx,
        TRIM(bom.material_name)        AS raw_name
      FROM   bill_of_materials bom
      WHERE  bom.company_id              = v_company_id
        AND  LOWER(TRIM(bom.lot_number)) = LOWER(TRIM(p_lot_number))
        AND  bom.material_name IS NOT NULL
        AND  TRIM(bom.material_name) <> ''
    ),
    deduped AS (
      -- One canonical representative per distinct normalized context.
      -- ORDER BY norm_ctx, raw_name makes the pick deterministic.
      SELECT DISTINCT ON (norm_ctx)
        norm_ctx,
        raw_name
      FROM   material_contexts
      WHERE  norm_ctx IS NOT NULL
        AND  norm_ctx <> ''
      ORDER  BY norm_ctx, raw_name
    )
    SELECT
      COUNT(*) > 1,
      CASE WHEN COUNT(*) > 1
           THEN COALESCE(jsonb_agg(raw_name ORDER BY raw_name), '[]'::jsonb)
           ELSE '[]'::jsonb
      END
    INTO v_ambiguity_detected, v_ambiguous_materials
    FROM deduped;

  ELSIF p_material_name IS NOT NULL THEN
    -- Exact case-insensitive, trim-safe match (fixed 2026-08-29; unchanged here).
    -- match_source is not lot-derived for this path; v_exact_batch_ids
    -- is left NULL and match_source will be NULL in the output.
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id)
    INTO   v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id                   = v_company_id
      AND  LOWER(TRIM(bom.material_name)) = LOWER(TRIM(p_material_name));
  END IF;

  -- ── Derive scope_quality (must run after ambiguity detection above) ───
  -- Uses the same parameter-precedence order as the IF/ELSIF chain above.
  v_scope_quality := CASE
    WHEN p_raw_material_lot_id IS NOT NULL THEN 'exact_uuid_lot'
    WHEN p_batch_id            IS NOT NULL THEN 'batch_exact'
    WHEN p_lot_number          IS NOT NULL THEN
      CASE WHEN v_ambiguity_detected
           THEN 'text_lot_ambiguous'
           ELSE 'text_lot_unambiguous'
      END
    WHEN p_material_name       IS NOT NULL THEN 'material_scope'
    ELSE NULL
  END;

  -- ── No matches → return empty result (P0-E1 metadata included) ───────
  -- Structured identically to the non-empty branch so callers see the
  -- same JSON contract regardless of result count.
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
      'has_open_recall',       false,
      'scope_quality',         v_scope_quality,
      'ambiguity_detected',    v_ambiguity_detected,
      'ambiguous_materials',   v_ambiguous_materials
    );
  END IF;

  -- ── Resolve batches.id for the distribution join (P0-A verbatim) ─────
  SELECT ARRAY_AGG(DISTINCT b.id)
  INTO   v_dist_batch_ids
  FROM   batches b
  WHERE  b.production_order_id = ANY(v_batch_ids)
    AND  b.company_id          = v_company_id;

  -- ── Affected batches (match_source added; all other fields P0-A verbatim) ──
  -- match_source semantics:
  --   p_raw_material_lot_id path: all batches are 'exact_fk'
  --   p_lot_number path:
  --     if production_order_id is in v_exact_batch_ids → 'exact_fk'
  --     otherwise → 'text_match'
  --     (NULL v_exact_batch_ids: ANY(NULL) → NULL → treated as false
  --      → falls to 'text_match'; correct when no FK rows matched)
  --   p_batch_id and p_material_name paths: NULL (not lot-derived)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'batch_id',     po.id,
        'product_name', COALESCE(p.name, 'Unknown'),
        'sku',          COALESCE(p.sku,  ''),
        'quantity',     po.quantity,
        'status',       po.status,
        'created_at',   po.created_at,
        'completed_at', po.completed_at,
        'match_source', CASE
                          WHEN p_raw_material_lot_id IS NOT NULL THEN 'exact_fk'
                          WHEN p_lot_number IS NOT NULL THEN
                            CASE WHEN po.id = ANY(v_exact_batch_ids)
                                 THEN 'exact_fk'
                                 ELSE 'text_match'
                            END
                          ELSE NULL
                        END
      ) ORDER BY po.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_batches
  FROM  production_orders po
  LEFT  JOIN products p ON p.id = po.product_id
  WHERE po.id         = ANY(v_batch_ids)
    AND po.company_id = v_company_id;

  -- ── Affected products (P0-A verbatim) ────────────────────────────────
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

  -- ── Downstream distribution (P0-A verbatim) ──────────────────────────
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

  -- Total distributed units (P0-A verbatim)
  SELECT COALESCE(SUM(dr.quantity_shipped), 0)
  INTO   v_total_units
  FROM   distribution_records dr
  WHERE  dr.company_id = v_company_id
    AND  dr.batch_id   = ANY(v_dist_batch_ids);

  -- Unique recipients (P0-A verbatim)
  SELECT COALESCE(COUNT(DISTINCT dr.recipient_name), 0)
  INTO   v_unique_recipients
  FROM   distribution_records dr
  WHERE  dr.company_id = v_company_id
    AND  dr.batch_id   = ANY(v_dist_batch_ids);

  -- ── Open recall check (P0-A verbatim) ────────────────────────────────
  SELECT EXISTS(
    SELECT 1 FROM recalls
    WHERE  batch_id   = ANY(v_batch_ids)
      AND  company_id = v_company_id
      AND  status    <> 'closed'
  ) INTO v_has_recall;

  -- ── Return full impact document (P0-E1 metadata added) ───────────────
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
    'has_open_recall',       v_has_recall,
    'scope_quality',         v_scope_quality,
    'ambiguity_detected',    v_ambiguity_detected,
    'ambiguous_materials',   v_ambiguous_materials
  );
END;
$$;

GRANT  EXECUTE ON FUNCTION public.get_recall_impact(text, text, uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_recall_impact(text, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_recall_impact(text, text, uuid, uuid) FROM anon;

DO $$
BEGIN
  RAISE NOTICE '✓ get_recall_impact redeployed — P0-E1 match-quality and ambiguity metadata added.';
  RAISE NOTICE '';
  RAISE NOTICE '  New top-level fields (present in all returned documents):';
  RAISE NOTICE '    scope_quality         text    — how the query was initiated';
  RAISE NOTICE '      exact_uuid_lot        p_raw_material_lot_id supplied (only relational exact scope)';
  RAISE NOTICE '      batch_exact           p_batch_id supplied';
  RAISE NOTICE '      text_lot_unambiguous  p_lot_number, one material context (still NON-EXACT)';
  RAISE NOTICE '      text_lot_ambiguous    p_lot_number, multiple material contexts';
  RAISE NOTICE '      material_scope        p_material_name supplied';
  RAISE NOTICE '    ambiguity_detected    boolean — true when lot spans multiple material contexts';
  RAISE NOTICE '    ambiguous_materials   jsonb   — human-readable material name list; [] if unambiguous';
  RAISE NOTICE '';
  RAISE NOTICE '  New field inside each affected_batches element:';
  RAISE NOTICE '    match_source   exact_fk | text_match | null';
  RAISE NOTICE '      exact_fk     production order has a BOM row with FK to the searched lot';
  RAISE NOTICE '      text_match   no FK path to queried lot; included via bom.lot_number text match';
  RAISE NOTICE '      null         batch_exact / material_scope paths (not lot-relationship-derived)';
  RAISE NOTICE '';
  RAISE NOTICE '  All P0-A LOWER(TRIM) lot-number comparisons preserved verbatim.';
  RAISE NOTICE '  No substring (%% || p_lot_number || %%) matching reintroduced.';
  RAISE NOTICE '  Affected batch result set is unchanged from P0-A.';
  RAISE NOTICE '  Risk level calculation is unchanged from P0-A.';
  RAISE NOTICE '';
  RAISE NOTICE '  Smoke tests:';
  RAISE NOTICE '    SELECT get_recall_impact(p_lot_number           := ''LOT-2025-SS316-0891'');';
  RAISE NOTICE '    SELECT get_recall_impact(p_lot_number           := ''SS316'');   -- expect null / empty';
  RAISE NOTICE '    SELECT get_recall_impact(p_material_name        := ''Stainless Steel 316 Round Bar 25mm'');';
  RAISE NOTICE '    SELECT get_recall_impact(p_batch_id             := ''<uuid>'');';
  RAISE NOTICE '    SELECT get_recall_impact(p_raw_material_lot_id  := ''<uuid>'');';
  RAISE NOTICE '  For each, check scope_quality, ambiguity_detected, ambiguous_materials.';
  RAISE NOTICE '  For lot_number tests, check match_source on each affected_batches element.';
END;
$$;
