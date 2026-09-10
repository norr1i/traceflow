-- =============================================================================
-- TraceFlow -- BOM raw_material_lot_id Backfill Apply
-- supabase_bom_lot_fk_backfill_20260910.sql
-- Applied to production on 2026-09-10.
--
-- PURPOSE
--   Permanently backfill raw_material_lot_id on exactly 4 BOM rows whose
--   FK is NULL and have a single unambiguous compound candidate.
--   Derived from the live mapping query result (4-row JSON; verified).
--   CHANGES ARE COMMITTED. Apply only after the dry-run passed.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New Query -> paste -> Run.
--   Execution role: postgres (SQL Editor default).
--   Expected: all assertions pass; COMMIT succeeds; 4 rows permanently updated.
--
-- TABLES WRITTEN
--   public.bill_of_materials  (UPDATE only; 4 rows; raw_material_lot_id set)
--
-- TABLES READ
--   public.bill_of_materials
--   public.raw_material_lots
--   public.raw_materials
--
-- PROHIBITED STATEMENTS
--   INSERT, DELETE, DDL, RPC, GRANT, REVOKE: none present.
--   The only data mutation is the single UPDATE in SECTION 2.
--
-- TRANSACTION CONTROL
--   Active:  BEGIN ... COMMIT (wraps Sections 1-3).
--   Absent:  no active ROLLBACK in this file.
--   The commented rollback block at the end is not executable until uncommented.
--
-- HARDCODED MAPPING (4 pairs; verified from live mapping query result)
--   bom_id                                target_raw_material_lot_id
--   57a631c6-0768-4adb-af1a-113e99e56496  820a8c65-2dd8-44e0-b4a4-8840eb7fb626
--   87341aaa-393e-462e-bf3b-f181d97926a1  f638d096-d58d-4b2d-855b-770610001116
--   9a0bac76-cacb-46ed-ba4b-6e40889bd347  820a8c65-2dd8-44e0-b4a4-8840eb7fb626
--   b6e8ba80-7a99-4f38-b573-252606081cdc  18c5f6e9-fe83-41b9-b147-aac4477e300e
--
-- ROLLBACK (if needed after COMMIT)
--   A fully commented rollback block is at the end of this file.
--   It sets raw_material_lot_id back to NULL only when each row still
--   points to its exact mapped target lot. Uncomment before running.
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECTION 1 -- Pre-condition assertions
-- Verify global baseline and per-pair validity before any modification.
-- Any failed ASSERT raises EXCEPTION and aborts the transaction.
-- Expected global baseline: total=647, linked=127, missing=520, unique_exact=4
-- =============================================================================
DO $$
DECLARE
  v_total         int;
  v_linked        int;
  v_missing       int;
  v_unique_exact  int;
  v_bom_exists    int;
  v_bom_null      int;
  v_lots_exist    int;
  v_company_match int;
  v_lot_match     int;
  v_mat_match     int;
BEGIN
  -- Global counts
  SELECT COUNT(*) INTO v_total   FROM public.bill_of_materials;
  SELECT COUNT(*) INTO v_linked  FROM public.bill_of_materials WHERE raw_material_lot_id IS NOT NULL;
  SELECT COUNT(*) INTO v_missing FROM public.bill_of_materials WHERE raw_material_lot_id IS NULL;

  -- unique_exact via bucket classification (same logic as audit and dry-run)
  WITH
  rml_exact AS (
    SELECT
      rml.company_id,
      LOWER(TRIM(rml.lot_number)) AS norm_lot,
      LOWER(TRIM(rm.name))        AS norm_mat,
      COUNT(*)                    AS n
    FROM   public.raw_material_lots rml
    JOIN   public.raw_materials     rm  ON rm.id = rml.raw_material_id
    WHERE  NULLIF(TRIM(rml.lot_number), '') IS NOT NULL
      AND  NULLIF(TRIM(rm.name),         '') IS NOT NULL
    GROUP  BY rml.company_id,
              LOWER(TRIM(rml.lot_number)),
              LOWER(TRIM(rm.name))
  ),
  rml_lot AS (
    SELECT
      rml.company_id,
      LOWER(TRIM(rml.lot_number)) AS norm_lot,
      COUNT(*)                    AS n
    FROM   public.raw_material_lots rml
    WHERE  NULLIF(TRIM(rml.lot_number), '') IS NOT NULL
    GROUP  BY rml.company_id,
              LOWER(TRIM(rml.lot_number))
  ),
  buckets AS (
    SELECT
      CASE
        WHEN bom.lot_number IS NULL OR TRIM(bom.lot_number) = ''
             THEN 'no_lot_text'
        WHEN COALESCE(ec.n, 0) = 1
             THEN 'unique_exact'
        WHEN COALESCE(ec.n, 0) > 1
             THEN 'multi_exact'
        WHEN COALESCE(lc.n, 0) > 0
             THEN 'lot_name_mismatch'
        ELSE      'no_candidate'
      END AS bucket
    FROM   public.bill_of_materials bom
    LEFT JOIN rml_exact ec
           ON ec.company_id = bom.company_id
          AND ec.norm_lot   = LOWER(NULLIF(TRIM(bom.lot_number),    ''))
          AND ec.norm_mat   = LOWER(NULLIF(TRIM(bom.material_name), ''))
    LEFT JOIN rml_lot lc
           ON lc.company_id = bom.company_id
          AND lc.norm_lot   = LOWER(NULLIF(TRIM(bom.lot_number),    ''))
    WHERE  bom.raw_material_lot_id IS NULL
  )
  SELECT COUNT(*) FILTER (WHERE bucket = 'unique_exact')
  INTO   v_unique_exact
  FROM   buckets;

  ASSERT v_total        = 647, format('PRE-CHECK FAIL total_bom_rows: expected 647 got %s',  v_total);
  ASSERT v_linked       = 127, format('PRE-CHECK FAIL linked_fk_rows: expected 127 got %s',  v_linked);
  ASSERT v_missing      = 520, format('PRE-CHECK FAIL missing_fk_rows: expected 520 got %s', v_missing);
  ASSERT v_unique_exact = 4,   format('PRE-CHECK FAIL unique_exact: expected 4 got %s',      v_unique_exact);

  -- All four BOM IDs must exist in the table
  SELECT COUNT(*) INTO v_bom_exists
  FROM   public.bill_of_materials
  WHERE  id IN (
    '57a631c6-0768-4adb-af1a-113e99e56496'::uuid,
    '87341aaa-393e-462e-bf3b-f181d97926a1'::uuid,
    '9a0bac76-cacb-46ed-ba4b-6e40889bd347'::uuid,
    'b6e8ba80-7a99-4f38-b573-252606081cdc'::uuid
  );
  ASSERT v_bom_exists = 4,
    format('PRE-CHECK FAIL bom_ids_found: expected 4 got %s', v_bom_exists);

  -- All four must currently have raw_material_lot_id IS NULL
  SELECT COUNT(*) INTO v_bom_null
  FROM   public.bill_of_materials
  WHERE  id IN (
    '57a631c6-0768-4adb-af1a-113e99e56496'::uuid,
    '87341aaa-393e-462e-bf3b-f181d97926a1'::uuid,
    '9a0bac76-cacb-46ed-ba4b-6e40889bd347'::uuid,
    'b6e8ba80-7a99-4f38-b573-252606081cdc'::uuid
  )
    AND  raw_material_lot_id IS NULL;
  ASSERT v_bom_null = 4,
    format('PRE-CHECK FAIL bom_ids_null_fk: expected 4 got %s -- rows may already be updated', v_bom_null);

  -- All three distinct target lots must exist.
  -- 820a8c65-2dd8-44e0-b4a4-8840eb7fb626 appears for two BOM IDs (rows 1 and 3);
  -- COUNT(DISTINCT id) = 3 is the correct expected value.
  SELECT COUNT(DISTINCT id) INTO v_lots_exist
  FROM   public.raw_material_lots
  WHERE  id IN (
    '820a8c65-2dd8-44e0-b4a4-8840eb7fb626'::uuid,
    'f638d096-d58d-4b2d-855b-770610001116'::uuid,
    '18c5f6e9-fe83-41b9-b147-aac4477e300e'::uuid
  );
  ASSERT v_lots_exist = 3,
    format('PRE-CHECK FAIL target_lots_found: expected 3 got %s', v_lots_exist);

  -- Per-pair: company_id, normalized lot_number, and normalized material_name
  -- must each match for all 4 pairs. A single SELECT with three FILTER clauses
  -- over the 4-row VALUES join produces three independent counts.
  SELECT
    COUNT(*) FILTER (WHERE bom.company_id              = rml.company_id),
    COUNT(*) FILTER (WHERE LOWER(TRIM(bom.lot_number))    = LOWER(TRIM(rml.lot_number))),
    COUNT(*) FILTER (WHERE LOWER(TRIM(bom.material_name)) = LOWER(TRIM(rm.name)))
  INTO v_company_match, v_lot_match, v_mat_match
  FROM (VALUES
    ('57a631c6-0768-4adb-af1a-113e99e56496'::uuid, '820a8c65-2dd8-44e0-b4a4-8840eb7fb626'::uuid),
    ('87341aaa-393e-462e-bf3b-f181d97926a1'::uuid, 'f638d096-d58d-4b2d-855b-770610001116'::uuid),
    ('9a0bac76-cacb-46ed-ba4b-6e40889bd347'::uuid, '820a8c65-2dd8-44e0-b4a4-8840eb7fb626'::uuid),
    ('b6e8ba80-7a99-4f38-b573-252606081cdc'::uuid, '18c5f6e9-fe83-41b9-b147-aac4477e300e'::uuid)
  ) AS m(bom_uuid, target_lot_id)
  JOIN   public.bill_of_materials bom ON bom.id  = m.bom_uuid
  JOIN   public.raw_material_lots rml ON rml.id  = m.target_lot_id
  JOIN   public.raw_materials     rm  ON rm.id   = rml.raw_material_id;

  ASSERT v_company_match = 4,
    format('PRE-CHECK FAIL company_id_match: expected 4 got %s', v_company_match);
  ASSERT v_lot_match = 4,
    format('PRE-CHECK FAIL lot_number_match: expected 4 got %s', v_lot_match);
  ASSERT v_mat_match = 4,
    format('PRE-CHECK FAIL material_name_match: expected 4 got %s', v_mat_match);

  RAISE NOTICE 'SECTION 1: all 10 pre-condition assertions passed.';
END;
$$;


-- =============================================================================
-- SECTION 2 -- UPDATE (hardcoded 4 pairs) and row-count assertion
-- Targets only the exact BOM UUIDs where raw_material_lot_id IS still NULL.
-- The AND raw_material_lot_id IS NULL guard prevents accidental re-update
-- if this block is replayed against already-updated rows.
-- =============================================================================
DO $$
DECLARE
  n_updated int;
BEGIN
  UPDATE public.bill_of_materials bom
  SET    raw_material_lot_id = m.target_lot_id
  FROM (VALUES
    ('57a631c6-0768-4adb-af1a-113e99e56496'::uuid, '820a8c65-2dd8-44e0-b4a4-8840eb7fb626'::uuid),
    ('87341aaa-393e-462e-bf3b-f181d97926a1'::uuid, 'f638d096-d58d-4b2d-855b-770610001116'::uuid),
    ('9a0bac76-cacb-46ed-ba4b-6e40889bd347'::uuid, '820a8c65-2dd8-44e0-b4a4-8840eb7fb626'::uuid),
    ('b6e8ba80-7a99-4f38-b573-252606081cdc'::uuid, '18c5f6e9-fe83-41b9-b147-aac4477e300e'::uuid)
  ) AS m(bom_uuid, target_lot_id)
  WHERE  bom.id                    = m.bom_uuid
    AND  bom.raw_material_lot_id IS NULL;

  GET DIAGNOSTICS n_updated = ROW_COUNT;

  ASSERT n_updated = 4,
    format('UPDATE row count: expected 4 got %s -- aborting.', n_updated);

  RAISE NOTICE 'SECTION 2: UPDATE affected % rows (expected 4).', n_updated;
END;
$$;


-- =============================================================================
-- SECTION 3 -- Post-update assertions (inside transaction, before COMMIT)
-- All six assertions must pass before COMMIT is reached.
-- Expected: linked=131, missing=516, unique_exact_remaining=0,
--           company_mismatch=0, lot_text_mismatch=0, mat_name_mismatch=0
-- =============================================================================
DO $$
DECLARE
  v_linked       int;
  v_missing      int;
  v_unique_exact int;
  v_co_mismatch  int;
  v_lot_mismatch int;
  v_mat_mismatch int;
BEGIN
  SELECT COUNT(*) INTO v_linked  FROM public.bill_of_materials WHERE raw_material_lot_id IS NOT NULL;
  SELECT COUNT(*) INTO v_missing FROM public.bill_of_materials WHERE raw_material_lot_id IS NULL;

  WITH
  rml_exact AS (
    SELECT
      rml.company_id,
      LOWER(TRIM(rml.lot_number)) AS norm_lot,
      LOWER(TRIM(rm.name))        AS norm_mat,
      COUNT(*)                    AS n
    FROM   public.raw_material_lots rml
    JOIN   public.raw_materials     rm  ON rm.id = rml.raw_material_id
    WHERE  NULLIF(TRIM(rml.lot_number), '') IS NOT NULL
      AND  NULLIF(TRIM(rm.name),         '') IS NOT NULL
    GROUP  BY rml.company_id,
              LOWER(TRIM(rml.lot_number)),
              LOWER(TRIM(rm.name))
  ),
  rml_lot AS (
    SELECT
      rml.company_id,
      LOWER(TRIM(rml.lot_number)) AS norm_lot,
      COUNT(*)                    AS n
    FROM   public.raw_material_lots rml
    WHERE  NULLIF(TRIM(rml.lot_number), '') IS NOT NULL
    GROUP  BY rml.company_id,
              LOWER(TRIM(rml.lot_number))
  ),
  buckets AS (
    SELECT
      CASE
        WHEN bom.lot_number IS NULL OR TRIM(bom.lot_number) = ''
             THEN 'no_lot_text'
        WHEN COALESCE(ec.n, 0) = 1
             THEN 'unique_exact'
        WHEN COALESCE(ec.n, 0) > 1
             THEN 'multi_exact'
        WHEN COALESCE(lc.n, 0) > 0
             THEN 'lot_name_mismatch'
        ELSE      'no_candidate'
      END AS bucket
    FROM   public.bill_of_materials bom
    LEFT JOIN rml_exact ec
           ON ec.company_id = bom.company_id
          AND ec.norm_lot   = LOWER(NULLIF(TRIM(bom.lot_number),    ''))
          AND ec.norm_mat   = LOWER(NULLIF(TRIM(bom.material_name), ''))
    LEFT JOIN rml_lot lc
           ON lc.company_id = bom.company_id
          AND lc.norm_lot   = LOWER(NULLIF(TRIM(bom.lot_number),    ''))
    WHERE  bom.raw_material_lot_id IS NULL
  )
  SELECT COUNT(*) FILTER (WHERE bucket = 'unique_exact')
  INTO   v_unique_exact
  FROM   buckets;

  -- Integrity across all 131 linked rows (127 original + 4 newly updated)
  SELECT
    COUNT(*) FILTER (WHERE bom.company_id <> rml.company_id),
    COUNT(*) FILTER (
      WHERE NULLIF(TRIM(bom.lot_number), '') IS NOT NULL
        AND LOWER(TRIM(bom.lot_number)) <> LOWER(TRIM(rml.lot_number))
    ),
    COUNT(*) FILTER (
      WHERE NULLIF(TRIM(bom.material_name), '') IS NOT NULL
        AND NULLIF(TRIM(rm.name),            '') IS NOT NULL
        AND LOWER(TRIM(bom.material_name)) <> LOWER(TRIM(rm.name))
    )
  INTO v_co_mismatch, v_lot_mismatch, v_mat_mismatch
  FROM   public.bill_of_materials bom
  JOIN   public.raw_material_lots rml ON rml.id = bom.raw_material_lot_id
  JOIN   public.raw_materials     rm  ON rm.id  = rml.raw_material_id
  WHERE  bom.raw_material_lot_id IS NOT NULL;

  ASSERT v_linked       = 131, format('POST-UPDATE FAIL linked: expected 131 got %s',               v_linked);
  ASSERT v_missing      = 516, format('POST-UPDATE FAIL missing: expected 516 got %s',              v_missing);
  ASSERT v_unique_exact = 0,   format('POST-UPDATE FAIL unique_exact_remaining: expected 0 got %s', v_unique_exact);
  ASSERT v_co_mismatch  = 0,   format('POST-UPDATE FAIL company_mismatch: expected 0 got %s',       v_co_mismatch);
  ASSERT v_lot_mismatch = 0,   format('POST-UPDATE FAIL lot_text_mismatch: expected 0 got %s',      v_lot_mismatch);
  ASSERT v_mat_mismatch = 0,   format('POST-UPDATE FAIL mat_name_mismatch: expected 0 got %s',      v_mat_mismatch);

  RAISE NOTICE 'SECTION 3: all 6 post-update assertions passed -- proceeding to COMMIT.';
END;
$$;


-- All 10 pre-condition + 1 row-count + 6 post-update assertions passed.
COMMIT;


-- =============================================================================
-- SECTION 4 -- Post-COMMIT aggregate verification
-- Confirms committed state. No UUIDs or row-level data are returned.
-- Expected: post_commit_linked=131, post_commit_missing=516,
--           post_commit_unique_exact=0
-- =============================================================================
WITH
rml_exact AS (
  SELECT
    rml.company_id,
    LOWER(TRIM(rml.lot_number)) AS norm_lot,
    LOWER(TRIM(rm.name))        AS norm_mat,
    COUNT(*)                    AS n
  FROM   public.raw_material_lots rml
  JOIN   public.raw_materials     rm  ON rm.id = rml.raw_material_id
  WHERE  NULLIF(TRIM(rml.lot_number), '') IS NOT NULL
    AND  NULLIF(TRIM(rm.name),         '') IS NOT NULL
  GROUP  BY rml.company_id,
            LOWER(TRIM(rml.lot_number)),
            LOWER(TRIM(rm.name))
),
rml_lot AS (
  SELECT
    rml.company_id,
    LOWER(TRIM(rml.lot_number)) AS norm_lot,
    COUNT(*)                    AS n
  FROM   public.raw_material_lots rml
  WHERE  NULLIF(TRIM(rml.lot_number), '') IS NOT NULL
  GROUP  BY rml.company_id,
            LOWER(TRIM(rml.lot_number))
),
missing_classified AS (
  SELECT
    CASE
      WHEN bom.lot_number IS NULL OR TRIM(bom.lot_number) = ''
           THEN 'no_lot_text'
      WHEN COALESCE(ec.n, 0) = 1
           THEN 'unique_exact'
      WHEN COALESCE(ec.n, 0) > 1
           THEN 'multi_exact'
      WHEN COALESCE(lc.n, 0) > 0
           THEN 'lot_name_mismatch'
      ELSE      'no_candidate'
    END AS bucket
  FROM   public.bill_of_materials bom
  LEFT JOIN rml_exact ec
         ON ec.company_id = bom.company_id
        AND ec.norm_lot   = LOWER(NULLIF(TRIM(bom.lot_number),    ''))
        AND ec.norm_mat   = LOWER(NULLIF(TRIM(bom.material_name), ''))
  LEFT JOIN rml_lot lc
         ON lc.company_id = bom.company_id
        AND lc.norm_lot   = LOWER(NULLIF(TRIM(bom.lot_number),    ''))
  WHERE  bom.raw_material_lot_id IS NULL
)
SELECT 'post_commit_linked'        AS metric, COUNT(*) AS count
FROM   public.bill_of_materials WHERE raw_material_lot_id IS NOT NULL

UNION ALL

SELECT 'post_commit_missing',               COUNT(*)
FROM   public.bill_of_materials WHERE raw_material_lot_id IS NULL

UNION ALL

SELECT 'post_commit_unique_exact',          COUNT(*)
FROM   missing_classified WHERE bucket = 'unique_exact';


-- =============================================================================
-- ROLLBACK (commented -- apply only if the committed update must be reversed)
--
-- Prerequisites before uncommenting and running:
--   1. Confirm the four rows still point to their mapped target lots.
--   2. Uncomment the entire block below (remove /* and */).
--   3. Run in a fresh SQL Editor query tab.
--
-- Effect: sets raw_material_lot_id back to NULL for each row, but only when
-- the row's current raw_material_lot_id still equals the mapped target.
-- The AND guard prevents nulling a row subsequently re-updated to a new lot.
-- Asserts ROW_COUNT = 4 to catch any partial mismatch before committing.
-- =============================================================================
/*
BEGIN;

DO $$
DECLARE
  n_rolled_back int;
BEGIN
  UPDATE public.bill_of_materials bom
  SET    raw_material_lot_id = NULL
  FROM (VALUES
    ('57a631c6-0768-4adb-af1a-113e99e56496'::uuid, '820a8c65-2dd8-44e0-b4a4-8840eb7fb626'::uuid),
    ('87341aaa-393e-462e-bf3b-f181d97926a1'::uuid, 'f638d096-d58d-4b2d-855b-770610001116'::uuid),
    ('9a0bac76-cacb-46ed-ba4b-6e40889bd347'::uuid, '820a8c65-2dd8-44e0-b4a4-8840eb7fb626'::uuid),
    ('b6e8ba80-7a99-4f38-b573-252606081cdc'::uuid, '18c5f6e9-fe83-41b9-b147-aac4477e300e'::uuid)
  ) AS m(bom_uuid, target_lot_id)
  WHERE  bom.id                  = m.bom_uuid
    AND  bom.raw_material_lot_id = m.target_lot_id;

  GET DIAGNOSTICS n_rolled_back = ROW_COUNT;

  ASSERT n_rolled_back = 4,
    format('ROLLBACK row count: expected 4 got %s -- some rows may not match their target lot', n_rolled_back);

  RAISE NOTICE 'ROLLBACK: % rows restored to NULL (raw_material_lot_id).', n_rolled_back;
END;
$$;

COMMIT;
*/
