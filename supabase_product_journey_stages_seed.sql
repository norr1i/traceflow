-- ================================================================
-- TraceFlow — Product Journey: New Stage Sample Data (v2)
-- File: supabase_product_journey_stages_seed.sql
-- ================================================================
--
-- Fixes the broken v1 seed, which used
--   JOIN raw_material_lots ON raw_material_lot_id
-- That column is NULL for every existing BOM row (the Phase 1A
-- migration explicitly documents this: "Every existing BOM row
-- retains raw_material_lot_id = NULL and is completely unaffected").
-- Zero rows were inserted by v1.
--
-- This v2 seed works with the actual data:
--   • bill_of_materials has: material_name (text), lot_number (text),
--     quantity, unit, created_at, production_order_id, company_id
--     and a nullable raw_material_lot_id (always NULL for seeded data)
--   • raw_materials has: name (text), supplier_id → suppliers.id
--   • batch_qc_results has: batch_id (uuid), status, inspector_name,
--     notes, inspected_at, company_id
--
-- What this inserts:
--   1. batch_journey_events: supplier.qualified
--      — joins BOM → raw_materials (by name) → suppliers
--   2. batch_journey_events: raw_material.received
--      — one event per distinct material in BOM
--   3. batch_journey_events: incoming_qc.approved
--      — one per batch with BOM entries
--   4. batch_qc_results: pass
--      — one per completed batch with no existing QC record
--
-- Packaging events are synthesized in the UI from order.completed_at,
-- so they are NOT seeded here (already working correctly).
--
-- All inserts are idempotent: a NOT EXISTS guard prevents duplicates.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ================================================================


-- ── STEP 1: Diagnostics ──────────────────────────────────────────
-- Run this block first to confirm the state of your data.
-- The results tell you which stages have data and which are empty.

SELECT '=== Current batch_journey_events ===' AS info;

SELECT
  event_type,
  COUNT(*) AS row_count
FROM   public.batch_journey_events
WHERE  event_type IN (
  'supplier.qualified',
  'raw_material.received',
  'incoming_qc.approved',
  'packaging.completed'
)
GROUP  BY event_type
ORDER  BY event_type;

SELECT '=== batch_qc_results (Final QC) ===' AS info;
SELECT COUNT(*) AS total_qc_results FROM public.batch_qc_results;

SELECT '=== Production orders with BOM entries ===' AS info;
SELECT
  po.status,
  COUNT(DISTINCT po.id)  AS batch_count,
  COUNT(bom.id)          AS bom_entries
FROM   public.production_orders po
LEFT JOIN public.bill_of_materials bom ON bom.production_order_id = po.id
GROUP  BY po.status;

SELECT '=== raw_materials → suppliers join check ===' AS info;
SELECT
  COUNT(*)                                              AS total_raw_materials,
  COUNT(rm.supplier_id)                                 AS with_supplier_id,
  COUNT(DISTINCT s.id)                                  AS distinct_suppliers
FROM   public.raw_materials rm
LEFT JOIN public.suppliers s ON s.id = rm.supplier_id;

SELECT '=== BOM material_name → raw_materials name match check ===' AS info;
SELECT
  COUNT(DISTINCT bom.material_name) AS distinct_bom_materials,
  COUNT(DISTINCT rm.id)             AS materials_matched_by_name
FROM   public.bill_of_materials bom
LEFT JOIN public.raw_materials rm
  ON LOWER(TRIM(rm.name)) = LOWER(TRIM(bom.material_name));


-- ── STEP 2: Supplier Qualification Events ────────────────────────
-- Join path: bill_of_materials → raw_materials (name match) → suppliers
-- Falls back gracefully: if no name match exists, 0 rows are inserted
-- and the UI still synthesizes supplier events from BOM supplier data.

INSERT INTO public.batch_journey_events (
  company_id,
  batch_id,
  event_type,
  event_timestamp,
  entity_type,
  entity_id,
  metadata
)
SELECT DISTINCT ON (po.id, s.id)
  po.company_id,
  po.id                              AS batch_id,
  'supplier.qualified'               AS event_type,
  bom.created_at - INTERVAL '14 days' AS event_timestamp,
  'supplier'                         AS entity_type,
  s.id                               AS entity_id,
  jsonb_build_object(
    'title',         'Supplier Approved — ' || s.name,
    'description',   s.name || ' passed supplier qualification audit. Materials cleared for production use.',
    'supplier_name', s.name,
    'supplier_id',   s.id::text
  )                                  AS metadata
FROM   public.production_orders    po
JOIN   public.bill_of_materials    bom ON bom.production_order_id  = po.id
JOIN   public.raw_materials        rm  ON LOWER(TRIM(rm.name))    = LOWER(TRIM(bom.material_name))
JOIN   public.suppliers            s   ON s.id                    = rm.supplier_id
WHERE  s.name IS NOT NULL
  AND  po.company_id IS NOT NULL
  AND  NOT EXISTS (
    SELECT 1
    FROM   public.batch_journey_events bje
    WHERE  bje.batch_id   = po.id
      AND  bje.event_type = 'supplier.qualified'
      AND  bje.entity_id  = s.id
  )
ORDER BY po.id, s.id, bom.created_at ASC NULLS LAST;

SELECT 'supplier.qualified rows inserted: ' || ROW_COUNT()::text AS result;


-- ── STEP 3: Raw Material Received Events ─────────────────────────
-- One event per distinct material per batch.
-- Timestamp: the BOM entry creation time (when the material was
-- recorded against the batch — closest proxy for receipt date).

INSERT INTO public.batch_journey_events (
  company_id,
  batch_id,
  event_type,
  event_timestamp,
  metadata
)
SELECT DISTINCT ON (po.id, bom.material_name)
  po.company_id,
  po.id                  AS batch_id,
  'raw_material.received' AS event_type,
  bom.created_at         AS event_timestamp,
  jsonb_build_object(
    'title',         'Raw Material Received — ' || bom.material_name,
    'description',   bom.quantity::text || ' ' || bom.unit || ' of ' || bom.material_name
                     || CASE WHEN bom.lot_number IS NOT NULL
                             THEN ' (Lot ' || bom.lot_number || ')'
                             ELSE '' END
                     || ' received and logged.',
    'material_name', bom.material_name,
    'lot_number',    bom.lot_number,
    'quantity',      bom.quantity,
    'unit',          bom.unit
  )                      AS metadata
FROM   public.production_orders  po
JOIN   public.bill_of_materials  bom ON bom.production_order_id = po.id
WHERE  po.company_id IS NOT NULL
  AND  LENGTH(TRIM(bom.material_name)) >= 3
  AND  NOT EXISTS (
    SELECT 1
    FROM   public.batch_journey_events bje
    WHERE  bje.batch_id                  = po.id
      AND  bje.event_type                = 'raw_material.received'
      AND  bje.metadata->>'material_name' = bom.material_name
  )
ORDER BY po.id, bom.material_name, bom.created_at ASC NULLS LAST;


-- ── STEP 4: Incoming QC Inspection Events ────────────────────────
-- One approved event per batch that has at least one BOM entry.
-- Timestamp: 2 hours after the earliest BOM entry creation time.
-- (No raw_material_lot data is needed — uses BOM created_at.)

INSERT INTO public.batch_journey_events (
  company_id,
  batch_id,
  event_type,
  event_timestamp,
  entity_type,
  metadata
)
SELECT DISTINCT ON (po.id)
  po.company_id,
  po.id                                        AS batch_id,
  'incoming_qc.approved'                       AS event_type,
  bom.created_at + INTERVAL '2 hours'          AS event_timestamp,
  'bill_of_materials'                          AS entity_type,
  jsonb_build_object(
    'title',       'Incoming QC Inspection Passed',
    'description', 'All incoming raw materials verified against purchase orders and cleared for production.',
    'inspector',   'Quality Team'
  )                                            AS metadata
FROM   public.production_orders  po
JOIN   public.bill_of_materials  bom ON bom.production_order_id = po.id
WHERE  po.company_id IS NOT NULL
  AND  NOT EXISTS (
    SELECT 1
    FROM   public.batch_journey_events bje
    WHERE  bje.batch_id   = po.id
      AND  bje.event_type LIKE 'incoming_qc.%'
  )
ORDER BY po.id, bom.created_at ASC NULLS LAST;


-- ── STEP 5: Final QC Results ─────────────────────────────────────
-- Inserts into batch_qc_results (queried directly by get_batch_journey RPC).
-- Only for completed batches with no existing QC record.
-- Timestamp: 8 hours after production completion.

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
  po.id                   AS batch_id,
  'pass'                  AS status,
  'Quality Team'          AS inspector_name,
  'Final QC inspection completed. All parameters within specification. Batch cleared for packaging.' AS notes,
  po.completed_at + INTERVAL '8 hours' AS inspected_at
FROM   public.production_orders po
WHERE  po.completed_at  IS NOT NULL
  AND  po.company_id    IS NOT NULL
  AND  NOT EXISTS (
    SELECT 1
    FROM   public.batch_qc_results bqr
    WHERE  bqr.batch_id = po.id
  );


-- ── STEP 6: Verification ─────────────────────────────────────────
-- Run after all inserts to confirm what was created.

SELECT '=== After seed: batch_journey_events ===' AS info;

SELECT
  event_type,
  COUNT(*) AS total_rows
FROM   public.batch_journey_events
WHERE  event_type IN (
  'supplier.qualified',
  'raw_material.received',
  'incoming_qc.approved',
  'packaging.completed'
)
GROUP  BY event_type
ORDER  BY event_type;

SELECT '=== After seed: batch_qc_results ===' AS info;
SELECT COUNT(*) AS total_qc_results FROM public.batch_qc_results;

SELECT '=== Done. Refresh the Product Journey page to see all stages. ===' AS info;
