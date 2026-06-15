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
--   issue_signals  — QC failures, inspection failures, CAPAs, recalls,
--                    material issues, supplier substitutions
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
  v_company_id       uuid;
  v_batch            jsonb;
  v_signals          jsonb;
  v_materials        jsonb;
  v_capas            jsonb;
  v_recalls          jsonb;
  v_risk             int  := 0;
  v_qc_fail          int  := 0;
  v_insp_fail        int  := 0;
  v_critical_capas   int  := 0;
  v_open_capas       int  := 0;
  v_critical_recalls int  := 0;
  v_open_recalls     int  := 0;
  v_rejected_lots    int  := 0;
  v_quarantine_lots  int  := 0;
  v_supplier_subs    int  := 0;
  v_affected_units   int  := 0;
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
  -- Unified across: QC results, inspections, CAPAs, recalls,
  -- rejected/quarantined lots, and supplier substitutions.
  WITH signals AS (

    -- QC failures (batch_qc_results)
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

    -- Inspection failures (quality_inspections)
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

    UNION ALL

    -- CAPAs
    SELECT
      'capas',
      c.status,
      COALESCE(c.severity, 'medium'),
      'CAPA ' || c.capa_number || ': ' || c.title
        || ' [' || COALESCE(c.severity, 'medium') || ', ' || c.status || ']',
      c.created_at,
      c.root_cause
    FROM  capas c
    WHERE c.batch_id   = p_batch_id
      AND c.company_id = v_company_id

    UNION ALL

    -- Recalls
    SELECT
      'recalls',
      r.status,
      COALESCE(r.severity, 'high'),
      'Recall ' || r.recall_number || ': ' || r.title
        || CASE WHEN r.affected_units > 0
                THEN ' (' || r.affected_units::text || ' units affected)'
                ELSE '' END,
      r.initiated_at,
      r.reason
    FROM  recalls r
    WHERE r.batch_id   = p_batch_id
      AND r.company_id = v_company_id

    UNION ALL

    -- Rejected / quarantined material lots
    SELECT
      'raw_material_lots',
      rml.status,
      CASE rml.status WHEN 'rejected' THEN 'high' ELSE 'medium' END,
      bom.material_name || ' lot ' || COALESCE(bom.lot_number, rml.lot_number, 'unknown')
        || ' — status: ' || rml.status,
      rml.received_at,
      NULL::text
    FROM  bill_of_materials bom
    JOIN  raw_material_lots rml ON rml.id = bom.raw_material_lot_id
    WHERE bom.production_order_id = p_batch_id
      AND bom.company_id          = v_company_id
      AND rml.status IN ('rejected', 'quarantine')

    UNION ALL

    -- Supplier substitutions (lot supplier differs from material default supplier)
    SELECT
      'supplier_substitution',
      'substitution',
      'medium',
      bom.material_name || ': supplier substitution — expected ' || s_default.name
        || ', used ' || s_actual.name,
      rml.received_at,
      NULL::text
    FROM  bill_of_materials bom
    JOIN  raw_material_lots rml      ON rml.id      = bom.raw_material_lot_id
    JOIN  raw_materials     rm       ON rm.id        = rml.raw_material_id
    JOIN  suppliers         s_actual  ON s_actual.id  = rml.supplier_id
    JOIN  suppliers         s_default ON s_default.id = rm.supplier_id
    WHERE bom.production_order_id = p_batch_id
      AND bom.company_id          = v_company_id
      AND rml.supplier_id IS NOT NULL
      AND rm.supplier_id  IS NOT NULL
      AND rml.supplier_id != rm.supplier_id

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

  -- QC failures (batch_qc_results status = 'fail')
  SELECT COUNT(*) INTO v_qc_fail
  FROM batch_qc_results
  WHERE batch_id = p_batch_id AND company_id = v_company_id AND status = 'fail';

  -- Inspection failures (quality_inspections status = 'failed' or 'conditional')
  SELECT COUNT(*) INTO v_insp_fail
  FROM quality_inspections
  WHERE batch_id = p_batch_id::text AND company_id = v_company_id
    AND status IN ('failed', 'conditional');

  -- Critical CAPAs
  SELECT COUNT(*) INTO v_critical_capas
  FROM capas
  WHERE batch_id = p_batch_id AND company_id = v_company_id AND severity = 'critical';

  -- Open CAPAs (any severity, not closed)
  SELECT COUNT(*) INTO v_open_capas
  FROM capas
  WHERE batch_id = p_batch_id AND company_id = v_company_id AND status <> 'closed';

  -- Critical recalls
  SELECT COUNT(*) INTO v_critical_recalls
  FROM recalls
  WHERE batch_id = p_batch_id AND company_id = v_company_id AND severity = 'critical';

  -- Open recalls (not closed)
  SELECT COUNT(*) INTO v_open_recalls
  FROM recalls
  WHERE batch_id = p_batch_id AND company_id = v_company_id AND status <> 'closed';

  -- Rejected material lots
  SELECT COUNT(*) INTO v_rejected_lots
  FROM  bill_of_materials bom
  JOIN  raw_material_lots rml ON rml.id = bom.raw_material_lot_id
  WHERE bom.production_order_id = p_batch_id
    AND bom.company_id          = v_company_id
    AND rml.status = 'rejected';

  -- Quarantined material lots
  SELECT COUNT(*) INTO v_quarantine_lots
  FROM  bill_of_materials bom
  JOIN  raw_material_lots rml ON rml.id = bom.raw_material_lot_id
  WHERE bom.production_order_id = p_batch_id
    AND bom.company_id          = v_company_id
    AND rml.status = 'quarantine';

  -- Supplier substitutions
  SELECT COUNT(*) INTO v_supplier_subs
  FROM  bill_of_materials bom
  JOIN  raw_material_lots rml ON rml.id  = bom.raw_material_lot_id
  JOIN  raw_materials     rm  ON rm.id   = rml.raw_material_id
  WHERE bom.production_order_id = p_batch_id
    AND bom.company_id          = v_company_id
    AND rml.supplier_id IS NOT NULL
    AND rm.supplier_id  IS NOT NULL
    AND rml.supplier_id != rm.supplier_id;

  -- Total affected units across all recalls (1 pt per 10 units, max 20)
  SELECT COALESCE(SUM(affected_units), 0) INTO v_affected_units
  FROM recalls
  WHERE batch_id = p_batch_id AND company_id = v_company_id;

  -- Score: critical recall +60, open recall +20, critical CAPA +25,
  --        open CAPA +15, QC fail +15, inspection fail +10,
  --        rejected lot +20, quarantine lot +10, supplier sub +20,
  --        affected units +1/10 (max 20). Cap 100.
  v_risk := LEAST(100,
    (LEAST(v_critical_recalls, 1) * 60) +
    (LEAST(v_open_recalls,     1) * 20) +
    (LEAST(v_critical_capas,   1) * 25) +
    (LEAST(v_open_capas,       1) * 15) +
    (LEAST(v_qc_fail,          1) * 15) +
    (LEAST(v_insp_fail,        1) * 10) +
    (LEAST(v_rejected_lots,    1) * 20) +
    (LEAST(v_quarantine_lots,  1) * 10) +
    (LEAST(v_supplier_subs,    1) * 20) +
    LEAST(v_affected_units / 10, 20)
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
                        WHEN v_risk <  20 THEN 'none'
                        WHEN v_risk <  40 THEN 'low'
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
  RAISE NOTICE '✓ get_root_cause_analysis(uuid) redeployed with updated risk model.';
  RAISE NOTICE '  Smoke test: SELECT get_root_cause_analysis(''<batch_uuid>'');';
END;
$$;
