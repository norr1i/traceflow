-- ============================================================
-- TraceFlow — Dedicated Public Batch Trace RPC
-- File: supabase_get_public_batch_trace.sql
-- ============================================================
--
-- PURPOSE
--   Creates get_public_batch_trace(p_batch_id uuid) → jsonb.
--   This is the ONLY RPC the public /trace/[id] page should
--   call for product data.  It implements a strict ALLOWLIST:
--   every returned field is explicitly constructed here.
--   No internal payload is accepted and then filtered.
--
-- REPLACES on the public page (existing RPCs stay unchanged):
--   get_batch_trace         ← exposes QC notes, inspector names, B2B sales
--   get_batch_journey       ← exposes actor_email, device telemetry, schema names
--   get_root_cause_analysis ← exposes full CAPA records, root causes, employee names
--
-- log_scan_event is NOT replaced — it is correct as-is.
--
-- ── FORBIDDEN CATEGORIES (absent from every code path below) ─
--
--   EMPLOYEE / PII        inspector_name, inspector_id, actor_email,
--                         actor_user_id, owner_name, initiated_by_name,
--                         performed_by, created_by, user_name
--
--   QC INTERNAL           notes (any table), free-text inspection details,
--                         arbitrary QC descriptions containing notes
--
--   B2B COMMERCIAL        sales[], customer_name, customer quantity,
--                         sold_at, named distribution recipients
--
--   SUPPLY CHAIN          supplier_name, supplier_id, lot_number,
--                         lot_id, raw_material_lot_id, bom_id,
--                         material quantities, exact BOM data
--
--   CAPA / RCA            capas[], capa_number, root_cause,
--                         corrective_action, preventive_action,
--                         issue_signals, risk_score, model internals
--
--   SCAN TELEMETRY        qr.scan events, user_agent, browser,
--                         device_type, prior visitor information
--
--   SCHEMA INTERNALS      source_table, entity_id, entity_type,
--                         raw metadata blobs, internal UUIDs
--
--   UNKNOWN EVENT TYPES   any timeline event_type not in the
--                         explicit allowlist is silently dropped
--
-- ── SECURITY MODEL ────────────────────────────────────────────
--   SECURITY DEFINER  — anon callers bypass RLS (required for public page)
--   SET search_path   — prevents search_path injection
--   Company scoping   — company_id resolved from production_orders;
--                       every downstream query is additionally filtered
--                       by v_company_id (belt-and-suspenders even though
--                       SECURITY DEFINER already bypasses RLS)
--   NULL return       — for any unknown / non-existent batch ID
--   No dynamic SQL    — all queries use static parameterised SQL
--   Explicit grants   — REVOKE ALL FROM PUBLIC; targeted GRANT only
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
--   Safe to re-run — CREATE OR REPLACE is idempotent.
-- ============================================================


-- ── Remove any previous version ───────────────────────────────
DROP FUNCTION IF EXISTS public.get_public_batch_trace(uuid);


-- ── Function ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_batch_trace(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Company anchor — resolved once, referenced in every query
  v_company_id        uuid;

  -- Response sections — assembled field-by-field
  v_product           jsonb;
  v_qc                jsonb;
  v_materials         jsonb;
  v_timeline          jsonb;
  v_recalls           jsonb;
  v_has_active_recall boolean := false;

  -- Risk computation (computed internally; raw integer NEVER returned)
  v_risk              int := 0;
  v_qc_fail           int := 0;
  v_insp_fail         int := 0;
  v_critical_capas    int := 0;
  v_open_capas        int := 0;
  v_critical_recalls  int := 0;
  v_open_recalls      int := 0;
  v_rejected_lots     int := 0;
  v_quarantine_lots   int := 0;
  v_supplier_subs     int := 0;
  v_affected_units    int := 0;
BEGIN

  -- ────────────────────────────────────────────────────────────
  -- STEP 1 — Resolve company anchor
  --
  -- Returns NULL immediately if the batch ID is unknown.
  -- v_company_id is the cross-company guard used in every
  -- subsequent query.  SECURITY DEFINER bypasses RLS, so this
  -- explicit filter is the real isolation boundary.
  -- ────────────────────────────────────────────────────────────
  SELECT po.company_id
  INTO   v_company_id
  FROM   production_orders po
  WHERE  po.id = p_batch_id;

  IF v_company_id IS NULL THEN
    RETURN NULL;    -- unknown batch → no data, no error, no information leakage
  END IF;


  -- ────────────────────────────────────────────────────────────
  -- STEP 2 — Product identity
  --
  -- ALLOWLIST: name, sku, status, completed_at
  -- EXCLUDED:  id (redundant — already in the URL / page param),
  --            quantity (reveals manufacturing scale),
  --            created_at, started_at (reveal operational cadence),
  --            product_id, company_id (internal UUIDs)
  -- ────────────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'name',         p.name,
    'sku',          p.sku,
    'status',       po.status,
    'completed_at', po.completed_at
  )
  INTO  v_product
  FROM  production_orders po
  JOIN  products           p ON p.id = po.product_id
  WHERE po.id         = p_batch_id
    AND po.company_id = v_company_id;


  -- ────────────────────────────────────────────────────────────
  -- STEP 3 — QC aggregate
  --
  -- ALLOWLIST: overall pass/fail/hold/pending, count, last date
  -- EXCLUDED:  inspector_name, notes, per-inspector rows,
  --            per-result breakdown
  --
  -- Severity order: fail > hold > pass (worst outcome wins)
  -- ────────────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'overall_result',    CASE
                           WHEN COUNT(*) = 0
                             THEN 'pending'
                           WHEN COUNT(*) FILTER (WHERE status = 'fail') > 0
                             THEN 'fail'
                           WHEN COUNT(*) FILTER (WHERE status = 'hold') > 0
                             THEN 'hold'
                           ELSE 'pass'
                         END,
    'inspection_count',  COUNT(*)::int,
    'last_inspected_at', MAX(inspected_at)
  )
  INTO  v_qc
  FROM  batch_qc_results
  WHERE batch_id   = p_batch_id
    AND company_id = v_company_id;


  -- ────────────────────────────────────────────────────────────
  -- STEP 4 — Materials (names only)
  --
  -- ALLOWLIST: material_name
  -- EXCLUDED:  supplier_name, supplier_id, lot_number, lot_id,
  --            raw_material_lot_id, bom_id, quantity, unit
  --
  -- DISTINCT collapses multiple BOM rows for the same material
  -- name (e.g., two lots of the same material) to one entry.
  -- This prevents per-lot detail from being inferred.
  -- ────────────────────────────────────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('material_name', m.material_name)
      ORDER BY m.material_name ASC
    ),
    '[]'::jsonb
  )
  INTO  v_materials
  FROM (
    SELECT DISTINCT bom.material_name
    FROM   bill_of_materials bom
    WHERE  bom.production_order_id = p_batch_id
      AND  bom.company_id          = v_company_id
      AND  bom.material_name       IS NOT NULL
  ) m;


  -- ────────────────────────────────────────────────────────────
  -- STEP 5 — Sanitized public timeline
  --
  -- STRICT ALLOWLIST: each event source below lists exactly
  -- which event_types are included.  Anything not in the list
  -- produces a NULL title and is dropped by the final WHERE.
  --
  -- TITLE RULE: all titles are generated by this RPC.
  -- No title is ever copied from free-text columns:
  --   metadata->>'title', notes, description, actor_email, or
  --   any field that could contain employee names or internal IDs.
  --
  -- PER-EVENT EXCLUDED: source_table, description, metadata blobs,
  --   notes, inspector fields, recipient names, lot identifiers,
  --   actor_email, entity_id, entity_type, user_agent, device_type.
  --
  -- Each returned event has exactly three keys:
  --   event_type, event_timestamp, title
  --
  -- NOTE — potential duplicates:
  --   distribution.shipped may appear from both Source D
  --   (distribution_records) and Source E (batch_journey_events).
  --   production.completed may appear from both Source A
  --   (production_orders) and Source F (batch_events).
  --   Duplicates at slightly different timestamps are acceptable
  --   at this layer; deduplication is a Phase 2 client concern.
  -- ────────────────────────────────────────────────────────────
  WITH public_events AS (

    -- ── Source A: production_orders ──────────────────────────
    -- Authoritative source for production lifecycle milestones.
    -- Three possible events per batch (created / started / completed).

    SELECT
      'production.order_created'   AS event_type,
      po.created_at                AS event_timestamp,
      'Production order opened'    AS title
    FROM production_orders po
    WHERE po.id         = p_batch_id
      AND po.company_id = v_company_id

    UNION ALL

    SELECT
      'production.started',
      po.started_at,
      'Production started'
    FROM production_orders po
    WHERE po.id          = p_batch_id
      AND po.company_id  = v_company_id
      AND po.started_at IS NOT NULL

    UNION ALL

    SELECT
      'production.completed',
      po.completed_at,
      'Production completed'
    FROM production_orders po
    WHERE po.id           = p_batch_id
      AND po.company_id   = v_company_id
      AND po.completed_at IS NOT NULL

    UNION ALL

    -- ── Source B: batch_qc_results ───────────────────────────
    -- One event per QC result row.
    -- Title derived solely from the outcome status.
    -- inspector_name and notes are never referenced.

    SELECT
      'qc.' || bqr.status,
      bqr.inspected_at,
      CASE bqr.status
        WHEN 'pass' THEN 'Quality inspection passed'
        WHEN 'fail' THEN 'Quality inspection failed'
        WHEN 'hold' THEN 'Quality inspection placed on hold'
        ELSE             'Quality inspection'
      END
    FROM batch_qc_results bqr
    WHERE bqr.batch_id   = p_batch_id
      AND bqr.company_id = v_company_id

    UNION ALL

    -- ── Source C: quality_inspections ────────────────────────
    -- Standalone inspection module events.
    -- batch_id is TEXT in this table — cast required.
    -- inspector_id, inspector_name, notes never referenced.

    SELECT
      'qc_inspection.' || qi.status,
      qi.inspection_date::timestamptz,
      CASE qi.status
        WHEN 'passed'      THEN 'Quality inspection passed'
        WHEN 'failed'      THEN 'Quality inspection failed'
        WHEN 'conditional' THEN 'Quality inspection — conditional pass'
        WHEN 'pending'     THEN 'Quality inspection pending'
        ELSE                    'Quality inspection'
      END
    FROM quality_inspections qi
    WHERE qi.batch_id   = p_batch_id::text
      AND qi.company_id = v_company_id

    UNION ALL

    -- ── Source D: distribution_records ───────────────────────
    -- Shipment events via the canonical FK chain:
    --   production_orders → batches → distribution_records
    -- distribution_records.batch_id is UUID (FK → batches.id) in the
    -- live DB — confirmed by seed_lifecycle_demo.sql (uuid var used
    -- without cast on INSERT/DELETE) and supabase_recall_impact_rpc.sql
    -- schema notes.  The original sfda_tables.sql TEXT definition was
    -- superseded by an undocumented migration.  No cast required.
    -- Title is fixed — NEVER exposes recipient name, notes, or
    -- any distribution counterparty identifier.

    SELECT
      'distribution.shipped',
      dr.shipped_at,
      'Shipped to distribution partner'
    FROM distribution_records dr
    JOIN batches               b ON b.id = dr.batch_id
    WHERE b.production_order_id = p_batch_id
      AND b.company_id          = v_company_id
      AND dr.company_id         = v_company_id
      AND dr.shipped_at        IS NOT NULL

    UNION ALL

    -- ── Source E: batch_journey_events ────────────────────────
    -- Custom lifecycle events.  STRICT TYPE ALLOWLIST via CASE.
    -- Any event_type not in the CASE list yields NULL title
    -- and is dropped by the final WHERE title IS NOT NULL.
    --
    -- Title is generated by this RPC — never copied from:
    --   metadata->>'title', actor_email, description, notes.
    --
    -- Production lifecycle types (order_created / started /
    -- completed) are excluded here: production_orders (Source A)
    -- is the authoritative source for those milestones.
    --
    -- Belt-and-suspenders: qr.scan is rejected in both the CASE
    -- (returns NULL) and the explicit AND clause below.

    SELECT
      bje.event_type,
      bje.event_timestamp,
      CASE bje.event_type

        -- Raw material intake
        WHEN 'raw_material.received'       THEN 'Raw materials received'
        WHEN 'raw_material.approved'       THEN 'Raw material approval completed'
        WHEN 'raw_material.released'       THEN 'Raw materials released to production'

        -- Packaging
        WHEN 'packaging.started'           THEN 'Packaging started'
        WHEN 'packaging.completed'         THEN 'Packaging completed'

        -- Finished goods / storage
        WHEN 'storage.entry'               THEN 'Entered finished goods storage'
        WHEN 'storage.finished_goods'      THEN 'Moved to finished goods'
        WHEN 'storage.exit'                THEN 'Released from storage'

        -- Distribution (supplements Source D)
        WHEN 'distribution.shipped'        THEN 'Shipped to distribution partner'
        WHEN 'distribution.received'       THEN 'Received by distribution partner'
        WHEN 'distributor.received'        THEN 'Received by distribution partner'

        -- Market / regulatory
        WHEN 'market.listed'               THEN 'Product listed on market'
        WHEN 'market.registered'           THEN 'Market registration complete'
        WHEN 'market.registered.sfda'      THEN 'SFDA registration complete'
        WHEN 'market.surveillance'         THEN 'Market surveillance completed'
        WHEN 'market.surveillance.passed'  THEN 'Market surveillance passed'
        WHEN 'market.surveillance.failed'  THEN 'Market surveillance flagged'
        WHEN 'market.compliance.confirmed' THEN 'Regulatory compliance confirmed'

        -- Recall lifecycle
        WHEN 'recall.opened'               THEN 'Recall initiated'
        WHEN 'recall.closed'               THEN 'Recall closed'

        -- ALL OTHER TYPES → NULL → dropped by WHERE title IS NOT NULL.
        -- Explicitly omitted (not exhaustive):
        --   material.added_to_batch  (lot numbers in description)
        --   qr.scan                  (prior visitor device telemetry)
        --   capa.created / closed    (internal quality workflow)
        --   supplier.*               (internal supply chain)
        --   production.*             (covered by Source A)
        ELSE NULL

      END
    FROM batch_journey_events bje
    WHERE bje.batch_id   = p_batch_id
      AND bje.company_id = v_company_id
      AND bje.event_type <> 'qr.scan'   -- explicit guard regardless of CASE outcome

    UNION ALL

    -- ── Source F: batch_events (SFDA legacy table) ────────────
    -- batch_events.batch_id is UUID FK to batches.id — confirmed
    -- by live information_schema diagnostic (udt_name = uuid).
    -- No cast required on either side of the JOIN.
    -- Join through batches.production_order_id to anchor to the
    -- requested production order.
    -- 'consumed' (internal materials step) is explicitly excluded.

    SELECT
      CASE be.event_type
        WHEN 'produced' THEN 'production.completed'
        WHEN 'shipped'  THEN 'distribution.shipped'
      END,
      be.occurred_at,
      CASE be.event_type
        WHEN 'produced' THEN 'Production completed'
        WHEN 'shipped'  THEN 'Shipped to distribution partner'
      END
    FROM  batch_events be
    JOIN  batches       b  ON b.id = be.batch_id
    WHERE b.production_order_id = p_batch_id
      AND be.company_id         = v_company_id
      AND be.event_type         IN ('produced', 'shipped')  -- 'consumed' excluded

  )
  -- Final aggregation — chronological, both NULL guards in place:
  --   event_timestamp IS NOT NULL  → skips rows with missing timestamps
  --   title IS NOT NULL            → drops non-allowlisted Source E rows
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'event_type',      event_type,
        'event_timestamp', event_timestamp,
        'title',           title
        -- source_table: OMITTED — internal implementation detail
        -- description:  OMITTED — requires per-type sanitization
        -- metadata:     OMITTED — contains forbidden fields
      )
      ORDER BY event_timestamp ASC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_timeline
  FROM  public_events
  WHERE event_timestamp IS NOT NULL
    AND title            IS NOT NULL;


  -- ────────────────────────────────────────────────────────────
  -- STEP 6a — Recalls (public structured fields only)
  --
  -- ALLOWLIST: recall_number, title, severity, status,
  --            affected_units, initiated_at, closed_at
  --
  -- EXCLUDED:  reason            — live data contains customer names,
  --                                internal RCA text, technical failure
  --                                details, and regulatory references;
  --                                not safe as a public free-text field.
  --                                Future improvement: add a dedicated
  --                                public_message column to recalls.
  --            root_cause        — internal RCA investigation finding
  --            corrective_action — internal CAPA content
  --            preventive_action — internal CAPA content
  --            initiated_by_name — employee PII
  --            id, product_id, batch_id, company_id — internal UUIDs
  -- ────────────────────────────────────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'recall_number',  r.recall_number,
        'title',          r.title,
        'severity',       r.severity,
        'status',         r.status,
        'affected_units', r.affected_units,
        'initiated_at',   r.initiated_at,
        'closed_at',      r.closed_at
        -- reason:             OMITTED — free-text field populated with internal
        --                     RCA content, customer names (e.g. "Tasnee"),
        --                     and technical investigation details.
        --                     Not safe for public exposure.
        -- root_cause:         OMITTED — internal RCA finding
        -- corrective_action:  OMITTED — internal CAPA content
        -- preventive_action:  OMITTED — internal CAPA content
        -- initiated_by_name:  OMITTED — employee PII
        -- product_id:         OMITTED — internal UUID
        -- batch_id:           OMITTED — internal UUID
        -- company_id:         OMITTED — internal UUID
      )
      ORDER BY r.initiated_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_recalls
  FROM  recalls r
  WHERE r.batch_id   = p_batch_id
    AND r.company_id = v_company_id;

  -- ── STEP 6b — Active recall flag ─────────────────────────────
  -- Separate query so the boolean is computed cleanly.
  SELECT EXISTS (
    SELECT 1
    FROM   recalls r
    WHERE  r.batch_id   = p_batch_id
      AND  r.company_id = v_company_id
      AND  r.status    <> 'closed'
  ) INTO v_has_active_recall;


  -- ────────────────────────────────────────────────────────────
  -- STEP 7 — Risk level (internal computation; score never returned)
  --
  -- Identical scoring model to get_root_cause_analysis so that
  -- the public risk_level is consistent with what internal staff
  -- see.  Only the bucketed label is returned to the caller.
  -- The raw integer v_risk and all intermediate counts remain
  -- entirely within this function's stack.
  -- ────────────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_qc_fail
  FROM  batch_qc_results
  WHERE batch_id   = p_batch_id
    AND company_id = v_company_id
    AND status     = 'fail';

  SELECT COUNT(*) INTO v_insp_fail
  FROM  quality_inspections
  WHERE batch_id   = p_batch_id::text
    AND company_id = v_company_id
    AND status     IN ('failed', 'conditional');

  SELECT COUNT(*) INTO v_critical_capas
  FROM  capas
  WHERE batch_id   = p_batch_id
    AND company_id = v_company_id
    AND severity   = 'critical';

  SELECT COUNT(*) INTO v_open_capas
  FROM  capas
  WHERE batch_id   = p_batch_id
    AND company_id = v_company_id
    AND status    <> 'closed';

  SELECT COUNT(*) INTO v_critical_recalls
  FROM  recalls
  WHERE batch_id   = p_batch_id
    AND company_id = v_company_id
    AND severity   = 'critical'
    AND status    <> 'closed';     -- closed recalls do not count toward current risk

  SELECT COUNT(*) INTO v_open_recalls
  FROM  recalls
  WHERE batch_id   = p_batch_id
    AND company_id = v_company_id
    AND status    <> 'closed';

  SELECT COUNT(*) INTO v_rejected_lots
  FROM  bill_of_materials bom
  JOIN  raw_material_lots rml ON rml.id = bom.raw_material_lot_id
  WHERE bom.production_order_id = p_batch_id
    AND bom.company_id          = v_company_id
    AND rml.status              = 'rejected';

  SELECT COUNT(*) INTO v_quarantine_lots
  FROM  bill_of_materials bom
  JOIN  raw_material_lots rml ON rml.id = bom.raw_material_lot_id
  WHERE bom.production_order_id = p_batch_id
    AND bom.company_id          = v_company_id
    AND rml.status              = 'quarantine';

  SELECT COUNT(*) INTO v_supplier_subs
  FROM  bill_of_materials bom
  JOIN  raw_material_lots rml ON rml.id  = bom.raw_material_lot_id
  JOIN  raw_materials     rm  ON rm.id   = rml.raw_material_id
  WHERE bom.production_order_id = p_batch_id
    AND bom.company_id          = v_company_id
    AND rml.supplier_id IS NOT NULL
    AND rm.supplier_id  IS NOT NULL
    AND rml.supplier_id != rm.supplier_id;

  SELECT COALESCE(SUM(affected_units), 0) INTO v_affected_units
  FROM  recalls
  WHERE batch_id   = p_batch_id
    AND company_id = v_company_id
    AND status    <> 'closed';     -- only count units from active/unresolved recalls

  -- Scoring weights match get_root_cause_analysis exactly.
  -- Cap at 100.
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


  -- ────────────────────────────────────────────────────────────
  -- STEP 8 — Assemble and return
  --
  -- Top-level keys match the public contract exactly.
  -- No additional keys exist at any nesting level.
  -- ────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'product',      v_product,
    'qc',           v_qc,
    'materials',    v_materials,
    'timeline',     v_timeline,
    'recall_alert', jsonb_build_object(
                      'has_active_recall', v_has_active_recall,
                      'recalls',          v_recalls
                    ),
    'risk_level',   CASE
                      WHEN v_risk <  20 THEN 'none'
                      WHEN v_risk <  40 THEN 'low'
                      WHEN v_risk <  60 THEN 'medium'
                      WHEN v_risk <  80 THEN 'high'
                      ELSE                   'critical'
                    END
  );

END;
$$;


-- ── Permissions ────────────────────────────────────────────────
-- Explicitly revoke the PostgreSQL default PUBLIC execute grant,
-- then grant only to the roles that legitimately need access.
-- This survives configuration drift and documents intent clearly.

REVOKE ALL    ON FUNCTION public.get_public_batch_trace(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_public_batch_trace(uuid) TO anon;
GRANT  EXECUTE ON FUNCTION public.get_public_batch_trace(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_batch_trace(uuid) TO service_role;


-- ── Deployment notice ──────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✓ get_public_batch_trace(uuid) deployed successfully.';
  RAISE NOTICE '';
  RAISE NOTICE '  Public contract — returned keys:';
  RAISE NOTICE '    product       { name, sku, status, completed_at }';
  RAISE NOTICE '    qc            { overall_result, inspection_count, last_inspected_at }';
  RAISE NOTICE '    materials[]   { material_name }';
  RAISE NOTICE '    timeline[]    { event_type, event_timestamp, title }  (allowlisted + sanitized)';
  RAISE NOTICE '    recall_alert  { has_active_recall, recalls[] }  — reason EXCLUDED';
  RAISE NOTICE '    risk_level    none | low | medium | high | critical';
  RAISE NOTICE '';
  RAISE NOTICE '  Execute grants: anon, authenticated, service_role';
  RAISE NOTICE '  PUBLIC execute:  REVOKED';
  RAISE NOTICE '';
  RAISE NOTICE '  Forbidden fields — verified absent from all code paths:';
  RAISE NOTICE '    inspector_name  inspector_id  actor_email  actor_user_id  owner_name';
  RAISE NOTICE '    initiated_by_name  notes (any)  sales[]  customer_name  sold_at';
  RAISE NOTICE '    supplier_name  supplier_id  lot_number  lot_id  bom_id';
  RAISE NOTICE '    raw_material_lot_id  material quantities  capas[]  root_cause';
  RAISE NOTICE '    corrective_action  preventive_action  risk_score  issue_signals';
  RAISE NOTICE '    source_table  entity_id  entity_type  raw metadata blobs';
  RAISE NOTICE '    qr.scan events  user_agent  browser  device_type';
  RAISE NOTICE '';
  RAISE NOTICE '  Next step: Phase 2 — migrate /trace/[id] to call only this RPC,';
  RAISE NOTICE '  then revoke anon EXECUTE from the old RPCs.';
END;
$$;
