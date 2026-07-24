-- ==============================================================================
-- TraceFlow — Enterprise Demo Seed Data
-- ==============================================================================
-- USAGE   : Paste into Supabase Dashboard → SQL Editor → New Query → Run
-- IDEMPOTENT: Safe to re-run. Products resolved by SKU; suppliers by email;
--             raw materials by name. Existing rows are reused, not duplicated.
--             Production orders, QC results, sales, and scan events are always
--             appended (no unique constraint — each run adds a fresh dataset
--             that references the same resolved products/suppliers).
-- NOTE    : user_id and company_id are resolved automatically from your
--           existing companies/user_profiles rows — no UUID replacement needed.
-- ==============================================================================

DO $$
DECLARE
  uid  uuid;   -- resolved from user_profiles at runtime
  cid  uuid;   -- resolved from companies at runtime

  -- Entity ID arrays
  s    uuid[] := '{}';   -- suppliers      [1..10]
  p    uuid[] := '{}';   -- products       [1..50]
  m    uuid[] := '{}';   -- raw_materials  [1..30]
  o    uuid[] := '{}';   -- production_orders [1..200]

  -- Loop / temp vars
  i         int;
  j         int;
  stat      text;
  temp_id   uuid;   -- scratch variable for SELECT-or-INSERT resolution
  crt       timestamptz;
  srt       timestamptz;
  cmp       timestamptz;
  due_date  date;
  qty       int;
  ord_idx   int;
  prod_idx  int;
  sup_idx   int;
  mat_idx   int;
  qc_id     uuid;
  insp_stat text;
  score     numeric;
  def_cnt   int;
  unit_p    numeric;
  tot       numeric;
  bad_cnt         int;          -- pre-lineage validation counter
  bt_first        text;         -- first value of batch_type enum (resolved at runtime)
  bl              uuid[] := '{}'; -- batches.id values for o[1..200], used in batch_lineage
  bl_transfer_col text := NULL;   -- batch_lineage quantity column name (detected at runtime)
  temp_text       text;           -- scratch for diagnostic NOTICEs
  base      timestamptz := NOW() - INTERVAL '180 days';

  -- ── Lookup arrays ──────────────────────────────────────────────────────

  sup_names text[] := ARRAY[
    'Gulf Steel Industries LLC',
    'SABIC Advanced Polymers Co.',
    'Yanbu Metal Works & Trading',
    'Arabian Heavy Equipment Corp.',
    'Al-Khobar Industrial Supplies',
    'Riyadh Precision Engineering',
    'National Chemical Trading Co.',
    'Eastern Province Steel Works',
    'Tabuk Manufacturing Group',
    'Arabian Valve & Fittings Co.'
  ];
  sup_emails text[] := ARRAY[
    'procurement@gulfsteel.sa',    'supply@sabic-polymers.sa',
    'orders@yanbu-metals.sa',      'sales@arabian-heavy.sa',
    'info@alkhobar-industrial.sa', 'bids@riyadh-precision.sa',
    'trade@nchem.sa',              'supply@ep-steel.sa',
    'sales@tabuk-mfg.sa',          'export@arabvalve.sa'
  ];
  sup_phones text[] := ARRAY[
    '+966-11-234-5678', '+966-13-445-6789', '+966-14-332-1100',
    '+966-13-567-8901', '+966-13-234-5670', '+966-11-445-7890',
    '+966-12-334-5671', '+966-13-778-9012', '+966-14-445-6892',
    '+966-13-334-5673'
  ];

  prod_names text[] := ARRAY[
    -- Fasteners (1-8)
    'Steel Hex Bolt M12x80 Grade 8.8',
    'Stainless Hex Nut M12 DIN 934',
    'Galvanized Flat Washer 25mm',
    'Carbon Steel Stud M16x150mm',
    'High-Tension Anchor Bolt M20x200',
    'Socket Head Cap Screw M10x50',
    'Self-Drilling Roofing Screw 5.5x100',
    'Heavy Flange Nut M16 Class 10',
    -- Valves (9-16)
    'Ball Valve 2in 316 Stainless Steel',
    'Gate Valve DN50 PN16 Carbon Steel',
    'Butterfly Valve DN80 Lug Type',
    'Globe Valve DN25 PN40',
    'Safety Relief Valve 0.5in 10 bar',
    'Spring Check Valve DN40',
    'Solenoid Valve 24VDC 2-Way',
    'Control Valve DN65 Pneumatic Act.',
    -- Electrical (17-24)
    'MCCB 3-Pole 250A Fixed Mount',
    'MCB Single-Pole 32A C-Curve',
    'Industrial Contactor 150A 3-Phase',
    'DOL Motor Starter 15kW 380V',
    'Surge Protection Device Class II',
    'Variable Frequency Drive 7.5kW',
    'Selector Switch 3-Position Rotary',
    'Emergency Stop Button 40mm Red',
    -- Hydraulic / Pneumatic (25-32)
    'Hydraulic Cylinder 50mm Bore 200mm',
    'Pneumatic Cylinder Double Act. DN50',
    'Gear Pump 16cc 250 bar Hydraulic',
    'Pressure Gauge 0-400 bar 0.25in BSP',
    'Air Filter-Regulator 0.5in Gauge',
    'Hydraulic Hose SAE 100R2AT 0.5in',
    'NBR Oil Seal 80x100x10mm',
    'Directional Control Valve 4/2 NG6',
    -- Structural / Piping (33-41)
    'Pipe Elbow 2in 90deg 316 Stainless',
    'Weld Neck Flange DN80 PN40',
    'HDPE Pressure Pipe SDR11 90mm',
    'Heavy-Duty Pipe Clamp 3in Galv.',
    'H-Beam HEA200 S275JR 1m',
    'Galvanized Angle Iron 50x50x5mm',
    'Stainless Sheet 316L 2000x1000x2mm',
    'Mild Steel Plate 1500x3000x10mm',
    'Threaded Rod M16x1000mm Grade 8.8',
    -- Safety / PPE (42-50)
    'Safety Helmet Class G EN397 White',
    'Cut-Resistant Gloves Level F Size L',
    'S3 Safety Boot EN ISO 20345 Size 42',
    'Arc Flash Jacket 40cal Large',
    'Chemical Splash Safety Goggles',
    'Half-Face Respirator P100 OV Kit',
    'High-Visibility Vest Class 3 XL',
    'Full-Body Safety Harness EN361',
    'Plumbed Emergency Eyewash Station'
  ];
  prod_skus text[] := ARRAY[
    'IFB-0012','IFN-0013','IFW-0014','IFS-0015','IFA-0016','IFC-0017','IFR-0018','IFF-0019',
    'VBC-0021','VGV-0022','VBF-0023','VGL-0024','VSR-0025','VCV-0026','VSV-0027','VCT-0028',
    'ELM-0031','ELB-0032','ELC-0033','ELS-0034','ELP-0035','ELV-0036','ELW-0037','ELE-0038',
    'HPC-0041','HPP-0042','HPG-0043','HPR-0044','HPA-0045','HPH-0046','HPS-0047','HPD-0048',
    'SPE-0051','SPF-0052','SHP-0053','SPC-0054','SIB-0055','SAI-0056','SSS-0057','SMP-0058','STR-0059',
    'PPH-0061','PPG-0062','PPB-0063','PPJ-0064','PPO-0065','PPR-0066','PPV-0067','PPS-0068','PPE-0069'
  ];
  prod_descs text[] := ARRAY[
    'High-strength industrial fastener, zinc-plated, meets DIN 931. For structural steel connections in oil & gas facilities.',
    'A2-70 stainless steel, corrosion-resistant. Suitable for offshore and marine environments.',
    'Hot-dip galvanized, load distribution washer. ASTM F436 compliant.',
    'Grade B7 alloy steel, fully threaded. Used in pressure vessel flange joints.',
    'Mechanical expansion anchor for concrete and masonry in industrial structures.',
    'Alloy steel, black oxide finish. Precision-machined for hydraulic manifold assemblies.',
    'Self-sealing EPDM washer, corrosion-resistant tip. For industrial roofing and cladding.',
    'Class 10 flange nut with serrated bearing face. Vibration-resistant for heavy machinery.',
    'Full-bore ball valve, fire-safe design, ISO 17292. For process isolation in petrochemical plants.',
    'OS&Y gate valve, rising stem. API 600 compliant for high-pressure pipeline service.',
    'Rubber-lined butterfly valve, EPDM seat. Suitable for water treatment and HVAC.',
    'Globe valve for precise flow regulation. EN 1984 certified, suitable for steam service.',
    'Spring-loaded pressure relief valve. Set pressure factory-tested, ASME coded.',
    'Piston-type check valve, stainless internals. For pump protection in process lines.',
    'Direct-acting solenoid valve, IP65 rated. Used in automation and pneumatic control.',
    'Globe-pattern control valve with positioner. ANSI Class 150, split-range capable.',
    'Moulded case circuit breaker, thermal-magnetic trip. IEC 60947-2 certified.',
    'Miniature circuit breaker, DIN rail mount. Suitable for panel board distribution.',
    'Three-pole contactor with integrated arc chute. IEC 60947-4-1 rated.',
    'Direct online starter with overload relay. Factory set for 15kW motor protection.',
    'Type 2 surge protection, DIN rail mount. Protects sensitive instrumentation.',
    'Sensorless vector control drive. Built-in EMC filter, RS485 Modbus RTU.',
    'Cam-operated 3-position switch. IP65 panel mount for machine mode selection.',
    'Mushroom-head e-stop, twist release. EN ISO 13850 compliant safety function.',
    'Double-acting hydraulic cylinder, chrome-plated rod, honed bore. ISO 6020-2.',
    'Double-acting pneumatic actuator, aluminium body. ISO 15552 standard.',
    'External gear pump, SAE flange mount. For mobile and industrial hydraulic circuits.',
    'Bourdon tube pressure gauge, glycerine-filled. ASME B40.100 accuracy class 1.',
    'Modular filter-regulator unit with bracket. For compressed air preparation in automation.',
    'Wire-braided hydraulic hose, end-crimped. Working pressure 350 bar. SAE 100R2.',
    'Rotary shaft seal, nitrile rubber. For gearbox, pump and hydraulic motor shafts.',
    'Cetop 3 directional valve, spring-centred, 24VDC. For hydraulic circuit control.',
    '316L stainless elbow, butt-weld ends. ASME B16.9, for hygienic process piping.',
    'Class 300 raised-face weld neck flange. ASME B16.5, full radiographic inspection.',
    'PE100 pressure pipe, blue. For water distribution and industrial fluid transfer.',
    'Two-bolt heavy-duty pipe clamp, hot-dip galvanized. For process and utility piping.',
    'Hot-rolled H-section beam. S275JR grade, used for mezzanine and equipment support.',
    'Pre-galvanized equal angle iron. For structural bracing and cable tray support.',
    'Cold-rolled stainless steel sheet. 2B finish, used in food-grade and chemical equipment.',
    'Hot-rolled mild steel plate. S235JR grade, used for base plates and skid fabrication.',
    'Class 4.8 fully-threaded rod, zinc-plated. For clamping, hanging and anchor bolt assemblies.',
    'Polypropylene hard hat with 6-point suspension. EN 397 certified, vented design.',
    'Level F cut-resistant liner with nitrile foam coating. EN 388:2016 certified.',
    'Steel-toe safety boot, midsole puncture protection. EN ISO 20345:2011 S3 SRC.',
    'Flame-resistant arc-flash jacket with HRC2 rating. ATPV 40 cal/cm2, NFPA 70E.',
    'Anti-fog polycarbonate indirect-vent goggles. EN 166 / ANSI Z87.1 certified.',
    'Half-mask respirator with combination P100 OV cartridges. NIOSH approved.',
    'ANSI/ISEA 107 Class 3 fluorescent orange vest. Reflective tape 360-degree visibility.',
    'Full-body harness with dorsal D-ring. EN 361 / ANSI Z359.1 fall arrest rated.',
    'Twin-head plumbed eyewash station with cover. ANSI Z358.1 compliant, SS bowl.'
  ];

  mat_names text[] := ARRAY[
    'Carbon Steel Sheet S235 6mm',
    'Stainless Steel 316 Round Bar 25mm',
    'Hot-Dip Galvanized Steel Coil 1.5mm',
    'Aluminum Alloy 6061-T6 Profile',
    'Electrolytic Copper Wire 4mm2',
    'Epoxy Coating Primer 2-Part',
    'Industrial Zinc-Rich Primer',
    'Hydraulic Oil ISO VG 46 Mineral',
    'Gear Oil ISO VG 220 Synthetic',
    'Water-Soluble Cutting Fluid Concentrate',
    'Anti-Corrosion Compound NLGI 2',
    'MS Polymer Adhesive Sealant',
    'NBR Nitrile Rubber Sheet 3mm',
    'PTFE Virgin Rod Stock 20mm dia.',
    'HDPE Granules MFI 0.3 g/10min',
    'Polypropylene Copolymer Sheet 5mm',
    'Nitrile O-Ring Assorted Kit 500pcs',
    'Copper Bus Bar 30x5mm Soft Anneal',
    'PVC Flexible Cable 4mm2 3-Core',
    'Copper Compression Cable Lug 50mm2',
    'Electrical Insulation Tape PVC 19mm',
    'Hex Bolt M12x80 Raw Stock',
    'Stainless Nut M12 DIN 934 Bulk',
    'Spring Washer M12 Zinc Plate',
    'Polyethylene Foam Sheet 20mm',
    'Corrugated Cardboard Box 600x400x300',
    'Machine Stretch Wrap 500mm 20um',
    'Euro Pallet 1200x800 ISPM-15',
    'Argon Gas 99.997pct 50L Cylinder',
    'Nitrogen Gas 99.9pct 50L Cylinder'
  ];
  mat_units text[] := ARRAY[
    'kg','kg','kg','kg','kg',
    'L','L','L','L','L',
    'kg','tube',
    'sheet','m','kg','sheet','kit',
    'kg','m','pc','roll',
    'kg','kg','kg',
    'sheet','pc','roll','pc',
    'cylinder','cylinder'
  ];

  customers text[] := ARRAY[
    'Saudi Aramco',
    'SABIC Manufacturing',
    'Maaden Mining Co.',
    'Saudi Electricity Company',
    'Tasnee Petrochemicals',
    'Sipchem Jubail',
    'Al Rajhi Industrial',
    'Zahran Maintenance Co.',
    'Bakr Group Engineering',
    'National Gas Co. NGIC',
    'Advanced Polypropylene Co.',
    'Kingdom Contracting Est.',
    'Rawabi Holding Group',
    'Dar Al-Riyadh Consultants',
    'Almabani General Contractors',
    'Red Sea Housing Services',
    'Consolidated Contractors CCC',
    'Arabian Geophysical ARGAS',
    'Saudi Kayan Petrochemical',
    'Farabi Petrochemicals'
  ];

  inspectors text[] := ARRAY[
    'Khalid Al-Rashidi',
    'Mohammed Al-Harbi',
    'Ahmed Al-Mutairi',
    'Sara Al-Qahtani',
    'Omar Al-Shamrani',
    'Fatima Al-Dosari',
    'Abdullah Al-Zahrani',
    'Noor Al-Hamdan'
  ];
  inspector_ids text[] := ARRAY[
    'INS-001','INS-002','INS-003','INS-004',
    'INS-005','INS-006','INS-007','INS-008'
  ];

  -- Weighted status distributions
  order_statuses text[] := ARRAY[
    'completed','completed','completed','completed','completed','completed','completed',
    'in_progress','in_progress','in_progress',
    'pending','pending',
    'cancelled'
  ];
  qc_statuses text[] := ARRAY[
    'pass','pass','pass','pass','pass','pass',
    'fail','fail','fail',
    'hold','hold'
  ];
  sale_statuses text[] := ARRAY[
    'completed','completed','completed','completed','completed','completed','completed',
    'pending','pending',
    'cancelled',
    'refunded'
  ];
  insp_types    text[] := ARRAY['incoming','in_process','final','random'];
  insp_statuses text[] := ARRAY[
    'passed','passed','passed','passed','passed',
    'failed','failed',
    'conditional','conditional',
    'pending'
  ];
  defect_types text[] := ARRAY[
    'Surface Corrosion',
    'Dimensional Deviation',
    'Material Hardness Out of Spec',
    'Weld Defect Detected',
    'Thread Damage',
    'Coating Adhesion Failure',
    'Contamination Found',
    'Tolerance Exceeded',
    'Missing Material Certification',
    'Packaging Damage'
  ];
  defect_sevs text[] := ARRAY[
    'minor','minor','minor',
    'major','major',
    'critical'
  ];
  lot_years text[] := ARRAY['2024','2025','2026'];

BEGIN

  -- ── 0. Resolve company & user from live data ────────────────────────────
  SELECT c.id,
         (SELECT up.user_id FROM user_profiles up
          WHERE up.company_id = c.id LIMIT 1)
  INTO   cid, uid
  FROM   companies c
  ORDER  BY c.created_at
  LIMIT  1;

  IF cid IS NULL THEN
    RAISE EXCEPTION 'No company found. Complete onboarding first (sign in and visit the app to trigger company creation).';
  END IF;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'No user found in user_profiles for company %. Complete onboarding first.', cid;
  END IF;
  RAISE NOTICE 'Seeding: company_id=%, user_id=%', cid, uid;

  -- ── 1. Generate all entity IDs ──────────────────────────────────────────
  FOR i IN 1..10  LOOP s := array_append(s, gen_random_uuid()); END LOOP;
  FOR i IN 1..50  LOOP p := array_append(p, gen_random_uuid()); END LOOP;
  FOR i IN 1..30  LOOP m := array_append(m, gen_random_uuid()); END LOOP;
  FOR i IN 1..200 LOOP o := array_append(o, gen_random_uuid()); END LOOP;

  -- ── 2. Suppliers ────────────────────────────────────────────────────────
  -- Resolve by contact_email within this company; insert only when absent.
  FOR i IN 1..10 LOOP
    SELECT id INTO temp_id
    FROM   suppliers
    WHERE  company_id = cid AND contact_email = sup_emails[i]
    LIMIT  1;

    IF temp_id IS NULL THEN
      INSERT INTO suppliers (id, user_id, company_id, name, contact_email, contact_phone, created_at)
      VALUES (
        s[i], uid, cid, sup_names[i], sup_emails[i], sup_phones[i],
        base + (random() * 20 || ' days')::interval
      );
      temp_id := s[i];
    END IF;

    s[i] := temp_id;
  END LOOP;

  -- ── 3. Products ─────────────────────────────────────────────────────────
  -- products_sku_key is a global UNIQUE(sku) constraint.
  -- Insert when the SKU is new; skip when it already exists.
  -- Always resolve p[i] to the canonical row ID so later FKs are correct.
  FOR i IN 1..50 LOOP
    INSERT INTO products (id, user_id, company_id, name, sku, description, created_at)
    VALUES (
      p[i], uid, cid, prod_names[i], prod_skus[i], prod_descs[i],
      base + (random() * 15 || ' days')::interval
    )
    ON CONFLICT (sku) DO NOTHING;

    SELECT id INTO temp_id FROM products WHERE sku = prod_skus[i];
    p[i] := temp_id;
  END LOOP;

  -- ── 4. Raw Materials ────────────────────────────────────────────────────
  -- No unique constraint, but material names are logically unique per company.
  -- Resolve by name within company; insert only when absent.
  FOR i IN 1..30 LOOP
    sup_idx := 1 + ((i - 1) % 10);

    SELECT id INTO temp_id
    FROM   raw_materials
    WHERE  company_id = cid AND name = mat_names[i]
    LIMIT  1;

    IF temp_id IS NULL THEN
      INSERT INTO raw_materials (id, user_id, company_id, name, unit, quantity_in_stock, reorder_level, supplier_id, created_at)
      VALUES (
        m[i], uid, cid,
        mat_names[i], mat_units[i],
        ROUND((50 + random() * 2000)::numeric, 2),
        ROUND((10 + random() * 200)::numeric, 2),
        s[sup_idx],
        base + (random() * 10 || ' days')::interval
      );
      temp_id := m[i];
    END IF;

    m[i] := temp_id;
  END LOOP;

  -- ── 5. Production Orders ────────────────────────────────────────────────
  FOR i IN 1..200 LOOP
    prod_idx := 1 + ((i - 1) % 50);
    stat     := order_statuses[1 + (floor(random() * array_length(order_statuses, 1)))::int];
    crt      := base + (random() * 170 || ' days')::interval;

    IF stat IN ('in_progress','completed','cancelled') THEN
      srt := crt + ((1 + random() * 3) || ' days')::interval;
    ELSE
      srt := NULL;
    END IF;

    IF stat = 'completed' THEN
      cmp := srt + ((3 + random() * 14) || ' days')::interval;
    ELSE
      cmp := NULL;
    END IF;

    -- Due date: 7–60 days after order creation. Naturally creates a mix of
    -- upcoming, on-time, and overdue orders across the 170-day date range.
    due_date := (crt + ((7 + floor(random() * 53)) || ' days')::interval)::date;

    INSERT INTO production_orders (id, user_id, company_id, product_id, quantity, status, started_at, completed_at, created_at, due_date)
    VALUES (
      o[i], uid, cid, p[prod_idx],
      (10 + floor(random() * 4990))::int,
      stat, srt, cmp, crt, due_date
    );
  END LOOP;

  -- ── 5b. Resolve batch_type enum ─────────────────────────────────────────
  BEGIN
    SELECT enumlabel INTO bt_first
    FROM   pg_enum
    WHERE  enumtypid = 'batch_type'::regtype
    ORDER  BY enumsortorder
    LIMIT  1;
  EXCEPTION WHEN OTHERS THEN
    bt_first := NULL;
  END;

  IF bt_first IS NULL THEN
    RAISE EXCEPTION
      '[seed] batch_type enum not found — run the batches table migration first.';
  END IF;

  -- ── 5c. Batches (one per production order, covering ALL 200 orders)
  -- batch_lineage.parent_batch_id / child_batch_id reference batches.id,
  -- NOT production_orders.id. We create batches for all 200 orders so that:
  --   (a) validate_lineage_company() finds the batch rows for bl[1..100]
  --   (b) any BOM-triggered consumption UPDATE finds a batch for every order
  --       and never evaluates quantity_remaining - NULL (which would violate NOT NULL)
  -- quantity_initial and quantity_remaining are set to 5000 — large enough
  -- to absorb BOM consumption (≤ 3 lines × 500 units = 1500 max) and stay positive.
  FOR i IN 1..200 LOOP
    prod_idx := 1 + ((i - 1) % 50);

    -- Prefer an existing batches row for this production order + company.
    SELECT id INTO temp_id
    FROM   batches
    WHERE  production_order_id = o[i]
      AND  company_id          = cid
    LIMIT  1;

    IF temp_id IS NULL THEN
      temp_id := gen_random_uuid();
      INSERT INTO batches (
        id, company_id, type, sku, name, lot_number,
        quantity_initial, quantity_remaining, product_id, production_order_id
      ) VALUES (
        temp_id, cid, bt_first::batch_type,
        prod_skus[prod_idx],
        prod_names[prod_idx] || ' — Demo Batch ' || lpad(i::text, 3, '0'),
        'LOT-DEMO-' || left(o[i]::text, 16),
        5000, 5000,
        p[prod_idx], o[i]
      );
    END IF;

    bl := array_append(bl, temp_id);
  END LOOP;

  -- ── 6. Bill of Materials (2-3 entries per order) ────────────────────────
  FOR i IN 1..200 LOOP
    FOR j IN 1..(2 + (floor(random() * 2))::int) LOOP
      mat_idx := 1 + ((i * 3 + j - 1) % 30);
      INSERT INTO bill_of_materials (id, user_id, company_id, production_order_id, material_name, lot_number, quantity, unit, created_at)
      VALUES (
        gen_random_uuid(), uid, cid, o[i],
        mat_names[mat_idx],
        'LOT-' || lot_years[1 + (floor(random() * 3))::int] || '-' || lpad((floor(random() * 9999) + 1)::text, 4, '0'),
        ROUND((1 + random() * 500)::numeric, 2),
        mat_units[mat_idx],
        base + (random() * 170 || ' days')::interval
      );
    END LOOP;
  END LOOP;

  -- ── 7. Batch QC Results (100 entries) ───────────────────────────────────
  FOR i IN 1..100 LOOP
    ord_idx := 1 + ((i - 1) * 2 % 199);
    stat    := qc_statuses[1 + (floor(random() * array_length(qc_statuses, 1)))::int];

    INSERT INTO batch_qc_results (id, user_id, company_id, batch_id, status, inspector_name, notes, inspected_at, created_at)
    VALUES (
      gen_random_uuid(), uid, cid,
      o[ord_idx],
      stat,
      inspectors[1 + (floor(random() * 8))::int],
      CASE stat
        WHEN 'pass' THEN 'All checkpoints within specification. Batch cleared for next stage.'
        WHEN 'fail' THEN 'Critical non-conformance: ' || defect_types[1 + (floor(random() * array_length(defect_types, 1)))::int] || '. Batch quarantined. NCR raised — awaiting root cause analysis.'
        WHEN 'hold' THEN 'Batch placed on QC hold. Marginal dimensional result. Re-inspection scheduled within 48 hours.'
      END,
      base + (random() * 175 || ' days')::interval,
      base + (random() * 175 || ' days')::interval
    );
  END LOOP;

  -- ── 8. Quality Inspections + Defects ────────────────────────────────────
  FOR i IN 1..100 LOOP
    ord_idx   := 1 + (i % 199);
    insp_stat := insp_statuses[1 + (floor(random() * array_length(insp_statuses, 1)))::int];
    score     := CASE insp_stat
                   WHEN 'passed'      THEN ROUND((82 + random() * 18)::numeric, 1)
                   WHEN 'conditional' THEN ROUND((60 + random() * 20)::numeric, 1)
                   WHEN 'failed'      THEN ROUND((20 + random() * 40)::numeric, 1)
                   ELSE                    ROUND((45 + random() * 30)::numeric, 1)
                 END;
    qc_id := gen_random_uuid();

    INSERT INTO quality_inspections (
      id, user_id, company_id, batch_id, inspector_id, inspection_date,
      inspection_type, status, overall_score, notes, created_at, updated_at
    ) VALUES (
      qc_id, uid, cid,
      o[ord_idx],
      inspector_ids[1 + (floor(random() * 8))::int],
      (base + (random() * 170 || ' days')::interval)::date,
      insp_types[1 + (floor(random() * 4))::int],
      insp_stat,
      score,
      CASE insp_stat
        WHEN 'passed'      THEN 'Inspection complete. All checkpoints satisfactory. Certificate of conformance issued per QCP-003.'
        WHEN 'conditional' THEN 'Conditional pass. Minor non-conformances documented. Supplier corrective action required within 14 days.'
        WHEN 'failed'      THEN 'FAILED: ' || defect_types[1 + (floor(random() * array_length(defect_types, 1)))::int] || '. Full production hold applied. 8D report initiated per NCR procedure.'
        ELSE                    'Inspection pending lab results. Batch tagged — do not ship.'
      END,
      base + (random() * 170 || ' days')::interval,
      base + (random() * 170 || ' days')::interval
    );

    -- Defects for failed / conditional inspections
    IF insp_stat IN ('failed', 'conditional') THEN
      def_cnt := 1 + (floor(random() * 3))::int;
      FOR j IN 1..def_cnt LOOP
        INSERT INTO quality_defects (
          id, company_id, inspection_id, defect_type, severity, quantity,
          description, corrective_action, resolved, resolved_at, created_at
        ) VALUES (
          gen_random_uuid(), cid, qc_id,
          defect_types[1 + (floor(random() * array_length(defect_types, 1)))::int],
          defect_sevs[1 + (floor(random() * array_length(defect_sevs, 1)))::int],
          (1 + floor(random() * 50))::int,
          'Non-conformance documented during inspection. Affected units segregated and tagged per QCP-007 quarantine procedure.',
          CASE WHEN random() > 0.4 THEN 'Segregate batch. Issue supplier NCR-' || lpad((floor(random()*9999)+1)::text,4,'0') || '. Initiate 8D corrective action. Re-inspect after supplier response.' ELSE NULL END,
          random() > 0.5,
          CASE WHEN random() > 0.5 THEN base + (random() * 170 || ' days')::interval ELSE NULL END,
          base + (random() * 170 || ' days')::interval
        );
      END LOOP;
    END IF;
  END LOOP;

  -- ── 9. Sales (200 records) ───────────────────────────────────────────────
  FOR i IN 1..200 LOOP
    prod_idx := 1 + ((i - 1) % 50);
    stat     := sale_statuses[1 + (floor(random() * array_length(sale_statuses, 1)))::int];
    qty      := (5 + floor(random() * 500))::int;

    unit_p := CASE
      WHEN prod_idx <= 8  THEN ROUND((5   + random() * 95)::numeric, 2)
      WHEN prod_idx <= 16 THEN ROUND((800  + random() * 7200)::numeric, 2)
      WHEN prod_idx <= 24 THEN ROUND((200  + random() * 14800)::numeric, 2)
      WHEN prod_idx <= 32 THEN ROUND((500  + random() * 4500)::numeric, 2)
      WHEN prod_idx <= 41 THEN ROUND((50   + random() * 1950)::numeric, 2)
      ELSE                     ROUND((50   + random() * 750)::numeric, 2)
    END;
    tot := ROUND((qty * unit_p)::numeric, 2);

    INSERT INTO sales (
      id, user_id, company_id, product_id, product_name,
      quantity, unit_price, total_price,
      customer_name, status, sold_at, created_at
    ) VALUES (
      gen_random_uuid(), uid, cid,
      p[prod_idx], prod_names[prod_idx],
      qty, unit_p, tot,
      customers[1 + (floor(random() * array_length(customers, 1)))::int],
      stat,
      base + (random() * 175 || ' days')::interval,
      base + (random() * 175 || ' days')::interval
    );
  END LOOP;

  -- ── 10. Scan Events (500 records) ───────────────────────────────────────
  FOR i IN 1..500 LOOP
    ord_idx := 1 + ((i - 1) % 200);
    INSERT INTO scan_events (company_id, batch_id, scanned_at, device_type, browser, user_agent)
    VALUES (
      cid, o[ord_idx],
      base + (random() * 179 || ' days')::interval,
      CASE WHEN random() > 0.4 THEN 'mobile' ELSE 'desktop' END,
      (ARRAY['Chrome','Chrome','Safari','Firefox','Edge','Safari','Chrome'])[1 + (floor(random() * 7))::int],
      CASE WHEN random() > 0.35
        THEN 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36'
        ELSE 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      END
    );
  END LOOP;

  -- ── Pre-lineage validation ──────────────────────────────────────────────
  -- Only bl[1..100] are used in batch_lineage (parents = bl[1..50],
  -- children = bl[51..100]). Confirm those 100 rows exist with company_id = cid.
  SELECT (
    (SELECT COUNT(*) FROM batches WHERE id = ANY(bl[1:100]) AND company_id IS DISTINCT FROM cid)
    + (100 - (SELECT COUNT(*) FROM batches WHERE id = ANY(bl[1:100])))
  ) INTO bad_cnt;

  IF bad_cnt > 0 THEN
    RAISE EXCEPTION
      '[seed validation] % batches row(s) in bl[1..100] missing or have wrong company_id. '
      'Expected all 100 to have company_id = %. '
      'Cannot safely insert batch_lineage.', bad_cnt, cid;
  END IF;

  RAISE NOTICE 'Pre-lineage validation passed: bl[1..100] confirmed with company_id = %', cid;

  -- ── Detect optional quantity column on batch_lineage ──────────────────
  -- The live DB may have a consumption trigger on batch_lineage that reads
  -- NEW.<qty_col> as p_consumed. If p_consumed is NULL, the UPDATE
  -- "quantity_remaining = quantity_remaining - p_consumed" violates NOT NULL.
  -- Detect the column name at runtime and provide a non-NULL value.
  SELECT column_name INTO bl_transfer_col
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'batch_lineage'
    AND column_name  IN (
      'quantity_transferred', 'quantity', 'qty',
      'transferred_qty', 'consumed_qty', 'transfer_quantity', 'amount'
    )
  ORDER BY CASE column_name
    WHEN 'quantity_transferred' THEN 1
    WHEN 'quantity'             THEN 2
    WHEN 'qty'                  THEN 3
    ELSE 4
  END
  LIMIT 1;

  -- Log all batch_lineage columns so errors are diagnosable from NOTICES.
  SELECT string_agg(column_name || '(' || data_type || ')', ', ' ORDER BY ordinal_position)
  INTO temp_text
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'batch_lineage';
  RAISE NOTICE '[seed] batch_lineage columns: %', temp_text;
  RAISE NOTICE '[seed] batch_lineage transfer column detected: %', COALESCE(bl_transfer_col, '(none)');

  -- ── 11. Batch Lineage (50 parent → child pairs) ─────────────────────────
  -- bl[1..50]   = batches.id values for parent orders (o[1..50])
  -- bl[51..100] = batches.id values for child orders  (o[51..100])
  -- validate_lineage_company() looks up batches by parent_batch_id to resolve
  -- company_id — using real batches.id values satisfies that check.
  --
  -- If the live DB has a consumption trigger that reads NEW.<qty_col> as
  -- p_consumed, we include it via dynamic SQL so p_consumed is never NULL.
  -- Each parent batch has quantity_remaining = 5000; we transfer 100–500 units.
  FOR i IN 1..50 LOOP
    IF bl_transfer_col IS NOT NULL THEN
      EXECUTE format(
        'INSERT INTO batch_lineage
           (company_id, parent_batch_id, child_batch_id, relationship_type, %I)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING',
        bl_transfer_col
      ) USING cid, bl[i], bl[50 + i], 'material_flow',
              ROUND((100 + random() * 400)::numeric, 2);
    ELSE
      INSERT INTO batch_lineage (company_id, parent_batch_id, child_batch_id, relationship_type)
      VALUES (cid, bl[i], bl[50 + i], 'material_flow')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RAISE NOTICE 'Seed complete: 10 suppliers, 50 products, 30 raw materials, 200 orders, 200 batches, 100 QC results, 100 quality inspections, 200 sales, 500 scan events, 50 lineage pairs.';

END;
$$;
