-- ============================================================
-- TraceFlow — Safe Reseed for Current Active Company
-- ============================================================
-- WHAT IT DOES
--   Inserts demo data into all empty business tables scoped
--   to the existing company_id — no companies, auth users,
--   roles, or invitations are touched.
--
-- IDEMPOTENCY
--   • Detects the company automatically (oldest row in companies).
--   • Skips the entire seed if products already has ≥ 10 rows
--     for this company (re-run safe).
--   • All INSERT rows use md5-derived deterministic UUIDs so
--     ON CONFLICT (id) DO NOTHING prevents double-inserts.
--   • The scan_events re-link step runs every time (idempotent).
--
-- TABLES WRITTEN
--   products, raw_materials, production_orders,
--   batch_qc_results, sales,
--   quality_inspections, quality_defects
--
-- TABLES READ (never modified)
--   companies, user_profiles, auth.users, invitations
--
-- SCAN EVENTS
--   The 500 existing rows are kept; their batch_id is updated
--   to point to the newly seeded production_orders so every
--   dashboard widget resolves product names correctly.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

DO $$
DECLARE
  target_company_id  uuid;          -- resolved from companies table; never overwritten
  base               timestamptz := now() - INTERVAL '120 days';

  -- Deterministic entity ID arrays (same UUIDs every run for same company)
  p      uuid[];   -- products          [1..20]
  m      uuid[];   -- raw_materials     [1..15]
  o      uuid[];   -- production_orders [1..80]

  -- Separate typed temporaries — never mixed up
  tmp_uuid   uuid;     -- scratch UUID (product-ID resolution)
  row_count  bigint;   -- scratch counter (verification summary)

  -- Loop vars
  i         int;
  j         int;
  stat      text;
  crt       timestamptz;
  srt       timestamptz;
  cmp       timestamptz;
  qty       int;
  qc_id     uuid;
  unit_p    numeric;
  tot       numeric;
  insp_stat text;
  score     numeric;
  def_cnt   int;

  -- ── Lookup arrays ──────────────────────────────────────────────────────

  prod_names text[] := ARRAY[
    'Steel Hex Bolt M12 Grade 8.8',
    'Stainless Hex Nut M12 DIN 934',
    'Galvanized Flat Washer 25mm',
    'Ball Valve 2in 316 Stainless',
    'Gate Valve DN50 Carbon Steel',
    'MCCB 3-Pole 250A Fixed Mount',
    'MCB Single-Pole 32A C-Curve',
    'Hydraulic Cylinder 50mm Bore 200mm',
    'Pneumatic Cylinder Double Act. DN50',
    'Pressure Gauge 0-400 bar 0.25in',
    'Pipe Elbow 2in 90deg Stainless 316',
    'Weld Neck Flange DN80 PN40',
    'Safety Helmet Class G EN397',
    'Cut-Resistant Gloves Level F Size L',
    'S3 Safety Boot EN ISO 20345 Size 42',
    'Full-Body Safety Harness EN361',
    'Variable Frequency Drive 7.5kW',
    'Industrial Contactor 150A 3-Phase',
    'Gear Pump 16cc 250 bar Hydraulic',
    'Solenoid Valve 24VDC 2-Way IP65'
  ];

  -- SKUs match the old seed where possible (ON CONFLICT skips if already present)
  prod_skus text[] := ARRAY[
    'IFB-0012','IFN-0013','IFW-0014','VBC-0021','VGV-0022',
    'ELM-0031','ELB-0032','HPC-0041','HPP-0042','HPR-0044',
    'SPE-0051','SPF-0052','PPH-0061','PPG-0062','PPB-0063',
    'PPS-0068','ELV-0036','ELC-0033','HPG-0043','VSV-0027'
  ];

  mat_names text[] := ARRAY[
    'Carbon Steel Sheet S235 6mm',
    'Stainless Steel 316 Round Bar 25mm',
    'Hot-Dip Galvanized Steel Coil 1.5mm',
    'Aluminum Alloy 6061-T6 Profile',
    'Electrolytic Copper Wire 4mm2',
    'Hydraulic Oil ISO VG 46 Mineral',
    'Gear Oil ISO VG 220 Synthetic',
    'NBR Nitrile Rubber Sheet 3mm',
    'PTFE Virgin Rod Stock 20mm dia.',
    'HDPE Granules MFI 0.3 g/10min',
    'Nitrile O-Ring Assorted Kit 500pcs',
    'PVC Flexible Cable 4mm2 3-Core',
    'Hex Bolt M12x80 Raw Stock',
    'Argon Gas 99.997pct 50L Cylinder',
    'Corrugated Cardboard Box 600x400x300'
  ];
  mat_units text[] := ARRAY[
    'kg','kg','kg','kg','kg',
    'L','L','sheet','m','kg',
    'kit','m','kg','cylinder','pc'
  ];

  customers text[] := ARRAY[
    'Saudi Aramco',            'SABIC Manufacturing',
    'Maaden Mining Co.',       'Saudi Electricity Company',
    'Tasnee Petrochemicals',   'Sipchem Jubail',
    'Al Rajhi Industrial',     'Zahran Maintenance Co.',
    'Bakr Group Engineering',  'National Gas Co. NGIC',
    'Kingdom Contracting Est.','Rawabi Holding Group',
    'Dar Al-Riyadh Consultants','Almabani General Contractors',
    'Red Sea Housing Services'
  ];

  inspectors    text[] := ARRAY[
    'Khalid Al-Rashidi','Mohammed Al-Harbi','Ahmed Al-Mutairi',
    'Sara Al-Qahtani',  'Omar Al-Shamrani', 'Fatima Al-Dosari',
    'Abdullah Al-Zahrani','Noor Al-Hamdan'
  ];
  inspector_ids text[] := ARRAY[
    'INS-001','INS-002','INS-003','INS-004',
    'INS-005','INS-006','INS-007','INS-008'
  ];

  -- Weighted distributions mirror real-world factory ratios
  order_statuses text[] := ARRAY[
    'completed','completed','completed','completed','completed',
    'in_progress','in_progress','in_progress',
    'pending','pending','cancelled'
  ];
  qc_statuses text[] := ARRAY[
    'pass','pass','pass','pass','pass','pass',
    'fail','fail','fail',
    'hold','hold'
  ];
  sale_statuses text[] := ARRAY[
    'completed','completed','completed','completed','completed','completed',
    'pending','pending','cancelled','refunded'
  ];
  insp_types    text[] := ARRAY['incoming','in_process','final','random'];
  insp_statuses text[] := ARRAY[
    'passed','passed','passed','passed','passed',
    'failed','failed','conditional','conditional','pending'
  ];
  defect_types text[] := ARRAY[
    'Surface Corrosion',          'Dimensional Deviation',
    'Material Hardness Out of Spec','Weld Defect Detected',
    'Thread Damage',              'Coating Adhesion Failure',
    'Contamination Found',        'Tolerance Exceeded',
    'Packaging Damage'
  ];
  defect_sevs text[] := ARRAY[
    'minor','minor','minor','major','major','critical'
  ];

BEGIN

  -- ── 0. Resolve company ───────────────────────────────────────────────────
  SELECT id INTO target_company_id FROM companies ORDER BY created_at LIMIT 1;
  IF target_company_id IS NULL THEN
    RAISE EXCEPTION 'No company found — run the multitenancy migration first.';
  END IF;
  RAISE NOTICE '▶ Seeding for company_id = %', target_company_id;

  -- ── Idempotency guard ────────────────────────────────────────────────────
  -- Skip inserts if already seeded; still re-link scan_events below.
  IF (SELECT COUNT(*) FROM products WHERE company_id = target_company_id) >= 10 THEN
    RAISE NOTICE '  Products already seeded — skipping insert phase.';
  ELSE

    -- ── Build deterministic UUID arrays ────────────────────────────────────
    -- Same UUID on every run for the same (prefix, company_id, index).
    FOR i IN 1..20 LOOP
      p := array_append(p, (md5('tf-seed-product-' || target_company_id::text || '-' || i))::uuid);
    END LOOP;
    FOR i IN 1..15 LOOP
      m := array_append(m, (md5('tf-seed-matrl-'   || target_company_id::text || '-' || i))::uuid);
    END LOOP;
    FOR i IN 1..80 LOOP
      o := array_append(o, (md5('tf-seed-order-'   || target_company_id::text || '-' || i))::uuid);
    END LOOP;

    -- ── 1. Products ─────────────────────────────────────────────────────────
    FOR i IN 1..20 LOOP
      INSERT INTO products (id, company_id, name, sku, created_at)
      VALUES (
        p[i], target_company_id, prod_names[i], prod_skus[i],
        base + ((i * 0.3) || ' days')::interval
      )
      ON CONFLICT (id)  DO NOTHING;
      -- If a different ID holds this SKU, resolve the real ID so foreign keys stay valid
      SELECT id INTO tmp_uuid FROM products WHERE sku = prod_skus[i] LIMIT 1;
      IF tmp_uuid IS NOT NULL THEN p[i] := tmp_uuid; END IF;
    END LOOP;
    RAISE NOTICE '  ✓ products inserted/resolved';

    -- ── 2. Raw Materials ────────────────────────────────────────────────────
    FOR i IN 1..15 LOOP
      INSERT INTO raw_materials (id, company_id, name, unit, quantity_in_stock, reorder_level, created_at)
      VALUES (
        m[i], target_company_id,
        mat_names[i], mat_units[i],
        ROUND((50  + (i * 73.7))::numeric, 2),   -- deterministic, no random()
        ROUND((15  + (i * 6.5))::numeric,  2),
        base + ((i * 0.2) || ' days')::interval
      )
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
    RAISE NOTICE '  ✓ raw_materials inserted';

    -- ── 3. Production Orders ────────────────────────────────────────────────
    FOR i IN 1..80 LOOP
      stat := order_statuses[1 + ((i - 1) % array_length(order_statuses, 1))];
      crt  := base + ((i * 1.4) || ' days')::interval;

      srt := CASE WHEN stat IN ('in_progress','completed','cancelled')
                  THEN crt + '2 days'::interval
                  ELSE NULL END;
      cmp := CASE WHEN stat = 'completed'
                  THEN srt + '10 days'::interval
                  ELSE NULL END;

      INSERT INTO production_orders (id, company_id, product_id, quantity, status, started_at, completed_at, created_at)
      VALUES (
        o[i], target_company_id,
        p[1 + ((i - 1) % 20)],
        50 + (i * 17),          -- deterministic qty 67..1413
        stat, srt, cmp, crt
      )
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
    RAISE NOTICE '  ✓ production_orders inserted (80 rows)';

    -- ── 4. Batch QC Results ─────────────────────────────────────────────────
    -- This is what the dashboard reads for the QC widgets (batch_qc_results).
    -- Half in the last 7 days so the trend chart shows activity.
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'batch_qc_results' AND table_schema = 'public'
    ) THEN
      FOR i IN 1..55 LOOP
        stat := qc_statuses[1 + ((i - 1) % array_length(qc_statuses, 1))];

        EXECUTE '
          INSERT INTO batch_qc_results
            (id, company_id, batch_id, status, inspector_name, notes, inspected_at, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (id) DO NOTHING'
        USING
          (md5('tf-seed-bqc-' || target_company_id::text || '-' || i))::uuid,
          target_company_id,
          o[1 + ((i - 1) % 80)],
          stat,
          inspectors[1 + ((i - 1) % 8)],
          CASE stat
            WHEN 'pass' THEN 'All checkpoints within specification. Batch cleared for next stage.'
            WHEN 'fail' THEN 'Critical non-conformance detected. Batch quarantined. NCR raised — awaiting root cause analysis.'
            WHEN 'hold' THEN 'Batch on QC hold. Marginal dimensional result. Re-inspection scheduled within 48 h.'
          END,
          -- First 28 rows fall within the last 7 days for the trend chart
          CASE WHEN i <= 28
            THEN now() - (((i - 1) % 7) || ' days')::interval
            ELSE base + ((i * 1.4) || ' days')::interval
          END,
          base + ((i * 1.4) || ' days')::interval;
      END LOOP;
      RAISE NOTICE '  ✓ batch_qc_results inserted (55 rows)';
    ELSE
      RAISE NOTICE '  ℹ batch_qc_results table not found — skipping (dashboard QC widgets will be empty)';
    END IF;

    -- ── 5. Sales ────────────────────────────────────────────────────────────
    FOR i IN 1..60 LOOP
      stat   := sale_statuses[1 + ((i - 1) % array_length(sale_statuses, 1))];
      qty    := 10 + (i * 8);
      unit_p := ROUND((100 + (i * 47.3))::numeric, 2);
      tot    := ROUND((qty * unit_p)::numeric, 2);

      INSERT INTO sales (
        id, company_id, product_id, product_name,
        quantity, unit_price, total_price,
        customer_name, status, sold_at, created_at
      )
      VALUES (
        (md5('tf-seed-sale-' || target_company_id::text || '-' || i))::uuid,
        target_company_id,
        p[1 + ((i - 1) % 20)],
        prod_names[1 + ((i - 1) % 20)],
        qty, unit_p, tot,
        customers[1 + ((i - 1) % array_length(customers, 1))],
        stat,
        base + ((i * 1.9) || ' days')::interval,
        base + ((i * 1.9) || ' days')::interval
      )
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
    RAISE NOTICE '  ✓ sales inserted (60 rows)';

    -- ── 6. Quality Inspections ───────────────────────────────────────────────
    -- Used by the Quality Control page (separate from batch_qc_results).
    FOR i IN 1..50 LOOP
      insp_stat := insp_statuses[1 + ((i - 1) % array_length(insp_statuses, 1))];
      score     := CASE insp_stat
                     WHEN 'passed'      THEN 85 + (i % 15)
                     WHEN 'conditional' THEN 60 + (i % 20)
                     WHEN 'failed'      THEN 20 + (i % 40)
                     ELSE                    45 + (i % 30)
                   END;
      qc_id := (md5('tf-seed-qi-' || target_company_id::text || '-' || i))::uuid;

      INSERT INTO quality_inspections (
        id, company_id, batch_id, inspector_id, inspection_date,
        inspection_type, status, overall_score, notes, created_at, updated_at
      ) VALUES (
        qc_id, target_company_id,
        'BATCH-SEED-' || lpad(i::text, 3, '0'),
        inspector_ids[1 + ((i - 1) % 8)],
        (base + ((i * 2.1) || ' days')::interval)::date,
        insp_types[1 + ((i - 1) % 4)],
        insp_stat,
        score,
        CASE insp_stat
          WHEN 'passed'      THEN 'Inspection complete. All checkpoints satisfactory. Certificate of conformance issued per QCP-003.'
          WHEN 'conditional' THEN 'Conditional pass. Minor non-conformances documented. Supplier corrective action required within 14 days.'
          WHEN 'failed'      THEN 'FAILED: Critical non-conformance. Full production hold applied. 8D report initiated per NCR procedure.'
          ELSE                    'Inspection pending lab results. Batch tagged — do not ship.'
        END,
        base + ((i * 2.1) || ' days')::interval,
        base + ((i * 2.1) || ' days')::interval
      )
      ON CONFLICT (id) DO NOTHING;

      -- ── 7. Quality Defects ─────────────────────────────────────────────────
      IF insp_stat IN ('failed', 'conditional') THEN
        def_cnt := 1 + (i % 3);
        FOR j IN 1..def_cnt LOOP
          INSERT INTO quality_defects (
            id, inspection_id, defect_type, severity, quantity,
            description, corrective_action, resolved, created_at
          ) VALUES (
            (md5('tf-seed-qd-' || target_company_id::text || '-' || i || '-' || j))::uuid,
            qc_id,
            defect_types[1 + ((i + j - 1) % array_length(defect_types, 1))],
            defect_sevs[1 + ((i * j - 1)  % array_length(defect_sevs, 1))],
            1 + (i % 20),
            'Non-conformance documented during inspection. Affected units segregated and tagged per QCP-007 quarantine procedure.',
            CASE WHEN j = 1
              THEN 'Segregate batch. Issue supplier NCR. Initiate 8D corrective action. Re-inspect after supplier response.'
              ELSE NULL
            END,
            (i % 3 = 0),     -- every 3rd batch resolved
            base + ((i * 2.1) || ' days')::interval
          )
          ON CONFLICT (id) DO NOTHING;
        END LOOP;
      END IF;
    END LOOP;
    RAISE NOTICE '  ✓ quality_inspections + defects inserted';

  END IF; -- end idempotency guard

  -- ── 8. Re-link scan_events ───────────────────────────────────────────────
  -- The 500 existing rows have orphaned batch_ids (pointing to deleted orders).
  -- Distribute them across the 80 seeded production_orders in round-robin so
  -- the dashboard scan widgets, trend chart, and most-scanned table all resolve.
  -- This step always runs (idempotent: re-linking to same UUIDs is harmless).
  --
  -- Uses md5 formula — same formula used to generate o[] above — so no array
  -- needed; the formula produces the correct production_order UUID directly.
  EXECUTE format($q$
    WITH ordered_scans AS (
      SELECT
        ctid,
        ROW_NUMBER() OVER (ORDER BY scanned_at) AS rn
      FROM scan_events
    )
    UPDATE scan_events se
    SET
      batch_id   = (md5('tf-seed-order-' || %L || '-' || (1 + ((ordered_scans.rn - 1) %% 80))::text))::uuid,
      company_id = %L
    FROM ordered_scans
    WHERE se.ctid = ordered_scans.ctid
  $q$, target_company_id::text, target_company_id::text);

  RAISE NOTICE '  ✓ scan_events re-linked to seeded production_orders';

  -- ── 9. Verification summary ─────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════';
  RAISE NOTICE 'Reseed complete for company %', target_company_id;
  RAISE NOTICE '───────────────────────────────────────────────────';

  EXECUTE format('SELECT COUNT(*) FROM products            WHERE company_id = %L', target_company_id) INTO row_count;
  RAISE NOTICE '  products            : % rows', row_count;

  EXECUTE format('SELECT COUNT(*) FROM raw_materials       WHERE company_id = %L', target_company_id) INTO row_count;
  RAISE NOTICE '  raw_materials       : % rows', row_count;

  EXECUTE format('SELECT COUNT(*) FROM production_orders   WHERE company_id = %L', target_company_id) INTO row_count;
  RAISE NOTICE '  production_orders   : % rows', row_count;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batch_qc_results' AND table_schema = 'public') THEN
    EXECUTE format('SELECT COUNT(*) FROM batch_qc_results   WHERE company_id = %L', target_company_id) INTO row_count;
    RAISE NOTICE '  batch_qc_results    : % rows', row_count;
  END IF;

  EXECUTE format('SELECT COUNT(*) FROM sales               WHERE company_id = %L', target_company_id) INTO row_count;
  RAISE NOTICE '  sales               : % rows', row_count;

  EXECUTE format('SELECT COUNT(*) FROM quality_inspections WHERE company_id = %L', target_company_id) INTO row_count;
  RAISE NOTICE '  quality_inspections : % rows', row_count;

  EXECUTE format('SELECT COUNT(*) FROM quality_defects     WHERE company_id = %L', target_company_id) INTO row_count;
  RAISE NOTICE '  quality_defects     : % rows', row_count;

  EXECUTE format('SELECT COUNT(*) FROM scan_events         WHERE company_id = %L', target_company_id) INTO row_count;
  RAISE NOTICE '  scan_events         : % rows (re-linked)', row_count;

  RAISE NOTICE '═══════════════════════════════════════════════════';
  RAISE NOTICE 'Dashboard and all module pages should now show data.';

END;
$$;
