-- ============================================================
-- TraceFlow — Phase 1B: Root Cause Analysis RPC
-- File: supabase_rca_rpc.sql
-- ============================================================
--
-- Creates:
--   get_root_cause_analysis(p_batch_id uuid) → jsonb
--
-- Returns a JSONB document containing:
--   batch          — batch header (product name, SKU, status)
--   issue_signals  — QC failures and inspection failures
--   material_trace — BOM entries enriched with lot status + supplier
--   capas          — CAPA records linked to this batch
--   recalls        — Recall records linked to this batch
--   risk_score     — 0-100 composite risk score
--   risk_level     — none | low | medium | high | critical
--
-- SECURITY DEFINER so the public QR trace page can call it.
-- Explicit company_id filter on every table as belt-and-suspenders.
--
-- No new tables. Pure read-only aggregation of existing data.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

CREATE OR REPLACE FUNCTION get_root_cause_analysis(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id   uuid;
  v_batch        jsonb;
  v_signals      jsonb;
  v_materials    jsonb;
  v_capas        jsonb;
  v_recalls      jsonb;
  v_risk         int  := 0;
  v_qc_fail      int  := 0;
  v_qc_hold      int  := 0;
  v_open_capas   int  := 0;
  v_open_recalls int  := 0;
  v_bad_lots     int  := 0;
BEGIN

  -- Resolve company from the batch; return NULL if not found.
  SELECT company_id INTO v_company_id
  FROM   production_orders
  WHERE  id = p_batch_id;

  IF v_company_id IS NULL THEN RETURN NULL; END IF;

  -- ── Batch header ─────────────────────────────────────────────
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

  -- ── Issue signals ─────────────────────────────────────────────
  -- QC failures and inspection failures that triggered investigation.
  -- Unified from two tables: batch_qc_results (UUID match) and
  -- quality_inspections (TEXT match via cast).
  WITH signals AS (
    SELECT
      'batch_qc_results'  AS source_table,
      bqr.status          AS signal_type,
      CASE bqr.status WHEN 'fail' THEN 'high' ELSE 'medium' END AS severity,
      'QC ' || bqr.status
        || ' recorded by ' || COALESCE(bqr.inspector_name, 'inspector')
        || COALESCE('. ' || bqr.notes, '')
                          AS summary,
      bqr.inspected_at    AS occurred_at,
      bqr.notes           AS detail
    FROM  batch_qc_results bqr
    WHERE bqr.batch_id   = p_batch_id
      AND bqr.company_id = v_company_id
      AND bqr.status IN ('fail', 'hold')

    UNION ALL

    SELECT
      'quality_inspections',
      qi.status,
      CASE qi.status WHEN 'failed' THEN 'high' ELSE 'medium' END,
      qi.inspection_type || ' inspection — ' || qi.status
        || CASE WHEN qi.overall_score > 0
                THEN ' (score: ' || qi.overall_score::text || ')'
                ELSE '' END,
      qi.inspection_date::timestamptz,
      qi.notes
    FROM  quality_inspections qi
    WHERE qi.batch_id   = p_batch_id::text
      AND qi.company_id = v_company_id
      AND qi.status IN ('failed', 'conditional')
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'source_table', source_table,
      'signal_type',  signal_type,
      'severity',     severity,
      'summary',      summary,
      'occurred_at',  occurred_at,
      'detail',       detail
    ) ORDER BY occurred_at ASC),
    '[]'::jsonb
  )
  INTO v_signals
  FROM signals;

  -- ── Material trace ────────────────────────────────────────────
  -- BOM entries enriched with lot status and supplier.
  -- Supplier resolved via lot FK first, then raw_material FK as fallback.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'bom_id',          bom.id,
        'material_name',   bom.material_name,
        'lot_number',      bom.lot_number,
        'quantity',        bom.quantity,
        'unit',            bom.unit,
        'lot_id',          rml.id,
        'lot_status',      rml.status,
        'lot_received_at', rml.received_at,
        'lot_expiry_date', rml.expiry_date,
        'supplier_name',   COALESCE(s.name,  s2.name),
        'supplier_id',     COALESCE(rml.supplier_id, rm.supplier_id)
      )) ORDER BY bom.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_materials
  FROM  bill_of_materials bom
  LEFT  JOIN raw_material_lots rml ON rml.id  = bom.raw_material_lot_id
  LEFT  JOIN raw_materials     rm  ON rm.id   = rml.raw_material_id
  LEFT  JOIN suppliers         s   ON s.id    = rml.supplier_id
  LEFT  JOIN suppliers         s2  ON s2.id   = rm.supplier_id
  WHERE bom.production_order_id = p_batch_id
    AND bom.company_id          = v_company_id;

  -- ── CAPAs linked to this batch ────────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id',                c.id,
        'capa_number',       c.capa_number,
        'title',             c.title,
        'severity',          c.severity,
        'status',            c.status,
        'root_cause',        c.root_cause,
        'corrective_action', c.corrective_action,
        'preventive_action', c.preventive_action,
        'owner_name',        c.owner_name,
        'due_date',          c.due_date,
        'overdue',           (c.due_date IS NOT NULL
                              AND c.due_date < current_date
                              AND c.status <> 'closed'),
        'created_at',        c.created_at,
        'closed_at',         c.closed_at
      )) ORDER BY c.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_capas
  FROM  capas c
  WHERE c.batch_id   = p_batch_id
    AND c.company_id = v_company_id;

  -- ── Recalls linked to this batch ──────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id',             r.id,
        'recall_number',  r.recall_number,
        'title',          r.title,
        'severity',       r.severity,
        'status',         r.status,
        'reason',         r.reason,
        'root_cause',     r.root_cause,
        'affected_units', r.affected_units,
        'initiated_at',   r.initiated_at,
        'closed_at',      r.closed_at
      )) ORDER BY r.initiated_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_recalls
  FROM  recalls r
  WHERE r.batch_id   = p_batch_id
    AND r.company_id = v_company_id;

  -- ── Risk score ────────────────────────────────────────────────
  -- QC failures (batch_qc_results + quality_inspections)
  SELECT COUNT(*) INTO v_qc_fail FROM (
    SELECT 1 FROM batch_qc_results
    WHERE batch_id = p_batch_id AND company_id = v_company_id AND status = 'fail'
    UNION ALL
    SELECT 1 FROM quality_inspections
    WHERE batch_id = p_batch_id::text AND company_id = v_company_id AND status = 'failed'
  ) x;

  SELECT COUNT(*) INTO v_qc_hold FROM (
    SELECT 1 FROM batch_qc_results
    WHERE batch_id = p_batch_id AND company_id = v_company_id AND status = 'hold'
    UNION ALL
    SELECT 1 FROM quality_inspections
    WHERE batch_id = p_batch_id::text AND company_id = v_company_id AND status = 'conditional'
  ) x;

  SELECT COUNT(*) INTO v_open_capas
  FROM capas
  WHERE batch_id = p_batch_id AND company_id = v_company_id AND status <> 'closed';

  SELECT COUNT(*) INTO v_open_recalls
  FROM recalls
  WHERE batch_id = p_batch_id AND company_id = v_company_id AND status <> 'closed';

  -- Materials with a known lot in quarantine or rejected status.
  SELECT COUNT(*) INTO v_bad_lots
  FROM  bill_of_materials bom
  JOIN  raw_material_lots rml ON rml.id = bom.raw_material_lot_id
  WHERE bom.production_order_id = p_batch_id
    AND bom.company_id          = v_company_id
    AND rml.status IN ('quarantine', 'rejected');

  -- Score: 40 per QC fail, 20 per QC hold, 30 per open recall,
  --        15 per open CAPA (max 2 counted), 20 per bad lot. Cap 100.
  v_risk := LEAST(100,
    (LEAST(v_qc_fail,      1) * 40) +
    (LEAST(v_qc_hold,      1) * 20) +
    (LEAST(v_open_recalls, 1) * 30) +
    (LEAST(v_open_capas,   2) * 15) +
    (LEAST(v_bad_lots,     1) * 20)
  );

  -- ── Return ────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'batch',          v_batch,
    'issue_signals',  v_signals,
    'material_trace', v_materials,
    'capas',          v_capas,
    'recalls',        v_recalls,
    'risk_score',     v_risk,
    'risk_level',     CASE
                        WHEN v_risk =   0 THEN 'none'
                        WHEN v_risk <  30 THEN 'low'
                        WHEN v_risk <  60 THEN 'medium'
                        WHEN v_risk <  80 THEN 'high'
                        ELSE                   'critical'
                      END
  );

END;
$$;

GRANT EXECUTE ON FUNCTION get_root_cause_analysis(uuid) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✓ get_root_cause_analysis(uuid) deployed.';
  RAISE NOTICE '  Smoke test: SELECT get_root_cause_analysis(''<batch_uuid>'');';
END;
$$;
