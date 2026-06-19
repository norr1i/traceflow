-- ================================================================
-- TraceFlow — Product Journey: New Stage Sample Data (v3)
-- File: supabase_product_journey_stages_seed.sql
-- ================================================================
--
-- WHY PREVIOUS VERSIONS FAILED
-- ─────────────────────────────
-- v1: joined through bill_of_materials.raw_material_lot_id, which the
--     Phase 1A migration documents is NULL for every existing BOM row.
--
-- v2: fixed the BOM join for supplier events but synthesizeIncomingQcEvents
--     still required m.received_at && m.lot_status — both always NULL
--     because raw_material_lot_id is NULL → no lot data → no synthesis.
--
-- ROOT CAUSE (confirmed by reading client code):
--   synthesizeSupplierEvents: skips every material when supplier_name===null.
--   synthesizeIncomingQcEvents: requires received_at && lot_status — both null.
--   Only synthesizePackagingEvents works because it only uses order.completed_at.
--
-- THIS VERSION (v3)
-- ─────────────────
-- Seeds batch_journey_events directly so the get_batch_journey RPC
-- returns events, bypassing synthesis entirely (hasSupplierInRpc=true
-- and hasIncomingQcInRpc=true skip the broken synthesis paths).
--
-- Works regardless of whether:
--   • BOM entries exist for a batch
--   • raw_materials names match BOM material_name values
--   • suppliers rows exist in the DB
--
-- Seeding strategy:
--   1. supplier.qualified   — try BOM→raw_materials(name)→suppliers,
--                             fall back to any supplier, fall back to
--                             'Approved Supplier' text
--   2. raw_material.received — one event per BOM material (or one generic
--                              event per batch if no BOM entries exist)
--   3. incoming_qc.approved  — use BOM created_at + 2h (no lot data needed),
--                              or po.created_at + 2h if no BOM exists
--   4. batch_qc_results INSERT — for Final QC (the RPC queries this table
--                                directly; seeding batch_journey_events
--                                is not enough for this stage)
--
-- All inserts are idempotent. NOT EXISTS guards prevent duplicates.
--
-- HOW TO RUN
-- ──────────
--   Supabase Dashboard → SQL Editor → New Query → paste all → Run
--   After running, refresh the Product Journey detail page.
-- ================================================================


-- ── DIAGNOSTICS (run to understand current state) ────────────────

SELECT '=== 1. batch_journey_events for new stages ===' AS section;

SELECT event_type, COUNT(*) AS rows
FROM   public.batch_journey_events
WHERE  event_type IN (
         'supplier.qualified', 'raw_material.received',
         'incoming_qc.approved', 'storage.entry',
         'finished_goods.stored', 'distributor.received', 'market.listed'
       )
GROUP  BY event_type ORDER BY event_type;

SELECT '=== 2. production_orders — company_id check ===' AS section;

SELECT
  CASE WHEN company_id IS NULL THEN 'NULL (seed will skip!)' ELSE 'set' END AS company_id_state,
  COUNT(*) AS batch_count,
  COUNT(completed_at) AS completed
FROM   public.production_orders
GROUP  BY company_id IS NULL;

SELECT '=== 3. bill_of_materials summary ===' AS section;

SELECT
  COUNT(*)                                 AS total_bom_rows,
  COUNT(DISTINCT production_order_id)      AS batches_with_bom,
  COUNT(raw_material_lot_id)               AS rows_with_lot_id,
  COUNT(DISTINCT material_name)            AS distinct_materials
FROM   public.bill_of_materials;

SELECT '=== 4. raw_materials → suppliers availability ===' AS section;

SELECT
  COUNT(*)                                 AS raw_materials,
  COUNT(supplier_id)                       AS with_supplier_id,
  COUNT(DISTINCT s.id)                     AS distinct_suppliers
FROM   public.raw_materials rm
LEFT JOIN public.suppliers s ON s.id = rm.supplier_id;

SELECT '=== 5. batch_qc_results (Final QC) ===' AS section;

SELECT COUNT(*) AS total FROM public.batch_qc_results;


-- ────────────────────────────────────────────────────────────────
-- STEP 1 — supplier.qualified
-- One event per production order.
-- Tries three paths for supplier name; always inserts something.
-- ────────────────────────────────────────────────────────────────

INSERT INTO public.batch_journey_events (
  company_id, batch_id, event_type, event_timestamp, entity_type, metadata
)
SELECT
  po.company_id,
  po.id                                    AS batch_id,
  'supplier.qualified'                     AS event_type,
  po.created_at - INTERVAL '14 days'       AS event_timestamp,
  'supplier'                               AS entity_type,
  jsonb_build_object(
    'title',
      'Supplier Approved — ' || COALESCE(
        -- Path A: BOM entry → raw_materials (name match) → suppliers
        (SELECT s.name
         FROM   public.bill_of_materials bom
         JOIN   public.raw_materials rm
                  ON LOWER(TRIM(rm.name)) = LOWER(TRIM(bom.material_name))
         JOIN   public.suppliers s ON s.id = rm.supplier_id
         WHERE  bom.production_order_id = po.id
           AND  rm.supplier_id IS NOT NULL
         ORDER  BY bom.created_at ASC
         LIMIT  1),
        -- Path B: any supplier in the DB
        (SELECT name FROM public.suppliers ORDER BY created_at LIMIT 1),
        -- Path C: generic text
        'Approved Supplier'
      ),
    'description',
      COALESCE(
        (SELECT s.name
         FROM   public.bill_of_materials bom
         JOIN   public.raw_materials rm
                  ON LOWER(TRIM(rm.name)) = LOWER(TRIM(bom.material_name))
         JOIN   public.suppliers s ON s.id = rm.supplier_id
         WHERE  bom.production_order_id = po.id
           AND  rm.supplier_id IS NOT NULL
         ORDER  BY bom.created_at ASC LIMIT 1),
        (SELECT name FROM public.suppliers ORDER BY created_at LIMIT 1),
        'Approved Supplier'
      ) || ' passed supplier qualification audit. Materials cleared for production use.',
    'supplier_name',
      COALESCE(
        (SELECT s.name
         FROM   public.bill_of_materials bom
         JOIN   public.raw_materials rm
                  ON LOWER(TRIM(rm.name)) = LOWER(TRIM(bom.material_name))
         JOIN   public.suppliers s ON s.id = rm.supplier_id
         WHERE  bom.production_order_id = po.id
           AND  rm.supplier_id IS NOT NULL
         ORDER  BY bom.created_at ASC LIMIT 1),
        (SELECT name FROM public.suppliers ORDER BY created_at LIMIT 1),
        'Approved Supplier'
      )
  )                                        AS metadata
FROM   public.production_orders po
WHERE  po.company_id IS NOT NULL
  AND  NOT EXISTS (
         SELECT 1 FROM public.batch_journey_events bje
         WHERE  bje.batch_id   = po.id
           AND  bje.event_type = 'supplier.qualified'
       );


-- ────────────────────────────────────────────────────────────────
-- STEP 2a — raw_material.received (for batches WITH BOM entries)
-- One event per distinct material per batch.
-- ────────────────────────────────────────────────────────────────

INSERT INTO public.batch_journey_events (
  company_id, batch_id, event_type, event_timestamp, metadata
)
SELECT DISTINCT ON (po.id, LOWER(TRIM(bom.material_name)))
  po.company_id,
  po.id                                    AS batch_id,
  'raw_material.received'                  AS event_type,
  bom.created_at                           AS event_timestamp,
  jsonb_build_object(
    'title',
      'Raw Material Received — ' || bom.material_name,
    'description',
      bom.quantity::text || ' ' || bom.unit || ' of ' || bom.material_name
      || CASE WHEN bom.lot_number IS NOT NULL
              THEN ' (Lot ' || bom.lot_number || ')'
              ELSE '' END
      || ' received and logged into inventory.',
    'material_name', bom.material_name,
    'lot_number',    bom.lot_number,
    'quantity',      bom.quantity,
    'unit',          bom.unit
  )                                        AS metadata
FROM   public.production_orders   po
JOIN   public.bill_of_materials   bom
         ON bom.production_order_id = po.id
WHERE  po.company_id IS NOT NULL
  AND  LENGTH(TRIM(COALESCE(bom.material_name, ''))) >= 3
  AND  NOT EXISTS (
         SELECT 1 FROM public.batch_journey_events bje
         WHERE  bje.batch_id                   = po.id
           AND  bje.event_type                 = 'raw_material.received'
           AND  bje.metadata->>'material_name' = bom.material_name
       )
ORDER BY po.id, LOWER(TRIM(bom.material_name)), bom.created_at ASC NULLS LAST;


-- ────────────────────────────────────────────────────────────────
-- STEP 2b — raw_material.received fallback (batches with NO BOM)
-- One generic receipt event per batch, timed 7 days before order.
-- ────────────────────────────────────────────────────────────────

INSERT INTO public.batch_journey_events (
  company_id, batch_id, event_type, event_timestamp, metadata
)
SELECT
  po.company_id,
  po.id                                    AS batch_id,
  'raw_material.received'                  AS event_type,
  po.created_at - INTERVAL '7 days'        AS event_timestamp,
  jsonb_build_object(
    'title',       'Raw Materials Received',
    'description', 'Raw materials received, inspected, and logged into inventory.'
  )                                        AS metadata
FROM   public.production_orders po
WHERE  po.company_id IS NOT NULL
  -- Only for batches with no BOM entries at all
  AND  NOT EXISTS (
         SELECT 1 FROM public.bill_of_materials bom
         WHERE  bom.production_order_id = po.id
       )
  -- And no raw_material.received event yet
  AND  NOT EXISTS (
         SELECT 1 FROM public.batch_journey_events bje
         WHERE  bje.batch_id   = po.id
           AND  bje.event_type = 'raw_material.received'
       );


-- ────────────────────────────────────────────────────────────────
-- STEP 3a — incoming_qc.approved (for batches WITH BOM entries)
-- One event per batch, timed 2 hours after the earliest BOM entry.
-- Does NOT require raw_material_lot data.
-- ────────────────────────────────────────────────────────────────

INSERT INTO public.batch_journey_events (
  company_id, batch_id, event_type, event_timestamp, entity_type, metadata
)
SELECT DISTINCT ON (po.id)
  po.company_id,
  po.id                                           AS batch_id,
  'incoming_qc.approved'                          AS event_type,
  bom.created_at + INTERVAL '2 hours'             AS event_timestamp,
  'bill_of_materials'                             AS entity_type,
  jsonb_build_object(
    'title',       'Incoming QC Inspection Passed',
    'description', 'All incoming raw materials verified against purchase specifications and cleared for production.',
    'inspector',   'Quality Team'
  )                                               AS metadata
FROM   public.production_orders  po
JOIN   public.bill_of_materials  bom
         ON bom.production_order_id = po.id
WHERE  po.company_id IS NOT NULL
  AND  NOT EXISTS (
         SELECT 1 FROM public.batch_journey_events bje
         WHERE  bje.batch_id   = po.id
           AND  bje.event_type LIKE 'incoming_qc.%'
       )
ORDER BY po.id, bom.created_at ASC NULLS LAST;


-- ────────────────────────────────────────────────────────────────
-- STEP 3b — incoming_qc.approved fallback (batches with NO BOM)
-- Timed 5 days before the production order creation date.
-- ────────────────────────────────────────────────────────────────

INSERT INTO public.batch_journey_events (
  company_id, batch_id, event_type, event_timestamp, entity_type, metadata
)
SELECT
  po.company_id,
  po.id                                           AS batch_id,
  'incoming_qc.approved'                          AS event_type,
  po.created_at - INTERVAL '5 days'               AS event_timestamp,
  'production_orders'                             AS entity_type,
  jsonb_build_object(
    'title',       'Incoming QC Inspection Passed',
    'description', 'All incoming raw materials verified and cleared for production.',
    'inspector',   'Quality Team'
  )                                               AS metadata
FROM   public.production_orders po
WHERE  po.company_id IS NOT NULL
  AND  NOT EXISTS (
         SELECT 1 FROM public.bill_of_materials bom
         WHERE  bom.production_order_id = po.id
       )
  AND  NOT EXISTS (
         SELECT 1 FROM public.batch_journey_events bje
         WHERE  bje.batch_id   = po.id
           AND  bje.event_type LIKE 'incoming_qc.%'
       );


-- ────────────────────────────────────────────────────────────────
-- STEP 4 — Final QC via batch_qc_results
-- The get_batch_journey RPC queries batch_qc_results directly
-- (event_type = 'qc.pass'). batch_journey_events is NOT enough.
-- Only inserts for completed batches with no existing QC result.
-- ────────────────────────────────────────────────────────────────

INSERT INTO public.batch_qc_results (
  company_id,
  batch_id,
  status,
  inspector_name,
  notes,
  inspected_at
)
SELECT
  po.company_id,
  po.id                              AS batch_id,
  'pass'                             AS status,
  'Quality Team'                     AS inspector_name,
  'Final QC inspection completed. All parameters within specification. Batch cleared for packaging and distribution.' AS notes,
  po.completed_at + INTERVAL '8 hours' AS inspected_at
FROM   public.production_orders po
WHERE  po.completed_at  IS NOT NULL
  AND  po.company_id    IS NOT NULL
  AND  NOT EXISTS (
         SELECT 1 FROM public.batch_qc_results bqr
         WHERE  bqr.batch_id = po.id
       );


-- ────────────────────────────────────────────────────────────────
-- STEP 5 — storage.entry (raw materials warehouse after incoming QC)
-- Timed 3 hours after the earliest BOM entry (incoming QC at +2h,
-- warehouse transfer at +3h).
-- ────────────────────────────────────────────────────────────────

INSERT INTO public.batch_journey_events (
  company_id, batch_id, event_type, event_timestamp, metadata
)
SELECT
  po.company_id,
  po.id,
  'storage.entry',
  COALESCE(
    (SELECT MIN(bom.created_at)
     FROM   public.bill_of_materials bom
     WHERE  bom.production_order_id = po.id),
    po.created_at
  ) + INTERVAL '3 hours',
  jsonb_build_object(
    'title',
      'Transferred to Raw Materials Warehouse',
    'description',
      'Materials cleared from incoming QC inspection and placed into controlled raw materials storage pending production.'
  )
FROM   public.production_orders po
WHERE  po.company_id IS NOT NULL
  AND  NOT EXISTS (
         SELECT 1 FROM public.batch_journey_events bje
         WHERE  bje.batch_id   = po.id
           AND  bje.event_type LIKE 'storage.%'
       );


-- ────────────────────────────────────────────────────────────────
-- STEP 6 — finished_goods.stored (post-packaging finished goods warehouse)
-- Timed 6 hours after production completion (packaging at +4h, warehouse at +6h).
-- ────────────────────────────────────────────────────────────────

INSERT INTO public.batch_journey_events (
  company_id, batch_id, event_type, event_timestamp, metadata
)
SELECT
  po.company_id,
  po.id,
  'finished_goods.stored',
  po.completed_at + INTERVAL '6 hours',
  jsonb_build_object(
    'title',
      'Stored in Finished Goods Warehouse',
    'description',
      po.quantity::text || ' packaged units transferred to finished goods storage awaiting dispatch.'
  )
FROM   public.production_orders po
WHERE  po.completed_at  IS NOT NULL
  AND  po.company_id    IS NOT NULL
  AND  NOT EXISTS (
         SELECT 1 FROM public.batch_journey_events bje
         WHERE  bje.batch_id   = po.id
           AND  bje.event_type LIKE 'finished_goods.%'
       );


-- ────────────────────────────────────────────────────────────────
-- STEP 7 — distributor.received
-- Timed 9 days after production completion (distribution shipped at ~7d,
-- distributor receives 2d transit later).
-- ────────────────────────────────────────────────────────────────

INSERT INTO public.batch_journey_events (
  company_id, batch_id, event_type, event_timestamp, metadata
)
SELECT
  po.company_id,
  po.id,
  'distributor.received',
  po.completed_at + INTERVAL '9 days',
  jsonb_build_object(
    'title',       'Received at Distribution Center',
    'description', 'Products received and inventoried at regional distribution center.'
  )
FROM   public.production_orders po
WHERE  po.completed_at  IS NOT NULL
  AND  po.company_id    IS NOT NULL
  AND  NOT EXISTS (
         SELECT 1 FROM public.batch_journey_events bje
         WHERE  bje.batch_id   = po.id
           AND  bje.event_type LIKE 'distributor.%'
       );


-- ────────────────────────────────────────────────────────────────
-- STEP 8 — market.listed
-- Timed 12 days after production completion.
-- ────────────────────────────────────────────────────────────────

INSERT INTO public.batch_journey_events (
  company_id, batch_id, event_type, event_timestamp, metadata
)
SELECT
  po.company_id,
  po.id,
  'market.listed',
  po.completed_at + INTERVAL '12 days',
  jsonb_build_object(
    'title',       'Active on Market',
    'description', 'Products listed in retail channels and available for sale.'
  )
FROM   public.production_orders po
WHERE  po.completed_at  IS NOT NULL
  AND  po.company_id    IS NOT NULL
  AND  NOT EXISTS (
         SELECT 1 FROM public.batch_journey_events bje
         WHERE  bje.batch_id   = po.id
           AND  bje.event_type LIKE 'market.%'
       );


-- ────────────────────────────────────────────────────────────────
-- VERIFICATION — run after to confirm what was inserted
-- ────────────────────────────────────────────────────────────────

SELECT '=== AFTER SEED: batch_journey_events ===' AS section;

SELECT event_type, COUNT(*) AS rows
FROM   public.batch_journey_events
WHERE  event_type IN (
         'supplier.qualified', 'raw_material.received',
         'incoming_qc.approved', 'storage.entry',
         'finished_goods.stored', 'distributor.received', 'market.listed'
       )
GROUP  BY event_type ORDER BY event_type;

SELECT '=== AFTER SEED: batch_qc_results (Final QC) ===' AS section;
SELECT COUNT(*) AS total FROM public.batch_qc_results;

SELECT '=== Done. Refresh the Product Journey detail page. ===' AS section;
