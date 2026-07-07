-- ============================================================
-- TraceFlow — Complete Demo Data Seed
-- File: seed_complete_demo_data.sql
-- ============================================================
--
-- Purpose
--   Brings every supporting batch (b04–b14) up to the same
--   showcase quality as the Ball Valve (VBC-2IN-316):
--     ✓ BOM rows already added by seed_bom_patch.sql (guarded)
--     ✓ QC PASS results (incl. VFD b14 fix + Flange b10 rework)
--     ✓ Batches + Distribution records for every completed batch
--     ✓ Sales records (lifecycle demo already has most)
--     ✓ batch_journey_events lifecycle milestones
--     ✓ scan_events for analytics charts
--     ✓ quality_inspections formal records
--
-- PREREQUISITES
--   seed_lifecycle_demo.sql and seed_bom_patch.sql must have run.
--
-- IDEMPOTENT — safe to run multiple times.
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

DO $$
DECLARE
  v_cid          uuid;
  v_uid          uuid;   -- any user in the company (for activity logs)
  v_t_base       timestamptz;

  -- Suppliers
  v_s_gulf   uuid;
  v_s_sabic  uuid;
  v_s_aramo  uuid;
  v_s_yanbu  uuid;

  -- Lot IDs (resolved after insert)
  v_lot_cs235_611  uuid;
  v_lot_ss316_1047 uuid;
  v_lot_copper0331 uuid;
  v_lot_hdpe0178   uuid;
  v_lot_nbr0203    uuid;
  v_lot_ptfe0054   uuid;

  -- Product IDs
  v_p_bolt   uuid;   -- IFB-M12-880
  v_p_nut    uuid;   -- IFN-M12-934
  v_p_gate   uuid;   -- VGV-DN50-16
  v_p_mccb   uuid;   -- ELM-3P-250A
  v_p_vfd    uuid;   -- ELV-7K5-VFD
  v_p_gear   uuid;   -- HPG-16CC-250
  v_p_flange uuid;   -- SPF-DN80-40
  v_p_helmet uuid;   -- PPH-CG-WHT

  -- Production order IDs (batch_qc_results.batch_id, scan_events.batch_id)
  v_b04  uuid;   -- Steel Bolt 5 000  completed QC pass
  v_b05  uuid;   -- S/S Nut 8 000     completed QC pass
  v_b06  uuid;   -- Gate Valve 120    completed QC pass
  v_b07  uuid;   -- MCCB 200          completed QC pass
  v_b08  uuid;   -- VFD 75            completed QC FAIL  → skip dist
  v_b09  uuid;   -- Gear Pump 300     completed QC pass
  v_b10  uuid;   -- Flange 500        completed QC hold  → add rework PASS
  v_b11  uuid;   -- Helmet 1 200      completed QC pass
  v_b14  uuid;   -- VFD 60            in_progress → promote to completed + PASS

  -- batches table IDs (separate UUIDs — dist_records.batch_id → batches.id)
  v_db04  uuid;
  v_db05  uuid;
  v_db06  uuid;
  v_db07  uuid;
  v_db09  uuid;
  v_db10  uuid;
  v_db11  uuid;
  v_db14  uuid;   -- VFD second batch (the passing one)

  -- batch_type first label (discovered at runtime)
  v_bt_first text;

  v_i int;

BEGIN

  -- ── 0. Resolve company & base timestamp ──────────────────────
  SELECT c.id,
         (SELECT up.user_id FROM user_profiles up
          WHERE up.company_id = c.id LIMIT 1)
  INTO   v_cid, v_uid
  FROM   companies c
  ORDER  BY c.created_at
  LIMIT  1;

  IF v_cid IS NULL THEN
    RAISE EXCEPTION 'No company found. Run onboarding then seed_lifecycle_demo.sql first.';
  END IF;

  SELECT created_at INTO v_t_base FROM products
  WHERE company_id = v_cid AND sku = 'VBC-2IN-316' LIMIT 1;
  IF v_t_base IS NULL THEN
    v_t_base := now() - interval '90 days';
  END IF;

  RAISE NOTICE 'Company: %  base: %', v_cid, v_t_base;

  -- ── 0b. Discover batch_type enum ─────────────────────────────
  SELECT e.enumlabel INTO v_bt_first
  FROM   pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE  t.typname = 'batch_type'
  ORDER  BY e.enumsortorder
  LIMIT  1;

  IF v_bt_first IS NULL THEN
    RAISE EXCEPTION 'batch_type enum not found — batches table may not be installed';
  END IF;
  RAISE NOTICE 'batch_type first label: %', v_bt_first;

  -- ── 1. Resolve suppliers ──────────────────────────────────────
  SELECT id INTO v_s_gulf  FROM suppliers WHERE company_id = v_cid AND name ILIKE 'Gulf Steel%'        LIMIT 1;
  SELECT id INTO v_s_sabic FROM suppliers WHERE company_id = v_cid AND name ILIKE 'SABIC%'             LIMIT 1;
  SELECT id INTO v_s_aramo FROM suppliers WHERE company_id = v_cid AND name ILIKE 'Arabian Valve%'     LIMIT 1;
  SELECT id INTO v_s_yanbu FROM suppliers WHERE company_id = v_cid AND name ILIKE 'Yanbu Precision%'   LIMIT 1;

  RAISE NOTICE 'Suppliers — Gulf:% SABIC:% Aramo:% Yanbu:%',
    v_s_gulf, v_s_sabic, v_s_aramo, v_s_yanbu;

  -- ── 2. Resolve raw_material_lot IDs (created by seed_bom_patch.sql) ──
  SELECT id INTO v_lot_cs235_611  FROM raw_material_lots WHERE company_id = v_cid AND lot_number = 'LOT-2025-CS235-0611'  LIMIT 1;
  SELECT id INTO v_lot_ss316_1047 FROM raw_material_lots WHERE company_id = v_cid AND lot_number = 'LOT-2025-SS316-1047'  LIMIT 1;
  SELECT id INTO v_lot_copper0331 FROM raw_material_lots WHERE company_id = v_cid AND lot_number = 'LOT-2025-CUW4-0331'  LIMIT 1;
  SELECT id INTO v_lot_hdpe0178   FROM raw_material_lots WHERE company_id = v_cid AND lot_number = 'LOT-2025-HDPE-0178'  LIMIT 1;
  SELECT id INTO v_lot_nbr0203    FROM raw_material_lots WHERE company_id = v_cid AND lot_number = 'LOT-2025-NBR-0203'   LIMIT 1;
  SELECT id INTO v_lot_ptfe0054   FROM raw_material_lots WHERE company_id = v_cid AND lot_number = 'LOT-2025-PTFE-0054'  LIMIT 1;

  RAISE NOTICE 'Lots — CS235:% SS316:% Copper:% HDPE:% NBR:% PTFE:%',
    v_lot_cs235_611, v_lot_ss316_1047, v_lot_copper0331, v_lot_hdpe0178, v_lot_nbr0203, v_lot_ptfe0054;

  -- ── 3. Resolve product IDs ────────────────────────────────────
  SELECT id INTO v_p_bolt   FROM products WHERE company_id = v_cid AND sku = 'IFB-M12-880'  LIMIT 1;
  SELECT id INTO v_p_nut    FROM products WHERE company_id = v_cid AND sku = 'IFN-M12-934'  LIMIT 1;
  SELECT id INTO v_p_gate   FROM products WHERE company_id = v_cid AND sku = 'VGV-DN50-16'  LIMIT 1;
  SELECT id INTO v_p_mccb   FROM products WHERE company_id = v_cid AND sku = 'ELM-3P-250A'  LIMIT 1;
  SELECT id INTO v_p_vfd    FROM products WHERE company_id = v_cid AND sku = 'ELV-7K5-VFD'  LIMIT 1;
  SELECT id INTO v_p_gear   FROM products WHERE company_id = v_cid AND sku = 'HPG-16CC-250' LIMIT 1;
  SELECT id INTO v_p_flange FROM products WHERE company_id = v_cid AND sku = 'SPF-DN80-40'  LIMIT 1;
  SELECT id INTO v_p_helmet FROM products WHERE company_id = v_cid AND sku = 'PPH-CG-WHT'   LIMIT 1;

  -- ── 4. Resolve production order IDs ──────────────────────────
  SELECT po.id INTO v_b04 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'IFB-M12-880'  AND po.quantity = 5000  AND po.company_id = v_cid LIMIT 1;
  SELECT po.id INTO v_b05 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'IFN-M12-934'  AND po.quantity = 8000  AND po.company_id = v_cid LIMIT 1;
  SELECT po.id INTO v_b06 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'VGV-DN50-16'  AND po.quantity = 120   AND po.company_id = v_cid LIMIT 1;
  SELECT po.id INTO v_b07 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'ELM-3P-250A'  AND po.quantity = 200   AND po.company_id = v_cid LIMIT 1;
  SELECT po.id INTO v_b08 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'ELV-7K5-VFD'  AND po.quantity = 75    AND po.company_id = v_cid LIMIT 1;
  SELECT po.id INTO v_b09 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'HPG-16CC-250' AND po.quantity = 300   AND po.company_id = v_cid LIMIT 1;
  SELECT po.id INTO v_b10 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'SPF-DN80-40'  AND po.quantity = 500   AND po.company_id = v_cid LIMIT 1;
  SELECT po.id INTO v_b11 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'PPH-CG-WHT'   AND po.quantity = 1200  AND po.company_id = v_cid LIMIT 1;
  SELECT po.id INTO v_b14 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'ELV-7K5-VFD'  AND po.quantity = 60    AND po.company_id = v_cid LIMIT 1;

  RAISE NOTICE 'Orders — b04:% b05:% b06:% b07:% b08:%', v_b04, v_b05, v_b06, v_b07, v_b08;
  RAISE NOTICE '         b09:% b10:% b11:% b14:%',        v_b09, v_b10, v_b11, v_b14;

  -- ════════════════════════════════════════════════════════════
  -- 5. PROMOTE VFD b14  in_progress → completed
  --    The first VFD batch (b08, 75 units) already has a QC FAIL.
  --    b14 (60 units) is the replacement run. Mark it completed
  --    so resolveToUUID() on the trace page finds a passing batch.
  -- ════════════════════════════════════════════════════════════
  IF v_b14 IS NOT NULL THEN
    UPDATE production_orders
    SET    status       = 'completed',
           completed_at = v_t_base + interval '95 days'
    WHERE  id           = v_b14
      AND  status      <> 'completed';
    RAISE NOTICE '  ✓ VFD b14 promoted to completed.';
  END IF;

  -- ════════════════════════════════════════════════════════════
  -- 6. QC RESULTS
  --    ON CONFLICT DO NOTHING — lifecycle demo already added pass
  --    results for b04, b05, b06, b07, b09, b11.
  -- ════════════════════════════════════════════════════════════

  -- b04 Steel Bolt: already has pass in lifecycle demo — idempotent guard
  IF v_b04 IS NOT NULL THEN
    INSERT INTO batch_qc_results
      (batch_id, status, inspector_name, notes, inspected_at, company_id, created_at)
    VALUES
      (v_b04, 'pass', 'Khalid Al-Rashidi',
       'Final inspection: 500-unit AQL 0.65 sample. Thread GO/NO-GO PASS 100%. '
       'Tensile 880 MPa (spec ≥830 MPa). Zinc plating 8.5 μm (spec ≥8 μm). '
       'Salt spray >96 h. Certificate CC-2025-0904 issued. 5 000 units cleared.',
       v_t_base + interval '16 days', v_cid, v_t_base + interval '16 days')
    ON CONFLICT DO NOTHING;
  END IF;

  -- b05 Stainless Nut: already has pass
  IF v_b05 IS NOT NULL THEN
    INSERT INTO batch_qc_results
      (batch_id, status, inspector_name, notes, inspected_at, company_id, created_at)
    VALUES
      (v_b05, 'pass', 'Mohammed Al-Harbi',
       'Final: 400-unit AQL 0.65. Pitch gauge M12×1.75 PASS. Hardness 241 HB avg '
       '(spec 230–300 HB). Material cert vs EN ISO 3506-2 reviewed. '
       '8 000 nuts certified. Certificate CC-2025-0907.',
       v_t_base + interval '19 days', v_cid, v_t_base + interval '19 days')
    ON CONFLICT DO NOTHING;
  END IF;

  -- b06 Gate Valve: already has pass
  IF v_b06 IS NOT NULL THEN
    INSERT INTO batch_qc_results
      (batch_id, status, inspector_name, notes, inspected_at, company_id, created_at)
    VALUES
      (v_b06, 'pass', 'Sara Al-Qahtani',
       '100% pressure test at 1.5× WP (24 bar). Seat leakage: nil (API 598 Class VI). '
       'Handwheel torque 32 Nm. Rising stem travel ±0.1 mm. '
       '120 units cleared. CC-2025-0912 issued.',
       v_t_base + interval '27 days', v_cid, v_t_base + interval '27 days')
    ON CONFLICT DO NOTHING;
  END IF;

  -- b07 MCCB: already has pass
  IF v_b07 IS NOT NULL THEN
    INSERT INTO batch_qc_results
      (batch_id, status, inspector_name, notes, inspected_at, company_id, created_at)
    VALUES
      (v_b07, 'pass', 'Omar Al-Shamrani',
       'IEC 60947-2 functional test: 200 units. Overload trip 10× rated: 28 ms avg '
       '(spec ≤40 ms). Short-circuit interruption 36 kA PASS. '
       'Insulation ≥500 MΩ. Certificate CC-2025-0918. 200 units cleared.',
       v_t_base + interval '31 days', v_cid, v_t_base + interval '31 days')
    ON CONFLICT DO NOTHING;
  END IF;

  -- b09 Gear Pump: already has pass
  IF v_b09 IS NOT NULL THEN
    INSERT INTO batch_qc_results
      (batch_id, status, inspector_name, notes, inspected_at, company_id, created_at)
    VALUES
      (v_b09, 'pass', 'Khalid Al-Rashidi',
       'Full-flow efficiency test ISO 4409: 95.2% at 1 450 rpm (spec ≥93%). '
       'Hydrostatic 1.5× rated: 375 bar PASS. Noise 68 dB(A) (spec ≤72 dB). '
       'External leakage: nil. 300 units cleared. CC-2025-0924.',
       v_t_base + interval '47 days', v_cid, v_t_base + interval '47 days')
    ON CONFLICT DO NOTHING;
  END IF;

  -- b10 Flange rework confirmation: lifecycle demo inserted 'hold' — add resolution pass
  IF v_b10 IS NOT NULL THEN
    INSERT INTO batch_qc_results
      (batch_id, status, inspector_name, notes, inspected_at, company_id, created_at)
    VALUES
      (v_b10, 'pass', 'Sara Al-Qahtani',
       'Post-rework re-inspection of 12 non-conforming flanges from QC hold. '
       'Facing re-ground to Ra 1.8 μm (spec ≤3.2 μm). Dimensional recheck PASS. '
       'All 500 flanges now cleared. CC-2025-0931 issued. ASME B16.5 Class 300 compliant.',
       v_t_base + interval '56 days', v_cid, v_t_base + interval '56 days')
    ON CONFLICT DO NOTHING;
  END IF;

  -- b11 Helmet: already has pass
  IF v_b11 IS NOT NULL THEN
    INSERT INTO batch_qc_results
      (batch_id, status, inspector_name, notes, inspected_at, company_id, created_at)
    VALUES
      (v_b11, 'pass', 'Abdullah Al-Zahrani',
       'EN 397 impact attenuation: 3.5 kN max (spec ≤5 kN) — 5 units sample. '
       'Penetration test: PASS. Chin strap 50 N 25 mm elongation. '
       'UV aging 500 h: no cracking. 1 200 helmets certified. CC-2025-0936.',
       v_t_base + interval '57 days', v_cid, v_t_base + interval '57 days')
    ON CONFLICT DO NOTHING;
  END IF;

  -- b14 VFD replacement batch: add QC PASS (EMC fix applied)
  IF v_b14 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batch_qc_results WHERE batch_id = v_b14 AND status = 'pass' AND company_id = v_cid
  ) THEN
    INSERT INTO batch_qc_results
      (batch_id, status, inspector_name, notes, inspected_at, company_id, created_at)
    VALUES
      (v_b14, 'pass', 'Ahmed Al-Mutairi',
       'Replacement batch after b08 EMC FAIL. PCB filter cap C47 upgraded 100 nF → 220 nF '
       'per ECO-2025-0014. EMC re-test EN 55011 Class A: emissions 4 dB below limit at 150 kHz. '
       'All 60 VFDs cleared. Certificate CC-2025-0944.',
       v_t_base + interval '98 days', v_cid, v_t_base + interval '98 days');
    RAISE NOTICE '  ✓ VFD b14: QC PASS added.';
  END IF;

  -- ════════════════════════════════════════════════════════════
  -- 7. QUALITY INSPECTIONS  (formal records — batch_id is TEXT)
  -- ════════════════════════════════════════════════════════════

  IF v_b04 IS NOT NULL THEN
    INSERT INTO quality_inspections
      (batch_id, inspector_id, inspector_name, inspection_date, inspection_type,
       status, overall_score, notes, company_id, created_at, updated_at)
    VALUES
      (v_b04::text, 'INS-001', 'Khalid Al-Rashidi',
       (v_t_base + interval '16 days')::date, 'final', 'passed', 96.0,
       'AQL 0.65 sample of 500. Thread, tensile, plating, salt spray: all PASS. CC-2025-0904.',
       v_cid, v_t_base + interval '16 days', v_t_base + interval '16 days')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_b05 IS NOT NULL THEN
    INSERT INTO quality_inspections
      (batch_id, inspector_id, inspector_name, inspection_date, inspection_type,
       status, overall_score, notes, company_id, created_at, updated_at)
    VALUES
      (v_b05::text, 'INS-002', 'Mohammed Al-Harbi',
       (v_t_base + interval '19 days')::date, 'final', 'passed', 93.5,
       'Pitch gauge, hardness, material cert: all PASS. 8 000 nuts certified.',
       v_cid, v_t_base + interval '19 days', v_t_base + interval '19 days')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_b06 IS NOT NULL THEN
    INSERT INTO quality_inspections
      (batch_id, inspector_id, inspector_name, inspection_date, inspection_type,
       status, overall_score, notes, company_id, created_at, updated_at)
    VALUES
      (v_b06::text, 'INS-004', 'Sara Al-Qahtani',
       (v_t_base + interval '27 days')::date, 'final', 'passed', 97.0,
       'Pressure 24 bar, seat leakage nil, torque 32 Nm. API 598 Class VI. 120 units cleared.',
       v_cid, v_t_base + interval '27 days', v_t_base + interval '27 days')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_b07 IS NOT NULL THEN
    INSERT INTO quality_inspections
      (batch_id, inspector_id, inspector_name, inspection_date, inspection_type,
       status, overall_score, notes, company_id, created_at, updated_at)
    VALUES
      (v_b07::text, 'INS-005', 'Omar Al-Shamrani',
       (v_t_base + interval '31 days')::date, 'final', 'passed', 98.5,
       'IEC 60947-2 trip, short-circuit, insulation: all PASS. 200 MCCBs certified.',
       v_cid, v_t_base + interval '31 days', v_t_base + interval '31 days')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_b09 IS NOT NULL THEN
    INSERT INTO quality_inspections
      (batch_id, inspector_id, inspector_name, inspection_date, inspection_type,
       status, overall_score, notes, company_id, created_at, updated_at)
    VALUES
      (v_b09::text, 'INS-001', 'Khalid Al-Rashidi',
       (v_t_base + interval '47 days')::date, 'final', 'passed', 95.5,
       'Efficiency 95.2%, pressure 375 bar, noise 68 dB(A). 300 gear pumps cleared.',
       v_cid, v_t_base + interval '47 days', v_t_base + interval '47 days')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_b10 IS NOT NULL THEN
    INSERT INTO quality_inspections
      (batch_id, inspector_id, inspector_name, inspection_date, inspection_type,
       status, overall_score, notes, company_id, created_at, updated_at)
    VALUES
      (v_b10::text, 'INS-004', 'Sara Al-Qahtani',
       (v_t_base + interval '56 days')::date, 'final', 'passed', 91.0,
       'Post-rework: Ra 1.8 μm after re-grind. All 500 flanges cleared. ASME B16.5 CC-2025-0931.',
       v_cid, v_t_base + interval '56 days', v_t_base + interval '56 days')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_b11 IS NOT NULL THEN
    INSERT INTO quality_inspections
      (batch_id, inspector_id, inspector_name, inspection_date, inspection_type,
       status, overall_score, notes, company_id, created_at, updated_at)
    VALUES
      (v_b11::text, 'INS-007', 'Abdullah Al-Zahrani',
       (v_t_base + interval '57 days')::date, 'final', 'passed', 98.5,
       'EN 397 impact, penetration, chin strap, UV aging: all PASS. 1 200 helmets certified.',
       v_cid, v_t_base + interval '57 days', v_t_base + interval '57 days')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_b14 IS NOT NULL THEN
    INSERT INTO quality_inspections
      (batch_id, inspector_id, inspector_name, inspection_date, inspection_type,
       status, overall_score, notes, company_id, created_at, updated_at)
    VALUES
      (v_b14::text, 'INS-003', 'Ahmed Al-Mutairi',
       (v_t_base + interval '98 days')::date, 'final', 'passed', 97.0,
       'EMC EN 55011 Class A PASS after C47 cap upgrade. Full functional test. 60 VFDs cleared.',
       v_cid, v_t_base + interval '98 days', v_t_base + interval '98 days')
    ON CONFLICT DO NOTHING;
  END IF;

  RAISE NOTICE 'QC results seeded.';

  -- ════════════════════════════════════════════════════════════
  -- 8. BATCHES ROWS  (required by distribution_records FK)
  --    batches.id ≠ production_orders.id — separate UUIDs.
  --    ON CONFLICT (id) DO NOTHING — safe to re-run.
  -- ════════════════════════════════════════════════════════════

  v_db04  := gen_random_uuid();
  v_db05  := gen_random_uuid();
  v_db06  := gen_random_uuid();
  v_db07  := gen_random_uuid();
  v_db09  := gen_random_uuid();
  v_db10  := gen_random_uuid();
  v_db11  := gen_random_uuid();
  v_db14  := gen_random_uuid();

  IF v_b04 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batches WHERE production_order_id = v_b04 AND company_id = v_cid
  ) THEN
    INSERT INTO batches
      (id, company_id, type, sku, name, lot_number,
       quantity_initial, quantity_remaining, product_id, production_order_id)
    VALUES
      (v_db04, v_cid, v_bt_first::batch_type, 'IFB-M12-880',
       'Steel Hex Bolt M12x80 Grade 8.8 — Batch 2025-Q1-004',
       'LOT-2025-BOLT-0004', 5000, 800, v_p_bolt, v_b04)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    SELECT id INTO v_db04 FROM batches WHERE production_order_id = v_b04 AND company_id = v_cid LIMIT 1;
  END IF;

  IF v_b05 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batches WHERE production_order_id = v_b05 AND company_id = v_cid
  ) THEN
    INSERT INTO batches
      (id, company_id, type, sku, name, lot_number,
       quantity_initial, quantity_remaining, product_id, production_order_id)
    VALUES
      (v_db05, v_cid, v_bt_first::batch_type, 'IFN-M12-934',
       'Stainless Hex Nut M12 DIN 934 — Batch 2025-Q1-005',
       'LOT-2025-NUT-0005', 8000, 1500, v_p_nut, v_b05)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    SELECT id INTO v_db05 FROM batches WHERE production_order_id = v_b05 AND company_id = v_cid LIMIT 1;
  END IF;

  IF v_b06 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batches WHERE production_order_id = v_b06 AND company_id = v_cid
  ) THEN
    INSERT INTO batches
      (id, company_id, type, sku, name, lot_number,
       quantity_initial, quantity_remaining, product_id, production_order_id)
    VALUES
      (v_db06, v_cid, v_bt_first::batch_type, 'VGV-DN50-16',
       'Gate Valve DN50 PN16 Carbon Steel — Batch 2025-Q1-006',
       'LOT-2025-GATE-0006', 120, 30, v_p_gate, v_b06)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    SELECT id INTO v_db06 FROM batches WHERE production_order_id = v_b06 AND company_id = v_cid LIMIT 1;
  END IF;

  IF v_b07 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batches WHERE production_order_id = v_b07 AND company_id = v_cid
  ) THEN
    INSERT INTO batches
      (id, company_id, type, sku, name, lot_number,
       quantity_initial, quantity_remaining, product_id, production_order_id)
    VALUES
      (v_db07, v_cid, v_bt_first::batch_type, 'ELM-3P-250A',
       'MCCB 3-Pole 250A Fixed Mount — Batch 2025-Q1-007',
       'LOT-2025-MCCB-0007', 200, 100, v_p_mccb, v_b07)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    SELECT id INTO v_db07 FROM batches WHERE production_order_id = v_b07 AND company_id = v_cid LIMIT 1;
  END IF;

  IF v_b09 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batches WHERE production_order_id = v_b09 AND company_id = v_cid
  ) THEN
    INSERT INTO batches
      (id, company_id, type, sku, name, lot_number,
       quantity_initial, quantity_remaining, product_id, production_order_id)
    VALUES
      (v_db09, v_cid, v_bt_first::batch_type, 'HPG-16CC-250',
       'Gear Pump 16cc 250 bar Hydraulic — Batch 2025-Q1-009',
       'LOT-2025-GEAR-0009', 300, 150, v_p_gear, v_b09)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    SELECT id INTO v_db09 FROM batches WHERE production_order_id = v_b09 AND company_id = v_cid LIMIT 1;
  END IF;

  IF v_b10 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batches WHERE production_order_id = v_b10 AND company_id = v_cid
  ) THEN
    INSERT INTO batches
      (id, company_id, type, sku, name, lot_number,
       quantity_initial, quantity_remaining, product_id, production_order_id)
    VALUES
      (v_db10, v_cid, v_bt_first::batch_type, 'SPF-DN80-40',
       'Weld Neck Flange DN80 PN40 — Batch 2025-Q1-010',
       'LOT-2025-FLG-0010', 500, 300, v_p_flange, v_b10)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    SELECT id INTO v_db10 FROM batches WHERE production_order_id = v_b10 AND company_id = v_cid LIMIT 1;
  END IF;

  IF v_b11 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batches WHERE production_order_id = v_b11 AND company_id = v_cid
  ) THEN
    INSERT INTO batches
      (id, company_id, type, sku, name, lot_number,
       quantity_initial, quantity_remaining, product_id, production_order_id)
    VALUES
      (v_db11, v_cid, v_bt_first::batch_type, 'PPH-CG-WHT',
       'Safety Helmet Class G EN397 White — Batch 2025-Q1-011',
       'LOT-2025-HLM-0011', 1200, 600, v_p_helmet, v_b11)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    SELECT id INTO v_db11 FROM batches WHERE production_order_id = v_b11 AND company_id = v_cid LIMIT 1;
  END IF;

  IF v_b14 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batches WHERE production_order_id = v_b14 AND company_id = v_cid
  ) THEN
    INSERT INTO batches
      (id, company_id, type, sku, name, lot_number,
       quantity_initial, quantity_remaining, product_id, production_order_id)
    VALUES
      (v_db14, v_cid, v_bt_first::batch_type, 'ELV-7K5-VFD',
       'Variable Frequency Drive 7.5kW — Batch 2025-Q2-014',
       'LOT-2025-VFD-0014', 60, 20, v_p_vfd, v_b14)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    SELECT id INTO v_db14 FROM batches WHERE production_order_id = v_b14 AND company_id = v_cid LIMIT 1;
  END IF;

  RAISE NOTICE 'Batches rows resolved.';

  -- ════════════════════════════════════════════════════════════
  -- 9. DISTRIBUTION RECORDS
  --    ON CONFLICT DO NOTHING — FK (company_id, batch_id) unique.
  -- ════════════════════════════════════════════════════════════

  IF v_db04 IS NOT NULL THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (v_cid, v_db04, 'distributor'::recipient_type,
       'Saudi Electricity Company — Riyadh Substation Div.',
       2000, v_t_base + interval '20 days',
       'DN-SEC-2025-0312 | 2 000 bolts | MV substation structural assembly. PO SEC-PO-61120. Confirmed delivery.'),
      (v_cid, v_db04, 'distributor'::recipient_type,
       'Rawabi Holding Group — Contracting Div.',
       1200, v_t_base + interval '23 days',
       'DN-RAW-2025-0188 | 1 200 bolts | Building structural steel. Customer confirmed delivery.'),
      (v_cid, v_db04, 'distributor'::recipient_type,
       'Maaden Mining Co. — Wa''ad Al Shamal',
       1000, v_t_base + interval '26 days',
       'DN-MAD-2025-0201 | 1 000 bolts | Mining conveyor frame fastening. Received and signed.')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_db05 IS NOT NULL THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (v_cid, v_db05, 'distributor'::recipient_type,
       'Al Rajhi Industrial LLC',
       3500, v_t_base + interval '22 days',
       'DN-ARJ-2025-0095 | 3 500 nuts | Process piping flange assemblies. Accepted at Al Rajhi warehouse.'),
      (v_cid, v_db05, 'distributor'::recipient_type,
       'Kingdom Contracting Est.',
       3000, v_t_base + interval '25 days',
       'DN-KCE-2025-0047 | 3 000 nuts | Steel structure project Al-Qiddiya. Customer signed.')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_db06 IS NOT NULL THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (v_cid, v_db06, 'distributor'::recipient_type,
       'SABIC Manufacturing — Yanbu Complex',
       60, v_t_base + interval '30 days',
       'DN-SAB-2025-0443 | 60 gate valves | Utility water isolation DN50 upgrade. PO YNC-PO-8821.'),
      (v_cid, v_db06, 'distributor'::recipient_type,
       'Tasnee Petrochemicals — Jubail',
       30, v_t_base + interval '33 days',
       'DN-TAS-2025-0218 | 30 gate valves | Plant 2 cooling water circuit. Delivery confirmed.'),
      (v_cid, v_db06, 'distributor'::recipient_type,
       'Dar Al-Riyadh Consultants',
       30, v_t_base + interval '36 days',
       'DN-DAR-2025-0071 | 30 gate valves | Water treatment plant instrument air. Signed.')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_db07 IS NOT NULL THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (v_cid, v_db07, 'distributor'::recipient_type,
       'Zahran Maintenance Co.',
       100, v_t_base + interval '35 days',
       'DN-ZMC-2025-0161 | 100 MCCBs | Main distribution board upgrade. IEC 60947-2 certs attached.'),
      (v_cid, v_db07, 'distributor'::recipient_type,
       'Al Khaleej Electrical Contracting',
       70, v_t_base + interval '38 days',
       'DN-AKE-2025-0089 | 70 MCCBs | Industrial facility panel upgrade Dammam. Customer signed.'),
      (v_cid, v_db07, 'distributor'::recipient_type,
       'SABIC Manufacturing — Yanbu Complex',
       30, v_t_base + interval '40 days',
       'DN-SAB-2025-0447 | 30 MCCBs | Sub-meter LV board. PO YNC-PO-8845. Received and signed.')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_db09 IS NOT NULL THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (v_cid, v_db09, 'distributor'::recipient_type,
       'Consolidated Contractors Company (CCC)',
       150, v_t_base + interval '50 days',
       'DN-CCC-2025-0302 | 150 gear pumps | Hydraulic power units offshore. PO CCC-PO-34477.'),
      (v_cid, v_db09, 'distributor'::recipient_type,
       'Hyundai Engineering — Yanbu LNG Project',
       100, v_t_base + interval '53 days',
       'DN-HYN-2025-0188 | 100 gear pumps | LNG secondary pump system. Customer confirmed receipt.'),
      (v_cid, v_db09, 'distributor'::recipient_type,
       'Saudi Aramco — Southern Area Engineering',
       50, v_t_base + interval '56 days',
       'DN-SA-2025-0509 | 50 gear pumps | Gas compression auxiliary lube oil. SAP-PO-94120.')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_db10 IS NOT NULL THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (v_cid, v_db10, 'distributor'::recipient_type,
       'Bakr Group Engineering',
       200, v_t_base + interval '58 days',
       'DN-BGE-2025-0244 | 200 flanges | Gas pipeline DN80 tie-in points. ASME B16.5 certs attached.'),
      (v_cid, v_db10, 'distributor'::recipient_type,
       'Arabian Industries — Dammam',
       200, v_t_base + interval '61 days',
       'DN-ARI-2025-0117 | 200 flanges | Refinery steam tracing. Delivery confirmed at AI warehouse.'),
      (v_cid, v_db10, 'distributor'::recipient_type,
       'Saudi Aramco — Abqaiq Plants',
       100, v_t_base + interval '64 days',
       'DN-SA-2025-0516 | 100 flanges | Abqaiq wellhead isolation. SAP-PO-94211. Signed.')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_db11 IS NOT NULL THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (v_cid, v_db11, 'distributor'::recipient_type,
       'Red Sea Housing Services',
       600, v_t_base + interval '60 days',
       'DN-RSH-2025-0088 | 600 helmets | Worker PPE supply Neom site. EN 397 certs provided.'),
      (v_cid, v_db11, 'distributor'::recipient_type,
       'Saudi Aramco — HSE Procurement',
       400, v_t_base + interval '63 days',
       'DN-SA-2025-0520 | 400 helmets | Annual HSE stock renewal. SAP-PO-94388. Received.'),
      (v_cid, v_db11, 'distributor'::recipient_type,
       'Tasnee Petrochemicals — HSE Dept.',
       200, v_t_base + interval '66 days',
       'DN-TAS-2025-0222 | 200 helmets | Maintenance team PPE. Customer signed delivery note.')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_db14 IS NOT NULL THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (v_cid, v_db14, 'distributor'::recipient_type,
       'Saudi Kayan Petrochemical Co.',
       35, v_t_base + interval '100 days',
       'DN-SKP-2025-0339 | 35 VFDs | Cooling tower fan speed control. EMC certs CC-2025-0944 attached.'),
      (v_cid, v_db14, 'distributor'::recipient_type,
       'Sipchem — Utilities Division',
       25, v_t_base + interval '103 days',
       'DN-SPC-2025-0277 | 25 VFDs | Boiler feed pump control. PO SPC-PO-77228. Received and signed.')
    ON CONFLICT DO NOTHING;
  END IF;

  RAISE NOTICE 'Distribution records seeded.';

  -- ════════════════════════════════════════════════════════════
  -- 10. SALES RECORDS  (ON CONFLICT DO NOTHING — lifecycle demo
  --     already seeded most; this only fills any that are missing)
  -- ════════════════════════════════════════════════════════════

  IF v_p_vfd IS NOT NULL AND v_b14 IS NOT NULL THEN
    INSERT INTO sales
      (product_id, product_name, quantity, unit_price, total_price,
       customer_name, status, sold_at, company_id, created_at)
    VALUES
      (v_p_vfd, 'Variable Frequency Drive 7.5kW', 35, 3200.00, 112000.00,
       'Saudi Kayan Petrochemical Co.', 'completed',
       v_t_base + interval '100 days', v_cid, v_t_base + interval '100 days'),
      (v_p_vfd, 'Variable Frequency Drive 7.5kW', 25, 3200.00, 80000.00,
       'Sipchem Utilities Division', 'completed',
       v_t_base + interval '103 days', v_cid, v_t_base + interval '103 days')
    ON CONFLICT DO NOTHING;
  END IF;

  RAISE NOTICE 'Sales records seeded.';

  -- ════════════════════════════════════════════════════════════
  -- 11. BATCH JOURNEY EVENTS  (full lifecycle milestones)
  -- ════════════════════════════════════════════════════════════

  -- b04 Steel Hex Bolt 5 000
  IF v_b04 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batch_journey_events WHERE batch_id = v_b04 AND company_id = v_cid
  ) THEN
    INSERT INTO batch_journey_events
      (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
    VALUES
      (v_cid, v_b04, 'raw_material.received', v_t_base + interval '6 days',
       'warehouse@company.sa', 'raw_material',
       '{"title":"Raw Materials Received","description":"Carbon steel rod S235 (LOT-2025-CS235-0611, 310 kg) received from Gulf Steel Industries. Mill cert EN 10204 3.1 — heat HN-30991. Stored in approved stock pending in-line inspection."}'::jsonb,
       v_t_base + interval '6 days'),
      (v_cid, v_b04, 'raw_material.released', v_t_base + interval '8 days',
       'qa@company.sa', 'raw_material',
       '{"title":"Raw Material Released for Production","description":"LOT-2025-CS235-0611 (Carbon steel 310 kg) passed incoming dimensional and chemical check. Released to production floor for Bolt M12x80 batch."}'::jsonb,
       v_t_base + interval '8 days'),
      (v_cid, v_b04, 'packaging.completed', v_t_base + interval '14 days',
       'ops@company.sa', 'production_order',
       '{"title":"Packaging & Labelling Complete","description":"5 000 bolts packed in 50-unit polyethylene zip bags and outer cartons. SFDA traceability labels and QR codes applied. Ready for dispatch."}'::jsonb,
       v_t_base + interval '14 days'),
      (v_cid, v_b04, 'distribution.delivered', v_t_base + interval '21 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Saudi Electricity Company","description":"2 000 bolts confirmed received at SEC Riyadh Substation Division. DN-SEC-2025-0312 delivery note signed. Customer acceptance complete."}'::jsonb,
       v_t_base + interval '21 days'),
      (v_cid, v_b04, 'distribution.delivered', v_t_base + interval '24 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Rawabi Holding Group","description":"1 200 bolts confirmed at Rawabi Contracting Division. DN-RAW-2025-0188 signed. Customer acceptance complete."}'::jsonb,
       v_t_base + interval '24 days'),
      (v_cid, v_b04, 'distribution.delivered', v_t_base + interval '27 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Maaden Mining","description":"1 000 bolts received at Wa''ad Al Shamal. DN-MAD-2025-0201 signed. Customer acceptance complete."}'::jsonb,
       v_t_base + interval '27 days')
    ON CONFLICT DO NOTHING;
    RAISE NOTICE '  ✓ Journey events: b04 (Steel Bolt)';
  END IF;

  -- b05 Stainless Nut 8 000
  IF v_b05 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batch_journey_events WHERE batch_id = v_b05 AND company_id = v_cid
  ) THEN
    INSERT INTO batch_journey_events
      (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
    VALUES
      (v_cid, v_b05, 'raw_material.received', v_t_base + interval '10 days',
       'warehouse@company.sa', 'raw_material',
       '{"title":"Raw Materials Received","description":"SS316 hex bar (LOT-2025-SS316-1047, 95 kg) received from Gulf Steel Industries. Mill cert EN 10088-3, heat HN-31044. Corrosion-resistant A2-70 grade confirmed."}'::jsonb,
       v_t_base + interval '10 days'),
      (v_cid, v_b05, 'raw_material.released', v_t_base + interval '12 days',
       'qa@company.sa', 'raw_material',
       '{"title":"Raw Material Released for Production","description":"LOT-2025-SS316-1047 passed incoming hardness (200 HB) and chemical check. 95 kg released for Hex Nut M12 batch."}'::jsonb,
       v_t_base + interval '12 days'),
      (v_cid, v_b05, 'packaging.completed', v_t_base + interval '17 days',
       'ops@company.sa', 'production_order',
       '{"title":"Packaging Complete","description":"8 000 stainless nuts bagged (100-unit moisture-resistant bags). QR traceability labels applied per SFDA guidelines. Ready for shipment."}'::jsonb,
       v_t_base + interval '17 days'),
      (v_cid, v_b05, 'distribution.delivered', v_t_base + interval '23 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Al Rajhi Industrial","description":"3 500 stainless nuts delivered and signed at Al Rajhi warehouse. DN-ARJ-2025-0095."}'::jsonb,
       v_t_base + interval '23 days'),
      (v_cid, v_b05, 'distribution.delivered', v_t_base + interval '26 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Kingdom Contracting","description":"3 000 nuts at Kingdom Contracting Al-Qiddiya site. DN-KCE-2025-0047 signed."}'::jsonb,
       v_t_base + interval '26 days')
    ON CONFLICT DO NOTHING;
    RAISE NOTICE '  ✓ Journey events: b05 (Stainless Nut)';
  END IF;

  -- b06 Gate Valve 120
  IF v_b06 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batch_journey_events WHERE batch_id = v_b06 AND company_id = v_cid
  ) THEN
    INSERT INTO batch_journey_events
      (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
    VALUES
      (v_cid, v_b06, 'raw_material.received', v_t_base + interval '15 days',
       'warehouse@company.sa', 'raw_material',
       '{"title":"Raw Materials Received","description":"Carbon steel S235 (LOT-2025-CS235-0611, 620 kg), SS316 bar (LOT-2025-SS316-1047, 75 kg), NBR sheet (LOT-2025-NBR-0203, 8 sheets) received. All CoAs verified and stored in quarantine bay."}'::jsonb,
       v_t_base + interval '15 days'),
      (v_cid, v_b06, 'incoming_qc.approved', v_t_base + interval '16 days',
       'qa@company.sa', 'raw_material',
       '{"title":"Incoming QC Approved","description":"All three lots cleared. CS235 hardness 143 HB (spec 120–170 HB). SS316 chemical cert meets EN 10088-3. NBR Shore A 70 confirmed. All released to stock."}'::jsonb,
       v_t_base + interval '16 days'),
      (v_cid, v_b06, 'raw_material.released', v_t_base + interval '18 days',
       'qa@company.sa', 'raw_material',
       '{"title":"Raw Materials Released for Production","description":"620 kg carbon steel, 75 kg SS316, 8 NBR sheets allocated to Gate Valve DN50 batch. Released to machining floor."}'::jsonb,
       v_t_base + interval '18 days'),
      (v_cid, v_b06, 'packaging.completed', v_t_base + interval '25 days',
       'ops@company.sa', 'production_order',
       '{"title":"Packaging & Labelling Complete","description":"120 gate valves individually wrapped, packed in wooden crates. SFDA labels, QR codes, and API 600 compliance tags applied."}'::jsonb,
       v_t_base + interval '25 days'),
      (v_cid, v_b06, 'distribution.delivered', v_t_base + interval '31 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — SABIC Yanbu","description":"60 gate valves delivered to SABIC Yanbu Complex. DN-SAB-2025-0443 signed. PO YNC-PO-8821 fulfilled."}'::jsonb,
       v_t_base + interval '31 days'),
      (v_cid, v_b06, 'distribution.delivered', v_t_base + interval '34 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Tasnee Petrochemicals","description":"30 gate valves delivered to Jubail Plant 2. DN-TAS-2025-0218 signed."}'::jsonb,
       v_t_base + interval '34 days'),
      (v_cid, v_b06, 'distribution.delivered', v_t_base + interval '37 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Dar Al-Riyadh","description":"30 gate valves at water treatment plant site. DN-DAR-2025-0071 signed."}'::jsonb,
       v_t_base + interval '37 days')
    ON CONFLICT DO NOTHING;
    RAISE NOTICE '  ✓ Journey events: b06 (Gate Valve)';
  END IF;

  -- b07 MCCB 200
  IF v_b07 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batch_journey_events WHERE batch_id = v_b07 AND company_id = v_cid
  ) THEN
    INSERT INTO batch_journey_events
      (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
    VALUES
      (v_cid, v_b07, 'raw_material.received', v_t_base + interval '20 days',
       'warehouse@company.sa', 'raw_material',
       '{"title":"Raw Materials Received","description":"Electrolytic copper wire (LOT-2025-CUW4-0331, 180 kg) and HDPE granules (LOT-2025-HDPE-0178, 25 kg) received. Both CoAs reviewed, stored in controlled environment."}'::jsonb,
       v_t_base + interval '20 days'),
      (v_cid, v_b07, 'raw_material.released', v_t_base + interval '22 days',
       'qa@company.sa', 'raw_material',
       '{"title":"Raw Materials Released for Production","description":"Copper wire and HDPE released to assembly line. Conductivity check ≥58 MS/m confirmed. HDPE MFI 0.31 g/10min within spec."}'::jsonb,
       v_t_base + interval '22 days'),
      (v_cid, v_b07, 'packaging.completed', v_t_base + interval '29 days',
       'ops@company.sa', 'production_order',
       '{"title":"Packaging & Labelling Complete","description":"200 MCCBs packed individually in antistatic cartons. IEC 60947-2 certificates, SFDA traceability labels, and QR codes applied."}'::jsonb,
       v_t_base + interval '29 days'),
      (v_cid, v_b07, 'distribution.delivered', v_t_base + interval '36 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Zahran Maintenance","description":"100 MCCBs delivered to Zahran Maintenance Co. DN-ZMC-2025-0161 signed. IEC certs accepted."}'::jsonb,
       v_t_base + interval '36 days'),
      (v_cid, v_b07, 'distribution.delivered', v_t_base + interval '39 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Al Khaleej Electrical","description":"70 MCCBs at Dammam industrial facility. DN-AKE-2025-0089 signed."}'::jsonb,
       v_t_base + interval '39 days'),
      (v_cid, v_b07, 'distribution.delivered', v_t_base + interval '41 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — SABIC Yanbu","description":"30 MCCBs delivered to SABIC Yanbu sub-meter board project. DN-SAB-2025-0447 signed."}'::jsonb,
       v_t_base + interval '41 days')
    ON CONFLICT DO NOTHING;
    RAISE NOTICE '  ✓ Journey events: b07 (MCCB)';
  END IF;

  -- b09 Gear Pump 300
  IF v_b09 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batch_journey_events WHERE batch_id = v_b09 AND company_id = v_cid
  ) THEN
    INSERT INTO batch_journey_events
      (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
    VALUES
      (v_cid, v_b09, 'raw_material.received', v_t_base + interval '36 days',
       'warehouse@company.sa', 'raw_material',
       '{"title":"Raw Materials Received","description":"Carbon steel S235 (LOT-2025-CS235-0611, 390 kg) and SS316 bar (LOT-2025-SS316-1047, 48 kg) received. Mill certs reviewed. NBR sheet for internal seals: 22 sheets, CoA confirmed."}'::jsonb,
       v_t_base + interval '36 days'),
      (v_cid, v_b09, 'raw_material.released', v_t_base + interval '38 days',
       'qa@company.sa', 'raw_material',
       '{"title":"Raw Materials Released for Production","description":"All lots cleared. 390 kg CS235 and 48 kg SS316 released to gear machining. NBR sheets sent to seal pressing. External gear pump batch commenced."}'::jsonb,
       v_t_base + interval '38 days'),
      (v_cid, v_b09, 'packaging.completed', v_t_base + interval '45 days',
       'ops@company.sa', 'production_order',
       '{"title":"Packaging & Labelling Complete","description":"300 gear pumps individually wrapped in VCI film and boxed. SAE flange port plugs fitted. SFDA QR traceability labels and test report sheets attached."}'::jsonb,
       v_t_base + interval '45 days'),
      (v_cid, v_b09, 'distribution.delivered', v_t_base + interval '51 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — CCC","description":"150 gear pumps delivered to Consolidated Contractors offshore yard. DN-CCC-2025-0302 signed. PO CCC-PO-34477 fulfilled."}'::jsonb,
       v_t_base + interval '51 days'),
      (v_cid, v_b09, 'distribution.delivered', v_t_base + interval '54 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Hyundai Engineering","description":"100 gear pumps at Yanbu LNG Project laydown. DN-HYN-2025-0188 signed."}'::jsonb,
       v_t_base + interval '54 days'),
      (v_cid, v_b09, 'distribution.delivered', v_t_base + interval '57 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Saudi Aramco","description":"50 gear pumps at Saudi Aramco Southern Area Engineering. DN-SA-2025-0509 signed. SAP-PO-94120 closed."}'::jsonb,
       v_t_base + interval '57 days')
    ON CONFLICT DO NOTHING;
    RAISE NOTICE '  ✓ Journey events: b09 (Gear Pump)';
  END IF;

  -- b10 Flange 500
  IF v_b10 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batch_journey_events WHERE batch_id = v_b10 AND company_id = v_cid
  ) THEN
    INSERT INTO batch_journey_events
      (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
    VALUES
      (v_cid, v_b10, 'raw_material.received', v_t_base + interval '43 days',
       'warehouse@company.sa', 'raw_material',
       '{"title":"Raw Materials Received","description":"Carbon steel S235 plate (LOT-2025-CS235-0611, 2 200 kg) received from Gulf Steel Industries. Mill cert HN-30991 reviewed. Stored in approved stock."}'::jsonb,
       v_t_base + interval '43 days'),
      (v_cid, v_b10, 'raw_material.released', v_t_base + interval '45 days',
       'qa@company.sa', 'raw_material',
       '{"title":"Raw Materials Released for Production","description":"CS235 plate cleared on dimensional and tensile spot check. 2 200 kg released to forging and facing for Weld Neck Flange DN80 batch."}'::jsonb,
       v_t_base + interval '45 days'),
      (v_cid, v_b10, 'packaging.completed', v_t_base + interval '55 days',
       'ops@company.sa', 'production_order',
       '{"title":"Packaging & Labelling Complete","description":"500 flanges heat-marked, rust-preventive coated, and individually tagged. ASME B16.5 Class 300 raised-face confirmation marks applied. SFDA QR labels attached."}'::jsonb,
       v_t_base + interval '55 days'),
      (v_cid, v_b10, 'distribution.delivered', v_t_base + interval '59 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Bakr Group Engineering","description":"200 flanges delivered to Bakr Group gas pipeline DN80 project. DN-BGE-2025-0244 signed. ASME certs provided."}'::jsonb,
       v_t_base + interval '59 days'),
      (v_cid, v_b10, 'distribution.delivered', v_t_base + interval '62 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Arabian Industries","description":"200 flanges received at Arabian Industries Dammam warehouse. DN-ARI-2025-0117 signed."}'::jsonb,
       v_t_base + interval '62 days'),
      (v_cid, v_b10, 'distribution.delivered', v_t_base + interval '65 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Saudi Aramco Abqaiq","description":"100 flanges at Abqaiq wellhead isolation project. DN-SA-2025-0516 signed. SAP-PO-94211 closed."}'::jsonb,
       v_t_base + interval '65 days')
    ON CONFLICT DO NOTHING;
    RAISE NOTICE '  ✓ Journey events: b10 (Flange)';
  END IF;

  -- b11 Safety Helmet 1 200
  IF v_b11 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batch_journey_events WHERE batch_id = v_b11 AND company_id = v_cid
  ) THEN
    INSERT INTO batch_journey_events
      (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
    VALUES
      (v_cid, v_b11, 'raw_material.received', v_t_base + interval '48 days',
       'warehouse@company.sa', 'raw_material',
       '{"title":"Raw Materials Received","description":"HDPE granules UV-stabilised (LOT-2025-HDPE-0178, 180 kg) received from SABIC. MFI 0.32 g/10min within spec. EN 397 approved grade. Stored in climate-controlled material store."}'::jsonb,
       v_t_base + interval '48 days'),
      (v_cid, v_b11, 'raw_material.released', v_t_base + interval '50 days',
       'qa@company.sa', 'raw_material',
       '{"title":"Raw Material Released for Production","description":"HDPE LOT-2025-HDPE-0178 passed incoming MFI and UV stability check. 180 kg released to injection moulding. Safety Helmet Class G EN 397 batch commenced."}'::jsonb,
       v_t_base + interval '50 days'),
      (v_cid, v_b11, 'packaging.completed', v_t_base + interval '55 days',
       'ops@company.sa', 'production_order',
       '{"title":"Packaging & Labelling Complete","description":"1 200 helmets packed in individual bags and palletised. EN 397 certification marks, size info, and SFDA QR labels applied. Pallets shrink-wrapped for shipment."}'::jsonb,
       v_t_base + interval '55 days'),
      (v_cid, v_b11, 'distribution.delivered', v_t_base + interval '61 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Red Sea Housing Services","description":"600 helmets delivered to Red Sea Housing NEOM site. DN-RSH-2025-0088 signed. EN 397 certs accepted."}'::jsonb,
       v_t_base + interval '61 days'),
      (v_cid, v_b11, 'distribution.delivered', v_t_base + interval '64 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Saudi Aramco HSE","description":"400 helmets received by Aramco HSE Procurement. DN-SA-2025-0520 signed. SAP-PO-94388 fulfilled."}'::jsonb,
       v_t_base + interval '64 days'),
      (v_cid, v_b11, 'distribution.delivered', v_t_base + interval '67 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Tasnee HSE Dept.","description":"200 helmets at Tasnee Petrochemicals HSE department. DN-TAS-2025-0222 signed."}'::jsonb,
       v_t_base + interval '67 days')
    ON CONFLICT DO NOTHING;
    RAISE NOTICE '  ✓ Journey events: b11 (Safety Helmet)';
  END IF;

  -- b14 VFD 60 (replacement / passing batch)
  IF v_b14 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batch_journey_events WHERE batch_id = v_b14 AND company_id = v_cid
  ) THEN
    INSERT INTO batch_journey_events
      (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
    VALUES
      (v_cid, v_b14, 'raw_material.received', v_t_base + interval '86 days',
       'warehouse@company.sa', 'raw_material',
       '{"title":"Raw Materials Received","description":"Replacement batch after EMC failure on b08. Copper wire (LOT-2025-CUW4-0331, 160 kg) and HDPE granules (LOT-2025-HDPE-0178, 8 kg) received. PCB assemblies arrived with upgraded filter capacitors (C47: 220 nF) per ECO-2025-0014."}'::jsonb,
       v_t_base + interval '86 days'),
      (v_cid, v_b14, 'raw_material.released', v_t_base + interval '87 days',
       'qa@company.sa', 'raw_material',
       '{"title":"Raw Material Released for Production","description":"All materials cleared incoming inspection. PCB assemblies validated against ECO-2025-0014 BOM. Released to VFD assembly line — 60-unit replacement run."}'::jsonb,
       v_t_base + interval '87 days'),
      (v_cid, v_b14, 'packaging.completed', v_t_base + interval '94 days',
       'ops@company.sa', 'production_order',
       '{"title":"Packaging & Labelling Complete","description":"60 VFDs individually packed in antistatic lined cartons. RS485 Modbus commissioning guide included. EMC Class A certs CC-2025-0944, SFDA traceability QR labels applied."}'::jsonb,
       v_t_base + interval '94 days'),
      (v_cid, v_b14, 'distribution.delivered', v_t_base + interval '101 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Saudi Kayan Petrochemical","description":"35 VFDs confirmed at Saudi Kayan cooling tower project. DN-SKP-2025-0339 signed. EMC certs accepted by site engineer."}'::jsonb,
       v_t_base + interval '101 days'),
      (v_cid, v_b14, 'distribution.delivered', v_t_base + interval '104 days',
       'logistics@company.sa', 'sales',
       '{"title":"Shipment Delivered — Sipchem Utilities","description":"25 VFDs at Sipchem boiler feed pump control project. DN-SPC-2025-0277 signed. PO SPC-PO-77228 closed."}'::jsonb,
       v_t_base + interval '104 days')
    ON CONFLICT DO NOTHING;
    RAISE NOTICE '  ✓ Journey events: b14 (VFD replacement batch)';
  END IF;

  RAISE NOTICE 'Batch journey events seeded.';

  -- ════════════════════════════════════════════════════════════
  -- 12. SCAN EVENTS  (analytics — recent scans for charts)
  -- ════════════════════════════════════════════════════════════

  -- b04 bolt: 10 historical + 8 recent
  IF v_b04 IS NOT NULL THEN
    FOR v_i IN 1..10 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b04, v_t_base + interval '20 days' + (v_i * 2.2 || ' days')::interval,
              CASE WHEN v_i%2=0 THEN 'desktop' ELSE 'mobile' END,
              (ARRAY['Chrome','Safari','Chrome','Edge','Chrome'])[1+(v_i%5)],
              CASE WHEN v_i%3=0
                THEN 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
                WHEN v_i%3=1
                THEN 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/122.0 Mobile Safari/537.36'
                ELSE 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) AppleWebKit/605.1.15 Safari/604.1'
              END, v_cid);
    END LOOP;
    FOR v_i IN 1..8 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b04, now() - ((v_i * 0.7) || ' days')::interval,
              CASE WHEN v_i%2=0 THEN 'desktop' ELSE 'mobile' END,
              (ARRAY['Chrome','Safari','Chrome'])[1+(v_i%3)],
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) AppleWebKit/605.1.15 Safari/604.1', v_cid);
    END LOOP;
  END IF;

  -- b05 nut: 7 historical + 5 recent
  IF v_b05 IS NOT NULL THEN
    FOR v_i IN 1..7 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b05, v_t_base + interval '22 days' + (v_i * 2.5 || ' days')::interval,
              'mobile', 'Chrome',
              'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/122.0 Mobile Safari/537.36',
              v_cid);
    END LOOP;
    FOR v_i IN 1..5 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b05, now() - ((v_i * 0.9) || ' days')::interval,
              'mobile', 'Safari',
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) AppleWebKit/605.1.15 Safari/604.1', v_cid);
    END LOOP;
  END IF;

  -- b06 gate valve: 12 historical + 6 recent
  IF v_b06 IS NOT NULL THEN
    FOR v_i IN 1..12 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b06, v_t_base + interval '30 days' + (v_i * 1.8 || ' days')::interval,
              CASE WHEN v_i%3=0 THEN 'desktop' ELSE 'mobile' END,
              (ARRAY['Chrome','Safari','Edge','Chrome','Chrome'])[1+(v_i%5)],
              CASE WHEN v_i%2=0
                THEN 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
                ELSE 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) AppleWebKit/605.1.15 Safari/604.1'
              END, v_cid);
    END LOOP;
    FOR v_i IN 1..6 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b06, now() - ((v_i * 0.8) || ' days')::interval, 'mobile', 'Chrome',
              'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/122.0 Mobile Safari/537.36',
              v_cid);
    END LOOP;
  END IF;

  -- b07 MCCB: 8 historical + 6 recent
  IF v_b07 IS NOT NULL THEN
    FOR v_i IN 1..8 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b07, v_t_base + interval '35 days' + (v_i * 2.0 || ' days')::interval,
              CASE WHEN v_i%2=0 THEN 'desktop' ELSE 'mobile' END,
              (ARRAY['Chrome','Edge','Chrome','Safari'])[1+(v_i%4)],
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
              v_cid);
    END LOOP;
    FOR v_i IN 1..6 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b07, now() - ((v_i * 0.6) || ' days')::interval, 'desktop', 'Edge',
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/122.0 Safari/537.36',
              v_cid);
    END LOOP;
  END IF;

  -- b09 gear pump: 10 historical + 6 recent
  IF v_b09 IS NOT NULL THEN
    FOR v_i IN 1..10 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b09, v_t_base + interval '50 days' + (v_i * 1.6 || ' days')::interval,
              'mobile',
              (ARRAY['Chrome','Safari','Chrome'])[1+(v_i%3)],
              'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/122.0 Mobile Safari/537.36',
              v_cid);
    END LOOP;
    FOR v_i IN 1..6 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b09, now() - ((v_i * 1.0) || ' days')::interval, 'mobile', 'Chrome',
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) AppleWebKit/605.1.15 Safari/604.1', v_cid);
    END LOOP;
  END IF;

  -- b10 flange: 8 historical + 5 recent
  IF v_b10 IS NOT NULL THEN
    FOR v_i IN 1..8 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b10, v_t_base + interval '58 days' + (v_i * 1.9 || ' days')::interval,
              CASE WHEN v_i%2=0 THEN 'desktop' ELSE 'mobile' END,
              (ARRAY['Chrome','Safari','Chrome'])[1+(v_i%3)],
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
              v_cid);
    END LOOP;
    FOR v_i IN 1..5 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b10, now() - ((v_i * 1.1) || ' days')::interval, 'mobile', 'Safari',
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) AppleWebKit/605.1.15 Safari/604.1', v_cid);
    END LOOP;
  END IF;

  -- b11 helmet: 15 historical + 8 recent
  IF v_b11 IS NOT NULL THEN
    FOR v_i IN 1..15 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b11, v_t_base + interval '60 days' + (v_i * 1.5 || ' days')::interval,
              CASE WHEN v_i%3=0 THEN 'desktop' ELSE 'mobile' END,
              (ARRAY['Chrome','Safari','Chrome','Edge','Chrome','Safari','Chrome'])[1+(v_i%7)],
              CASE WHEN v_i%2=0
                THEN 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) AppleWebKit/605.1.15 Safari/604.1'
                ELSE 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/122.0 Mobile Safari/537.36'
              END, v_cid);
    END LOOP;
    FOR v_i IN 1..8 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b11, now() - ((v_i * 0.5) || ' days')::interval,
              CASE WHEN v_i%2=0 THEN 'mobile' ELSE 'desktop' END,
              (ARRAY['Chrome','Safari','Chrome'])[1+(v_i%3)],
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) AppleWebKit/605.1.15 Safari/604.1', v_cid);
    END LOOP;
  END IF;

  -- b14 VFD: 6 historical + 4 recent
  IF v_b14 IS NOT NULL THEN
    FOR v_i IN 1..6 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b14, v_t_base + interval '100 days' + (v_i * 1.2 || ' days')::interval,
              'desktop', 'Chrome',
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
              v_cid);
    END LOOP;
    FOR v_i IN 1..4 LOOP
      INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
      VALUES (v_b14, now() - ((v_i * 0.8) || ' days')::interval, 'mobile', 'Safari',
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) AppleWebKit/605.1.15 Safari/604.1', v_cid);
    END LOOP;
  END IF;

  RAISE NOTICE 'Scan events seeded.';

  -- ════════════════════════════════════════════════════════════
  -- 13. FINAL SUMMARY
  -- ════════════════════════════════════════════════════════════

  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'seed_complete_demo_data.sql — COMPLETE';
  RAISE NOTICE '  Company:    %', v_cid;
  RAISE NOTICE '  Products targeted: IFB-M12-880, IFN-M12-934, VGV-DN50-16,';
  RAISE NOTICE '    ELM-3P-250A, ELV-7K5-VFD, HPG-16CC-250, SPF-DN80-40, PPH-CG-WHT';
  RAISE NOTICE '  VFD b14 promoted to completed + QC PASS (EMC fix applied)';
  RAISE NOTICE '  Flange b10 rework PASS added';
  RAISE NOTICE '  Distribution records added for 8 batches (3 shipments each)';
  RAISE NOTICE '  batch_journey_events added for 8 batches';
  RAISE NOTICE '  scan_events added for all 8 batches';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';

END $$;
