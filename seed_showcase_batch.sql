-- ============================================================
-- TraceFlow — Complete Showcase Batch for Public Product Passport
-- File: seed_showcase_batch.sql
-- ============================================================
--
-- Purpose
--   Guarantees that exactly ONE fully-populated production batch
--   exists in the database, suitable for the public QR scan /
--   Product Passport demo page (/trace/[id]).
--
--   The batch will always show:
--     Batch Overview     — product name, SKU, quantity, status
--     Production Info    — started / completed timestamps
--     Raw Materials Used — 3 materials, real suppliers, lot numbers
--     Quality & Compliance — QC pass result
--
-- Strategy
--   1. Re-use the Ball Valve batch if it was already seeded by
--      seed_lifecycle_demo.sql (look up by SKU + quantity).
--   2. If that batch is missing, create one from scratch with
--      the same realistic data.
--   3. Either way, ensure BOM rows and QC rows are present and
--      all raw_material_lot_id FKs are set.
--   4. Print the batch UUID at the end — paste it into:
--        /trace/<uuid>
--
-- Idempotent — safe to run multiple times.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

DO $$
DECLARE
  v_cid       uuid;

  -- Suppliers
  s_gulf    uuid;
  s_sabic   uuid;

  -- Raw materials
  m_ss316   uuid;
  m_ptfe    uuid;
  m_nbr     uuid;

  -- Raw material lots
  lot_ss316   uuid;
  lot_ptfe    uuid;
  lot_nbr     uuid;

  -- Product + batch
  p_valve   uuid;
  v_batch_id  uuid;

  -- QC
  qc_id     uuid;

  t_base    timestamptz := now() - interval '90 days';
BEGIN

  -- ── 0. Resolve company ────────────────────────────────────
  SELECT id INTO v_cid FROM companies ORDER BY created_at LIMIT 1;

  IF v_cid IS NULL THEN
    RAISE EXCEPTION 'No company found. Complete onboarding first.';
  END IF;
  RAISE NOTICE 'Company: %', v_cid;

  -- ══════════════════════════════════════════════════════════
  -- 1. SUPPLIERS
  -- ══════════════════════════════════════════════════════════

  -- Gulf Steel Industries (steel supplier)
  SELECT id INTO s_gulf
  FROM suppliers
  WHERE company_id = v_cid AND name = 'Gulf Steel Industries LLC'
  LIMIT 1;

  IF s_gulf IS NULL THEN
    s_gulf := gen_random_uuid();
    INSERT INTO suppliers (id, name, contact_email, contact_phone, company_id, created_at)
    VALUES (s_gulf, 'Gulf Steel Industries LLC', 'procurement@gulfsteel.sa', '+966-11-234-5678', v_cid, t_base);
    RAISE NOTICE '  ✓ Created supplier: Gulf Steel Industries LLC';
  ELSE
    RAISE NOTICE '  ℹ Supplier exists: Gulf Steel Industries LLC (%)', s_gulf;
  END IF;

  -- SABIC Advanced Polymers (polymer/rubber supplier)
  SELECT id INTO s_sabic
  FROM suppliers
  WHERE company_id = v_cid AND name = 'SABIC Advanced Polymers Co.'
  LIMIT 1;

  IF s_sabic IS NULL THEN
    s_sabic := gen_random_uuid();
    INSERT INTO suppliers (id, name, contact_email, contact_phone, company_id, created_at)
    VALUES (s_sabic, 'SABIC Advanced Polymers Co.', 'supply@sabic-polymers.sa', '+966-13-445-6789', v_cid, t_base);
    RAISE NOTICE '  ✓ Created supplier: SABIC Advanced Polymers Co.';
  ELSE
    RAISE NOTICE '  ℹ Supplier exists: SABIC Advanced Polymers Co. (%)', s_sabic;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 2. RAW MATERIALS
  -- ══════════════════════════════════════════════════════════

  SELECT id INTO m_ss316
  FROM raw_materials
  WHERE company_id = v_cid AND name = 'Stainless Steel 316 Round Bar 25mm'
  LIMIT 1;

  IF m_ss316 IS NULL THEN
    m_ss316 := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (m_ss316, 'Stainless Steel 316 Round Bar 25mm', 'kg', 1850.0, 200.0, s_gulf, v_cid, t_base);
    RAISE NOTICE '  ✓ Created raw material: Stainless Steel 316';
  ELSE
    RAISE NOTICE '  ℹ Raw material exists: Stainless Steel 316 (%)', m_ss316;
  END IF;

  SELECT id INTO m_ptfe
  FROM raw_materials
  WHERE company_id = v_cid AND name = 'PTFE Virgin Rod Stock 20mm dia.'
  LIMIT 1;

  IF m_ptfe IS NULL THEN
    m_ptfe := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (m_ptfe, 'PTFE Virgin Rod Stock 20mm dia.', 'm', 120.0, 20.0, s_sabic, v_cid, t_base);
    RAISE NOTICE '  ✓ Created raw material: PTFE Virgin Rod';
  ELSE
    RAISE NOTICE '  ℹ Raw material exists: PTFE (%)', m_ptfe;
  END IF;

  SELECT id INTO m_nbr
  FROM raw_materials
  WHERE company_id = v_cid AND name = 'NBR Nitrile Rubber Sheet 3mm'
  LIMIT 1;

  IF m_nbr IS NULL THEN
    m_nbr := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (m_nbr, 'NBR Nitrile Rubber Sheet 3mm', 'sheet', 45.0, 10.0, s_sabic, v_cid, t_base);
    RAISE NOTICE '  ✓ Created raw material: NBR Nitrile Rubber';
  ELSE
    RAISE NOTICE '  ℹ Raw material exists: NBR (%)', m_nbr;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 3. RAW MATERIAL LOTS  (with supplier_id always set)
  -- ══════════════════════════════════════════════════════════

  SELECT id INTO lot_ss316
  FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-SS316-0891'
  LIMIT 1;

  IF lot_ss316 IS NULL THEN
    lot_ss316 := gen_random_uuid();
    INSERT INTO raw_material_lots
      (id, company_id, raw_material_id, lot_number, quantity, unit,
       supplier_id, received_at, expiry_date, status, notes, created_at, updated_at)
    VALUES
      (lot_ss316, v_cid, m_ss316, 'LOT-2025-SS316-0891', 500.0, 'kg',
       s_gulf,
       t_base, t_base + interval '2 years', 'available',
       'Mill cert EN 10204 3.1. Heat number HN-29841. Hardness 187 HB. '
       'Tensile 540 MPa, yield 240 MPa. Gulf Steel CoC GS-SS316-0891.',
       t_base, t_base);
    RAISE NOTICE '  ✓ Created lot: LOT-2025-SS316-0891 (Gulf Steel)';
  ELSE
    -- Ensure supplier_id is set on the existing lot
    UPDATE raw_material_lots
    SET supplier_id = s_gulf
    WHERE id = lot_ss316 AND supplier_id IS NULL;
    RAISE NOTICE '  ℹ Lot exists: LOT-2025-SS316-0891 (%)', lot_ss316;
  END IF;

  SELECT id INTO lot_ptfe
  FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-PTFE-0054'
  LIMIT 1;

  IF lot_ptfe IS NULL THEN
    lot_ptfe := gen_random_uuid();
    INSERT INTO raw_material_lots
      (id, company_id, raw_material_id, lot_number, quantity, unit,
       supplier_id, received_at, expiry_date, status, notes, created_at, updated_at)
    VALUES
      (lot_ptfe, v_cid, m_ptfe, 'LOT-2025-PTFE-0054', 80.0, 'm',
       s_sabic,
       t_base + interval '3 days', t_base + interval '3 years', 'available',
       'Virgin-grade extruded PTFE rod 20mm. MFI 2.1 g/10min, density 2.17 g/cm³. '
       'FDA 21 CFR 177.1550 compliant. SABIC CoA PTFE-2025-0054.',
       t_base + interval '3 days', t_base + interval '3 days');
    RAISE NOTICE '  ✓ Created lot: LOT-2025-PTFE-0054 (SABIC)';
  ELSE
    UPDATE raw_material_lots
    SET supplier_id = s_sabic
    WHERE id = lot_ptfe AND supplier_id IS NULL;
    RAISE NOTICE '  ℹ Lot exists: LOT-2025-PTFE-0054 (%)', lot_ptfe;
  END IF;

  SELECT id INTO lot_nbr
  FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-NBR-0203'
  LIMIT 1;

  IF lot_nbr IS NULL THEN
    lot_nbr := gen_random_uuid();
    INSERT INTO raw_material_lots
      (id, company_id, raw_material_id, lot_number, quantity, unit,
       supplier_id, received_at, expiry_date, status, notes, created_at, updated_at)
    VALUES
      (lot_nbr, v_cid, m_nbr, 'LOT-2025-NBR-0203', 60.0, 'sheet',
       s_sabic,
       t_base + interval '4 days', t_base + interval '2 years', 'available',
       'NBR 3mm sheet, 70 Shore A, oil-resistant. Volume swell 14% (spec <20%). '
       'Petroleum service approved per ISO 6945. SABIC CoA NBR-2025-0203.',
       t_base + interval '4 days', t_base + interval '4 days');
    RAISE NOTICE '  ✓ Created lot: LOT-2025-NBR-0203 (SABIC)';
  ELSE
    UPDATE raw_material_lots
    SET supplier_id = s_sabic
    WHERE id = lot_nbr AND supplier_id IS NULL;
    RAISE NOTICE '  ℹ Lot exists: LOT-2025-NBR-0203 (%)', lot_nbr;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 4. PRODUCT
  -- ══════════════════════════════════════════════════════════

  SELECT id INTO p_valve
  FROM products
  WHERE company_id = v_cid AND sku = 'VBC-2IN-316'
  LIMIT 1;

  IF p_valve IS NULL THEN
    p_valve := gen_random_uuid();
    INSERT INTO products (id, name, sku, description, company_id, created_at)
    VALUES (p_valve, 'Ball Valve 2in 316 Stainless Steel', 'VBC-2IN-316',
      'Full-bore ball valve, fire-safe design, ISO 17292. '
      'Process isolation in petrochemical plants.', v_cid, t_base);
    RAISE NOTICE '  ✓ Created product: Ball Valve 2in 316 SS (VBC-2IN-316)';
  ELSE
    RAISE NOTICE '  ℹ Product exists: VBC-2IN-316 (%)', p_valve;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 5. PRODUCTION ORDER (the showcase batch)
  -- ══════════════════════════════════════════════════════════

  SELECT po.id INTO v_batch_id
  FROM production_orders po
  WHERE po.product_id  = p_valve
    AND po.company_id  = v_cid
    AND po.quantity    = 250
  LIMIT 1;

  IF v_batch_id IS NULL THEN
    v_batch_id := gen_random_uuid();
    INSERT INTO production_orders
      (id, product_id, quantity, status, started_at, completed_at, company_id, created_at)
    VALUES
      (v_batch_id, p_valve, 250, 'completed',
       t_base + interval '6 days',
       t_base + interval '14 days',
       v_cid, t_base + interval '5 days');
    RAISE NOTICE '  ✓ Created production order (batch): %', v_batch_id;
  ELSE
    RAISE NOTICE '  ℹ Production order exists: %', v_batch_id;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 6. BILL OF MATERIALS  (3 rows, all with lot FK + supplier)
  -- ══════════════════════════════════════════════════════════

  IF NOT EXISTS (
    SELECT 1 FROM bill_of_materials
    WHERE production_order_id = v_batch_id AND company_id = v_cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit,
       raw_material_lot_id, company_id, created_at)
    VALUES
      -- Steel ball body and body halves
      (v_batch_id,
       'Stainless Steel 316 Round Bar 25mm',
       'LOT-2025-SS316-0891',
       87.5, 'kg',
       lot_ss316, v_cid,
       t_base + interval '6 days'),

      -- Stem and seat insert
      (v_batch_id,
       'PTFE Virgin Rod Stock 20mm dia.',
       'LOT-2025-PTFE-0054',
       12.5, 'm',
       lot_ptfe, v_cid,
       t_base + interval '6 days'),

      -- Body seals and O-rings
      (v_batch_id,
       'NBR Nitrile Rubber Sheet 3mm',
       'LOT-2025-NBR-0203',
       2.5, 'sheet',
       lot_nbr, v_cid,
       t_base + interval '6 days');

    RAISE NOTICE '  ✓ BOM rows inserted (3 materials with lot FKs and suppliers).';
  ELSE
    -- Rows exist — make sure all raw_material_lot_id FKs are set
    UPDATE bill_of_materials
    SET raw_material_lot_id = lot_ss316
    WHERE production_order_id = v_batch_id
      AND company_id = v_cid
      AND lot_number = 'LOT-2025-SS316-0891'
      AND raw_material_lot_id IS NULL;

    UPDATE bill_of_materials
    SET raw_material_lot_id = lot_ptfe
    WHERE production_order_id = v_batch_id
      AND company_id = v_cid
      AND lot_number = 'LOT-2025-PTFE-0054'
      AND raw_material_lot_id IS NULL;

    UPDATE bill_of_materials
    SET raw_material_lot_id = lot_nbr
    WHERE production_order_id = v_batch_id
      AND company_id = v_cid
      AND lot_number = 'LOT-2025-NBR-0203'
      AND raw_material_lot_id IS NULL;

    RAISE NOTICE '  ℹ BOM rows already exist — FK patch applied if needed.';
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 7. QC RESULT
  -- ══════════════════════════════════════════════════════════

  IF NOT EXISTS (
    SELECT 1 FROM batch_qc_results qr
    WHERE qr.batch_id = v_batch_id AND qr.company_id = v_cid
  ) THEN
    INSERT INTO batch_qc_results
      (batch_id, status, inspector_name, notes, inspected_at, company_id, created_at)
    VALUES
      (v_batch_id, 'pass', 'Khalid Al-Rashidi',
       'All 250 units inspected. Ball rotation torque 7.8 Nm (spec 7–9 Nm). '
       'Pressure test 1.5× WP: PASS. Fire-safe seat ISO 10497: PASS. '
       'Surface roughness Ra 0.8 μm. CoC CC-2025-0891 issued.',
       t_base + interval '15 days', v_cid,
       t_base + interval '15 days');
    RAISE NOTICE '  ✓ QC result inserted (PASS — Khalid Al-Rashidi).';
  ELSE
    RAISE NOTICE '  ℹ QC result already exists.';
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- RESULT — print the URL to use
  -- ══════════════════════════════════════════════════════════

  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE '  SHOWCASE BATCH READY';
  RAISE NOTICE '  Batch UUID : %', v_batch_id;
  RAISE NOTICE '  Public URL : /trace/%', v_batch_id;
  RAISE NOTICE '  Product    : Ball Valve 2in 316 Stainless Steel';
  RAISE NOTICE '  SKU        : VBC-2IN-316';
  RAISE NOTICE '  Status     : completed  |  Qty: 250 units';
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  Raw Materials (3 rows):';
  RAISE NOTICE '    Stainless Steel 316 Round Bar 25mm  |  LOT-2025-SS316-0891  |  87.5 kg  |  Gulf Steel Industries LLC';
  RAISE NOTICE '    PTFE Virgin Rod Stock 20mm dia.     |  LOT-2025-PTFE-0054   |  12.5 m   |  SABIC Advanced Polymers Co.';
  RAISE NOTICE '    NBR Nitrile Rubber Sheet 3mm        |  LOT-2025-NBR-0203    |  2.5 sheet|  SABIC Advanced Polymers Co.';
  RAISE NOTICE '';
  RAISE NOTICE '  QC: PASS — Khalid Al-Rashidi';
  RAISE NOTICE '══════════════════════════════════════════════════════';

END;
$$;


-- ── Verification query — run after the block above ────────────
-- Shows the complete data chain for the showcase batch.
SELECT
  po.id                                          AS batch_id,
  p.name                                         AS product_name,
  p.sku,
  po.status,
  po.quantity,
  bom.material_name,
  bom.lot_number                                 AS bom_lot_number,
  rml.lot_number                                 AS rml_lot_number,
  s.name                                         AS supplier_name,
  bom.quantity                                   AS qty_used,
  bom.unit,
  qr.status                                      AS qc_status,
  qr.inspector_name
FROM      production_orders    po
JOIN      products              p   ON p.id   = po.product_id
LEFT JOIN bill_of_materials     bom ON bom.production_order_id = po.id
LEFT JOIN raw_material_lots     rml ON rml.id  = bom.raw_material_lot_id
LEFT JOIN suppliers             s   ON s.id   = rml.supplier_id
LEFT JOIN batch_qc_results      qr  ON qr.batch_id = po.id
WHERE p.sku        = 'VBC-2IN-316'
  AND po.quantity  = 250
ORDER BY bom.material_name;
