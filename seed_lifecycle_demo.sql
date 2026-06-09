-- ============================================================
-- TraceFlow — Production-Readiness Lifecycle Demo Seed  v3
-- ============================================================
-- Type audit (corrected across all three seed runs):
--   distribution_records.batch_id    UUID  (live DB FK, not sfda text)
--   distribution_records.recipient_type ENUM (live DB, labels unknown
--                                        → discovered at runtime)
--   quality_inspections.batch_id     TEXT  (schema confirmed)
--   recalls.batch_id / capas.batch_id UUID (FK to production_orders)
--   scan_events.batch_id             UUID  (FK to production_orders)
--   batch_qc_results.batch_id        UUID  (FK to production_orders)
--   activity_logs.entity_id          TEXT
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
--   Run ONCE per database. ON CONFLICT DO NOTHING guards keyed tables.
--   FOR-loop inserts (scan_events) are always safe (auto-UUID PK).
-- ============================================================

DO $$
DECLARE
  cid  uuid;
  uid  uuid;

  -- Suppliers
  s_gulf  uuid := gen_random_uuid();
  s_sabic uuid := gen_random_uuid();
  s_yanbu uuid := gen_random_uuid();
  s_aramo uuid := gen_random_uuid();

  -- Story products
  p_valve  uuid := gen_random_uuid();
  p_hyd    uuid := gen_random_uuid();
  p_relief uuid := gen_random_uuid();

  -- Supporting products
  p_bolt   uuid := gen_random_uuid();
  p_nut    uuid := gen_random_uuid();
  p_gate   uuid := gen_random_uuid();
  p_mccb   uuid := gen_random_uuid();
  p_vfd    uuid := gen_random_uuid();
  p_gear   uuid := gen_random_uuid();
  p_flange uuid := gen_random_uuid();
  p_helmet uuid := gen_random_uuid();

  -- Raw materials
  m_ss316  uuid := gen_random_uuid();
  m_carbon uuid := gen_random_uuid();
  m_ptfe   uuid := gen_random_uuid();
  m_chrome uuid := gen_random_uuid();
  m_nbr    uuid := gen_random_uuid();
  m_copper uuid := gen_random_uuid();
  m_hdpe   uuid := gen_random_uuid();

  -- Raw material lots
  lot_ss316  uuid := gen_random_uuid();
  lot_cs235  uuid := gen_random_uuid();
  lot_chrome uuid := gen_random_uuid();

  -- Story production orders
  batch_01 uuid := gen_random_uuid();   -- Ball Valve   (Story 1)
  batch_02 uuid := gen_random_uuid();   -- Hyd Cylinder (Story 2)
  batch_03 uuid := gen_random_uuid();   -- Relief Valve (Story 3)

  -- Supporting production orders
  b04 uuid := gen_random_uuid();  b05 uuid := gen_random_uuid();
  b06 uuid := gen_random_uuid();  b07 uuid := gen_random_uuid();
  b08 uuid := gen_random_uuid();  b09 uuid := gen_random_uuid();
  b10 uuid := gen_random_uuid();  b11 uuid := gen_random_uuid();
  b12 uuid := gen_random_uuid();  b13 uuid := gen_random_uuid();
  b14 uuid := gen_random_uuid();  b15 uuid := gen_random_uuid();

  -- QC result IDs (batch_qc_results)
  qc_01 uuid := gen_random_uuid();
  qc_02 uuid := gen_random_uuid();
  qc_03 uuid := gen_random_uuid();

  -- Formal inspection IDs (quality_inspections)
  qi_01 uuid := gen_random_uuid();
  qi_02 uuid := gen_random_uuid();
  qi_03 uuid := gen_random_uuid();

  -- CAPA IDs
  capa_01 uuid := gen_random_uuid();
  capa_02 uuid := gen_random_uuid();
  capa_03 uuid := gen_random_uuid();
  capa_04 uuid := gen_random_uuid();

  -- Recall IDs
  recall_01 uuid := gen_random_uuid();
  recall_02 uuid := gen_random_uuid();

  -- Timeline anchors
  t_base timestamptz := now() - interval '90 days';
  t1     timestamptz;
  t2     timestamptz;
  t3     timestamptz;

  n   int;
  i   int;

  -- batches rows required by distribution_records.batch_id FK → batches.id
  dist_b01 uuid := gen_random_uuid();  -- batches row: ball valve story
  dist_b03 uuid := gen_random_uuid();  -- batches row: relief valve story
  bt_first text;                        -- first label of batch_type enum

BEGIN

  -- ── 0a. Resolve company & user ───────────────────────────────
  SELECT c.id,
         (SELECT up.user_id FROM user_profiles up
          WHERE up.company_id = c.id LIMIT 1)
  INTO   cid, uid
  FROM   companies c
  ORDER  BY c.created_at
  LIMIT  1;

  IF cid IS NULL THEN
    RAISE EXCEPTION 'No company found. Complete onboarding first.';
  END IF;
  RAISE NOTICE 'Seeding company_id = %', cid;

  -- ── 0b. Backfill NULL company_id on orphaned rows ────────────
  UPDATE products            SET company_id = cid WHERE company_id IS NULL;
  UPDATE suppliers           SET company_id = cid WHERE company_id IS NULL;
  UPDATE raw_materials       SET company_id = cid WHERE company_id IS NULL;
  UPDATE production_orders   SET company_id = cid WHERE company_id IS NULL;
  UPDATE sales               SET company_id = cid WHERE company_id IS NULL;
  UPDATE quality_inspections SET company_id = cid WHERE company_id IS NULL;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='bill_of_materials') THEN
    UPDATE bill_of_materials SET company_id = cid WHERE company_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='batch_qc_results') THEN
    UPDATE batch_qc_results SET company_id = cid WHERE company_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='scan_events') THEN
    UPDATE scan_events SET company_id = cid WHERE company_id IS NULL;
  END IF;
  RAISE NOTICE 'Backfill complete';

  -- ── 0c. Introspect distribution_records ──────────────────────
  -- Print every column with nullability so schema drift is visible
  -- before the first INSERT executes.
  RAISE NOTICE 'distribution_records columns: %', (
    SELECT string_agg(
             column_name || ' ' || data_type
             || CASE WHEN is_nullable='NO' THEN ' NOT NULL' ELSE '' END,
             ', ' ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='distribution_records'
  );

  -- ── 0d. Discover batch_type enum (first label for batches INSERT) ──
  -- recipient_type labels confirmed from live schema audit:
  --   distributor(1) wholesaler(2) retailer(3) hospital(4)
  --   government(5) export(6) internal_transfer(7) consumer(8)
  -- batch_type labels discovered at runtime (not in any local SQL file).
  SELECT e.enumlabel INTO bt_first
  FROM   pg_type t
  JOIN   pg_enum e ON e.enumtypid = t.oid
  WHERE  t.typname = 'batch_type'
  ORDER  BY e.enumsortorder
  LIMIT  1;

  IF bt_first IS NULL THEN
    RAISE EXCEPTION 'batch_type enum not found — batches table may not be installed';
  END IF;
  RAISE NOTICE 'batch_type first label: %', bt_first;

  -- ══════════════════════════════════════════════════════════════
  -- 1. SUPPLIERS
  -- ══════════════════════════════════════════════════════════════

  INSERT INTO suppliers (id, name, contact_email, contact_phone, company_id, created_at) VALUES
    (s_gulf,  'Gulf Steel Industries LLC',       'procurement@gulfsteel.sa',  '+966-11-234-5678', cid, t_base),
    (s_sabic, 'SABIC Advanced Polymers Co.',     'supply@sabic-polymers.sa',  '+966-13-445-6789', cid, t_base),
    (s_yanbu, 'Yanbu Precision Engineering Ltd', 'orders@yanbu-precision.sa', '+966-14-332-1100', cid, t_base),
    (s_aramo, 'Arabian Valve & Fittings Co.',    'export@arabvalve.sa',       '+966-13-334-5673', cid, t_base)
  ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════
  -- 2. PRODUCTS
  -- ══════════════════════════════════════════════════════════════

  INSERT INTO products (id, name, sku, description, company_id, created_at) VALUES
    (p_valve,  'Ball Valve 2in 316 Stainless Steel', 'VBC-2IN-316',
     'Full-bore ball valve, fire-safe design, ISO 17292. Process isolation in petrochemical plants.', cid, t_base),
    (p_hyd,    'Hydraulic Cylinder 50mm Bore 200mm', 'HPC-50-200',
     'Double-acting hydraulic cylinder, chrome-plated rod, honed bore. ISO 6020-2.', cid, t_base),
    (p_relief, 'Safety Relief Valve 0.5in 10 bar',   'VSR-05-010',
     'Spring-loaded pressure relief valve. Set pressure factory-tested, ASME coded.', cid, t_base)
  ON CONFLICT (sku) DO NOTHING;

  SELECT id INTO p_valve  FROM products WHERE sku='VBC-2IN-316' AND company_id=cid LIMIT 1;
  SELECT id INTO p_hyd    FROM products WHERE sku='HPC-50-200'  AND company_id=cid LIMIT 1;
  SELECT id INTO p_relief FROM products WHERE sku='VSR-05-010'  AND company_id=cid LIMIT 1;

  INSERT INTO products (id, name, sku, description, company_id, created_at) VALUES
    (p_bolt,   'Steel Hex Bolt M12x80 Grade 8.8',   'IFB-M12-880',  'High-strength fastener, zinc-plated, DIN 931.', cid, t_base),
    (p_nut,    'Stainless Hex Nut M12 DIN 934',     'IFN-M12-934',  'A2-70 stainless, corrosion-resistant. Offshore certified.', cid, t_base),
    (p_gate,   'Gate Valve DN50 PN16 Carbon Steel', 'VGV-DN50-16',  'OS&Y gate valve, rising stem. API 600 compliant.', cid, t_base),
    (p_mccb,   'MCCB 3-Pole 250A Fixed Mount',      'ELM-3P-250A',  'Moulded case circuit breaker. IEC 60947-2 certified.', cid, t_base),
    (p_vfd,    'Variable Frequency Drive 7.5kW',    'ELV-7K5-VFD',  'Sensorless vector control, RS485 Modbus RTU, EMC filter.', cid, t_base),
    (p_gear,   'Gear Pump 16cc 250 bar Hydraulic',  'HPG-16CC-250', 'External gear pump, SAE flange mount.', cid, t_base),
    (p_flange, 'Weld Neck Flange DN80 PN40',        'SPF-DN80-40',  'Class 300 raised-face weld neck flange. ASME B16.5.', cid, t_base),
    (p_helmet, 'Safety Helmet Class G EN397 White', 'PPH-CG-WHT',   'Polypropylene hard hat, 6-point suspension. EN 397.', cid, t_base)
  ON CONFLICT (sku) DO NOTHING;

  -- ══════════════════════════════════════════════════════════════
  -- 3. RAW MATERIALS
  -- ══════════════════════════════════════════════════════════════

  INSERT INTO raw_materials (id, name, unit, quantity_in_stock, reorder_level, supplier_id, company_id, created_at) VALUES
    (m_ss316,  'Stainless Steel 316 Round Bar 25mm', 'kg',    1850.00, 200.00, s_gulf,  cid, t_base),
    (m_carbon, 'Carbon Steel Sheet S235 6mm',        'kg',    3200.00, 400.00, s_gulf,  cid, t_base),
    (m_ptfe,   'PTFE Virgin Rod Stock 20mm dia.',    'm',      120.00,  20.00, s_sabic, cid, t_base),
    (m_chrome, 'Chrome-Plated Steel Rod 50mm',       'kg',      45.00, 100.00, s_yanbu, cid, t_base),
    (m_nbr,    'NBR Nitrile Rubber Sheet 3mm',       'sheet',   45.00,  10.00, s_sabic, cid, t_base),
    (m_copper, 'Electrolytic Copper Wire 4mm2',      'kg',     920.00, 150.00, s_aramo, cid, t_base),
    (m_hdpe,   'HDPE Granules MFI 0.3 g/10min',     'kg',     280.00,  80.00, s_sabic, cid, t_base)
  ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════
  -- 4. RAW MATERIAL LOTS
  -- ══════════════════════════════════════════════════════════════

  INSERT INTO raw_material_lots (
    id, company_id, raw_material_id, lot_number, quantity, unit,
    supplier_id, received_at, expiry_date, status, notes, created_at, updated_at
  ) VALUES
    (lot_ss316, cid, m_ss316, 'LOT-2025-SS316-0891', 500.0, 'kg',
     s_gulf, t_base, t_base+interval '2 years', 'available',
     'Mill cert EN 10204 3.1. Heat number HN-29841. Hardness 187 HB.', t_base, t_base),

    (lot_cs235, cid, m_carbon, 'LOT-2025-CS235-0442', 800.0, 'kg',
     s_gulf, t_base+interval '5 days', t_base+interval '3 years', 'consumed',
     'Consumed in Safety Relief Valve production and supporting batches.', t_base+interval '5 days', t_base+interval '5 days'),

    (lot_chrome, cid, m_chrome, 'LOT-2025-CRROD-0115', 300.0, 'kg',
     s_yanbu, t_base+interval '2 days', t_base+interval '18 months', 'quarantine',
     'QUARANTINED: Hardness 48–51 HRC vs 58–62 HRC min. NCR-2025-0041. Return to Yanbu in progress.',
     t_base+interval '2 days', t_base+interval '30 days')
  ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════
  -- STORY 1 — Ball Valve 2in 316 SS
  -- Raw Material → Production → QC Pass → Distribution → QR Scans
  -- ══════════════════════════════════════════════════════════════

  t1 := t_base + interval '5 days';

  -- production_orders: id UUID, product_id UUID, company_id UUID
  INSERT INTO production_orders
    (id, product_id, quantity, status, started_at, completed_at, company_id, created_at)
  VALUES (batch_01, p_valve, 250, 'completed', t1+interval '1 day', t1+interval '8 days', cid, t1)
  ON CONFLICT DO NOTHING;

  -- bill_of_materials: production_order_id UUID
  -- raw_material_lot_id links to raw_material_lots so the Product Journey
  -- page can derive Real "Raw Material Received" timeline events with
  -- actual received_at timestamps and supplier names.
  INSERT INTO bill_of_materials (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
  VALUES
    (batch_01, 'Stainless Steel 316 Round Bar 25mm', 'LOT-2025-SS316-0891', 87.5, 'kg',    lot_ss316, cid, t1+interval '1 day'),
    (batch_01, 'PTFE Virgin Rod Stock 20mm dia.',    'LOT-2025-PTFE-0054',  12.5, 'm',     NULL,      cid, t1+interval '1 day'),
    (batch_01, 'NBR Nitrile Rubber Sheet 3mm',       'LOT-2025-NBR-0203',    2.5, 'sheet', NULL,      cid, t1+interval '1 day')
  ON CONFLICT DO NOTHING;

  -- batch_qc_results: batch_id UUID (FK production_orders.id)
  INSERT INTO batch_qc_results (id, batch_id, status, inspector_name, notes, inspected_at, company_id, created_at)
  VALUES (qc_01, batch_01, 'pass', 'Khalid Al-Rashidi',
    'All 250 units inspected. Ball rotation torque 7.8 Nm (spec 7–9 Nm). '
    'Pressure test 1.5× WP: PASS. Fire-safe seat ISO 10497: PASS. Ra 0.8 μm. CC-2025-0891 issued.',
    t1+interval '9 days', cid, t1+interval '9 days')
  ON CONFLICT DO NOTHING;

  -- quality_inspections: batch_id TEXT (schema confirmed)
  INSERT INTO quality_inspections
    (id, batch_id, inspector_id, inspector_name, inspection_date, inspection_type,
     status, overall_score, notes, company_id, created_at, updated_at)
  VALUES (qi_01, batch_01::text, 'INS-001', 'Khalid Al-Rashidi',
    (t1+interval '9 days')::date, 'final', 'passed', 97.5,
    'QCP-003 Rev 4. All dimensional checks ±0.05 mm. Pressure, fire-safe seat, material certs reviewed. '
    '100% units certified. CC-2025-0891 filed.',
    cid, t1+interval '9 days', t1+interval '9 days')
  ON CONFLICT DO NOTHING;

  -- ── batches row for ball valve story ─────────────────────────────
  -- distribution_records.batch_id FK → batches.id (confirmed from live audit).
  -- batch_01 is the production_orders.id; dist_b01 is the matching batches.id.
  INSERT INTO batches
    (id, company_id, type, sku, name, lot_number,
     quantity_initial, quantity_remaining, product_id, production_order_id)
  VALUES
    (dist_b01, cid, bt_first::batch_type, 'BV-2IN-316SS',
     'Ball Valve 2in 316 Stainless Steel — Batch 2025-Q1-001',
     'LOT-2025-BV316-0001', 250, 80, p_valve, batch_01)
  ON CONFLICT (id) DO NOTHING;

  -- distribution_records: 3 shipments for ball valve batch
  -- NOT NULL required: company_id, batch_id(→dist_b01), recipient_type, recipient_name, quantity_shipped
  -- Columns with server defaults omitted: recipient_country('SA'), unit('kg'), recall_acknowledged(false), timestamps
  INSERT INTO distribution_records
    (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
  VALUES
    (cid, dist_b01, 'distributor'::recipient_type,
     'Saudi Aramco — Jubail Industrial Area', 120, t1+interval '12 days',
     'DN-SA-2025-0441 | 120 units | PO SAP-PO-84231 | SAPTCO cargo | Delivery confirmed.');

  INSERT INTO distribution_records
    (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
  VALUES
    (cid, dist_b01, 'distributor'::recipient_type,
     'Sipchem Jubail Plant 4', 80, t1+interval '14 days',
     'DN-SPC-2025-0217 | 80 units | Plant 4 process isolation upgrade. Customer accepted.');

  INSERT INTO distribution_records
    (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
  VALUES
    (cid, dist_b01, 'distributor'::recipient_type,
     'Maaden Mining — Wa''ad Al Shamal', 50, t1+interval '16 days',
     'DN-MAD-2025-0089 | 50 units | Potash plant valve replacement program.');

  INSERT INTO sales (product_id, product_name, quantity, unit_price, total_price, customer_name, status, sold_at, company_id, created_at)
  VALUES
    (p_valve,'Ball Valve 2in 316 Stainless Steel',120,2850.00, 342000.00,'Saudi Aramco',      'completed',t1+interval '12 days',cid,t1+interval '12 days'),
    (p_valve,'Ball Valve 2in 316 Stainless Steel', 80,2780.00, 222400.00,'Sipchem Jubail',    'completed',t1+interval '14 days',cid,t1+interval '14 days'),
    (p_valve,'Ball Valve 2in 316 Stainless Steel', 50,2900.00, 145000.00,'Maaden Mining Co.', 'completed',t1+interval '16 days',cid,t1+interval '16 days')
  ON CONFLICT DO NOTHING;

  -- scan_events: batch_id UUID (FK production_orders.id) — no cast
  -- 35 historical scans (3 UA fingerprints for Repeat Consumer Rate metric)
  FOR i IN 1..35 LOOP
    INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
    VALUES (
      batch_01,
      t1 + interval '12 days' + (i * 2.8 || ' days')::interval,
      CASE WHEN i%3=0 THEN 'desktop' ELSE 'mobile' END,
      (ARRAY['Chrome','Safari','Safari','Chrome','Edge','Firefox','Chrome','Safari'])[1+(i%8)],
      CASE
        WHEN i%3=0 THEN 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
        WHEN i%3=1 THEN 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/122.0.6261.119 Mobile Safari/537.36'
        ELSE             'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) AppleWebKit/605.1.15 Version/17.3 Mobile Safari/604.1'
      END, cid);
  END LOOP;

  -- 12 recent scans across last 7 days (feeds Scan Activity chart)
  FOR i IN 1..12 LOOP
    INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
    VALUES (
      batch_01,
      now() - ((i*0.55)||' days')::interval,
      CASE WHEN i%2=0 THEN 'desktop' ELSE 'mobile' END,
      (ARRAY['Chrome','Safari','Chrome','Edge','Chrome'])[1+(i%5)],
      CASE WHEN i%2=0
        THEN 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
        ELSE 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) AppleWebKit/605.1.15 Safari/604.1'
      END, cid);
  END LOOP;

  -- batch_journey_events: batch_id UUID FK production_orders.id
  -- Story 1 — Ball Valve: complete lifecycle events
  INSERT INTO batch_journey_events
    (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
  VALUES
    (cid, batch_01, 'raw_material.received', t_base, 'warehouse@company.sa', 'raw_material',
     '{"title":"Raw Materials Received","description":"SS316 lot LOT-2025-SS316-0891 (500 kg) received from Gulf Steel Industries. Mill cert EN 10204 3.1 attached. Stored in quarantine pending incoming QC."}'::jsonb, t_base),

    (cid, batch_01, 'raw_material.released', t1, 'qa@company.sa', 'raw_material',
     '{"title":"Raw Material Released for Production","description":"LOT-2025-SS316-0891 passed incoming inspection. Hardness 187 HB confirmed (spec 150–200 HB). 87.5 kg allocated to Ball Valve order. Cleared for production."}'::jsonb, t1),

    (cid, batch_01, 'packaging.completed', t1+interval '10 days', 'ops@company.sa', 'production_order',
     '{"title":"Packaging & Labelling Complete","description":"250 units packed in VCI-coated cartons. SFDA traceability labels and QR codes applied. Ready for dispatch."}'::jsonb, t1+interval '10 days'),

    (cid, batch_01, 'distribution.delivered', t1+interval '13 days', 'logistics@company.sa', 'sales',
     '{"title":"Shipment Delivered — Saudi Aramco","description":"120 units confirmed received at Jubail Industrial Area. DN-SA-2025-0441 delivery note signed. Customer acceptance complete."}'::jsonb, t1+interval '13 days'),

    (cid, batch_01, 'distribution.delivered', t1+interval '15 days', 'logistics@company.sa', 'sales',
     '{"title":"Shipment Delivered — Sipchem Jubail","description":"80 units confirmed received at Plant 4. DN-SPC-2025-0217 delivery note signed. Customer acceptance complete."}'::jsonb, t1+interval '15 days'),

    (cid, batch_01, 'distribution.delivered', t1+interval '18 days', 'logistics@company.sa', 'sales',
     '{"title":"Shipment Delivered — Maaden Mining","description":"50 units confirmed received at Wa''ad Al Shamal. DN-MAD-2025-0089 delivery note signed. Customer acceptance complete."}'::jsonb, t1+interval '18 days')
  ON CONFLICT DO NOTHING;

  -- Story 2 — Hydraulic Cylinder: raw material receipt + release (then QC fail)
  INSERT INTO batch_journey_events
    (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
  VALUES
    (cid, batch_02, 'raw_material.received', t2-interval '2 days', 'warehouse@company.sa', 'raw_material',
     '{"title":"Raw Materials Received","description":"Chrome rod LOT-2025-CRROD-0115 (300 kg) from Yanbu Precision Engineering. Carbon steel LOT-2025-CS235-0442 (800 kg) from Gulf Steel Industries. Both delivered — incoming QC pending."}'::jsonb, t2-interval '2 days'),

    (cid, batch_02, 'raw_material.released', t2, 'qa@company.sa', 'raw_material',
     '{"title":"Raw Materials Released — Conditional","description":"LOT-2025-CS235-0442 (Carbon steel) passed incoming inspection. LOT-2025-CRROD-0115 (Chrome rod): CoC reviewed — hardness deferred to in-process Rockwell check per revised QCP-011. Materials released conditionally for production start."}'::jsonb, t2)
  ON CONFLICT DO NOTHING;

  -- Story 3 — Safety Relief Valve: full lifecycle including recall
  INSERT INTO batch_journey_events
    (company_id, batch_id, event_type, event_timestamp, actor_email, entity_type, metadata, created_at)
  VALUES
    (cid, batch_03, 'raw_material.received', t3-interval '1 day', 'warehouse@company.sa', 'raw_material',
     '{"title":"Raw Materials Received","description":"Carbon steel LOT-2025-CS235-0442 (62 kg), SS316 LOT-2025-SS316-0891 (18 kg), and NBR sheet LOT-2025-NBR-0223 (3 sheets) received. Spring assemblies from SHV-Springs also received — material cert on file."}'::jsonb, t3-interval '1 day'),

    (cid, batch_03, 'raw_material.released', t3, 'qa@company.sa', 'raw_material',
     '{"title":"Raw Materials Released for Production","description":"All incoming lots passed visual and dimensional inspection. Mill certs verified. Spring cert reviewed — Inconel 625 declared (not XRF/PMI verified at this stage). All materials released for production."}'::jsonb, t3),

    (cid, batch_03, 'distribution.delivered', t3+interval '11 days', 'logistics@company.sa', 'sales',
     '{"title":"Shipment Delivered — Tasnee Petrochemicals","description":"60 units confirmed received at Jubail. DN-TAS-2025-0388 delivery note signed. Units installed in process safety system."}'::jsonb, t3+interval '11 days'),

    (cid, batch_03, 'distribution.delivered', t3+interval '13 days', 'logistics@company.sa', 'sales',
     '{"title":"Shipment Delivered — National Gas Co.","description":"55 units confirmed received at NGIC Riyadh. DN-NGC-2025-0154 delivery note signed."}'::jsonb, t3+interval '13 days'),

    (cid, batch_03, 'distribution.delivered', t3+interval '15 days', 'logistics@company.sa', 'sales',
     '{"title":"Shipment Delivered — Advanced Polypropylene Co.","description":"35 units confirmed received at Jubail reactor facility. DN-APC-2025-0071 delivery note signed."}'::jsonb, t3+interval '15 days')
  ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════
  -- STORY 2 — Hydraulic Cylinder 50mm
  -- Production → QC Fail → CAPA (all five lifecycle stages → closed)
  -- ══════════════════════════════════════════════════════════════

  t2 := t_base + interval '25 days';

  INSERT INTO production_orders
    (id, product_id, quantity, status, started_at, completed_at, company_id, created_at)
  VALUES (batch_02, p_hyd, 80, 'completed', t2+interval '1 day', t2+interval '7 days', cid, t2)
  ON CONFLICT DO NOTHING;

  INSERT INTO bill_of_materials (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
  VALUES
    (batch_02,'Chrome-Plated Steel Rod 50mm',  'LOT-2025-CRROD-0115', 45.0,'kg',    lot_chrome, cid,t2+interval '1 day'),
    (batch_02,'Carbon Steel Sheet S235 6mm',   'LOT-2025-CS235-0442',120.0,'kg',    lot_cs235,  cid,t2+interval '1 day'),
    (batch_02,'NBR Nitrile Rubber Sheet 3mm',  'LOT-2025-NBR-0203',    4.0,'sheet', NULL,       cid,t2+interval '1 day')
  ON CONFLICT DO NOTHING;

  -- batch_qc_results.batch_id UUID
  INSERT INTO batch_qc_results (id, batch_id, status, inspector_name, notes, inspected_at, company_id, created_at)
  VALUES (qc_02, batch_02, 'fail', 'Ahmed Al-Mutairi',
    'CRITICAL FAILURE — Chrome rod hardness 48–51 HRC (spec 58–62 HRC min) across all 80 units. '
    'Bore honing ±0.05 mm actual vs ±0.02 mm spec. All 80 units QUARANTINED. NCR-2025-0041 raised. '
    'Root cause: Yanbu Precision incorrect heat treatment 850°C/2h vs 920°C/4h.',
    t2+interval '8 days', cid, t2+interval '8 days')
  ON CONFLICT DO NOTHING;

  -- quality_inspections.batch_id TEXT
  INSERT INTO quality_inspections
    (id, batch_id, inspector_id, inspector_name, inspection_date, inspection_type,
     status, overall_score, notes, company_id, created_at, updated_at)
  VALUES (qi_02, batch_02::text, 'INS-003', 'Ahmed Al-Mutairi',
    (t2+interval '8 days')::date, 'final', 'failed', 41.0,
    'FAILED — QCP-003 Rev 4. Hardness OOS 48–51 HRC vs 58–62 HRC min. Bore tolerance exceeded. '
    'Batch scrapped — no rework possible. 8D report HYD-8D-2025-041 initiated.',
    cid, t2+interval '8 days', t2+interval '8 days')
  ON CONFLICT DO NOTHING;

  -- quality_defects.inspection_id UUID FK quality_inspections.id
  INSERT INTO quality_defects
    (inspection_id, defect_type, severity, quantity, description, corrective_action, resolved, resolved_at, created_at)
  VALUES
    (qi_02,'Material Hardness Out of Spec','critical',80,
     'Chrome rod 48–51 HRC. Supplier applied 850°C/2h vs 920°C/4h heat treatment.',
     'Quarantine LOT-2025-CRROD-0115. NCR-2025-0041. Return lot. Source from Gulf Steel. 100% retest.',
     true,t2+interval '38 days',t2+interval '8 days'),
    (qi_02,'Tolerance Exceeded','major',80,
     'Bore honing ±0.05 mm vs ±0.02 mm. Correlated — incorrect rod hardness caused tool deflection.',
     '80 units condemned and scrapped. 8D report HYD-8D-2025-041 closed.',
     true,t2+interval '38 days',t2+interval '8 days')
  ON CONFLICT DO NOTHING;

  -- capas.inspection_id UUID, capas.batch_id UUID — no cast
  INSERT INTO capas (
    id, company_id, inspection_id, batch_id,
    title, severity, root_cause, corrective_action, preventive_action,
    owner_name, due_date, status,
    investigation_at, corrective_action_at, verification_at, closed_at,
    created_at, updated_at
  ) VALUES (
    capa_01, cid, qi_02, batch_02,
    'Critical Hardness Non-Conformance — Hydraulic Cylinder Batch HPC-2025-080',
    'critical',
    'Yanbu Precision Engineering applied 850°C/2h heat treatment (spec: 920°C/4h) to chrome rod '
    'LOT-2025-CRROD-0115. Furnace maintenance deviation. CoC falsely declared correct cycle.',
    '1. Quarantine and scrap all 80 units. 2. Supplier NCR-2025-0041 to Yanbu Precision. '
    '3. Return full LOT-2025-CRROD-0115 (300 kg). 4. Source from Gulf Steel Industries. '
    '5. 100% Rockwell hardness test before production release.',
    '1. Mandatory hardness cert for all chrome rod deliveries. '
    '2. In-process Rockwell check at machining stage — QCP-011 Rev 3. '
    '3. Thermal process verification on incoming inspection checklist. '
    '4. Yanbu Precision capacity audit within 60 days.',
    'Sara Al-Qahtani', (t2+interval '45 days')::date, 'closed',
    t2+interval '9 days', t2+interval '18 days', t2+interval '35 days', t2+interval '42 days',
    t2+interval '8 days', t2+interval '42 days'
  ) ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════
  -- STORY 3 — Safety Relief Valve 0.5in 10 bar
  -- Production → QC Pass → Distribution → Field Failure →
  -- Recall → CAPA → Both Closed
  -- ══════════════════════════════════════════════════════════════

  t3 := t_base + interval '42 days';

  INSERT INTO production_orders
    (id, product_id, quantity, status, started_at, completed_at, company_id, created_at)
  VALUES (batch_03, p_relief, 150, 'completed', t3+interval '1 day', t3+interval '6 days', cid, t3)
  ON CONFLICT DO NOTHING;

  INSERT INTO bill_of_materials (production_order_id, material_name, lot_number, quantity, unit, raw_material_lot_id, company_id, created_at)
  VALUES
    (batch_03,'Carbon Steel Sheet S235 6mm',       'LOT-2025-CS235-0442', 62.0,'kg',    lot_cs235, cid,t3+interval '1 day'),
    (batch_03,'NBR Nitrile Rubber Sheet 3mm',       'LOT-2025-NBR-0223',   3.0,'sheet', NULL,      cid,t3+interval '1 day'),
    (batch_03,'Stainless Steel 316 Round Bar 25mm','LOT-2025-SS316-0891', 18.0,'kg',    lot_ss316, cid,t3+interval '1 day')
  ON CONFLICT DO NOTHING;

  -- batch_qc_results.batch_id UUID
  INSERT INTO batch_qc_results (id, batch_id, status, inspector_name, notes, inspected_at, company_id, created_at)
  VALUES (qc_03, batch_03, 'pass', 'Mohammed Al-Harbi',
    'Final inspection per ASME UG-136. Set pressure 10.0 bar ±0.28 bar. Full-lift at 110%: PASS. '
    'Seat tightness 90%: PASS. 150 units stamped and tagged. CoC CC-2025-0903 issued. '
    'Note: ambient-temp only — latent high-temp spring defect undetected.',
    t3+interval '7 days', cid, t3+interval '7 days')
  ON CONFLICT DO NOTHING;

  -- quality_inspections.batch_id TEXT
  INSERT INTO quality_inspections
    (id, batch_id, inspector_id, inspector_name, inspection_date, inspection_type,
     status, overall_score, notes, company_id, created_at, updated_at)
  VALUES (qi_03, batch_03::text, 'INS-002', 'Mohammed Al-Harbi',
    (t3+interval '7 days')::date, 'final', 'passed', 91.0,
    'Passed — ASME UG-136. 100% cold pressure tested. Documentation complete. '
    'Ambient-temp only: high-temp performance assumed per spring cert — gap identified post-recall.',
    cid, t3+interval '7 days', t3+interval '7 days')
  ON CONFLICT DO NOTHING;

  -- ── batches row for relief valve story ────────────────────────────
  INSERT INTO batches
    (id, company_id, type, sku, name, lot_number,
     quantity_initial, quantity_remaining, product_id, production_order_id)
  VALUES
    (dist_b03, cid, bt_first::batch_type, 'SRV-05-010',
     'Safety Relief Valve 0.5in 10 bar — Batch 2025-Q1-003',
     'LOT-2025-SRV-0003', 150, 0, p_relief, batch_03)
  ON CONFLICT (id) DO NOTHING;

  -- distribution_records: 3 shipments for relief valve batch (all later recalled)
  INSERT INTO distribution_records
    (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
  VALUES
    (cid, dist_b03, 'distributor'::recipient_type,
     'Tasnee Petrochemicals — Jubail', 60, t3+interval '10 days',
     'DN-TAS-2025-0388 | 60 units | Process safety system upgrade.');

  INSERT INTO distribution_records
    (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
  VALUES
    (cid, dist_b03, 'government'::recipient_type,
     'National Gas Co. NGIC — Riyadh', 55, t3+interval '12 days',
     'DN-NGC-2025-0154 | 55 units | Pipeline pressure management project.');

  INSERT INTO distribution_records
    (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
  VALUES
    (cid, dist_b03, 'distributor'::recipient_type,
     'Advanced Polypropylene Co. — Jubail', 35, t3+interval '14 days',
     'DN-APC-2025-0071 | 35 units | Polypropylene reactor safety system.');

  INSERT INTO sales (product_id, product_name, quantity, unit_price, total_price, customer_name, status, sold_at, company_id, created_at)
  VALUES
    (p_relief,'Safety Relief Valve 0.5in 10 bar',60,1650.00, 99000.00,'Tasnee Petrochemicals',    'completed',t3+interval '10 days',cid,t3+interval '10 days'),
    (p_relief,'Safety Relief Valve 0.5in 10 bar',55,1620.00, 89100.00,'National Gas Co. NGIC',    'completed',t3+interval '12 days',cid,t3+interval '12 days'),
    (p_relief,'Safety Relief Valve 0.5in 10 bar',35,1680.00, 58800.00,'Advanced Polypropylene Co.','completed',t3+interval '14 days',cid,t3+interval '14 days')
  ON CONFLICT DO NOTHING;

  -- recalls.product_id UUID, recalls.batch_id UUID — no cast
  INSERT INTO recalls (
    id, company_id, product_id, batch_id,
    title, reason, severity, status,
    root_cause, corrective_action, affected_units,
    initiated_by_name, initiated_at, closed_at, created_at, updated_at
  ) VALUES (
    recall_01, cid, p_relief, batch_03,
    'Voluntary Recall — VSR-05-010 Safety Relief Valves, Batch 2025-Q1-003 (150 units)',
    'Field report from Tasnee: 4 units failed to open at set pressure at 185°C. '
    'Post-failure analysis: spring seat substituted (17-7PH SS vs Inconel 625 specified). '
    'All 150 units potentially affected. SFDA voluntary recall per MD-CAB-04.',
    'critical','closed',
    'Supplier substituted 17-7PH PH stainless for Inconel 625 without change notice. '
    'Material cert falsely declared correct material. Ambient QC did not detect high-temp deviation. '
    'Incoming inspection lacked XRF/PMI for spring assemblies.',
    'Voluntary recall 150 units. Free Inconel 625 spring retrofit within 30 days. '
    '3 customers notified within 24h. Field teams deployed. SFDA RN-2025-VSR-003 filed. '
    'Return: 148/150 (98.7%). 2 units unaccounted — SFDA notified.',
    150,'Omar Al-Shamrani',
    t3+interval '25 days', t3+interval '62 days',
    t3+interval '25 days', t3+interval '62 days'
  ) ON CONFLICT DO NOTHING;

  -- capas.recall_id UUID, capas.inspection_id UUID, capas.batch_id UUID
  INSERT INTO capas (
    id, company_id, recall_id, inspection_id, batch_id,
    title, severity, root_cause, corrective_action, preventive_action,
    owner_name, due_date, status,
    investigation_at, corrective_action_at, verification_at, closed_at,
    created_at, updated_at
  ) VALUES (
    capa_02, cid, recall_01, qi_03, batch_03,
    'Spring Material Deviation — Safety Relief Valve Recall VSR-2025-Q1-003',
    'critical',
    'Undisclosed substitution: 17-7PH SS vs Inconel 625. XRF confirmed post-failure. '
    'High-temp creep failure >160°C. Incoming QC lacked PMI/XRF for spring components.',
    '1. Full recall 150 units. 2. Free Inconel 625 spring retrofit at all 3 sites. '
    '3. Supplier SHV-Springs disqualified. 4. Warehouse XRF check — 0 further OOS. '
    '5. SFDA RN-2025-VSR-003 filed within 24h.',
    '1. Mandatory XRF/PMI for all Inconel/superalloy springs before production release. '
    '2. Single-source spring: Gulf Steel Industries only. '
    '3. PMI field added to incoming inspection checklist. '
    '4. Annual material audit clause in all spring supplier contracts.',
    'Fatima Al-Dosari', (now()+interval '14 days')::date, 'verification',
    t3+interval '26 days', t3+interval '34 days', t3+interval '54 days', NULL,
    t3+interval '25 days', now()-interval '4 days'
  ) ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════
  -- 5. ACTIVE / OPEN RECORDS (for live KPI card state)
  -- ══════════════════════════════════════════════════════════════

  -- Active recall (in_progress) — shows on Active Recalls KPI card
  INSERT INTO recalls (
    id, company_id, product_id,
    title, reason, severity, status,
    affected_units, initiated_by_name, initiated_at, created_at, updated_at
  ) VALUES (
    recall_02, cid, p_bolt,
    'Precautionary Hold — Steel Hex Bolt M12 Grade 8.8, Batch IFB-2025-Q2-007',
    'Saudi Aramco flagged 3 bolts with potential thread form deviation in flange joint. '
    'Batch IFB-2025-Q2-007 on hold pending field sampling and thread gauge testing.',
    'medium','in_progress',
    480,'Abdullah Al-Zahrani',
    now()-interval '8 days', now()-interval '8 days', now()-interval '8 days'
  ) ON CONFLICT DO NOTHING;

  -- Open CAPA: investigation stage
  INSERT INTO capas (
    id, company_id, recall_id,
    title, severity, root_cause,
    owner_name, due_date, status, investigation_at,
    created_at, updated_at
  ) VALUES (
    capa_03, cid, recall_02,
    'Thread Form Deviation Investigation — Bolt Batch IFB-2025-Q2-007',
    'major',
    'Under investigation. Metrology lab measuring thread profile on retained samples. '
    'Saudi Aramco field sampling in progress.',
    'Khalid Al-Rashidi', (now()+interval '21 days')::date, 'investigation',
    now()-interval '7 days',
    now()-interval '8 days', now()-interval '7 days'
  ) ON CONFLICT DO NOTHING;

  -- Open CAPA: corrective action stage
  INSERT INTO capas (
    id, company_id,
    title, severity, root_cause, corrective_action,
    owner_name, due_date, status, investigation_at, corrective_action_at,
    created_at, updated_at
  ) VALUES (
    capa_04, cid,
    'Supplier Documentation Gap — Missing SFDA Import Certificate LOT-SS316-0891',
    'major',
    'LOT-2025-SS316-0891 received without SFDA import certificate. Mill cert present; import cert omitted.',
    'Gulf Steel Industries to provide retroactive SFDA cert within 14 days. '
    'POs updated to include SFDA cert as mandatory delivery document.',
    'Abdullah Al-Zahrani', (now()+interval '10 days')::date, 'corrective_action',
    now()-interval '12 days', now()-interval '5 days',
    now()-interval '14 days', now()-interval '5 days'
  ) ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════
  -- 6. SUPPORTING PRODUCTION ORDERS (dashboard charts & KPIs)
  -- ══════════════════════════════════════════════════════════════

  INSERT INTO production_orders (id, product_id, quantity, status, started_at, completed_at, company_id, created_at) VALUES
    (b04,p_bolt,   5000,'completed',   t_base+interval '8d',  t_base+interval '15d',cid,t_base+interval '7d'),
    (b05,p_nut,    8000,'completed',   t_base+interval '12d', t_base+interval '18d',cid,t_base+interval '11d'),
    (b06,p_gate,    120,'completed',   t_base+interval '18d', t_base+interval '26d',cid,t_base+interval '17d'),
    (b07,p_mccb,    200,'completed',   t_base+interval '22d', t_base+interval '30d',cid,t_base+interval '21d'),
    (b08,p_vfd,      75,'completed',   t_base+interval '30d', t_base+interval '40d',cid,t_base+interval '29d'),
    (b09,p_gear,    300,'completed',   t_base+interval '38d', t_base+interval '46d',cid,t_base+interval '37d'),
    (b10,p_flange,  500,'completed',   t_base+interval '45d', t_base+interval '52d',cid,t_base+interval '44d'),
    (b11,p_helmet, 1200,'completed',   t_base+interval '50d', t_base+interval '56d',cid,t_base+interval '49d'),
    (b12,p_bolt,   3000,'in_progress', t_base+interval '82d', NULL,                 cid,t_base+interval '81d'),
    (b13,p_gate,    180,'in_progress', t_base+interval '85d', NULL,                 cid,t_base+interval '84d'),
    (b14,p_vfd,      60,'in_progress', t_base+interval '87d', NULL,                 cid,t_base+interval '86d'),
    (b15,p_mccb,    250,'pending',     NULL,                   NULL,                 cid,t_base+interval '88d')
  ON CONFLICT DO NOTHING;

  -- batch_qc_results.batch_id UUID — no cast
  INSERT INTO batch_qc_results (batch_id, status, inspector_name, notes, inspected_at, company_id, created_at) VALUES
    (b04,'pass','Khalid Al-Rashidi',  'Sample 50/5000: dimensional ±0.05 mm PASS. Thread GO/NO-GO PASS. Tensile 870 MPa. Cleared.',t_base+interval '16d',cid,t_base+interval '16d'),
    (b05,'pass','Mohammed Al-Harbi',  'All 8000 nuts: pitch gauge PASS. Hardness 241 HB. Plating 8 μm avg. Certified.',           t_base+interval '19d',cid,t_base+interval '19d'),
    (b06,'pass','Sara Al-Qahtani',    'Gate valve pressure 1.5× WP: PASS. Seat leakage nil. Handwheel 32 Nm. 120 units certified.',t_base+interval '27d',cid,t_base+interval '27d'),
    (b07,'pass','Omar Al-Shamrani',   'MCCB trip test 10× rated: 28 ms avg. Insulation >500 MΩ. All 200 pass IEC 60947-2.',       t_base+interval '31d',cid,t_base+interval '31d'),
    (b08,'fail','Ahmed Al-Mutairi',   'VFD EMC FAIL: emissions 12 dB above EN 55011 Class A at 150 kHz. PCB filter error. Quarantined.',t_base+interval '41d',cid,t_base+interval '41d'),
    (b09,'pass','Khalid Al-Rashidi',  'Gear pump: efficiency 95.2% (spec ≥93%). Pressure 375 bar 1.5× WP PASS. Noise 68 dB(A). Cleared.',t_base+interval '47d',cid,t_base+interval '47d'),
    (b10,'hold','Sara Al-Qahtani',    'Flange facing Ra 3.6 μm on 12/500 (spec ≤3.2 μm). QC hold. Rework 12 units authorised.',    t_base+interval '53d',cid,t_base+interval '53d'),
    (b11,'pass','Abdullah Al-Zahrani','Helmet impact max 3.5 kN (spec ≤5 kN EN 397). Penetration PASS. 1200 units certified.',    t_base+interval '57d',cid,t_base+interval '57d'),
    (b04,'pass','Noor Al-Hamdan',     'Sample re-audit 20 units: all within spec. Clearance for shipment confirmed.',              now()-interval '5d',  cid,now()-interval '5d'),
    (b12,'pass','Mohammed Al-Harbi',  'In-process 50%: thread form, hardness, dimensional within spec. Continue production.',      now()-interval '3d',  cid,now()-interval '3d'),
    (b13,'hold','Ahmed Al-Mutairi',   'In-process: 3/20 gate valve seats show minor pitting. Hold for rework. Not a safety issue.',now()-interval '1d',  cid,now()-interval '1d')
  ON CONFLICT DO NOTHING;

  -- quality_inspections.batch_id TEXT — ::text cast on all b-vars
  INSERT INTO quality_inspections (batch_id, inspector_id, inspector_name, inspection_date, inspection_type, status, overall_score, notes, company_id, created_at, updated_at) VALUES
    (b04::text,'INS-001','Khalid Al-Rashidi',  (now()-interval '6d')::date,'final',     'passed',     94.0,'Stored batch sample audit. Critical dims within spec.',           cid,now()-interval '6d',now()-interval '6d'),
    (b09::text,'INS-001','Khalid Al-Rashidi',  (now()-interval '6d')::date,'random',    'passed',     91.5,'Random post-production check. Efficiency and pressure PASS.',      cid,now()-interval '6d',now()-interval '6d'),
    (b05::text,'INS-002','Mohammed Al-Harbi',  (now()-interval '5d')::date,'incoming',  'passed',     88.0,'Incoming inspection on stainless nut bulk. Dimensional PASS.',     cid,now()-interval '5d',now()-interval '5d'),
    (b10::text,'INS-004','Sara Al-Qahtani',    (now()-interval '4d')::date,'in_process','conditional',74.0,'Surface finish non-conformance on 12 flanges. Rework authorised.', cid,now()-interval '4d',now()-interval '4d'),
    (b12::text,'INS-002','Mohammed Al-Harbi',  (now()-interval '3d')::date,'in_process','passed',     92.0,'In-process 50%: thread, hardness, dimensional within spec.',        cid,now()-interval '3d',now()-interval '3d'),
    (b07::text,'INS-005','Omar Al-Shamrani',   (now()-interval '3d')::date,'final',     'passed',     96.0,'Final MCCB trip and insulation PASS per IEC 60947-2.',             cid,now()-interval '3d',now()-interval '3d'),
    (b13::text,'INS-003','Ahmed Al-Mutairi',   (now()-interval '2d')::date,'in_process','conditional',68.0,'Seat pitting 3/20 sample. Hold applied. Rework in progress.',      cid,now()-interval '2d',now()-interval '2d'),
    (b11::text,'INS-007','Abdullah Al-Zahrani',(now()-interval '1d')::date,'random',    'passed',     98.5,'Random audit on certified helmet batch. Retest: PASS.',            cid,now()-interval '1d',now()-interval '1d'),
    (b14::text,'INS-001','Khalid Al-Rashidi',   current_date,              'incoming',  'pending',     0.0,'Lab results pending for EMC compliance. Tagged — do not ship.',    cid,now(),now())
  ON CONFLICT DO NOTHING;

  INSERT INTO sales (product_id, product_name, quantity, unit_price, total_price, customer_name, status, sold_at, company_id, created_at) VALUES
    (p_bolt,  'Steel Hex Bolt M12x80 Grade 8.8',  2000,4.50,  9000.00,'Saudi Electricity Company','completed',t_base+interval '20d',cid,t_base+interval '20d'),
    (p_nut,   'Stainless Hex Nut M12 DIN 934',    3500,1.80,  6300.00,'Al Rajhi Industrial',      'completed',t_base+interval '22d',cid,t_base+interval '22d'),
    (p_gate,  'Gate Valve DN50 PN16 Carbon Steel',  60,1250.00,75000.00,'SABIC Manufacturing',    'completed',t_base+interval '30d',cid,t_base+interval '30d'),
    (p_mccb,  'MCCB 3-Pole 250A Fixed Mount',      100,890.00,89000.00,'Zahran Maintenance Co.',  'completed',t_base+interval '35d',cid,t_base+interval '35d'),
    (p_gear,  'Gear Pump 16cc 250 bar Hydraulic',  150,620.00,93000.00,'Consolidated Contractors','completed',t_base+interval '50d',cid,t_base+interval '50d'),
    (p_flange,'Weld Neck Flange DN80 PN40',        200,380.00,76000.00,'Bakr Group Engineering',  'completed',t_base+interval '55d',cid,t_base+interval '55d'),
    (p_helmet,'Safety Helmet Class G EN397 White', 600,45.00, 27000.00,'Red Sea Housing Services','completed',t_base+interval '60d',cid,t_base+interval '60d'),
    (p_bolt,  'Steel Hex Bolt M12x80 Grade 8.8',  4000,4.50, 18000.00,'Rawabi Holding Group',    'completed',t_base+interval '65d',cid,t_base+interval '65d'),
    (p_nut,   'Stainless Hex Nut M12 DIN 934',    5000,1.80,  9000.00,'Kingdom Contracting Est.','completed',t_base+interval '68d',cid,t_base+interval '68d'),
    (p_gate,  'Gate Valve DN50 PN16 Carbon Steel',  90,1280.00,115200.00,'Tasnee Petrochemicals', 'completed',t_base+interval '72d',cid,t_base+interval '72d'),
    (p_vfd,   'Variable Frequency Drive 7.5kW',     35,3200.00,112000.00,'Saudi Kayan Petrochem.','completed',t_base+interval '75d',cid,t_base+interval '75d'),
    (p_bolt,  'Steel Hex Bolt M12x80 Grade 8.8',  6000,4.60, 27600.00,'Maaden Mining Co.',       'completed',t_base+interval '80d',cid,t_base+interval '80d'),
    (p_gate,  'Gate Valve DN50 PN16 Carbon Steel', 180,1250.00,225000.00,'Saudi Aramco',          'pending',  t_base+interval '86d',cid,t_base+interval '86d'),
    (p_vfd,   'Variable Frequency Drive 7.5kW',     60,3150.00,189000.00,'SABIC Manufacturing',   'pending',  t_base+interval '88d',cid,t_base+interval '88d'),
    (p_bolt,  'Steel Hex Bolt M12x80 Grade 8.8',  1200,4.50,  5400.00,'Sipchem Jubail',           'completed',now()-interval '4d',  cid,now()-interval '4d'),
    (p_gate,  'Gate Valve DN50 PN16 Carbon Steel',   30,1290.00,38700.00,'Dar Al-Riyadh Consult.','completed',now()-interval '2d',  cid,now()-interval '2d')
  ON CONFLICT DO NOTHING;

  -- scan_events.batch_id UUID — no cast
  FOR i IN 1..8 LOOP
    INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
    VALUES (b04, now()-((i*0.8)||' days')::interval,
            CASE WHEN i%2=0 THEN 'desktop' ELSE 'mobile' END,
            (ARRAY['Chrome','Safari','Chrome'])[1+(i%3)],
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) AppleWebKit/605.1.15 Safari/604.1', cid);
  END LOOP;

  FOR i IN 1..6 LOOP
    INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
    VALUES (b09, now()-((i*1.1)||' days')::interval, 'mobile', 'Chrome',
            'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/122.0 Mobile Safari/537.36', cid);
  END LOOP;

  FOR i IN 1..5 LOOP
    INSERT INTO scan_events (batch_id, scanned_at, device_type, browser, user_agent, company_id)
    VALUES (b06, now()-((i*1.3)||' days')::interval,
            CASE WHEN i%2=0 THEN 'mobile' ELSE 'desktop' END, 'Safari',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 Safari/605.1.15', cid);
  END LOOP;

  -- ══════════════════════════════════════════════════════════════
  -- 7. ACTIVITY LOGS
  -- activity_logs.entity_id is TEXT — ::text casts below are correct
  -- ══════════════════════════════════════════════════════════════

  INSERT INTO activity_logs
    (company_id, actor_user_id, actor_email, action_type, entity_type, entity_id, message, created_at)
  VALUES
    (cid,uid,'ops@company.sa',      'production_order.created','production_order',batch_01::text,'Production order: 250 × Ball Valve 2in 316 SS (VBC-2IN-316).',                         t1),
    (cid,uid,'qa@company.sa',       'qc_result.added',         'production_order',batch_01::text,'QC PASS: Ball Valve batch. CC-2025-0891 issued. Cleared for shipment.',                t1+interval '9d'),
    (cid,uid,'ops@company.sa',      'production_order.created','production_order',batch_02::text,'Production order: 80 × Hydraulic Cylinder HPC-50-200.',                               t2),
    (cid,uid,'qa@company.sa',       'qc_result.added',         'production_order',batch_02::text,'QC FAIL: Hydraulic Cylinder batch. 80 units quarantined. NCR-2025-0041 raised.',      t2+interval '8d'),
    (cid,uid,'qa@company.sa',       'capa.created',            'capa',            capa_01::text, 'CAPA opened: Critical hardness non-conformance — Hydraulic Cylinder HPC-2025-080.',   t2+interval '8d'),
    (cid,uid,'qa@company.sa',       'capa.status_changed',     'capa',            capa_01::text, 'CAPA → Corrective Action. Supplier NCR issued. Replacement lot sourced.',              t2+interval '18d'),
    (cid,uid,'qa@company.sa',       'capa.closed',             'capa',            capa_01::text, 'CAPA closed. Replacement lot passed 100% Rockwell hardness test.',                    t2+interval '42d'),
    (cid,uid,'ops@company.sa',      'production_order.created','production_order',batch_03::text,'Production order: 150 × Safety Relief Valve VSR-05-010.',                             t3),
    (cid,uid,'qa@company.sa',       'qc_result.added',         'production_order',batch_03::text,'QC PASS: Relief Valve batch. 150 units certified. CC-2025-0903.',                    t3+interval '7d'),
    (cid,uid,'qa@company.sa',       'recall.created',          'recall',          recall_01::text,'Voluntary recall: VSR-05-010 batch 2025-Q1-003. Spring material deviation. SFDA RN filed.',t3+interval '25d'),
    (cid,uid,'qa@company.sa',       'capa.created',            'capa',            capa_02::text, 'CAPA opened: Spring material deviation — VSR-2025-Q1-003.',                           t3+interval '25d'),
    (cid,uid,'qa@company.sa',       'capa.status_changed',     'capa',            capa_02::text, 'CAPA → Verification. Field retrofit confirmed at all 3 sites. SFDA documentation under review.', t3+interval '54d'),
    (cid,uid,'qa@company.sa',       'recall.created',          'recall',          recall_02::text,'Precautionary hold: Bolt batch IFB-2025-Q2-007. Saudi Aramco thread deviation.',    now()-interval '8d'),
    (cid,uid,'warehouse@company.sa','qc_result.added',         'production_order',b13::text,     'QC HOLD: Gate Valve in-process. Seat pitting 3/20 sample. Rework initiated.',        now()-interval '1d'),
    (cid,uid,'qa@company.sa',       'capa.created',            'capa',            capa_04::text, 'CAPA opened: Missing SFDA import cert for LOT-SS316-0891. Corrective action active.', now()-interval '14d')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE '=== Seed complete ===';
  RAISE NOTICE 'Story 1 — Ball Valve complete lifecycle:   batch_01 = %', batch_01;
  RAISE NOTICE 'Story 2 — Hydraulic Cylinder QC→CAPA:     batch_02 = %', batch_02;
  RAISE NOTICE 'Story 3 — Safety Relief Valve Recall:     batch_03 = %', batch_03;
  RAISE NOTICE 'Active recall:  recall_02 = %', recall_02;
  RAISE NOTICE 'CAPA states:    capa_01=closed | capa_02=verification | capa_03=investigation | capa_04=corrective_action';
  RAISE NOTICE 'Product Journey: navigate to /trace/<batch_01>';

END;
$$;
