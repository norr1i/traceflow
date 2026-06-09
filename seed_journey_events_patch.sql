-- ============================================================
-- TraceFlow — Journey Events Patch
-- ============================================================
-- PURPOSE
--   Fixes two problems created by the previous seed run:
--   1. Story 2 (Hydraulic Cylinder) and Story 3 (Safety Relief Valve)
--      had batch_journey_events with NULL timestamps because t2/t3 were
--      not yet assigned when those rows were inserted.
--   2. All three story batches were missing incoming_qc events and the
--      Production Order Created event was not synthesised by the client.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
--   Safe to run multiple times (DELETE + INSERT pattern).
-- ============================================================

DO $$
DECLARE
  cid  uuid;
  b01  uuid;   -- Ball Valve 2in 316 SS
  b02  uuid;   -- Hydraulic Cylinder 50mm
  b03  uuid;   -- Safety Relief Valve 0.5in 10bar

  t1   timestamptz;
  t2   timestamptz;
  t3   timestamptz;
  t_base timestamptz;
BEGIN

  -- ── Company ──────────────────────────────────────────────────
  SELECT id INTO cid FROM companies ORDER BY created_at LIMIT 1;
  IF cid IS NULL THEN
    RAISE EXCEPTION 'No company found. Complete onboarding first.';
  END IF;

  -- ── Find story batch IDs from product SKUs ───────────────────
  -- Use most recently created batch for each SKU so re-seeds don't confuse.
  SELECT po.id INTO b01
  FROM production_orders po
  JOIN products p ON p.id = po.product_id
  WHERE p.sku = 'VBC-2IN-316' AND po.company_id = cid
  ORDER BY po.created_at DESC LIMIT 1;

  SELECT po.id INTO b02
  FROM production_orders po
  JOIN products p ON p.id = po.product_id
  WHERE p.sku = 'HPC-50-200' AND po.company_id = cid
  ORDER BY po.created_at DESC LIMIT 1;

  SELECT po.id INTO b03
  FROM production_orders po
  JOIN products p ON p.id = po.product_id
  WHERE p.sku = 'VSR-05-010' AND po.company_id = cid
  ORDER BY po.created_at DESC LIMIT 1;

  IF b01 IS NULL OR b02 IS NULL OR b03 IS NULL THEN
    RAISE EXCEPTION 'One or more story batches not found. Run seed_lifecycle_demo.sql first.';
  END IF;

  -- ── Derive timestamps from production_orders ─────────────────
  SELECT created_at INTO t1 FROM production_orders WHERE id = b01;
  SELECT created_at INTO t2 FROM production_orders WHERE id = b02;
  SELECT created_at INTO t3 FROM production_orders WHERE id = b03;
  t_base := t1 - interval '5 days';

  RAISE NOTICE 'batch_01 (Ball Valve)=%', b01;
  RAISE NOTICE 'batch_02 (Hydraulic Cylinder)=%', b02;
  RAISE NOTICE 'batch_03 (Safety Relief Valve)=%', b03;
  RAISE NOTICE 't_base=% t1=% t2=% t3=%', t_base, t1, t2, t3;

  -- ── Clean slate: remove all existing journey events ──────────
  DELETE FROM batch_journey_events WHERE batch_id IN (b01, b02, b03);
  RAISE NOTICE 'Deleted existing journey events for all 3 story batches';

  -- ══════════════════════════════════════════════════════════════
  -- STORY 1 — Ball Valve 2in 316 SS
  -- Complete lifecycle: Materials → QC → Packaging → 3 Deliveries
  -- ══════════════════════════════════════════════════════════════

  INSERT INTO batch_journey_events
    (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
  VALUES
    -- Lot received 90 days ago (before production order was raised)
    (cid, b01, 'raw_material.received', t_base, 'warehouse@company.sa', 'raw_material',
     '{"title":"Raw Materials Received","description":"SS316 lot LOT-2025-SS316-0891 (500 kg) received from Gulf Steel Industries LLC. Mill cert EN 10204 3.1 attached. Heat number HN-29841. Stored in quarantine bay pending incoming QC."}'::jsonb,
     t_base),

    -- Incoming QC the next day
    (cid, b01, 'incoming_qc.approved', t_base + interval '1 day', 'qa@company.sa', 'raw_material',
     '{"title":"Incoming QC Approved","description":"LOT-2025-SS316-0891 passed incoming inspection. Hardness 187 HB confirmed (spec 150–200 HB). Chemical composition cert reviewed and on file. Lot approved and transferred to approved stock."}'::jsonb,
     t_base + interval '1 day'),

    -- Materials allocated when production order is raised
    (cid, b01, 'raw_material.released', t1, 'qa@company.sa', 'raw_material',
     '{"title":"Raw Material Released for Production","description":"87.5 kg of SS316 (LOT-2025-SS316-0891) allocated to Ball Valve production order VBC-2IN-316-2025-001. Cleared for production floor."}'::jsonb,
     t1),

    -- Packaging after QC pass
    (cid, b01, 'packaging.completed', t1 + interval '10 days', 'ops@company.sa', 'production_order',
     '{"title":"Packaging & Labelling Complete","description":"250 units packed in VCI-coated cartons. SFDA traceability labels and QR codes applied per SOP-PKG-007. Delivery notes raised. Ready for dispatch."}'::jsonb,
     t1 + interval '10 days'),

    -- Three delivery confirmations
    (cid, b01, 'distribution.delivered', t1 + interval '13 days', 'logistics@company.sa', 'sales',
     '{"title":"Shipment Delivered — Saudi Aramco","description":"120 units confirmed received at Jubail Industrial Area. DN-SA-2025-0441 delivery note signed by receiving supervisor. Customer acceptance complete."}'::jsonb,
     t1 + interval '13 days'),

    (cid, b01, 'distribution.delivered', t1 + interval '15 days', 'logistics@company.sa', 'sales',
     '{"title":"Shipment Delivered — Sipchem Jubail","description":"80 units confirmed received at Plant 4. DN-SPC-2025-0217 delivery note signed. Plant 4 process isolation upgrade completed."}'::jsonb,
     t1 + interval '15 days'),

    (cid, b01, 'distribution.delivered', t1 + interval '18 days', 'logistics@company.sa', 'sales',
     '{"title":"Shipment Delivered — Maaden Mining","description":"50 units confirmed received at Wa''ad Al Shamal. DN-MAD-2025-0089 delivery note signed. Potash plant valve replacement program complete."}'::jsonb,
     t1 + interval '18 days');

  -- ══════════════════════════════════════════════════════════════
  -- STORY 2 — Hydraulic Cylinder 50mm
  -- Materials → Conditional QC → QC Fail → CAPA Open → CAPA Closed
  -- (No shipment — batch was scrapped)
  -- ══════════════════════════════════════════════════════════════

  INSERT INTO batch_journey_events
    (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
  VALUES
    (cid, b02, 'raw_material.received', t2 - interval '2 days', 'warehouse@company.sa', 'raw_material',
     '{"title":"Raw Materials Received","description":"Chrome rod LOT-2025-CRROD-0115 (300 kg) from Yanbu Precision Engineering Ltd and Carbon steel LOT-2025-CS235-0442 (800 kg) from Gulf Steel Industries LLC received. Both deliveries complete — incoming QC pending."}'::jsonb,
     t2 - interval '2 days'),

    (cid, b02, 'incoming_qc.conditional', t2 - interval '1 day', 'qa@company.sa', 'raw_material',
     '{"title":"Incoming QC — Conditional Release","description":"LOT-2025-CS235-0442 (Carbon steel): PASS — dimensions and mill cert confirmed. LOT-2025-CRROD-0115 (Chrome rod): hardness deferred to in-process Rockwell check per revised QCP-011 Rev 2. Both lots conditionally released for production start."}'::jsonb,
     t2 - interval '1 day'),

    (cid, b02, 'raw_material.released', t2, 'qa@company.sa', 'raw_material',
     '{"title":"Raw Materials Released for Production","description":"45 kg chrome rod (LOT-2025-CRROD-0115) and 120 kg carbon steel (LOT-2025-CS235-0442) allocated to Hydraulic Cylinder batch HPC-50-200-2025-080. Conditional release — mandatory in-process Rockwell hardness check required at machining stage."}'::jsonb,
     t2);

  -- ══════════════════════════════════════════════════════════════
  -- STORY 3 — Safety Relief Valve 0.5in 10 bar
  -- Materials → QC Pass → 3 Deliveries → Recall → CAPA
  -- ══════════════════════════════════════════════════════════════

  INSERT INTO batch_journey_events
    (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
  VALUES
    (cid, b03, 'raw_material.received', t3 - interval '1 day', 'warehouse@company.sa', 'raw_material',
     '{"title":"Raw Materials Received","description":"Carbon steel LOT-2025-CS235-0442 (62 kg), SS316 LOT-2025-SS316-0891 (18 kg), and NBR sheet LOT-2025-NBR-0223 (3 sheets) received. Spring assemblies (Lot SHV-2025-INC-0044) from SHV-Springs also received — Inconel 625 CoC on file."}'::jsonb,
     t3 - interval '1 day'),

    (cid, b03, 'incoming_qc.approved', t3, 'qa@company.sa', 'raw_material',
     '{"title":"Incoming QC Approved","description":"All incoming lots passed visual and dimensional inspection. Mill certs reviewed and filed. Spring assembly CoC declares Inconel 625 — XRF/PMI not performed at this stage per standard practice. All materials approved for production."}'::jsonb,
     t3),

    (cid, b03, 'raw_material.released', t3, 'qa@company.sa', 'raw_material',
     '{"title":"Raw Materials Released for Production","description":"Carbon steel, SS316, NBR sheet, and spring assemblies (SHV-2025-INC-0044) allocated to Safety Relief Valve batch VSR-05-010-2025-150. All materials cleared for production floor."}'::jsonb,
     t3),

    -- Three delivery confirmations
    (cid, b03, 'distribution.delivered', t3 + interval '11 days', 'logistics@company.sa', 'sales',
     '{"title":"Shipment Delivered — Tasnee Petrochemicals","description":"60 units confirmed received at Jubail Industrial Area. DN-TAS-2025-0388 delivery note signed. Units installed in process safety system. Installation complete."}'::jsonb,
     t3 + interval '11 days'),

    (cid, b03, 'distribution.delivered', t3 + interval '13 days', 'logistics@company.sa', 'sales',
     '{"title":"Shipment Delivered — National Gas Co.","description":"55 units confirmed received at NGIC Riyadh facility. DN-NGC-2025-0154 delivery note signed. Pipeline pressure management system operational."}'::jsonb,
     t3 + interval '13 days'),

    (cid, b03, 'distribution.delivered', t3 + interval '15 days', 'logistics@company.sa', 'sales',
     '{"title":"Shipment Delivered — Advanced Polypropylene Co.","description":"35 units confirmed received at Jubail reactor facility. DN-APC-2025-0071 delivery note signed. Polypropylene reactor safety system commissioned."}'::jsonb,
     t3 + interval '15 days');

  RAISE NOTICE '=== Journey events patch complete ===';
  RAISE NOTICE 'batch_01 (Ball Valve): 7 events — full lifecycle with 3 deliveries';
  RAISE NOTICE 'batch_02 (Hydraulic Cylinder): 3 events — materials + conditional QC (QC fail + CAPA synthesised by client)';
  RAISE NOTICE 'batch_03 (Safety Relief Valve): 6 events — materials + 3 deliveries (recall + CAPA synthesised by client)';
  RAISE NOTICE '';
  RAISE NOTICE 'Each batch additionally gets these SYNTHESISED events from client-side data:';
  RAISE NOTICE '  production.created (order.created_at)';
  RAISE NOTICE '  production.started / production.completed';
  RAISE NOTICE '  qc_inspection.passed / failed (batch_qc_results)';
  RAISE NOTICE '  distribution.shipped x N (sales)';
  RAISE NOTICE '  capa.opened / capa.closed (capas)';
  RAISE NOTICE '  recall.initiated / recall.closed (recalls)';

END;
$$;
