-- ============================================================
-- TraceFlow — BOM Patch: Raw Material Lot Linkage
-- File: seed_bom_patch.sql
-- ============================================================
--
-- Problem this solves
--   After running seed_lifecycle_demo.sql, three gaps exist:
--
--   1. PTFE and NBR entries in bill_of_materials have
--      raw_material_lot_id = NULL because the corresponding
--      raw_material_lots rows were never created.
--      Result: supplier_name is NULL for those rows on the
--      public QR scan page even after get_batch_trace v2.
--
--   2. Supporting batches b04–b15 (12 batches) have zero rows
--      in bill_of_materials.
--      Result: Raw Materials shows "No materials linked" for
--      every one of those batches.
--
-- What this script does (idempotent — safe to run multiple times)
--   Step 1 — Create the five missing raw_material_lots:
--              PTFE-0054, NBR-0203, NBR-0223,
--              CUW4-0331 (copper wire),
--              HDPE-0178 (HDPE granules),
--              CS235-0611 (second CS235 lot for support batches),
--              SS316-1047 (second SS316 lot for nut/gate batches)
--
--   Step 2 — Back-fill NULL raw_material_lot_id on existing BOM
--              rows by matching lot_number text.
--              Affects: PTFE and NBR rows in batch_01/02/03.
--
--   Step 3 — Insert BOM rows for b04–b15 using realistic
--              material quantities per product type.
--              Guarded by NOT EXISTS so re-runs are harmless.
--
-- PREREQUISITES
--   seed_lifecycle_demo.sql must have been run first.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

DO $$
DECLARE
  cid        uuid;

  -- Suppliers (looked up by name — set by lifecycle seed)
  s_gulf     uuid;
  s_sabic    uuid;
  s_aramo    uuid;

  -- Raw materials (looked up by name)
  m_ss316    uuid;
  m_carbon   uuid;
  m_ptfe     uuid;
  m_nbr      uuid;
  m_copper   uuid;
  m_hdpe     uuid;

  -- New lot IDs (resolved after INSERT so ON CONFLICT is safe)
  lot_ptfe0054   uuid;
  lot_nbr0203    uuid;
  lot_nbr0223    uuid;
  lot_copper0331 uuid;
  lot_hdpe0178   uuid;
  lot_cs235_0611 uuid;
  lot_ss316_1047 uuid;

  -- Supporting batch IDs (looked up by product SKU + quantity)
  b04  uuid;   -- Steel Hex Bolt M12x80   5 000 units
  b05  uuid;   -- Stainless Hex Nut M12   8 000 units
  b06  uuid;   -- Gate Valve DN50 PN16      120 units
  b07  uuid;   -- MCCB 3-Pole 250A          200 units
  b08  uuid;   -- VFD 7.5 kW                 75 units  (QC FAIL)
  b09  uuid;   -- Gear Pump 16cc            300 units
  b10  uuid;   -- Weld Neck Flange DN80     500 units
  b11  uuid;   -- Safety Helmet Class G   1 200 units
  b12  uuid;   -- Steel Hex Bolt M12x80   3 000 units  (in_progress)
  b13  uuid;   -- Gate Valve DN50           180 units  (in_progress)
  b14  uuid;   -- VFD 7.5 kW                 60 units  (in_progress)
  b15  uuid;   -- MCCB 3-Pole 250A          250 units  (pending)

  t_base  timestamptz;
  n_fixed int;
BEGIN

  -- ── 0. Resolve company ────────────────────────────────────
  SELECT company_id INTO cid
  FROM   products
  WHERE  sku = 'VBC-2IN-316'
  LIMIT  1;

  IF cid IS NULL THEN
    RAISE NOTICE 'Demo company not found. Run seed_lifecycle_demo.sql first.';
    RETURN;
  END IF;

  SELECT created_at INTO t_base
  FROM   products
  WHERE  company_id = cid AND sku = 'VBC-2IN-316'
  LIMIT  1;

  RAISE NOTICE 'Patching company_id = %', cid;

  -- ── 0b. Resolve supplier IDs ─────────────────────────────
  SELECT id INTO s_gulf  FROM suppliers WHERE company_id = cid AND name ILIKE 'Gulf Steel%'    LIMIT 1;
  SELECT id INTO s_sabic FROM suppliers WHERE company_id = cid AND name ILIKE 'SABIC%'         LIMIT 1;
  SELECT id INTO s_aramo FROM suppliers WHERE company_id = cid AND name ILIKE 'Arabian Valve%' LIMIT 1;

  -- ── 0c. Resolve raw material IDs ─────────────────────────
  SELECT id INTO m_ss316  FROM raw_materials WHERE company_id = cid AND name ILIKE 'Stainless Steel 316 Round Bar%' LIMIT 1;
  SELECT id INTO m_carbon FROM raw_materials WHERE company_id = cid AND name ILIKE 'Carbon Steel Sheet%'            LIMIT 1;
  SELECT id INTO m_ptfe   FROM raw_materials WHERE company_id = cid AND name ILIKE 'PTFE%'                          LIMIT 1;
  SELECT id INTO m_nbr    FROM raw_materials WHERE company_id = cid AND name ILIKE 'NBR%'                           LIMIT 1;
  SELECT id INTO m_copper FROM raw_materials WHERE company_id = cid AND name ILIKE '%Copper Wire%'                  LIMIT 1;
  SELECT id INTO m_hdpe   FROM raw_materials WHERE company_id = cid AND name ILIKE 'HDPE%'                          LIMIT 1;

  -- ════════════════════════════════════════════════════════
  -- STEP 1 — Create the missing raw_material_lots
  -- ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING
  -- guarantees idempotency regardless of prior runs.
  -- ════════════════════════════════════════════════════════

  -- PTFE lot referenced in batch_01 BOM (LOT-2025-PTFE-0054)
  IF m_ptfe IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, expiry_date, status, notes, created_at, updated_at)
    VALUES
      (cid, m_ptfe, 'LOT-2025-PTFE-0054', 80.0, 'm', s_sabic,
       t_base + interval '3 days',
       t_base + interval '3 years',
       'consumed',
       'Virgin-grade extruded PTFE rod 20mm. MFI 2.1 g/10min, density 2.17 g/cm³. '
       'SABIC CoA PTFE-2025-0054. FDA 21 CFR 177.1550 compliant.',
       t_base + interval '3 days', t_base + interval '3 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
  END IF;

  -- NBR lot-203: referenced in batch_01 and batch_02 BOM
  IF m_nbr IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, expiry_date, status, notes, created_at, updated_at)
    VALUES
      (cid, m_nbr, 'LOT-2025-NBR-0203', 60.0, 'sheet', s_sabic,
       t_base + interval '4 days',
       t_base + interval '2 years',
       'consumed',
       'NBR 3mm sheet, 70 Shore A, oil-resistant. Volume swell 14% (spec <20%). '
       'SABIC CoA NBR-2025-0203. Suitable for petroleum-service seals per ISO 6945.',
       t_base + interval '4 days', t_base + interval '4 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;

    -- NBR lot-223: referenced in batch_03 BOM
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, expiry_date, status, notes, created_at, updated_at)
    VALUES
      (cid, m_nbr, 'LOT-2025-NBR-0223', 40.0, 'sheet', s_sabic,
       t_base + interval '40 days',
       (t_base + interval '40 days') + interval '2 years',
       'consumed',
       'NBR 3mm sheet, second delivery. Hardness 71 Shore A. Same spec as LOT-2025-NBR-0203. '
       'SABIC CoA NBR-2025-0223. Approved for relief valve seat service.',
       t_base + interval '40 days', t_base + interval '40 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
  END IF;

  -- Electrolytic Copper Wire lot (MCCB and VFD batches)
  IF m_copper IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, expiry_date, status, notes, created_at, updated_at)
    VALUES
      (cid, m_copper, 'LOT-2025-CUW4-0331', 500.0, 'kg', s_aramo,
       t_base + interval '18 days',
       NULL,
       'consumed',
       'Electrolytic copper wire 4mm², conductivity ≥58 MS/m. ROHS compliant. '
       'IEC 60228 class 2. Arabian Valve CoA CUW-2025-0331.',
       t_base + interval '18 days', t_base + interval '18 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
  END IF;

  -- HDPE Granules lot (Safety Helmet, MCCB housing, VFD housing)
  IF m_hdpe IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, expiry_date, status, notes, created_at, updated_at)
    VALUES
      (cid, m_hdpe, 'LOT-2025-HDPE-0178', 200.0, 'kg', s_sabic,
       t_base + interval '45 days',
       (t_base + interval '45 days') + interval '18 months',
       'consumed',
       'HDPE granules MFI 0.3 g/10min @ 190°C/2.16 kg. UV-stabilised grade. '
       'EN 397 approved formulation for safety helmets. SABIC CoA HDPE-2025-0178.',
       t_base + interval '45 days', t_base + interval '45 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
  END IF;

  -- Second CS235 lot (supporting batches: bolts, gate valves, gear pumps, flanges)
  IF m_carbon IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, expiry_date, status, notes, created_at, updated_at)
    VALUES
      (cid, m_carbon, 'LOT-2025-CS235-0611', 1200.0, 'kg', s_gulf,
       t_base + interval '14 days',
       t_base + interval '5 years',
       'consumed',
       'Carbon Steel S235JR 6mm sheet. Yield 255 MPa, tensile 380 MPa. '
       'EN 10025-2. Mill cert HN-30991. Gulf Steel heat number GS-CS2-0611.',
       t_base + interval '14 days', t_base + interval '14 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
  END IF;

  -- Second SS316 lot (stainless nuts, gate valve stems)
  IF m_ss316 IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, expiry_date, status, notes, created_at, updated_at)
    VALUES
      (cid, m_ss316, 'LOT-2025-SS316-1047', 800.0, 'kg', s_gulf,
       t_base + interval '8 days',
       t_base + interval '3 years',
       'consumed',
       'SS316 round bar 12mm hex bar, A2-70 standard. '
       'Tensile 700 MPa min, hardness 200 HB. EN 10088-3. '
       'Gulf Steel cert HN-31044. Suitable for marine and offshore fasteners.',
       t_base + interval '8 days', t_base + interval '8 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
  END IF;

  -- ── Resolve actual lot IDs after inserts ──────────────────
  -- (SELECT after INSERT ensures we get the correct ID even if
  -- the row was pre-existing and ON CONFLICT fired.)
  SELECT id INTO lot_ptfe0054   FROM raw_material_lots WHERE company_id = cid AND lot_number = 'LOT-2025-PTFE-0054'  LIMIT 1;
  SELECT id INTO lot_nbr0203    FROM raw_material_lots WHERE company_id = cid AND lot_number = 'LOT-2025-NBR-0203'   LIMIT 1;
  SELECT id INTO lot_nbr0223    FROM raw_material_lots WHERE company_id = cid AND lot_number = 'LOT-2025-NBR-0223'   LIMIT 1;
  SELECT id INTO lot_copper0331 FROM raw_material_lots WHERE company_id = cid AND lot_number = 'LOT-2025-CUW4-0331' LIMIT 1;
  SELECT id INTO lot_hdpe0178   FROM raw_material_lots WHERE company_id = cid AND lot_number = 'LOT-2025-HDPE-0178' LIMIT 1;
  SELECT id INTO lot_cs235_0611 FROM raw_material_lots WHERE company_id = cid AND lot_number = 'LOT-2025-CS235-0611' LIMIT 1;
  SELECT id INTO lot_ss316_1047 FROM raw_material_lots WHERE company_id = cid AND lot_number = 'LOT-2025-SS316-1047' LIMIT 1;

  RAISE NOTICE 'Lots resolved — PTFE:%  NBR-203:%  NBR-223:%  CUW4:%  HDPE:%  CS235-611:%  SS316-1047:%',
    lot_ptfe0054, lot_nbr0203, lot_nbr0223, lot_copper0331, lot_hdpe0178, lot_cs235_0611, lot_ss316_1047;

  -- ════════════════════════════════════════════════════════
  -- STEP 2 — Back-fill NULL raw_material_lot_id on existing
  -- BOM rows by matching lot_number text.
  -- Affects: PTFE and NBR rows in batch_01, batch_02, batch_03.
  -- ════════════════════════════════════════════════════════

  UPDATE bill_of_materials bom
  SET    raw_material_lot_id = rml.id
  FROM   raw_material_lots rml
  WHERE  bom.raw_material_lot_id IS NULL
    AND  bom.lot_number          IS NOT NULL
    AND  bom.company_id          = cid
    AND  rml.lot_number          = bom.lot_number
    AND  rml.company_id          = cid;

  GET DIAGNOSTICS n_fixed = ROW_COUNT;
  RAISE NOTICE 'Step 2: % BOM rows back-filled with lot FK.', n_fixed;

  -- ════════════════════════════════════════════════════════
  -- STEP 3 — BOM rows for supporting batches b04–b15
  -- Looked up by product SKU + quantity — the only reliable
  -- identifiers since all UUIDs were gen_random_uuid() at
  -- seed time and are not stored in any local file.
  -- NOT EXISTS guard makes this idempotent.
  -- ════════════════════════════════════════════════════════

  -- Resolve batch IDs
  SELECT po.id INTO b04 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'IFB-M12-880' AND po.quantity = 5000   AND po.company_id = cid LIMIT 1;
  SELECT po.id INTO b05 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'IFN-M12-934' AND po.quantity = 8000   AND po.company_id = cid LIMIT 1;
  SELECT po.id INTO b06 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'VGV-DN50-16' AND po.quantity = 120    AND po.company_id = cid LIMIT 1;
  SELECT po.id INTO b07 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'ELM-3P-250A' AND po.quantity = 200    AND po.company_id = cid LIMIT 1;
  SELECT po.id INTO b08 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'ELV-7K5-VFD' AND po.quantity = 75     AND po.company_id = cid LIMIT 1;
  SELECT po.id INTO b09 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'HPG-16CC-250' AND po.quantity = 300   AND po.company_id = cid LIMIT 1;
  SELECT po.id INTO b10 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'SPF-DN80-40' AND po.quantity = 500    AND po.company_id = cid LIMIT 1;
  SELECT po.id INTO b11 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'PPH-CG-WHT'  AND po.quantity = 1200   AND po.company_id = cid LIMIT 1;
  SELECT po.id INTO b12 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'IFB-M12-880' AND po.quantity = 3000   AND po.company_id = cid LIMIT 1;
  SELECT po.id INTO b13 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'VGV-DN50-16' AND po.quantity = 180    AND po.company_id = cid LIMIT 1;
  SELECT po.id INTO b14 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'ELV-7K5-VFD' AND po.quantity = 60     AND po.company_id = cid LIMIT 1;
  SELECT po.id INTO b15 FROM production_orders po JOIN products p ON p.id = po.product_id
    WHERE p.sku = 'ELM-3P-250A' AND po.quantity = 250    AND po.company_id = cid LIMIT 1;

  RAISE NOTICE 'Batch IDs: b04=% b05=% b06=% b07=% b08=%', b04, b05, b06, b07, b08;
  RAISE NOTICE '           b09=% b10=% b11=% b12=% b13=%', b09, b10, b11, b12, b13;
  RAISE NOTICE '           b14=% b15=%', b14, b15;

  -- ── b04: Steel Hex Bolt M12x80 Grade 8.8 — 5 000 units ───
  -- M12x80 bolt ≈ 58 g steel each → 5 000 × 58 g ≈ 290 kg
  -- Carbon steel rod, plus small copper anode wire for zinc plating bath.
  IF b04 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill_of_materials WHERE production_order_id = b04 AND company_id = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    VALUES
      (b04, 'Carbon Steel Sheet S235 6mm',   'LOT-2025-CS235-0611', 310.0, 'kg', lot_cs235_0611, cid, t_base + interval '8 days'),
      (b04, 'Electrolytic Copper Wire 4mm2', 'LOT-2025-CUW4-0331',    2.5, 'kg', lot_copper0331, cid, t_base + interval '8 days');
    RAISE NOTICE '  ✓ b04 (Steel Bolt): 2 BOM rows inserted.';
  ELSE
    RAISE NOTICE '  ℹ b04 (Steel Bolt): already has BOM rows or batch not found — skipped.';
  END IF;

  -- ── b05: Stainless Hex Nut M12 DIN 934 — 8 000 units ─────
  -- M12 hex nut ≈ 11 g each → 8 000 × 11 g ≈ 88 kg SS316
  IF b05 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill_of_materials WHERE production_order_id = b05 AND company_id = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    VALUES
      (b05, 'Stainless Steel 316 Round Bar 25mm', 'LOT-2025-SS316-1047', 95.0, 'kg', lot_ss316_1047, cid, t_base + interval '12 days');
    RAISE NOTICE '  ✓ b05 (Stainless Nut): 1 BOM row inserted.';
  ELSE
    RAISE NOTICE '  ℹ b05 (Stainless Nut): already has BOM rows or batch not found — skipped.';
  END IF;

  -- ── b06: Gate Valve DN50 PN16 Carbon Steel — 120 units ────
  -- DN50 gate valve ≈ 6 kg total. Body: carbon steel ~5 kg,
  -- stem/internals: SS316 ~0.6 kg, seals: NBR ~0.05 sheet each.
  IF b06 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill_of_materials WHERE production_order_id = b06 AND company_id = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    VALUES
      (b06, 'Carbon Steel Sheet S235 6mm',        'LOT-2025-CS235-0611', 620.0, 'kg',    lot_cs235_0611, cid, t_base + interval '18 days'),
      (b06, 'Stainless Steel 316 Round Bar 25mm',  'LOT-2025-SS316-1047',  75.0, 'kg',    lot_ss316_1047, cid, t_base + interval '18 days'),
      (b06, 'NBR Nitrile Rubber Sheet 3mm',        'LOT-2025-NBR-0203',     8.0, 'sheet', lot_nbr0203,    cid, t_base + interval '18 days');
    RAISE NOTICE '  ✓ b06 (Gate Valve): 3 BOM rows inserted.';
  ELSE
    RAISE NOTICE '  ℹ b06 (Gate Valve): already has BOM rows or batch not found — skipped.';
  END IF;

  -- ── b07: MCCB 3-Pole 250A — 200 units ────────────────────
  -- Copper bus bar + contact bridges ≈ 0.3 kg/unit → 60 kg
  -- HDPE housing ≈ 0.14 kg/unit → 28 kg
  IF b07 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill_of_materials WHERE production_order_id = b07 AND company_id = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    VALUES
      (b07, 'Electrolytic Copper Wire 4mm2',  'LOT-2025-CUW4-0331', 62.0, 'kg', lot_copper0331, cid, t_base + interval '22 days'),
      (b07, 'HDPE Granules MFI 0.3 g/10min', 'LOT-2025-HDPE-0178',  28.0, 'kg', lot_hdpe0178,   cid, t_base + interval '22 days');
    RAISE NOTICE '  ✓ b07 (MCCB): 2 BOM rows inserted.';
  ELSE
    RAISE NOTICE '  ℹ b07 (MCCB): already has BOM rows or batch not found — skipped.';
  END IF;

  -- ── b08: VFD 7.5 kW — 75 units (QC FAIL, EMC issue) ──────
  -- VFD copper winding + bus ≈ 0.9 kg/unit → 68 kg
  -- HDPE enclosure panels ≈ 0.25 kg/unit → 19 kg
  IF b08 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill_of_materials WHERE production_order_id = b08 AND company_id = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    VALUES
      (b08, 'Electrolytic Copper Wire 4mm2',  'LOT-2025-CUW4-0331', 68.0, 'kg', lot_copper0331, cid, t_base + interval '30 days'),
      (b08, 'HDPE Granules MFI 0.3 g/10min', 'LOT-2025-HDPE-0178',  19.0, 'kg', lot_hdpe0178,   cid, t_base + interval '30 days');
    RAISE NOTICE '  ✓ b08 (VFD — QC FAIL): 2 BOM rows inserted.';
  ELSE
    RAISE NOTICE '  ℹ b08 (VFD): already has BOM rows or batch not found — skipped.';
  END IF;

  -- ── b09: Gear Pump 16cc 250 bar — 300 units ───────────────
  -- Gear housing + shaft: carbon steel ≈ 1.3 kg/unit → 390 kg
  -- Shaft seals: NBR ≈ 0.06 sheet/unit → 18 sheets
  IF b09 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill_of_materials WHERE production_order_id = b09 AND company_id = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    VALUES
      (b09, 'Carbon Steel Sheet S235 6mm', 'LOT-2025-CS235-0611', 390.0, 'kg',    lot_cs235_0611, cid, t_base + interval '38 days'),
      (b09, 'NBR Nitrile Rubber Sheet 3mm','LOT-2025-NBR-0223',    18.0, 'sheet', lot_nbr0223,    cid, t_base + interval '38 days');
    RAISE NOTICE '  ✓ b09 (Gear Pump): 2 BOM rows inserted.';
  ELSE
    RAISE NOTICE '  ℹ b09 (Gear Pump): already has BOM rows or batch not found — skipped.';
  END IF;

  -- ── b10: Weld Neck Flange DN80 PN40 — 500 units ──────────
  -- DN80 ASME B16.5 Class 300 WNF ≈ 1.55 kg/unit → 775 kg CS
  IF b10 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill_of_materials WHERE production_order_id = b10 AND company_id = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    VALUES
      (b10, 'Carbon Steel Sheet S235 6mm', 'LOT-2025-CS235-0611', 780.0, 'kg', lot_cs235_0611, cid, t_base + interval '45 days');
    RAISE NOTICE '  ✓ b10 (Weld Neck Flange): 1 BOM row inserted.';
  ELSE
    RAISE NOTICE '  ℹ b10 (Flange): already has BOM rows or batch not found — skipped.';
  END IF;

  -- ── b11: Safety Helmet Class G EN397 — 1 200 units ────────
  -- PP/HDPE shell ≈ 0.08 kg/unit → 96 kg HDPE
  IF b11 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill_of_materials WHERE production_order_id = b11 AND company_id = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    VALUES
      (b11, 'HDPE Granules MFI 0.3 g/10min', 'LOT-2025-HDPE-0178', 96.0, 'kg', lot_hdpe0178, cid, t_base + interval '50 days');
    RAISE NOTICE '  ✓ b11 (Safety Helmet): 1 BOM row inserted.';
  ELSE
    RAISE NOTICE '  ℹ b11 (Safety Helmet): already has BOM rows or batch not found — skipped.';
  END IF;

  -- ── b12: Steel Hex Bolt M12x80 — 3 000 units (in_progress) ─
  IF b12 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill_of_materials WHERE production_order_id = b12 AND company_id = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    VALUES
      (b12, 'Carbon Steel Sheet S235 6mm',   'LOT-2025-CS235-0611', 188.0, 'kg', lot_cs235_0611, cid, t_base + interval '82 days'),
      (b12, 'Electrolytic Copper Wire 4mm2', 'LOT-2025-CUW4-0331',    1.5, 'kg', lot_copper0331, cid, t_base + interval '82 days');
    RAISE NOTICE '  ✓ b12 (Steel Bolt — in progress): 2 BOM rows inserted.';
  ELSE
    RAISE NOTICE '  ℹ b12 (Steel Bolt in-progress): already has BOM rows or batch not found — skipped.';
  END IF;

  -- ── b13: Gate Valve DN50 PN16 — 180 units (in_progress) ──
  IF b13 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill_of_materials WHERE production_order_id = b13 AND company_id = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    VALUES
      (b13, 'Carbon Steel Sheet S235 6mm',        'LOT-2025-CS235-0611',  930.0, 'kg',    lot_cs235_0611, cid, t_base + interval '85 days'),
      (b13, 'Stainless Steel 316 Round Bar 25mm',  'LOT-2025-SS316-1047',  112.0, 'kg',    lot_ss316_1047, cid, t_base + interval '85 days'),
      (b13, 'NBR Nitrile Rubber Sheet 3mm',        'LOT-2025-NBR-0223',     12.0, 'sheet', lot_nbr0223,    cid, t_base + interval '85 days');
    RAISE NOTICE '  ✓ b13 (Gate Valve — in progress): 3 BOM rows inserted.';
  ELSE
    RAISE NOTICE '  ℹ b13 (Gate Valve in-progress): already has BOM rows or batch not found — skipped.';
  END IF;

  -- ── b14: VFD 7.5 kW — 60 units (in_progress) ─────────────
  IF b14 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill_of_materials WHERE production_order_id = b14 AND company_id = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    VALUES
      (b14, 'Electrolytic Copper Wire 4mm2',  'LOT-2025-CUW4-0331', 54.0, 'kg', lot_copper0331, cid, t_base + interval '87 days'),
      (b14, 'HDPE Granules MFI 0.3 g/10min', 'LOT-2025-HDPE-0178',  15.0, 'kg', lot_hdpe0178,   cid, t_base + interval '87 days');
    RAISE NOTICE '  ✓ b14 (VFD — in progress): 2 BOM rows inserted.';
  ELSE
    RAISE NOTICE '  ℹ b14 (VFD in-progress): already has BOM rows or batch not found — skipped.';
  END IF;

  -- ── b15: MCCB 3-Pole 250A — 250 units (pending) ──────────
  IF b15 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill_of_materials WHERE production_order_id = b15 AND company_id = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    VALUES
      (b15, 'Electrolytic Copper Wire 4mm2',  'LOT-2025-CUW4-0331', 77.0, 'kg', lot_copper0331, cid, t_base + interval '88 days'),
      (b15, 'HDPE Granules MFI 0.3 g/10min', 'LOT-2025-HDPE-0178',  35.0, 'kg', lot_hdpe0178,   cid, t_base + interval '88 days');
    RAISE NOTICE '  ✓ b15 (MCCB — pending): 2 BOM rows inserted.';
  ELSE
    RAISE NOTICE '  ℹ b15 (MCCB pending): already has BOM rows or batch not found — skipped.';
  END IF;

  -- ── Final report ──────────────────────────────────────────
  RAISE NOTICE '─────────────────────────────────────────────────────';
  RAISE NOTICE '✓ seed_bom_patch.sql complete.';
  RAISE NOTICE '  Lots now in raw_material_lots for this company: %', (
    SELECT COUNT(*) FROM raw_material_lots WHERE company_id = cid
  );
  RAISE NOTICE '  Total BOM rows for this company: %', (
    SELECT COUNT(*) FROM bill_of_materials WHERE company_id = cid
  );
  RAISE NOTICE '  BOM rows with lot FK populated: %', (
    SELECT COUNT(*) FROM bill_of_materials WHERE company_id = cid AND raw_material_lot_id IS NOT NULL
  );
  RAISE NOTICE '  BOM rows still missing lot FK: %', (
    SELECT COUNT(*) FROM bill_of_materials WHERE company_id = cid AND raw_material_lot_id IS NULL
  );

END;
$$;
