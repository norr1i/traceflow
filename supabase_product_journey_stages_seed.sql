-- ================================================================
-- TraceFlow — Product Journey: New Stage Sample Data
-- File: supabase_product_journey_stages_seed.sql
-- ================================================================
-- Inserts realistic batch_journey_events for four new timeline stages:
--
--   1. supplier.qualified   — Supplier Qualification
--   2. incoming_qc.approved — Incoming QC Inspection
--   3. packaging.completed  — Packaging
--
-- These are inserted only when no equivalent event already exists
-- for that batch, making the script idempotent.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
--
-- PREREQUISITES:
--   • supabase_traceability_v1.sql already applied
--     (batch_journey_events table exists)
--   • raw_material_lots.supplier_id → suppliers FK exists
--   • bill_of_materials.raw_material_lot_id FK exists
-- ================================================================


-- ── 1. Supplier Qualification Events ─────────────────────────────
-- One event per (production_order, supplier) pair.
-- Timestamp: 14 days before the earliest material receipt from that
-- supplier — qualifications always precede material delivery.

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
  po.id                                                                  AS batch_id,
  'supplier.qualified'                                                   AS event_type,
  COALESCE(rml.received_at, po.created_at) - INTERVAL '14 days'        AS event_timestamp,
  'supplier'                                                             AS entity_type,
  s.id                                                                   AS entity_id,
  jsonb_build_object(
    'title',         'Supplier Approved — ' || s.name,
    'description',   s.name || ' passed supplier qualification audit. Materials cleared for production use.',
    'supplier_name', s.name,
    'supplier_id',   s.id::text
  )                                                                      AS metadata
FROM   public.production_orders  po
JOIN   public.bill_of_materials  bom ON bom.production_order_id     = po.id
JOIN   public.raw_material_lots  rml ON rml.id                      = bom.raw_material_lot_id
JOIN   public.suppliers          s   ON s.id                        = rml.supplier_id
WHERE  s.name IS NOT NULL
  AND  NOT EXISTS (
    SELECT 1
    FROM   public.batch_journey_events bje
    WHERE  bje.batch_id   = po.id
      AND  bje.event_type = 'supplier.qualified'
      AND  bje.entity_id  = s.id
  )
ORDER BY po.id, s.id, rml.received_at ASC NULLS LAST;


-- ── 2. Incoming QC Inspection Events ─────────────────────────────
-- One approved event per production_order that has raw material lots
-- with a non-rejected status. Timestamped 2 hours after the earliest
-- lot receipt (inspection occurs same day materials arrive).

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
  po.id                                                                        AS batch_id,
  'incoming_qc.approved'                                                       AS event_type,
  COALESCE(rml.received_at, po.created_at) + INTERVAL '2 hours'              AS event_timestamp,
  'raw_material_lot'                                                           AS entity_type,
  jsonb_build_object(
    'title',       'Incoming QC Inspection Passed',
    'description', 'All incoming raw material lots verified and cleared for production.',
    'inspector',   'Quality Team'
  )                                                                            AS metadata
FROM   public.production_orders  po
JOIN   public.bill_of_materials  bom ON bom.production_order_id = po.id
JOIN   public.raw_material_lots  rml ON rml.id                  = bom.raw_material_lot_id
WHERE  LOWER(COALESCE(rml.status, '')) NOT IN ('rejected', 'expired', 'quarantine')
  AND  rml.received_at IS NOT NULL
  AND  NOT EXISTS (
    SELECT 1
    FROM   public.batch_journey_events bje
    WHERE  bje.batch_id   = po.id
      AND  bje.event_type LIKE 'incoming_qc.%'
  )
ORDER BY po.id, rml.received_at ASC NULLS LAST;


-- ── 3. Packaging Events ───────────────────────────────────────────
-- One packaging.completed event per production_order that has
-- finished production (completed_at IS NOT NULL).
-- Timestamp: 4 hours after production completion.

INSERT INTO public.batch_journey_events (
  company_id,
  batch_id,
  event_type,
  event_timestamp,
  metadata
)
SELECT
  po.company_id,
  po.id                                                                       AS batch_id,
  'packaging.completed'                                                        AS event_type,
  po.completed_at + INTERVAL '4 hours'                                        AS event_timestamp,
  jsonb_build_object(
    'title',       'Packaging Completed',
    'description', po.quantity::text || ' units packaged, labelled, and sealed for distribution.',
    'quantity',    po.quantity
  )                                                                            AS metadata
FROM   public.production_orders po
WHERE  po.completed_at IS NOT NULL
  AND  NOT EXISTS (
    SELECT 1
    FROM   public.batch_journey_events bje
    WHERE  bje.batch_id   = po.id
      AND  bje.event_type LIKE 'packaging.%'
  );


-- ── Verification ──────────────────────────────────────────────────
-- Run these selects after applying to confirm data was inserted:

SELECT
  event_type,
  COUNT(*) AS inserted
FROM   public.batch_journey_events
WHERE  event_type IN ('supplier.qualified', 'incoming_qc.approved', 'packaging.completed')
GROUP  BY event_type
ORDER  BY event_type;
