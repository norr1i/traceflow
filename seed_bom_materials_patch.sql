-- ============================================================
-- TraceFlow — BOM Materials Patch
-- File: seed_bom_materials_patch.sql
-- ============================================================
--
-- Problem
--   supabase_reseed.sql creates 80 production orders across
--   20 products but inserts ZERO bill_of_materials rows.
--   seed_bom_patch.sql and seed_complete_demo_data.sql only
--   cover the lifecycle-demo SKUs (IFB-M12-880, ELV-7K5-VFD …).
--   The reseed SKUs (ELV-0036 VFD, PPS-0068 Safety Harness …)
--   therefore show "No materials linked to this batch."
--
-- What this script does
--   1. Resolves or creates the raw_material_lots needed for each
--      product category (with supplier_id so the trace page
--      supplier column is populated).
--   2. For every completed production_order that currently has
--      zero bill_of_materials rows, inserts 2–3 realistic
--      BOM rows matched to the product type.
--
-- Idempotent — NOT EXISTS guard on every insert.
-- Safe to run after seed_lifecycle_demo, seed_bom_patch, and
-- seed_complete_demo_data have all been applied.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

DO $$
DECLARE
  v_cid    uuid;
  v_t_base timestamptz;

  -- Suppliers
  v_s_gulf   uuid;
  v_s_sabic  uuid;
  v_s_aramo  uuid;
  v_s_yanbu  uuid;

  -- Raw material IDs (looked up by name; created if absent)
  v_m_carbon  uuid;
  v_m_ss316   uuid;
  v_m_galv    uuid;
  v_m_alum    uuid;
  v_m_copper  uuid;
  v_m_hydo    uuid;
  v_m_gearo   uuid;
  v_m_nbr     uuid;
  v_m_hdpe    uuid;
  v_m_argon   uuid;

  -- Lot IDs (resolved after insert)
  v_lot_cs235   uuid;
  v_lot_ss316   uuid;
  v_lot_galv    uuid;
  v_lot_alum    uuid;
  v_lot_copper  uuid;
  v_lot_hydo    uuid;
  v_lot_gearo   uuid;
  v_lot_nbr     uuid;
  v_lot_hdpe    uuid;
  v_lot_argon   uuid;

  v_rows int;

BEGIN

  -- ── 0. Company ──────────────────────────────────────────────────────
  SELECT c.id INTO v_cid
  FROM companies c ORDER BY c.created_at LIMIT 1;

  IF v_cid IS NULL THEN
    RAISE EXCEPTION 'No company found. Run onboarding first.';
  END IF;

  v_t_base := now() - interval '120 days';   -- matches reseed base
  RAISE NOTICE 'Company: %', v_cid;

  -- ── 1. Suppliers ─────────────────────────────────────────────────────
  SELECT id INTO v_s_gulf  FROM suppliers WHERE company_id = v_cid AND name ILIKE 'Gulf Steel%'       LIMIT 1;
  SELECT id INTO v_s_sabic FROM suppliers WHERE company_id = v_cid AND name ILIKE 'SABIC%'            LIMIT 1;
  SELECT id INTO v_s_aramo FROM suppliers WHERE company_id = v_cid AND name ILIKE 'Arabian Valve%'    LIMIT 1;
  SELECT id INTO v_s_yanbu FROM suppliers WHERE company_id = v_cid AND name ILIKE 'Yanbu Precision%'  LIMIT 1;

  IF v_s_gulf IS NULL THEN
    v_s_gulf := gen_random_uuid();
    INSERT INTO suppliers (id, name, contact_email, contact_phone, company_id, created_at)
    VALUES (v_s_gulf,'Gulf Steel Industries LLC','procurement@gulfsteel.sa','+966-11-234-5678',v_cid,v_t_base)
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_s_gulf FROM suppliers WHERE company_id = v_cid AND name ILIKE 'Gulf Steel%' LIMIT 1;
  END IF;

  IF v_s_sabic IS NULL THEN
    v_s_sabic := gen_random_uuid();
    INSERT INTO suppliers (id, name, contact_email, contact_phone, company_id, created_at)
    VALUES (v_s_sabic,'SABIC Advanced Polymers Co.','supply@sabic-polymers.sa','+966-13-445-6789',v_cid,v_t_base)
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_s_sabic FROM suppliers WHERE company_id = v_cid AND name ILIKE 'SABIC%' LIMIT 1;
  END IF;

  IF v_s_aramo IS NULL THEN
    v_s_aramo := gen_random_uuid();
    INSERT INTO suppliers (id, name, contact_email, contact_phone, company_id, created_at)
    VALUES (v_s_aramo,'Arabian Valve & Fittings Co.','export@arabvalve.sa','+966-13-334-5673',v_cid,v_t_base)
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_s_aramo FROM suppliers WHERE company_id = v_cid AND name ILIKE 'Arabian Valve%' LIMIT 1;
  END IF;

  IF v_s_yanbu IS NULL THEN
    v_s_yanbu := gen_random_uuid();
    INSERT INTO suppliers (id, name, contact_email, contact_phone, company_id, created_at)
    VALUES (v_s_yanbu,'Yanbu Precision Engineering Ltd','orders@yanbu-precision.sa','+966-14-332-1100',v_cid,v_t_base)
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_s_yanbu FROM suppliers WHERE company_id = v_cid AND name ILIKE 'Yanbu Precision%' LIMIT 1;
  END IF;

  RAISE NOTICE 'Suppliers — Gulf:% SABIC:% Aramo:% Yanbu:%',
    v_s_gulf, v_s_sabic, v_s_aramo, v_s_yanbu;

  -- ── 2. Raw materials (create if not already present) ─────────────────

  SELECT id INTO v_m_carbon FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Carbon Steel Sheet%'               LIMIT 1;
  SELECT id INTO v_m_ss316  FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Stainless Steel 316 Round Bar%'    LIMIT 1;
  SELECT id INTO v_m_galv   FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Hot-Dip Galvanized%'               LIMIT 1;
  SELECT id INTO v_m_alum   FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Aluminum Alloy 6061%'              LIMIT 1;
  SELECT id INTO v_m_copper FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Electrolytic Copper Wire%'         LIMIT 1;
  SELECT id INTO v_m_hydo   FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Hydraulic Oil ISO VG 46%'          LIMIT 1;
  SELECT id INTO v_m_gearo  FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Gear Oil ISO VG%'                  LIMIT 1;
  SELECT id INTO v_m_nbr    FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'NBR Nitrile Rubber%'               LIMIT 1;
  SELECT id INTO v_m_hdpe   FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'HDPE Granules%'                    LIMIT 1;
  SELECT id INTO v_m_argon  FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Argon Gas%'                        LIMIT 1;

  IF v_m_carbon IS NULL THEN
    v_m_carbon := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (v_m_carbon,'Carbon Steel Sheet S235 6mm','kg',3200,400,v_s_gulf,v_cid,v_t_base)
    ON CONFLICT (id) DO NOTHING;
    SELECT id INTO v_m_carbon FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Carbon Steel Sheet%' LIMIT 1;
  END IF;

  IF v_m_ss316 IS NULL THEN
    v_m_ss316 := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (v_m_ss316,'Stainless Steel 316 Round Bar 25mm','kg',1850,200,v_s_gulf,v_cid,v_t_base)
    ON CONFLICT (id) DO NOTHING;
    SELECT id INTO v_m_ss316 FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Stainless Steel 316 Round Bar%' LIMIT 1;
  END IF;

  IF v_m_galv IS NULL THEN
    v_m_galv := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (v_m_galv,'Hot-Dip Galvanized Steel Coil 1.5mm','kg',2500,300,v_s_gulf,v_cid,v_t_base)
    ON CONFLICT (id) DO NOTHING;
    SELECT id INTO v_m_galv FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Hot-Dip Galvanized%' LIMIT 1;
  END IF;

  IF v_m_alum IS NULL THEN
    v_m_alum := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (v_m_alum,'Aluminum Alloy 6061-T6 Profile','kg',1100,120,v_s_yanbu,v_cid,v_t_base)
    ON CONFLICT (id) DO NOTHING;
    SELECT id INTO v_m_alum FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Aluminum Alloy 6061%' LIMIT 1;
  END IF;

  IF v_m_copper IS NULL THEN
    v_m_copper := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (v_m_copper,'Electrolytic Copper Wire 4mm2','kg',920,150,v_s_aramo,v_cid,v_t_base)
    ON CONFLICT (id) DO NOTHING;
    SELECT id INTO v_m_copper FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Electrolytic Copper Wire%' LIMIT 1;
  END IF;

  IF v_m_hydo IS NULL THEN
    v_m_hydo := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (v_m_hydo,'Hydraulic Oil ISO VG 46 Mineral','L',800,100,v_s_sabic,v_cid,v_t_base)
    ON CONFLICT (id) DO NOTHING;
    SELECT id INTO v_m_hydo FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Hydraulic Oil ISO VG 46%' LIMIT 1;
  END IF;

  IF v_m_gearo IS NULL THEN
    v_m_gearo := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (v_m_gearo,'Gear Oil ISO VG 220 Synthetic','L',400,60,v_s_sabic,v_cid,v_t_base)
    ON CONFLICT (id) DO NOTHING;
    SELECT id INTO v_m_gearo FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Gear Oil ISO VG%' LIMIT 1;
  END IF;

  IF v_m_nbr IS NULL THEN
    v_m_nbr := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (v_m_nbr,'NBR Nitrile Rubber Sheet 3mm','sheet',45,10,v_s_sabic,v_cid,v_t_base)
    ON CONFLICT (id) DO NOTHING;
    SELECT id INTO v_m_nbr FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'NBR Nitrile Rubber%' LIMIT 1;
  END IF;

  IF v_m_hdpe IS NULL THEN
    v_m_hdpe := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (v_m_hdpe,'HDPE Granules MFI 0.3 g/10min','kg',280,80,v_s_sabic,v_cid,v_t_base)
    ON CONFLICT (id) DO NOTHING;
    SELECT id INTO v_m_hdpe FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'HDPE Granules%' LIMIT 1;
  END IF;

  IF v_m_argon IS NULL THEN
    v_m_argon := gen_random_uuid();
    INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at)
    VALUES (v_m_argon,'Argon Gas 99.997pct 50L Cylinder','cylinder',60,10,v_s_aramo,v_cid,v_t_base)
    ON CONFLICT (id) DO NOTHING;
    SELECT id INTO v_m_argon FROM raw_materials WHERE company_id = v_cid AND name ILIKE 'Argon Gas%' LIMIT 1;
  END IF;

  RAISE NOTICE 'Raw materials resolved.';

  -- ── 3. Raw material lots ─────────────────────────────────────────────
  --   Reuse existing lots from prior seeds where they exist.
  --   Create new lots only when missing.

  -- Carbon steel (reuse LOT-2025-CS235-0611 from seed_bom_patch or create)
  SELECT id INTO v_lot_cs235 FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-CS235-0611' LIMIT 1;
  IF v_lot_cs235 IS NULL THEN
    -- Fallback: any available carbon steel lot with a supplier
    SELECT id INTO v_lot_cs235 FROM raw_material_lots
    WHERE company_id = v_cid AND raw_material_id = v_m_carbon AND supplier_id IS NOT NULL LIMIT 1;
  END IF;
  IF v_lot_cs235 IS NULL AND v_m_carbon IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, status, notes, created_at, updated_at)
    VALUES (v_cid, v_m_carbon, 'LOT-2025-CS235-0611', 1200.0, 'kg', v_s_gulf,
            v_t_base + interval '5 days', 'consumed',
            'Carbon Steel S235JR 6mm. EN 10025-2. Mill cert HN-30991. Gulf Steel heat GS-CS2-0611.',
            v_t_base + interval '5 days', v_t_base + interval '5 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
    SELECT id INTO v_lot_cs235 FROM raw_material_lots
    WHERE company_id = v_cid AND lot_number = 'LOT-2025-CS235-0611' LIMIT 1;
  END IF;

  -- SS316 (reuse LOT-2025-SS316-1047 from seed_bom_patch or create)
  SELECT id INTO v_lot_ss316 FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-SS316-1047' LIMIT 1;
  IF v_lot_ss316 IS NULL THEN
    SELECT id INTO v_lot_ss316 FROM raw_material_lots
    WHERE company_id = v_cid AND raw_material_id = v_m_ss316 AND supplier_id IS NOT NULL LIMIT 1;
  END IF;
  IF v_lot_ss316 IS NULL AND v_m_ss316 IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, status, notes, created_at, updated_at)
    VALUES (v_cid, v_m_ss316, 'LOT-2025-SS316-1047', 800.0, 'kg', v_s_gulf,
            v_t_base + interval '3 days', 'consumed',
            'SS316 round bar 12mm hex. A2-70. EN 10088-3. Gulf Steel cert HN-31044.',
            v_t_base + interval '3 days', v_t_base + interval '3 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
    SELECT id INTO v_lot_ss316 FROM raw_material_lots
    WHERE company_id = v_cid AND lot_number = 'LOT-2025-SS316-1047' LIMIT 1;
  END IF;

  -- Galvanized steel (new lot)
  SELECT id INTO v_lot_galv FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-GALV-0001' LIMIT 1;
  IF v_lot_galv IS NULL AND v_m_galv IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, status, notes, created_at, updated_at)
    VALUES (v_cid, v_m_galv, 'LOT-2025-GALV-0001', 2000.0, 'kg', v_s_gulf,
            v_t_base + interval '7 days', 'consumed',
            'Hot-dip galvanized steel coil 1.5mm, Z275 coating. EN 10346. '
            'Zinc 275 g/m² per side. Gulf Steel cert GS-GALV-0001.',
            v_t_base + interval '7 days', v_t_base + interval '7 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
    SELECT id INTO v_lot_galv FROM raw_material_lots
    WHERE company_id = v_cid AND lot_number = 'LOT-2025-GALV-0001' LIMIT 1;
  END IF;

  -- Aluminum (new lot)
  SELECT id INTO v_lot_alum FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-ALUM-0001' LIMIT 1;
  IF v_lot_alum IS NULL AND v_m_alum IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, status, notes, created_at, updated_at)
    VALUES (v_cid, v_m_alum, 'LOT-2025-ALUM-0001', 800.0, 'kg', v_s_yanbu,
            v_t_base + interval '9 days', 'consumed',
            'Aluminum 6061-T6 extrusion profile. Yield 276 MPa. ASTM B221. '
            'Anodising grade. Yanbu Precision cert YPE-AL-0001.',
            v_t_base + interval '9 days', v_t_base + interval '9 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
    SELECT id INTO v_lot_alum FROM raw_material_lots
    WHERE company_id = v_cid AND lot_number = 'LOT-2025-ALUM-0001' LIMIT 1;
  END IF;

  -- Copper wire (reuse LOT-2025-CUW4-0331 from seed_bom_patch or create)
  SELECT id INTO v_lot_copper FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-CUW4-0331' LIMIT 1;
  IF v_lot_copper IS NULL THEN
    SELECT id INTO v_lot_copper FROM raw_material_lots
    WHERE company_id = v_cid AND raw_material_id = v_m_copper AND supplier_id IS NOT NULL LIMIT 1;
  END IF;
  IF v_lot_copper IS NULL AND v_m_copper IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, status, notes, created_at, updated_at)
    VALUES (v_cid, v_m_copper, 'LOT-2025-CUW4-0331', 500.0, 'kg', v_s_aramo,
            v_t_base + interval '11 days', 'consumed',
            'Electrolytic copper wire 4mm², IEC 60228 class 2. Conductivity ≥58 MS/m. ROHS. '
            'Arabian Valve CoA CUW-2025-0331.',
            v_t_base + interval '11 days', v_t_base + interval '11 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
    SELECT id INTO v_lot_copper FROM raw_material_lots
    WHERE company_id = v_cid AND lot_number = 'LOT-2025-CUW4-0331' LIMIT 1;
  END IF;

  -- Hydraulic oil (new lot)
  SELECT id INTO v_lot_hydo FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-HYDO-0001' LIMIT 1;
  IF v_lot_hydo IS NULL AND v_m_hydo IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, status, notes, created_at, updated_at)
    VALUES (v_cid, v_m_hydo, 'LOT-2025-HYDO-0001', 600.0, 'L', v_s_sabic,
            v_t_base + interval '13 days', 'consumed',
            'Mineral hydraulic oil ISO VG 46, anti-wear HV grade. Flash point 210°C. '
            'DIN 51524-3. SABIC CoA HYDO-2025-0001.',
            v_t_base + interval '13 days', v_t_base + interval '13 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
    SELECT id INTO v_lot_hydo FROM raw_material_lots
    WHERE company_id = v_cid AND lot_number = 'LOT-2025-HYDO-0001' LIMIT 1;
  END IF;

  -- Gear oil (new lot)
  SELECT id INTO v_lot_gearo FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-GEARO-0001' LIMIT 1;
  IF v_lot_gearo IS NULL AND v_m_gearo IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, status, notes, created_at, updated_at)
    VALUES (v_cid, v_m_gearo, 'LOT-2025-GEARO-0001', 300.0, 'L', v_s_sabic,
            v_t_base + interval '15 days', 'consumed',
            'Synthetic gear oil ISO VG 220. CLP PG grade, long drain. Flash point 260°C. '
            'DIN 51517-3. SABIC CoA GEARO-2025-0001.',
            v_t_base + interval '15 days', v_t_base + interval '15 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
    SELECT id INTO v_lot_gearo FROM raw_material_lots
    WHERE company_id = v_cid AND lot_number = 'LOT-2025-GEARO-0001' LIMIT 1;
  END IF;

  -- NBR (reuse LOT-2025-NBR-0203 from seed_bom_patch or create)
  SELECT id INTO v_lot_nbr FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-NBR-0203' LIMIT 1;
  IF v_lot_nbr IS NULL THEN
    SELECT id INTO v_lot_nbr FROM raw_material_lots
    WHERE company_id = v_cid AND raw_material_id = v_m_nbr AND supplier_id IS NOT NULL LIMIT 1;
  END IF;
  IF v_lot_nbr IS NULL AND v_m_nbr IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, status, notes, created_at, updated_at)
    VALUES (v_cid, v_m_nbr, 'LOT-2025-NBR-0203', 60.0, 'sheet', v_s_sabic,
            v_t_base + interval '4 days', 'consumed',
            'NBR 3mm, 70 Shore A, oil-resistant. Volume swell 14% (spec <20%). SABIC CoA NBR-2025-0203.',
            v_t_base + interval '4 days', v_t_base + interval '4 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
    SELECT id INTO v_lot_nbr FROM raw_material_lots
    WHERE company_id = v_cid AND lot_number = 'LOT-2025-NBR-0203' LIMIT 1;
  END IF;

  -- HDPE (reuse LOT-2025-HDPE-0178 from seed_bom_patch or create)
  SELECT id INTO v_lot_hdpe FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-HDPE-0178' LIMIT 1;
  IF v_lot_hdpe IS NULL THEN
    SELECT id INTO v_lot_hdpe FROM raw_material_lots
    WHERE company_id = v_cid AND raw_material_id = v_m_hdpe AND supplier_id IS NOT NULL LIMIT 1;
  END IF;
  IF v_lot_hdpe IS NULL AND v_m_hdpe IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, status, notes, created_at, updated_at)
    VALUES (v_cid, v_m_hdpe, 'LOT-2025-HDPE-0178', 200.0, 'kg', v_s_sabic,
            v_t_base + interval '6 days', 'consumed',
            'HDPE granules MFI 0.3 g/10min. UV-stabilised. EN 397 approved grade. SABIC CoA HDPE-2025-0178.',
            v_t_base + interval '6 days', v_t_base + interval '6 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
    SELECT id INTO v_lot_hdpe FROM raw_material_lots
    WHERE company_id = v_cid AND lot_number = 'LOT-2025-HDPE-0178' LIMIT 1;
  END IF;

  -- Argon gas (new lot)
  SELECT id INTO v_lot_argon FROM raw_material_lots
  WHERE company_id = v_cid AND lot_number = 'LOT-2025-ARGON-0001' LIMIT 1;
  IF v_lot_argon IS NULL AND v_m_argon IS NOT NULL THEN
    INSERT INTO raw_material_lots
      (company_id, raw_material_id, lot_number, quantity, unit, supplier_id,
       received_at, status, notes, created_at, updated_at)
    VALUES (v_cid, v_m_argon, 'LOT-2025-ARGON-0001', 40.0, 'cylinder', v_s_aramo,
            v_t_base + interval '8 days', 'consumed',
            'Industrial argon 99.997% purity, 50L/200 bar cylinders. '
            'ISO 14175-I1. TIG/MIG shielding gas. Arabian Valve CoA ARGON-2025-0001.',
            v_t_base + interval '8 days', v_t_base + interval '8 days')
    ON CONFLICT (company_id, raw_material_id, lot_number) DO NOTHING;
    SELECT id INTO v_lot_argon FROM raw_material_lots
    WHERE company_id = v_cid AND lot_number = 'LOT-2025-ARGON-0001' LIMIT 1;
  END IF;

  RAISE NOTICE 'Lots — cs235:% ss316:% galv:% alum:% copper:% hydo:% gearo:% nbr:% hdpe:% argon:%',
    v_lot_cs235, v_lot_ss316, v_lot_galv, v_lot_alum, v_lot_copper,
    v_lot_hydo, v_lot_gearo, v_lot_nbr, v_lot_hdpe, v_lot_argon;

  -- ════════════════════════════════════════════════════════════════════
  -- 4. BOM INSERTS BY PRODUCT CATEGORY
  --
  --    Strategy: one INSERT per category, using UNION ALL sub-selects
  --    so all 2–3 material rows for a given order are inserted in a
  --    single statement. The NOT EXISTS guard in each sub-select
  --    references the same zero-BOM condition, so all materials for
  --    a qualifying order are inserted atomically.
  --
  --    Quantities are scaled by po.quantity to keep values realistic.
  -- ════════════════════════════════════════════════════════════════════

  -- ── IFB  Steel Hex Bolts ────────────────────────────────────────────
  -- Carbon steel rod + copper wire (zinc plating bath anode)
  IF v_lot_cs235 IS NOT NULL AND v_lot_copper IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Carbon Steel Sheet S235 6mm' AS mn, 'LOT-2025-CS235-0611' AS ln,
             ROUND((po.quantity * 0.065)::numeric,1) AS qty, 'kg' AS u, v_lot_cs235 AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'IFB%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Electrolytic Copper Wire 4mm2', 'LOT-2025-CUW4-0331',
             GREATEST(ROUND((po.quantity * 0.0008)::numeric,2), 0.10), 'kg', v_lot_copper,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'IFB%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  IFB  (Steel Bolt):      % BOM rows inserted', v_rows;
  END IF;

  -- ── IFN  Stainless Hex Nuts ─────────────────────────────────────────
  -- SS316 hex bar stock (primary) + copper wire (small — for passivation bath anodes)
  IF v_lot_ss316 IS NOT NULL AND v_lot_copper IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Stainless Steel 316 Round Bar 25mm' AS mn, 'LOT-2025-SS316-1047' AS ln,
             ROUND((po.quantity * 0.012)::numeric,1) AS qty, 'kg' AS u, v_lot_ss316 AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'IFN%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Electrolytic Copper Wire 4mm2', 'LOT-2025-CUW4-0331',
             GREATEST(ROUND((po.quantity * 0.0003)::numeric,2), 0.05), 'kg', v_lot_copper,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'IFN%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  IFN  (Stainless Nut):   % BOM rows inserted', v_rows;
  END IF;

  -- ── IFW  Galvanized Flat Washers ────────────────────────────────────
  -- Galvanized steel coil (primary) + SS316 wire (small — for edge beading)
  IF v_lot_galv IS NOT NULL AND v_lot_ss316 IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Hot-Dip Galvanized Steel Coil 1.5mm' AS mn, 'LOT-2025-GALV-0001' AS ln,
             ROUND((po.quantity * 0.008)::numeric,1) AS qty, 'kg' AS u, v_lot_galv AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'IFW%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Stainless Steel 316 Round Bar 25mm', 'LOT-2025-SS316-1047',
             GREATEST(ROUND((po.quantity * 0.001)::numeric,2), 0.10), 'kg', v_lot_ss316,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'IFW%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  IFW  (Flat Washer):     % BOM rows inserted', v_rows;
  END IF;

  -- ── VBC / VGV  Ball Valves & Gate Valves ───────────────────────────
  -- Carbon steel body + SS316 stem/ball + NBR seals
  IF v_lot_cs235 IS NOT NULL AND v_lot_ss316 IS NOT NULL AND v_lot_nbr IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Carbon Steel Sheet S235 6mm' AS mn, 'LOT-2025-CS235-0611' AS ln,
             ROUND((po.quantity * 5.2)::numeric,1) AS qty, 'kg' AS u, v_lot_cs235 AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'VBC%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Stainless Steel 316 Round Bar 25mm', 'LOT-2025-SS316-1047',
             ROUND((po.quantity * 0.55)::numeric,1), 'kg', v_lot_ss316,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'VBC%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'NBR Nitrile Rubber Sheet 3mm', 'LOT-2025-NBR-0203',
             GREATEST(ROUND((po.quantity * 0.04)::numeric,1), 1.0), 'sheet', v_lot_nbr,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'VBC%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  VBC  (Ball Valve):      % BOM rows inserted', v_rows;
  END IF;

  IF v_lot_cs235 IS NOT NULL AND v_lot_ss316 IS NOT NULL AND v_lot_nbr IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Carbon Steel Sheet S235 6mm' AS mn, 'LOT-2025-CS235-0611' AS ln,
             ROUND((po.quantity * 6.1)::numeric,1) AS qty, 'kg' AS u, v_lot_cs235 AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'VGV%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Stainless Steel 316 Round Bar 25mm', 'LOT-2025-SS316-1047',
             ROUND((po.quantity * 0.62)::numeric,1), 'kg', v_lot_ss316,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'VGV%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'NBR Nitrile Rubber Sheet 3mm', 'LOT-2025-NBR-0203',
             GREATEST(ROUND((po.quantity * 0.07)::numeric,1), 1.0), 'sheet', v_lot_nbr,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'VGV%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  VGV  (Gate Valve):      % BOM rows inserted', v_rows;
  END IF;

  -- ── VSV  Solenoid Valve ─────────────────────────────────────────────
  -- Aluminum body + copper wire (solenoid coil) + NBR seals
  IF v_lot_alum IS NOT NULL AND v_lot_copper IS NOT NULL AND v_lot_nbr IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Aluminum Alloy 6061-T6 Profile' AS mn, 'LOT-2025-ALUM-0001' AS ln,
             ROUND((po.quantity * 0.42)::numeric,1) AS qty, 'kg' AS u, v_lot_alum AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'VSV%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Electrolytic Copper Wire 4mm2', 'LOT-2025-CUW4-0331',
             ROUND((po.quantity * 0.08)::numeric,2), 'kg', v_lot_copper,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'VSV%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'NBR Nitrile Rubber Sheet 3mm', 'LOT-2025-NBR-0203',
             GREATEST(ROUND((po.quantity * 0.02)::numeric,1), 0.5), 'sheet', v_lot_nbr,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'VSV%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  VSV  (Solenoid Valve):  % BOM rows inserted', v_rows;
  END IF;

  -- ── ELM / ELB / ELC  Switchgear & Contactors ───────────────────────
  -- Copper wire (busbars/contacts) + HDPE (housing moulding)
  IF v_lot_copper IS NOT NULL AND v_lot_hdpe IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Electrolytic Copper Wire 4mm2' AS mn, 'LOT-2025-CUW4-0331' AS ln,
             ROUND((po.quantity * 0.85)::numeric,1) AS qty, 'kg' AS u, v_lot_copper AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed'
        AND (p.sku ILIKE 'ELM%' OR p.sku ILIKE 'ELB%' OR p.sku ILIKE 'ELC%')
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'HDPE Granules MFI 0.3 g/10min', 'LOT-2025-HDPE-0178',
             ROUND((po.quantity * 0.22)::numeric,1), 'kg', v_lot_hdpe,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed'
        AND (p.sku ILIKE 'ELM%' OR p.sku ILIKE 'ELB%' OR p.sku ILIKE 'ELC%')
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  ELM/ELB/ELC (Switchgear): % BOM rows inserted', v_rows;
  END IF;

  -- ── ELV  Variable Frequency Drive ──────────────────────────────────
  -- Copper wire (motor leads/busbars) + HDPE (enclosure) + Aluminum (heatsink)
  IF v_lot_copper IS NOT NULL AND v_lot_hdpe IS NOT NULL AND v_lot_alum IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Electrolytic Copper Wire 4mm2' AS mn, 'LOT-2025-CUW4-0331' AS ln,
             ROUND((po.quantity * 7.8)::numeric,1) AS qty, 'kg' AS u, v_lot_copper AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'ELV%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'HDPE Granules MFI 0.3 g/10min', 'LOT-2025-HDPE-0178',
             ROUND((po.quantity * 1.9)::numeric,1), 'kg', v_lot_hdpe,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'ELV%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Aluminum Alloy 6061-T6 Profile', 'LOT-2025-ALUM-0001',
             ROUND((po.quantity * 2.1)::numeric,1), 'kg', v_lot_alum,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'ELV%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  ELV  (VFD):             % BOM rows inserted', v_rows;
  END IF;

  -- ── HPC  Hydraulic Cylinders ────────────────────────────────────────
  -- Carbon steel barrel + SS316 piston rod + NBR seals + hydraulic oil (filling charge)
  IF v_lot_cs235 IS NOT NULL AND v_lot_ss316 IS NOT NULL AND v_lot_nbr IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Carbon Steel Sheet S235 6mm' AS mn, 'LOT-2025-CS235-0611' AS ln,
             ROUND((po.quantity * 5.8)::numeric,1) AS qty, 'kg' AS u, v_lot_cs235 AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'HPC%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Stainless Steel 316 Round Bar 25mm', 'LOT-2025-SS316-1047',
             ROUND((po.quantity * 2.6)::numeric,1), 'kg', v_lot_ss316,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'HPC%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'NBR Nitrile Rubber Sheet 3mm', 'LOT-2025-NBR-0203',
             GREATEST(ROUND((po.quantity * 0.18)::numeric,1), 1.0), 'sheet', v_lot_nbr,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'HPC%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  HPC  (Hyd Cylinder):    % BOM rows inserted', v_rows;
  END IF;

  -- ── HPP  Pneumatic Cylinders ────────────────────────────────────────
  -- Aluminum barrel + SS316 piston rod + NBR seals
  IF v_lot_alum IS NOT NULL AND v_lot_ss316 IS NOT NULL AND v_lot_nbr IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Aluminum Alloy 6061-T6 Profile' AS mn, 'LOT-2025-ALUM-0001' AS ln,
             ROUND((po.quantity * 1.8)::numeric,1) AS qty, 'kg' AS u, v_lot_alum AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'HPP%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Stainless Steel 316 Round Bar 25mm', 'LOT-2025-SS316-1047',
             ROUND((po.quantity * 0.45)::numeric,1), 'kg', v_lot_ss316,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'HPP%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'NBR Nitrile Rubber Sheet 3mm', 'LOT-2025-NBR-0203',
             GREATEST(ROUND((po.quantity * 0.10)::numeric,1), 0.5), 'sheet', v_lot_nbr,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'HPP%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  HPP  (Pneumatic Cyl):   % BOM rows inserted', v_rows;
  END IF;

  -- ── HPR  Pressure Gauges ────────────────────────────────────────────
  -- SS316 Bourdon tube + aluminum case + NBR wetted seal
  IF v_lot_ss316 IS NOT NULL AND v_lot_alum IS NOT NULL AND v_lot_nbr IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Stainless Steel 316 Round Bar 25mm' AS mn, 'LOT-2025-SS316-1047' AS ln,
             ROUND((po.quantity * 0.085)::numeric,2) AS qty, 'kg' AS u, v_lot_ss316 AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'HPR%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Aluminum Alloy 6061-T6 Profile', 'LOT-2025-ALUM-0001',
             ROUND((po.quantity * 0.060)::numeric,2), 'kg', v_lot_alum,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'HPR%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'NBR Nitrile Rubber Sheet 3mm', 'LOT-2025-NBR-0203',
             GREATEST(ROUND((po.quantity * 0.004)::numeric,2), 0.10), 'sheet', v_lot_nbr,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'HPR%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  HPR  (Pressure Gauge):  % BOM rows inserted', v_rows;
  END IF;

  -- ── HPG  Gear Pumps ─────────────────────────────────────────────────
  -- Carbon steel housing + SS316 gears + gear oil (pre-fill)
  IF v_lot_cs235 IS NOT NULL AND v_lot_ss316 IS NOT NULL AND v_lot_gearo IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Carbon Steel Sheet S235 6mm' AS mn, 'LOT-2025-CS235-0611' AS ln,
             ROUND((po.quantity * 1.35)::numeric,1) AS qty, 'kg' AS u, v_lot_cs235 AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'HPG%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Stainless Steel 316 Round Bar 25mm', 'LOT-2025-SS316-1047',
             ROUND((po.quantity * 0.16)::numeric,1), 'kg', v_lot_ss316,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'HPG%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Gear Oil ISO VG 220 Synthetic', 'LOT-2025-GEARO-0001',
             GREATEST(ROUND((po.quantity * 0.06)::numeric,1), 0.5), 'L', v_lot_gearo,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'HPG%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  HPG  (Gear Pump):       % BOM rows inserted', v_rows;
  END IF;

  -- ── SPE  Pipe Elbows ────────────────────────────────────────────────
  -- SS316 tube stock + argon gas (TIG welding shielding)
  IF v_lot_ss316 IS NOT NULL AND v_lot_argon IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Stainless Steel 316 Round Bar 25mm' AS mn, 'LOT-2025-SS316-1047' AS ln,
             ROUND((po.quantity * 0.38)::numeric,1) AS qty, 'kg' AS u, v_lot_ss316 AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'SPE%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Argon Gas 99.997pct 50L Cylinder', 'LOT-2025-ARGON-0001',
             GREATEST(ROUND((po.quantity * 0.004)::numeric,2), 0.10), 'cylinder', v_lot_argon,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'SPE%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  SPE  (Pipe Elbow):      % BOM rows inserted', v_rows;
  END IF;

  -- ── SPF  Weld Neck Flanges ──────────────────────────────────────────
  -- Carbon steel plate + argon gas (TIG tack weld on hub)
  IF v_lot_cs235 IS NOT NULL AND v_lot_argon IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Carbon Steel Sheet S235 6mm' AS mn, 'LOT-2025-CS235-0611' AS ln,
             ROUND((po.quantity * 4.4)::numeric,1) AS qty, 'kg' AS u, v_lot_cs235 AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'SPF%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Argon Gas 99.997pct 50L Cylinder', 'LOT-2025-ARGON-0001',
             GREATEST(ROUND((po.quantity * 0.002)::numeric,2), 0.10), 'cylinder', v_lot_argon,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'SPF%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  SPF  (Flange):          % BOM rows inserted', v_rows;
  END IF;

  -- ── PPH  Safety Helmets ─────────────────────────────────────────────
  -- HDPE shell + galvanized steel (suspension rivet clips)
  IF v_lot_hdpe IS NOT NULL AND v_lot_galv IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'HDPE Granules MFI 0.3 g/10min' AS mn, 'LOT-2025-HDPE-0178' AS ln,
             ROUND((po.quantity * 0.31)::numeric,1) AS qty, 'kg' AS u, v_lot_hdpe AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'PPH%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Hot-Dip Galvanized Steel Coil 1.5mm', 'LOT-2025-GALV-0001',
             GREATEST(ROUND((po.quantity * 0.008)::numeric,2), 0.10), 'kg', v_lot_galv,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'PPH%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  PPH  (Safety Helmet):   % BOM rows inserted', v_rows;
  END IF;

  -- ── PPG  Cut-Resistant Gloves ───────────────────────────────────────
  -- HDPE-derived HPPE yarn (shell) + SS316 wire (cut liner reinforcement)
  IF v_lot_hdpe IS NOT NULL AND v_lot_ss316 IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'HDPE Granules MFI 0.3 g/10min' AS mn, 'LOT-2025-HDPE-0178' AS ln,
             ROUND((po.quantity * 0.045)::numeric,2) AS qty, 'kg' AS u, v_lot_hdpe AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'PPG%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Stainless Steel 316 Round Bar 25mm', 'LOT-2025-SS316-1047',
             GREATEST(ROUND((po.quantity * 0.003)::numeric,2), 0.10), 'kg', v_lot_ss316,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'PPG%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  PPG  (Cut-Res. Gloves): % BOM rows inserted', v_rows;
  END IF;

  -- ── PPB  S3 Safety Boots ────────────────────────────────────────────
  -- Galvanized steel toe cap blank + HDPE sole compound
  IF v_lot_galv IS NOT NULL AND v_lot_hdpe IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Hot-Dip Galvanized Steel Coil 1.5mm' AS mn, 'LOT-2025-GALV-0001' AS ln,
             ROUND((po.quantity * 0.038)::numeric,2) AS qty, 'kg' AS u, v_lot_galv AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'PPB%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'HDPE Granules MFI 0.3 g/10min', 'LOT-2025-HDPE-0178',
             ROUND((po.quantity * 0.21)::numeric,2), 'kg', v_lot_hdpe,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'PPB%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  PPB  (Safety Boot):     % BOM rows inserted', v_rows;
  END IF;

  -- ── PPS  Full-Body Safety Harness ───────────────────────────────────
  -- Galvanized steel D-rings/buckles + HDPE plastic hardware (chest buckle)
  IF v_lot_galv IS NOT NULL AND v_lot_hdpe IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Hot-Dip Galvanized Steel Coil 1.5mm' AS mn, 'LOT-2025-GALV-0001' AS ln,
             ROUND((po.quantity * 0.145)::numeric,2) AS qty, 'kg' AS u, v_lot_galv AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'PPS%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'HDPE Granules MFI 0.3 g/10min', 'LOT-2025-HDPE-0178',
             ROUND((po.quantity * 0.065)::numeric,2), 'kg', v_lot_hdpe,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed' AND p.sku ILIKE 'PPS%'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  PPS  (Safety Harness):  % BOM rows inserted', v_rows;
  END IF;

  -- ── Catch-all: any remaining completed orders with zero BOM ─────────
  --   Uses carbon steel + SS316 as a sensible default.
  --   Covers any product categories not matched by the blocks above
  --   (e.g. future products added by new seeds).
  IF v_lot_cs235 IS NOT NULL AND v_lot_ss316 IS NOT NULL THEN
    INSERT INTO bill_of_materials
      (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
    SELECT t.oid, t.mn, t.ln, t.qty, t.u, t.lid, v_cid, t.ts FROM (
      SELECT po.id AS oid, 'Carbon Steel Sheet S235 6mm' AS mn, 'LOT-2025-CS235-0611' AS ln,
             ROUND((po.quantity * 1.0)::numeric,1) AS qty, 'kg' AS u, v_lot_cs235 AS lid,
             po.created_at + interval '1 day' AS ts
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
      UNION ALL
      SELECT po.id, 'Stainless Steel 316 Round Bar 25mm', 'LOT-2025-SS316-1047',
             ROUND((po.quantity * 0.10)::numeric,1), 'kg', v_lot_ss316,
             po.created_at + interval '1 day'
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.company_id = v_cid AND po.status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid)
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  catch-all remaining:    % BOM rows inserted', v_rows;
  END IF;

  -- ── Summary ──────────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_rows
  FROM production_orders po
  WHERE po.company_id = v_cid
    AND po.status = 'completed'
    AND NOT EXISTS (SELECT 1 FROM bill_of_materials b WHERE b.production_order_id = po.id AND b.company_id = v_cid);

  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'seed_bom_materials_patch.sql — COMPLETE';
  RAISE NOTICE '  Company: %', v_cid;
  RAISE NOTICE '  Completed orders still missing BOM: %  (should be 0)', v_rows;
  RAISE NOTICE '  Lots used: CS235-0611 | SS316-1047 | GALV-0001 | ALUM-0001';
  RAISE NOTICE '             CUW4-0331  | HYDO-0001  | GEARO-0001';
  RAISE NOTICE '             NBR-0203   | HDPE-0178  | ARGON-0001';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';

END $$;
