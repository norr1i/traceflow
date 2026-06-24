-- ============================================================
-- TraceFlow — Recall Impact Analysis: 5 Industrial Scenarios
-- File: seed_impact_scenarios.sql
-- ============================================================
--
-- PURPOSE
--   Adds 5 complete material traceability scenarios so that
--   get_recall_impact() returns distinct, meaningful results for
--   searches by material name, lot number, or batch ID.
--
-- SCENARIOS
--   1. Inconel 625 Round Bar 25mm        → Turbine Impeller Housings
--   2. NBR Rubber Sheet 6mm              → Pipe Gaskets  [+ active recall]
--   3. Carbon Steel Sheet S355 10mm      → Pressure Vessel Shell Plates
--   4. Packaging Film LDPE 100μm         → Sterile Medical Pouches
--   5. PET Resin IV 0.84 dl/g            → Beverage Bottle Preforms
--
-- SEARCH COVERAGE (all searches return different results)
--   Material name: "Inconel" / "NBR Rubber" / "Carbon Steel" /
--                  "Packaging Film" / "PET Resin"
--   Lot number:    LOT-2025-IN625-0312 / LOT-2025-NBR-0512 /
--                  LOT-2025-CS355-0089 / LOT-2025-LDPE-0771 /
--                  LOT-2025-PET-1103
--   Batch ID:      b1000001... / b1000002... / b1000003... /
--                  b1000004... / b1000005...  (see UUIDs below)
--
-- JOIN CHAIN BUILT
--   bill_of_materials.production_order_id
--     → production_orders.id (= v_batch_ids in RPC)
--       → batches.production_order_id → batches.id (= v_dist_batch_ids)
--         → distribution_records.batch_id
--
-- IDEMPOTENCY
--   products            : ON CONFLICT (sku) DO NOTHING, re-SELECT after
--   production_orders   : ON CONFLICT (id) DO NOTHING
--   batches             : ON CONFLICT (id) DO NOTHING
--   bill_of_materials   : NOT EXISTS guard per (production_order_id, lot_number)
--   distribution_records: NOT EXISTS guard per batch_id
--   recalls             : NOT EXISTS guard per (batch_id, open status)
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

DO $$
DECLARE
  cid      uuid;
  uid      uuid;
  bt_first text;

  -- ── Fixed product UUIDs (format: version 4, variant 10xx) ────────
  p_tih  uuid := 'a1000001-0000-4000-8001-000000000001'::uuid; -- TIH-625-50
  p_gsk  uuid := 'a1000002-0000-4000-8001-000000000002'::uuid; -- GSK-NBR-DN100
  p_pvp  uuid := 'a1000003-0000-4000-8001-000000000003'::uuid; -- PVP-CS355-10
  p_pkg  uuid := 'a1000004-0000-4000-8001-000000000004'::uuid; -- PKG-LDPE-M200
  p_prf  uuid := 'a1000005-0000-4000-8001-000000000005'::uuid; -- PRF-PET-28G

  -- ── Fixed production order UUIDs (searchable as p_batch_id) ──────
  po_in625 uuid := 'b1000001-0000-4000-8001-000000000001'::uuid;
  po_nbr   uuid := 'b1000002-0000-4000-8001-000000000002'::uuid;
  po_cs355 uuid := 'b1000003-0000-4000-8001-000000000003'::uuid;
  po_ldpe  uuid := 'b1000004-0000-4000-8001-000000000004'::uuid;
  po_pet   uuid := 'b1000005-0000-4000-8001-000000000005'::uuid;

  -- ── Fixed batches UUIDs (distribution_records.batch_id → here) ───
  bt_in625 uuid := 'c1000001-0000-4000-8001-000000000001'::uuid;
  bt_nbr   uuid := 'c1000002-0000-4000-8001-000000000002'::uuid;
  bt_cs355 uuid := 'c1000003-0000-4000-8001-000000000003'::uuid;
  bt_ldpe  uuid := 'c1000004-0000-4000-8001-000000000004'::uuid;
  bt_pet   uuid := 'c1000005-0000-4000-8001-000000000005'::uuid;

  -- ── Timestamp anchors (staggered so each scenario has its own era) ─
  t1 timestamptz := now() - interval '120 days'; -- Inconel 625
  t2 timestamptz := now() - interval '95 days';  -- NBR Rubber
  t3 timestamptz := now() - interval '70 days';  -- Carbon Steel
  t4 timestamptz := now() - interval '50 days';  -- Packaging Film
  t5 timestamptz := now() - interval '30 days';  -- PET Resin

BEGIN

  -- ────────────────────────────────────────────────────────────────
  -- 0a. Resolve company and user
  -- ────────────────────────────────────────────────────────────────
  SELECT c.id,
         (SELECT up.user_id FROM user_profiles up
          WHERE  up.company_id = c.id LIMIT 1)
  INTO   cid, uid
  FROM   companies c
  ORDER  BY c.created_at
  LIMIT  1;

  IF cid IS NULL THEN
    RAISE EXCEPTION 'No company found. Complete onboarding before running this seed.';
  END IF;
  RAISE NOTICE 'Seeding company_id = %', cid;

  -- ────────────────────────────────────────────────────────────────
  -- 0b. Discover batch_type enum (first label used in batches INSERT)
  -- ────────────────────────────────────────────────────────────────
  SELECT e.enumlabel INTO bt_first
  FROM   pg_type t
  JOIN   pg_enum e ON e.enumtypid = t.oid
  WHERE  t.typname = 'batch_type'
  ORDER  BY e.enumsortorder
  LIMIT  1;

  IF bt_first IS NULL THEN
    RAISE EXCEPTION 'batch_type enum not found — verify schema is installed.';
  END IF;
  RAISE NOTICE 'batch_type first label: %', bt_first;

  -- ════════════════════════════════════════════════════════════════
  -- 1. PRODUCTS
  -- ════════════════════════════════════════════════════════════════

  INSERT INTO products (id, name, sku, description, company_id, created_at) VALUES
    (p_tih, 'Turbine Impeller Housing Inconel 625', 'TIH-625-50',
     'Investment-cast Inconel 625 turbine impeller housing. ASTM B443 / UNS N06625. '
     'High-temperature corrosion and oxidation resistance. For gas turbine and centrifugal compressor service.',
     cid, t1),

    (p_gsk, 'Pipe Gasket NBR 6mm DN100', 'GSK-NBR-DN100',
     'Full-face NBR rubber sheet gasket, DN100 PN16, 6 mm thick. ASME B16.21 dimensional standard. '
     'Oil and gas pipeline service. Shore A 60–70 hardness specification.',
     cid, t2),

    (p_pvp, 'Pressure Vessel Shell Plate 10mm', 'PVP-CS355-10',
     'Carbon steel shell plate S355JR, 10 mm, flame-cut to order. '
     'PED 2014/68/EU compliant. Third-party UTS/yield certified per EN 10025-2.',
     cid, t3),

    (p_pkg, 'Sterile Medical Pouch 200x300mm', 'PKG-LDPE-M200',
     'LDPE sterile packaging pouch 200×300 mm, heat-seal closure. '
     'Gamma radiation compatible, ISO 11607-1 compliant. Single-use surgical instrument packaging.',
     cid, t4),

    (p_prf, 'PET Bottle Preform 28g 28mm PCO', 'PRF-PET-28G',
     'PET preform 28 g, 28 mm PCO 1881 finish. For 500 ml CSD and water bottles. '
     'IV 0.84 dl/g, AA level <10 ppm. NSF/SFDA food-contact approved.',
     cid, t5)
  ON CONFLICT (sku) DO NOTHING;

  -- Re-select product IDs (handles case where sku already existed)
  SELECT id INTO p_tih FROM products WHERE sku = 'TIH-625-50'    LIMIT 1;
  SELECT id INTO p_gsk FROM products WHERE sku = 'GSK-NBR-DN100' LIMIT 1;
  SELECT id INTO p_pvp FROM products WHERE sku = 'PVP-CS355-10'  LIMIT 1;
  SELECT id INTO p_pkg FROM products WHERE sku = 'PKG-LDPE-M200' LIMIT 1;
  SELECT id INTO p_prf FROM products WHERE sku = 'PRF-PET-28G'   LIMIT 1;

  RAISE NOTICE 'Products: p_tih=% p_gsk=% p_pvp=% p_pkg=% p_prf=%',
    p_tih, p_gsk, p_pvp, p_pkg, p_prf;

  -- ════════════════════════════════════════════════════════════════
  -- 2. PRODUCTION ORDERS
  --    These UUIDs are the "batch IDs" users can search by p_batch_id.
  -- ════════════════════════════════════════════════════════════════

  INSERT INTO production_orders
    (id, product_id, quantity, status, started_at, completed_at, created_at, company_id)
  VALUES
    -- Scenario 1: Inconel 625 impeller housings — 180 units
    (po_in625, p_tih, 180,
     'completed', t1 + interval '2 days', t1 + interval '14 days', t1, cid),

    -- Scenario 2: NBR rubber gaskets — 3200 units
    (po_nbr, p_gsk, 3200,
     'completed', t2 + interval '1 day', t2 + interval '8 days', t2, cid),

    -- Scenario 3: Carbon steel shell plates — 120 units
    (po_cs355, p_pvp, 120,
     'completed', t3 + interval '3 days', t3 + interval '18 days', t3, cid),

    -- Scenario 4: Sterile medical pouches — 50000 units
    (po_ldpe, p_pkg, 50000,
     'completed', t4 + interval '1 day', t4 + interval '10 days', t4, cid),

    -- Scenario 5: PET bottle preforms — 250000 units
    (po_pet, p_prf, 250000,
     'completed', t5 + interval '2 days', t5 + interval '12 days', t5, cid)
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Production orders inserted (or already existed).';

  -- ════════════════════════════════════════════════════════════════
  -- 3. BILL OF MATERIALS
  --    lot_number here is what users search by p_lot_number.
  --    material_name is what users search by p_material_name.
  -- ════════════════════════════════════════════════════════════════

  -- Scenario 1: Inconel 625
  IF NOT EXISTS (
    SELECT 1 FROM bill_of_materials
    WHERE  production_order_id = po_in625
      AND  lot_number          = 'LOT-2025-IN625-0312'
      AND  company_id          = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, company_id, created_at)
    VALUES
      (po_in625, 'Inconel 625 Round Bar 25mm',      'LOT-2025-IN625-0312', 145, 'kg',    cid, t1 + interval '2 days'),
      (po_in625, 'Chrome-Free Conversion Primer',   'LOT-2025-CCP-0044',     5, 'litre', cid, t1 + interval '2 days'),
      (po_in625, 'Investment Casting Ceramic Shell', 'LOT-2025-ICS-0011',    18, 'kg',    cid, t1 + interval '2 days');
    RAISE NOTICE 'BOM: Inconel 625 scenario inserted.';
  ELSE
    RAISE NOTICE 'BOM: Inconel 625 scenario already exists — skipped.';
  END IF;

  -- Scenario 2: NBR Rubber Sheet
  IF NOT EXISTS (
    SELECT 1 FROM bill_of_materials
    WHERE  production_order_id = po_nbr
      AND  lot_number          = 'LOT-2025-NBR-0512'
      AND  company_id          = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, company_id, created_at)
    VALUES
      (po_nbr, 'NBR Rubber Sheet 6mm',       'LOT-2025-NBR-0512', 48, 'sheet', cid, t2 + interval '1 day'),
      (po_nbr, 'Anti-Adhesive Release Film', 'LOT-2025-ARF-0009',  6, 'roll',  cid, t2 + interval '1 day');
    RAISE NOTICE 'BOM: NBR Rubber scenario inserted.';
  ELSE
    RAISE NOTICE 'BOM: NBR Rubber scenario already exists — skipped.';
  END IF;

  -- Scenario 3: Carbon Steel Sheet
  IF NOT EXISTS (
    SELECT 1 FROM bill_of_materials
    WHERE  production_order_id = po_cs355
      AND  lot_number          = 'LOT-2025-CS355-0089'
      AND  company_id          = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, company_id, created_at)
    VALUES
      (po_cs355, 'Carbon Steel Sheet S355 10mm',  'LOT-2025-CS355-0089', 215, 'kg',    cid, t3 + interval '3 days'),
      (po_cs355, 'Epoxy Fusion-Bonded Primer',    'LOT-2025-EFP-0031',    13, 'litre', cid, t3 + interval '3 days');
    RAISE NOTICE 'BOM: Carbon Steel scenario inserted.';
  ELSE
    RAISE NOTICE 'BOM: Carbon Steel scenario already exists — skipped.';
  END IF;

  -- Scenario 4: Packaging Film LDPE
  IF NOT EXISTS (
    SELECT 1 FROM bill_of_materials
    WHERE  production_order_id = po_ldpe
      AND  lot_number          = 'LOT-2025-LDPE-0771'
      AND  company_id          = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, company_id, created_at)
    VALUES
      (po_ldpe, 'Packaging Film LDPE 100μm',      'LOT-2025-LDPE-0771', 125, 'kg', cid, t4 + interval '1 day'),
      (po_ldpe, 'Medical-Grade Heat Seal Lacquer', 'LOT-2025-HSL-0058',    3, 'kg', cid, t4 + interval '1 day');
    RAISE NOTICE 'BOM: Packaging Film scenario inserted.';
  ELSE
    RAISE NOTICE 'BOM: Packaging Film scenario already exists — skipped.';
  END IF;

  -- Scenario 5: PET Resin
  IF NOT EXISTS (
    SELECT 1 FROM bill_of_materials
    WHERE  production_order_id = po_pet
      AND  lot_number          = 'LOT-2025-PET-1103'
      AND  company_id          = cid
  ) THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, company_id, created_at)
    VALUES
      (po_pet, 'PET Resin IV 0.84 dl/g',          'LOT-2025-PET-1103',  7000, 'kg', cid, t5 + interval '2 days'),
      (po_pet, 'UV Stabiliser Masterbatch PET',    'LOT-2025-UVS-0022',    35, 'kg', cid, t5 + interval '2 days'),
      (po_pet, 'Acetaldehyde Scavenger Additive',  'LOT-2025-ASA-0017',    14, 'kg', cid, t5 + interval '2 days');
    RAISE NOTICE 'BOM: PET Resin scenario inserted.';
  ELSE
    RAISE NOTICE 'BOM: PET Resin scenario already exists — skipped.';
  END IF;

  -- ════════════════════════════════════════════════════════════════
  -- 4. BATCHES
  --    Bridges production_orders.id → batches.id so that
  --    distribution_records.batch_id (→ batches.id) resolves correctly.
  --    lot_number uses LOT-BTCH-* prefix to avoid uq_active_lot_per_company.
  -- ════════════════════════════════════════════════════════════════

  INSERT INTO batches
    (id, company_id, type, sku, name, lot_number,
     quantity_initial, quantity_remaining, product_id, production_order_id)
  VALUES
    (bt_in625, cid, bt_first::batch_type,
     'TIH-625-50',
     'Turbine Impeller Housing Inconel 625 — Batch 2025-Q1-IN625',
     'LOT-BTCH-IN625-0001',
     180, 20, p_tih, po_in625),

    (bt_nbr, cid, bt_first::batch_type,
     'GSK-NBR-DN100',
     'Pipe Gasket NBR 6mm DN100 — Batch 2025-Q2-NBR',
     'LOT-BTCH-NBR-0002',
     3200, 400, p_gsk, po_nbr),

    (bt_cs355, cid, bt_first::batch_type,
     'PVP-CS355-10',
     'Pressure Vessel Shell Plate 10mm — Batch 2025-Q3-CS',
     'LOT-BTCH-CS355-0003',
     120, 20, p_pvp, po_cs355),

    (bt_ldpe, cid, bt_first::batch_type,
     'PKG-LDPE-M200',
     'Sterile Medical Pouch 200x300mm — Batch 2025-Q4-LDPE',
     'LOT-BTCH-LDPE-0004',
     50000, 5000, p_pkg, po_ldpe),

    (bt_pet, cid, bt_first::batch_type,
     'PRF-PET-28G',
     'PET Bottle Preform 28g — Batch 2025-Q5-PET',
     'LOT-BTCH-PET-0005',
     250000, 20000, p_prf, po_pet)
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Batches inserted (or already existed).';

  -- ════════════════════════════════════════════════════════════════
  -- 5. DISTRIBUTION RECORDS
  --    NOT NULL: company_id, batch_id, recipient_type, recipient_name, quantity_shipped
  -- ════════════════════════════════════════════════════════════════

  -- ── Scenario 1: Inconel 625 — 160 of 180 units shipped to 3 recipients ──
  IF NOT EXISTS (
    SELECT 1 FROM distribution_records WHERE company_id = cid AND batch_id = bt_in625
  ) THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (cid, bt_in625, 'government'::recipient_type,
       'Saudi Aramco — Khurais Crude Oil Plant', 60, t1 + interval '16 days',
       'DN-SA-IN625-001 | 60 units | Turbine maintenance programme. '
       'SATORP approved vendor list AVO-2025-0071. Material cert 3.1 per EN 10204 on file.'),

      (cid, bt_in625, 'distributor'::recipient_type,
       'SABIC Engineering Materials — Jubail', 55, t1 + interval '18 days',
       'DN-SABIC-IN625-002 | 55 units | Capital project procurement. '
       'PO SABIC-PRO-2025-0318. ISO 15156 HIC-tested material certificate submitted.'),

      (cid, bt_in625, 'distributor'::recipient_type,
       'Tasnee Jubail Petrochemical Co.', 45, t1 + interval '20 days',
       'DN-TNJ-IN625-003 | 45 units | Ethylene plant turnaround stock. '
       'Advanced material certification and PMI report filed per project spec.');

    RAISE NOTICE 'Distribution: Inconel 625 — 3 records inserted (160 units).';
  ELSE
    RAISE NOTICE 'Distribution: Inconel 625 — already exists, skipped.';
  END IF;

  -- ── Scenario 2: NBR Rubber Gaskets — 2800 of 3200 units shipped to 4 recipients ──
  IF NOT EXISTS (
    SELECT 1 FROM distribution_records WHERE company_id = cid AND batch_id = bt_nbr
  ) THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (cid, bt_nbr, 'distributor'::recipient_type,
       'Al-Khobar Industrial Supplies Co.', 900, t2 + interval '10 days',
       'DN-AKI-NBR-001 | 900 units | Routine quarterly supply Q2-2025. '
       'PO AKI-2025-Q2-0084. Full-pallet SAPTCO freight. QA cert attached.'),

      (cid, bt_nbr, 'wholesaler'::recipient_type,
       'Gulf Sealing Solutions LLC', 750, t2 + interval '11 days',
       'DN-GSS-NBR-002 | 750 units | Gasket-cut service centre stock replenishment. '
       'QA conformance cert GSS-QC-2025-0033 on file.'),

      (cid, bt_nbr, 'government'::recipient_type,
       'Saudi Aramco — Yanbu Refinery', 700, t2 + interval '13 days',
       'DN-SA-NBR-003 | 700 units | Shutdown maintenance package RTO-2025-YNB. '
       'NDE-inspected batch. Aramco IPA approval IPA-2025-0447.'),

      (cid, bt_nbr, 'distributor'::recipient_type,
       'Dammam Engineering Trading LLC', 450, t2 + interval '15 days',
       'DN-DET-NBR-004 | 450 units | Consolidated supply order Q2. '
       'Combined pallet with carbon steel products. Invoice DET-INV-2025-0621.');

    RAISE NOTICE 'Distribution: NBR Rubber — 4 records inserted (2800 units).';
  ELSE
    RAISE NOTICE 'Distribution: NBR Rubber — already exists, skipped.';
  END IF;

  -- ── Scenario 3: Carbon Steel Shell Plates — 100 of 120 units shipped to 3 recipients ──
  IF NOT EXISTS (
    SELECT 1 FROM distribution_records WHERE company_id = cid AND batch_id = bt_cs355
  ) THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (cid, bt_cs355, 'distributor'::recipient_type,
       'Yanbu Industrial Services Co.', 45, t3 + interval '21 days',
       'DN-YIS-CS355-001 | 45 plates | Vessel fabrication project, Yanbu Industrial City Phase 4. '
       'Drawing rev C confirmed. Dimensional report DR-2025-0188 on file.'),

      (cid, bt_cs355, 'government'::recipient_type,
       'Saudi Aramco — Ras Tanura Refinery', 35, t3 + interval '23 days',
       'DN-SA-CS355-002 | 35 plates | Tank farm fabrication. '
       'MTC 3.1 per EN 10204 submitted. ASME VIII Div.1 compliance confirmed.'),

      (cid, bt_cs355, 'distributor'::recipient_type,
       'Eastern Province Steel Fabricators', 20, t3 + interval '25 days',
       'DN-EPSF-CS355-003 | 20 plates | Bespoke pressure vessel shell order. '
       'Customer design approval EP-DES-2025-0312 received prior to cut.');

    RAISE NOTICE 'Distribution: Carbon Steel — 3 records inserted (100 units).';
  ELSE
    RAISE NOTICE 'Distribution: Carbon Steel — already exists, skipped.';
  END IF;

  -- ── Scenario 4: Sterile Medical Pouches — 45000 of 50000 units to 3 recipients ──
  IF NOT EXISTS (
    SELECT 1 FROM distribution_records WHERE company_id = cid AND batch_id = bt_ldpe
  ) THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (cid, bt_ldpe, 'hospital'::recipient_type,
       'King Faisal Specialist Hospital — Riyadh', 18000, t4 + interval '12 days',
       'DN-KFSH-LDPE-001 | 18000 pouches | Central sterilisation supply. '
       'PO KFSH-CS-2025-0091. ISO 11607-1 conformity cert on file. Cold chain not required.'),

      (cid, bt_ldpe, 'hospital'::recipient_type,
       'Saudi German Hospital — Jeddah', 15000, t4 + interval '13 days',
       'DN-SGH-LDPE-002 | 15000 pouches | Surgical instrument re-packaging programme. '
       'SFDA medical device registration MDR-2025-PKG-0044 verified.'),

      (cid, bt_ldpe, 'distributor'::recipient_type,
       'Al-Mouwasat Medical Group Supply Chain', 12000, t4 + interval '15 days',
       'DN-AMM-LDPE-003 | 12000 pouches | Network hospital distribution Q4-2025. '
       'Gamma-sterility compatibility confirmed. Lot traceability records attached.');

    RAISE NOTICE 'Distribution: Packaging Film — 3 records inserted (45000 units).';
  ELSE
    RAISE NOTICE 'Distribution: Packaging Film — already exists, skipped.';
  END IF;

  -- ── Scenario 5: PET Bottle Preforms — 230000 of 250000 units to 4 recipients ──
  IF NOT EXISTS (
    SELECT 1 FROM distribution_records WHERE company_id = cid AND batch_id = bt_pet
  ) THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (cid, bt_pet, 'wholesaler'::recipient_type,
       'Almarai Beverage Division — Al Kharj', 90000, t5 + interval '14 days',
       'DN-ALM-PET-001 | 90000 preforms | CSD line 3 and water line 1 production run. '
       'PO ALM-2025-0512. IV and AA conformity report ALM-QA-2025-0187 received.'),

      (cid, bt_pet, 'wholesaler'::recipient_type,
       'Nadec Foods — Hail Processing Plant', 70000, t5 + interval '15 days',
       'DN-NDC-PET-002 | 70000 preforms | Juice and water lines Q3 stock. '
       'Batch conformity cert NDC-QA-2025-0034. SFDA food-contact declaration on file.'),

      (cid, bt_pet, 'distributor'::recipient_type,
       'Arabian Gulf Beverages LLC', 40000, t5 + interval '16 days',
       'DN-AGB-PET-003 | 40000 preforms | Flavoured water brand launch order. '
       'Speed-to-market priority shipment. Customer QC acceptance AGB-ACC-2025-0091.'),

      (cid, bt_pet, 'distributor'::recipient_type,
       'Saudi Refreshments Co. (PepsiCo Franchise)', 30000, t5 + interval '18 days',
       'DN-SRC-PET-004 | 30000 preforms | CSD operational stock replenishment. '
       'Annual supply agreement SRC-SA-2025-0003. Pallet inspection passed.');

    RAISE NOTICE 'Distribution: PET Resin — 4 records inserted (230000 units).';
  ELSE
    RAISE NOTICE 'Distribution: PET Resin — already exists, skipped.';
  END IF;

  -- ════════════════════════════════════════════════════════════════
  -- 6. ACTIVE RECALL — Scenario 2 (NBR Rubber Sheet Gaskets)
  --    recall.batch_id → production_orders.id (po_nbr), per schema.
  --    This makes get_recall_impact() return has_open_recall=true
  --    and risk_level='critical' (open recall + >0 distributed units).
  -- ════════════════════════════════════════════════════════════════

  IF NOT EXISTS (
    SELECT 1 FROM recalls
    WHERE  batch_id   = po_nbr
      AND  company_id = cid
      AND  status    <> 'closed'
  ) THEN
    INSERT INTO recalls
      (id, company_id, product_id, batch_id,
       title, reason, severity, status,
       affected_units, initiated_by_name,
       initiated_at, created_at, updated_at)
    VALUES (
      'd1000002-0000-4000-8001-000000000002'::uuid,
      cid, p_gsk, po_nbr,
      'Pipe Gasket NBR DN100 — Hardness Non-Conformance (Lot LOT-2025-NBR-0512)',
      'Third-party QA audit identified Shore A hardness below minimum specification '
      '(55 vs. required 60) on 11% of sampled units from lot LOT-2025-NBR-0512. '
      'Risk of fugitive emissions under cyclic pressure service conditions. '
      'Potentially affects all 2800 units distributed to four customers.',
      'high',
      'in_progress',
      2800,
      'Mohammed Al-Qahtani — Quality Director',
      t2 + interval '40 days',
      t2 + interval '40 days',
      t2 + interval '40 days'
    );
    RAISE NOTICE 'Recall: NBR Rubber non-conformance recall created (in_progress, high severity).';
  ELSE
    RAISE NOTICE 'Recall: NBR Rubber open recall already exists — skipped.';
  END IF;

  -- ════════════════════════════════════════════════════════════════
  -- Done
  -- ════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '══ Impact scenarios seed complete ══════════════════════════';
  RAISE NOTICE '5 industrial traceability scenarios seeded successfully.';
  RAISE NOTICE '';
  RAISE NOTICE 'Searchable material names:';
  RAISE NOTICE '  "Inconel 625"      → 1 batch, 160 units, 3 distributors, medium risk';
  RAISE NOTICE '  "NBR Rubber"       → 1 batch, 2800 units, 4 distributors, CRITICAL (open recall)';
  RAISE NOTICE '  "Carbon Steel"     → 1 batch, 100 units, 3 distributors, high risk';
  RAISE NOTICE '  "Packaging Film"   → 1 batch, 45000 units, 3 hospitals/distributors, high risk';
  RAISE NOTICE '  "PET Resin"        → 1 batch, 230000 units, 4 distributors, high risk';
  RAISE NOTICE '';
  RAISE NOTICE 'Searchable lot numbers:';
  RAISE NOTICE '  LOT-2025-IN625-0312  /  LOT-2025-NBR-0512  /  LOT-2025-CS355-0089';
  RAISE NOTICE '  LOT-2025-LDPE-0771   /  LOT-2025-PET-1103';
  RAISE NOTICE '';
  RAISE NOTICE 'Searchable batch IDs (production_orders.id):';
  RAISE NOTICE '  b1000001-0000-4000-8001-000000000001  (Inconel 625)';
  RAISE NOTICE '  b1000002-0000-4000-8001-000000000002  (NBR Rubber)';
  RAISE NOTICE '  b1000003-0000-4000-8001-000000000003  (Carbon Steel)';
  RAISE NOTICE '  b1000004-0000-4000-8001-000000000004  (Packaging Film)';
  RAISE NOTICE '  b1000005-0000-4000-8001-000000000005  (PET Resin)';

END;
$$;

-- ============================================================
-- VERIFICATION QUERIES — run these after the DO block above
-- ============================================================

-- 1. Material name: Inconel 625 — expect 3 distributors, 160 units, medium/high risk
SELECT
  result->>'risk_level'           AS risk_level,
  result->>'has_open_recall'      AS has_open_recall,
  (result->>'total_batches')::int AS total_batches,
  (result->>'total_affected_units')::int AS affected_units,
  (result->>'total_distributors')::int   AS distributors
FROM (SELECT get_recall_impact(p_material_name := 'Inconel 625') AS result) t;

-- 2. Lot number: LOT-2025-NBR-0512 — expect CRITICAL risk, open recall, 2800 units
SELECT
  result->>'risk_level'           AS risk_level,
  result->>'has_open_recall'      AS has_open_recall,
  (result->>'total_affected_units')::int AS affected_units,
  (result->>'total_distributors')::int   AS distributors
FROM (SELECT get_recall_impact(p_lot_number := 'LOT-2025-NBR-0512') AS result) t;

-- 3. Batch ID: Carbon Steel — expect 3 distributors, 100 units
SELECT
  result->>'risk_level'           AS risk_level,
  (result->>'total_affected_units')::int AS affected_units,
  (result->>'total_distributors')::int   AS distributors
FROM (
  SELECT get_recall_impact(
    p_batch_id := 'b1000003-0000-4000-8001-000000000003'::uuid
  ) AS result
) t;

-- 4. Material name: PET Resin — expect 4 distributors, 230000 units, high risk
SELECT
  result->>'risk_level'           AS risk_level,
  (result->>'total_affected_units')::int AS affected_units,
  (result->>'total_distributors')::int   AS distributors
FROM (SELECT get_recall_impact(p_material_name := 'PET Resin') AS result) t;

-- 5. Full distributor list for NBR recall scenario
SELECT
  d->>'recipient_name' AS recipient,
  d->>'recipient_type' AS type,
  (d->>'quantity')::int AS units,
  left(d->>'shipped_at', 10) AS shipped_date
FROM (
  SELECT get_recall_impact(p_lot_number := 'LOT-2025-NBR-0512') AS result
) t,
LATERAL jsonb_array_elements(t.result->'affected_distributors') d
ORDER BY shipped_date;
