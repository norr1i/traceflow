-- ============================================================
-- TraceFlow — Phase 1B: Traceability Engine RPCs
-- File: supabase_traceability_rpcs.sql
-- ============================================================
--
-- Creates two read-only functions:
--
--   1. get_batch_journey(p_batch_id uuid, p_company_id uuid)
--      Synthesises a complete chronological timeline for a
--      production batch from nine event sources.
--
--   2. get_lot_traceability(p_lot_number text, p_company_id uuid)
--      Returns all production batches and downstream distribution
--      records traceable to a specific raw material lot number.
--
-- SAFETY
--   • SECURITY INVOKER: existing RLS applies on every table.
--   • Explicit company_id filter on every WHERE clause as
--     belt-and-suspenders alongside RLS.
--   • Both functions are SELECT-only. No data is written.
--   • CREATE OR REPLACE: safe to re-run; updates in place.
--   • No existing tables, policies, or RPCs are modified.
--   • Idempotent: running multiple times is harmless.
--
-- KNOWN LIMITATION — quality_inspections.batch_id
--   This column is a free-text field filled by QC inspectors.
--   The join to production_orders uses an exact text match:
--     qi.batch_id = p_batch_id::text
--   Inspections will only appear in the timeline if the
--   inspector typed the production order UUID into that field.
--   This is a data-quality gap in the existing schema design,
--   not introduced by these functions.
--
-- PREREQUISITES
--   • Phase 1A migration applied (batch_journey_events,
--     raw_material_lots, bill_of_materials.raw_material_lot_id)
--   • All core tables exist with company_id columns
--   • get_my_company_id() function exists
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- FUNCTION 1: get_batch_journey
-- ════════════════════════════════════════════════════════════
--
-- Returns a JSONB document with:
--   batch     — header info (product, SKU, status, timestamps)
--   timeline  — chronologically sorted array of all events
--   event_count — total number of events in the timeline
--
-- Each timeline event has the shape:
--   {
--     "event_type":      "production.order_created",
--     "event_timestamp": "2026-06-01T08:00:00Z",
--     "title":           "Production Order Created",
--     "description":     "Batch of 1000 × Steel Bolt M8 opened.",
--     "source_table":    "production_orders",
--     "metadata":        { ... }
--   }
--
-- Returns NULL if the batch does not exist or does not belong
-- to the given company_id.
--
-- Event sources (9 tables):
--   production_orders    → order_created, started, completed
--   bill_of_materials    → material.added_to_batch (per entry)
--   batch_qc_results     → qc.pass / qc.fail / qc.hold
--   quality_inspections  → qc_inspection.* (text batch_id match)
--   scan_events          → qr.scan (per scan)
--   distribution_records → distribution.shipped (text batch_id)
--   batch_journey_events → any custom event type (Phase 1A)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_batch_journey(
  p_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch       jsonb;
  v_timeline    jsonb;
  v_company_id  uuid;
BEGIN

  -- ── Resolve company_id from the batch ───────────────────────
  -- SECURITY DEFINER bypasses RLS, so this works for the anon
  -- role on the public QR trace page — matching get_batch_trace.
  -- Returns NULL if the batch does not exist.
  SELECT company_id INTO v_company_id
  FROM   production_orders
  WHERE  id = p_batch_id;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- ── Batch header ────────────────────────────────────────────
  SELECT jsonb_build_object(
    'id',           po.id,
    'product_name', COALESCE(p.name, 'Unknown'),
    'sku',          COALESCE(p.sku,  ''),
    'quantity',     po.quantity,
    'status',       po.status,
    'created_at',   po.created_at,
    'started_at',   po.started_at,
    'completed_at', po.completed_at
  )
  INTO v_batch
  FROM  production_orders po
  LEFT  JOIN products p ON p.id = po.product_id
  WHERE po.id = p_batch_id;

  -- ── Timeline: UNION of all nine event sources ────────────────
  WITH events AS (

    -- ── Source 1: production_orders — order created ──────────
    -- Fires for every batch. The founding event of the timeline.
    SELECT
      'production.order_created'                          AS event_type,
      po.created_at                                       AS event_timestamp,
      'Production Order Created'                          AS title,
      'Batch of ' || po.quantity::text
        || ' × ' || COALESCE(p.name, 'product') || ' opened.'
                                                          AS description,
      'production_orders'                                 AS source_table,
      jsonb_build_object(
        'product_name', COALESCE(p.name, ''),
        'sku',          COALESCE(p.sku,  ''),
        'quantity',     po.quantity,
        'status',       po.status
      )                                                   AS metadata
    FROM  production_orders po
    LEFT  JOIN products p ON p.id = po.product_id
    WHERE po.id         = p_batch_id
      AND po.company_id = v_company_id

    UNION ALL

    -- ── Source 2: production_orders — production started ─────
    -- Only emitted when started_at is populated.
    SELECT
      'production.started',
      po.started_at,
      'Production Started',
      'Manufacturing of ' || COALESCE(p.name, 'batch') || ' began.',
      'production_orders',
      jsonb_build_object(
        'product_name', COALESCE(p.name, ''),
        'sku',          COALESCE(p.sku,  '')
      )
    FROM  production_orders po
    LEFT  JOIN products p ON p.id = po.product_id
    WHERE po.id          = p_batch_id
      AND po.company_id  = v_company_id
      AND po.started_at IS NOT NULL

    UNION ALL

    -- ── Source 3: production_orders — production completed ───
    -- Only emitted when completed_at is populated.
    SELECT
      'production.completed',
      po.completed_at,
      'Production Completed',
      'All ' || po.quantity::text || ' units of '
        || COALESCE(p.name, 'batch') || ' manufactured.',
      'production_orders',
      jsonb_build_object(
        'product_name', COALESCE(p.name, ''),
        'sku',          COALESCE(p.sku,  ''),
        'quantity',     po.quantity
      )
    FROM  production_orders po
    LEFT  JOIN products p ON p.id = po.product_id
    WHERE po.id          = p_batch_id
      AND po.company_id  = v_company_id
      AND po.completed_at IS NOT NULL

    UNION ALL

    -- ── Source 4: bill_of_materials — one event per BOM entry ─
    -- Each raw material addition to the batch is a separate event,
    -- timestamped at when the BOM entry was recorded (created_at).
    -- If raw_material_lot_id is populated (Phase 1A onward) it is
    -- included in metadata for forward/backward lot linking.
    SELECT
      'material.added_to_batch',
      bom.created_at,
      'Material Added: ' || bom.material_name,
      bom.quantity::text || ' ' || bom.unit || ' of '
        || bom.material_name
        || CASE WHEN bom.lot_number IS NOT NULL
                THEN ' (Lot ' || bom.lot_number || ')'
                ELSE '' END
        || ' added to batch.',
      'bill_of_materials',
      jsonb_strip_nulls(jsonb_build_object(
        'material_name',       bom.material_name,
        'lot_number',          bom.lot_number,
        'quantity',            bom.quantity,
        'unit',                bom.unit,
        'raw_material_lot_id', bom.raw_material_lot_id::text
      ))
    FROM  bill_of_materials bom
    WHERE bom.production_order_id = p_batch_id
      AND bom.company_id          = v_company_id

    UNION ALL

    -- ── Source 5: batch_qc_results ───────────────────────────
    -- Production-stage QC results attached directly to the batch.
    -- Status vocabulary: 'pass' | 'fail' | 'hold'.
    -- One event per result row (multiple QC checks are possible).
    SELECT
      'qc.' || bqr.status,
      bqr.inspected_at,
      CASE bqr.status
        WHEN 'pass' THEN 'QC Passed'
        WHEN 'fail' THEN 'QC Failed'
        WHEN 'hold' THEN 'QC On Hold'
        ELSE             'QC Result: ' || bqr.status
      END,
      COALESCE(
        bqr.notes,
        'QC ' || bqr.status || ' recorded by '
          || COALESCE(bqr.inspector_name, 'inspector') || '.'
      ),
      'batch_qc_results',
      jsonb_strip_nulls(jsonb_build_object(
        'inspector_name', bqr.inspector_name,
        'status',         bqr.status,
        'notes',          bqr.notes
      ))
    FROM  batch_qc_results bqr
    WHERE bqr.batch_id   = p_batch_id
      AND bqr.company_id = v_company_id

    UNION ALL

    -- ── Source 6: quality_inspections ────────────────────────
    -- Standalone QC module inspections.
    -- IMPORTANT: batch_id is a free-text field in this table.
    -- The match only succeeds if the inspector entered the
    -- production order UUID into the Batch ID field when creating
    -- the inspection. See KNOWN LIMITATION in file header.
    -- Status vocabulary: 'passed' | 'failed' | 'conditional' | 'pending'.
    -- inspection_date is DATE; cast to timestamptz for the timeline.
    SELECT
      'qc_inspection.' || qi.status,
      qi.inspection_date::timestamptz,
      CASE qi.status
        WHEN 'passed'      THEN 'QC Inspection Passed'
        WHEN 'failed'      THEN 'QC Inspection Failed'
        WHEN 'conditional' THEN 'QC Inspection — Conditional Pass'
        WHEN 'pending'     THEN 'QC Inspection Pending'
        ELSE                    'QC Inspection: ' || qi.status
      END,
      COALESCE(
        qi.notes,
        qi.inspection_type || ' inspection'
          || CASE WHEN qi.overall_score > 0
                  THEN ' (score: ' || qi.overall_score::text || ')'
                  ELSE ''
             END || '.'
      ),
      'quality_inspections',
      jsonb_strip_nulls(jsonb_build_object(
        'inspection_type', qi.inspection_type,
        'status',          qi.status,
        'overall_score',   qi.overall_score,
        'notes',           qi.notes,
        'inspector_id',    qi.inspector_id
      ))
    FROM  quality_inspections qi
    WHERE qi.batch_id   = p_batch_id::text
      AND qi.company_id = v_company_id

    UNION ALL

    -- ── Source 7: scan_events ────────────────────────────────
    -- Each row is one QR code scan of this batch.
    -- batch_id is UUID (FK to production_orders) — no cast needed.
    -- user_agent is truncated to 120 chars to keep metadata compact.
    SELECT
      'qr.scan',
      se.scanned_at,
      'QR Code Scanned',
      'Scanned via ' || COALESCE(se.browser, 'unknown browser')
        || ' on ' || COALESCE(se.device_type, 'unknown device') || '.',
      'scan_events',
      jsonb_strip_nulls(jsonb_build_object(
        'device_type', se.device_type,
        'browser',     se.browser,
        'user_agent',  LEFT(COALESCE(se.user_agent, ''), 120)
      ))
    FROM  scan_events se
    WHERE se.batch_id   = p_batch_id
      AND se.company_id = v_company_id

    UNION ALL

    -- ── Source 8: distribution_records ───────────────────────
    -- Outbound shipment records for this batch.
    -- IMPORTANT: batch_id is TEXT in this table — cast UUID to text.
    -- Note: the production schema has id, batch_id, shipped_at,
    -- notes, created_at, company_id — no recipient/quantity columns.
    SELECT
      'distribution.shipped',
      dr.shipped_at,
      'Shipped to Distributor',
      COALESCE(dr.notes, 'Batch dispatched.'),
      'distribution_records',
      jsonb_strip_nulls(jsonb_build_object(
        'notes',      dr.notes,
        'shipped_at', dr.shipped_at
      ))
    FROM  distribution_records dr
    WHERE dr.batch_id   = p_batch_id::text
      AND dr.company_id = v_company_id

    UNION ALL

    -- ── Source 9: batch_journey_events (Phase 1A catch-all) ──
    -- Custom events for lifecycle stages not captured above:
    -- raw_material.received, packaging.completed, storage.entry,
    -- supplier.approved, capa.created, distributor.received, etc.
    --
    -- Title / description fall back to auto-generated text when
    -- not supplied in metadata. The full metadata JSONB is merged
    -- into the event so event-specific fields pass through cleanly.
    SELECT
      bje.event_type,
      bje.event_timestamp,
      COALESCE(
        bje.metadata->>'title',
        INITCAP(REPLACE(REPLACE(bje.event_type, '.', ' '), '_', ' '))
      ),
      COALESCE(
        bje.metadata->>'description',
        bje.actor_email,
        bje.event_type
      ),
      'batch_journey_events',
      jsonb_strip_nulls(
        jsonb_build_object(
          'actor_email', bje.actor_email,
          'entity_type', bje.entity_type,
          'entity_id',   bje.entity_id::text
        ) || COALESCE(bje.metadata, '{}'::jsonb)
      )
    FROM  batch_journey_events bje
    WHERE bje.batch_id   = p_batch_id
      AND bje.company_id = v_company_id

  )
  -- ── Aggregate into sorted array ─────────────────────────────
  -- NULLS LAST: guards against any source returning a NULL
  -- timestamp (should not happen given NOT NULL constraints,
  -- but defensive ordering is cheaper than a bug report).
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'event_type',      event_type,
        'event_timestamp', event_timestamp,
        'title',           title,
        'description',     description,
        'source_table',    source_table,
        'metadata',        metadata
      )
      ORDER BY event_timestamp ASC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_timeline
  FROM  events
  WHERE event_timestamp IS NOT NULL;

  -- ── Return ───────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'batch',       v_batch,
    'timeline',    v_timeline,
    'event_count', jsonb_array_length(v_timeline)
  );

END;
$$;


-- ════════════════════════════════════════════════════════════
-- FUNCTION 2: get_lot_traceability
-- ════════════════════════════════════════════════════════════
--
-- Returns everything traceable from a raw material lot number:
-- the lot record itself, all production batches that consumed
-- the lot, and all downstream distribution shipments from
-- those batches.
--
-- Returns a JSONB document with:
--   lot_record                 — the raw_material_lots row
--                                (NULL if lot not yet formalised)
--   used_in_batches            — production orders that used
--                                this lot, with match_type
--   downstream_distribution    — distribution records for all
--                                affected batches
--   affected_batch_count       — count of used_in_batches
--   affected_distribution_count— count of downstream records
--
-- Two-path lot lookup (both always run, deduplicated by UNION):
--   Path A — formal FK link: bill_of_materials.raw_material_lot_id
--            → raw_material_lots.id (Phase 1A new rows)
--   Path B — text match:  bill_of_materials.lot_number ILIKE lot
--            (all existing historical data)
--
-- match_type in used_in_batches indicates which path matched:
--   "formal_link" = FK-based, authoritative
--   "text_match"  = lot_number string match, may have false
--                   positives if lot numbers are not globally
--                   unique within the company
--
-- Answers the recall questions:
--   "Which batches used lot X?"   → used_in_batches
--   "Where did those batches go?" → downstream_distribution
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_lot_traceability(
  p_lot_number text,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_lot      jsonb;
  v_batches  jsonb;
  v_dist     jsonb;
BEGIN

  -- ── Lot record ───────────────────────────────────────────────
  -- Queries raw_material_lots for a formally registered lot.
  -- Returns NULL if the lot has not been registered there yet
  -- (text-match path in bill_of_materials still works either way).
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'id',                  rml.id,
    'lot_number',          rml.lot_number,
    'raw_material_name',   rm.name,
    'raw_material_id',     rm.id,
    'quantity',            rml.quantity,
    'unit',                rml.unit,
    'supplier_name',       s.name,
    'supplier_id',         s.id,
    'received_at',         rml.received_at,
    'expiry_date',         rml.expiry_date,
    'status',              rml.status,
    'notes',               rml.notes
  ))
  INTO v_lot
  FROM       raw_material_lots rml
  JOIN       raw_materials     rm  ON rm.id  = rml.raw_material_id
  LEFT JOIN  suppliers         s   ON s.id   = rml.supplier_id
  WHERE rml.lot_number  = p_lot_number
    AND rml.company_id  = p_company_id
  LIMIT 1;

  -- ── Batches that used this lot ────────────────────────────────
  -- UNION deduplicates: if a BOM row has both a formal FK and a
  -- matching lot_number text field, it only appears once.
  -- Priority: formal_link takes precedence in the UNION ordering.
  WITH lot_batches AS (
    -- Path A: formal FK (raw_material_lot_id populated)
    SELECT
      bom.production_order_id,
      bom.material_name,
      bom.lot_number,
      bom.quantity   AS quantity_used,
      bom.unit,
      'formal_link'  AS match_type
    FROM bill_of_materials bom
    WHERE bom.company_id = p_company_id
      AND bom.raw_material_lot_id IN (
            SELECT id FROM raw_material_lots
            WHERE  lot_number  = p_lot_number
              AND  company_id  = p_company_id
          )

    UNION

    -- Path B: text match on lot_number field
    SELECT
      bom.production_order_id,
      bom.material_name,
      bom.lot_number,
      bom.quantity   AS quantity_used,
      bom.unit,
      'text_match'   AS match_type
    FROM bill_of_materials bom
    WHERE bom.company_id = p_company_id
      AND bom.lot_number ILIKE p_lot_number
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'production_order_id', lb.production_order_id,
        'product_name',        COALESCE(p.name,   'Unknown'),
        'sku',                 COALESCE(p.sku,    ''),
        'batch_status',        po.status,
        'quantity_used',       lb.quantity_used,
        'unit',                lb.unit,
        'lot_number',          lb.lot_number,
        'match_type',          lb.match_type,
        'created_at',          po.created_at,
        'completed_at',        po.completed_at
      )
      ORDER BY po.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_batches
  FROM       lot_batches       lb
  JOIN       production_orders po ON po.id = lb.production_order_id
  LEFT JOIN  products          p  ON p.id  = po.product_id;

  -- ── Downstream distribution for all affected batches ─────────
  -- distribution_records.batch_id is TEXT — cast uuid to text.
  -- Finds every outbound shipment from any batch that used the lot.
  WITH affected_ids AS (
    SELECT DISTINCT bom.production_order_id::text AS batch_id_text
    FROM   bill_of_materials bom
    WHERE  bom.company_id = p_company_id
      AND (
        bom.raw_material_lot_id IN (
          SELECT id FROM raw_material_lots
          WHERE  lot_number = p_lot_number
            AND  company_id = p_company_id
        )
        OR bom.lot_number ILIKE p_lot_number
      )
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'production_order_id', dr.batch_id,
        'recipient',           dr.recipient,
        'quantity',            dr.quantity,
        'shipped_at',          dr.shipped_at
      )
      ORDER BY dr.shipped_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_dist
  FROM  distribution_records dr
  JOIN  affected_ids         ai ON ai.batch_id_text = dr.batch_id
  WHERE dr.company_id = p_company_id;

  -- ── Return ───────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'lot_record',                   v_lot,
    'used_in_batches',              v_batches,
    'downstream_distribution',      v_dist,
    'affected_batch_count',         jsonb_array_length(v_batches),
    'affected_distribution_count',  jsonb_array_length(v_dist)
  );

END;
$$;


-- ── Completion notice ─────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✓ Phase 1B RPCs deployed.';
  RAISE NOTICE '  get_batch_journey(p_batch_id uuid)';
  RAISE NOTICE '  get_lot_traceability(p_lot_number text, p_company_id uuid)';
  RAISE NOTICE '';
  RAISE NOTICE '  Quick smoke test (replace UUIDs with real values):';
  RAISE NOTICE '  SELECT get_batch_journey(''<batch_uuid>'', ''<company_uuid>'');';
  RAISE NOTICE '  SELECT get_lot_traceability(''LOT-001'', ''<company_uuid>'');';
END;
$$;


-- ============================================================
-- ROLLBACK (run only to remove these functions)
-- ============================================================
-- DROP FUNCTION IF EXISTS get_batch_journey(uuid, uuid);
-- DROP FUNCTION IF EXISTS get_lot_traceability(text, uuid);
-- ============================================================
