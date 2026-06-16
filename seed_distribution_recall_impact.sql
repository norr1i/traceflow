-- ============================================================
-- TraceFlow — Distribution Records Seed for Recall Impact Demo
-- File: seed_distribution_recall_impact.sql
-- ============================================================
--
-- PURPOSE
--   Connects the two production batches that use lot LOT-2025-SS316-0891
--   to downstream distributors so that get_recall_impact() returns a
--   populated affected_distributors array and a non-zero total_affected_units.
--
-- PRODUCTION ORDERS TARGETED
--   74d19d61-b61f-42ad-b1df-84a954361e6b  (Batch A)
--   22ab30a1-5f65-476c-84fc-8ba06bc5b92d  (Batch B)
--
-- JOIN CHAIN BUILT
--   production_orders.id
--     → batches.production_order_id → batches.id
--       → distribution_records.batch_id
--
-- IDEMPOTENCY STRATEGY
--   For each production order:
--     1. SELECT existing batches row WHERE production_order_id = <po>.
--        If found  → use that batches.id (no insert needed).
--     2. If NOT found → insert a NEW batches row with a SYNTHETIC lot_number
--        'LOT-IMPACT-<first-8-chars-of-po-uuid>' which is globally unique
--        and can never collide with uq_active_lot_per_company.
--        Never reuse LOT-2025-SS316-0891 in a new row — that lot_number
--        already has an active row and the constraint will fire.
--     3. SELECT the id again (works on first run and on re-runs).
--   Distribution records are guarded by NOT EXISTS before each INSERT.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

DO $$
DECLARE
  -- ── Target production orders ─────────────────────────────────────
  po_a  uuid := '74d19d61-b61f-42ad-b1df-84a954361e6b';
  po_b  uuid := '22ab30a1-5f65-476c-84fc-8ba06bc5b92d';

  -- ── Runtime-resolved ─────────────────────────────────────────────
  cid       uuid;
  p_id_a    uuid;
  p_id_b    uuid;
  qty_a     int;
  qty_b     int;
  sku_a     text;
  sku_b     text;
  name_a    text;
  name_b    text;
  bt_first  text;

  -- ── batches.id — resolved or freshly inserted ───────────────────
  b_id_a  uuid;
  b_id_b  uuid;

  -- ── Shipment anchors ─────────────────────────────────────────────
  t_a  timestamptz;
  t_b  timestamptz;
BEGIN

  -- ── 1. Resolve company_id and product from production order A ────
  SELECT company_id, product_id, quantity
  INTO   cid,        p_id_a,     qty_a
  FROM   production_orders
  WHERE  id = po_a
  LIMIT  1;

  IF cid IS NULL THEN
    RAISE EXCEPTION
      'Production order % not found. Verify the UUID matches your live DB.', po_a;
  END IF;

  -- ── 2. Resolve production order B ────────────────────────────────
  SELECT product_id, quantity
  INTO   p_id_b,     qty_b
  FROM   production_orders
  WHERE  id         = po_b
    AND  company_id = cid
  LIMIT  1;

  -- B is optional; warn but continue
  IF qty_b IS NULL THEN
    RAISE WARNING
      'Production order % not found for company %. Batch B will be skipped.', po_b, cid;
  END IF;

  -- ── 3. Resolve product details ───────────────────────────────────
  SELECT sku, name INTO sku_a, name_a
  FROM   products WHERE id = p_id_a AND company_id = cid LIMIT 1;

  SELECT sku, name INTO sku_b, name_b
  FROM   products WHERE id = p_id_b AND company_id = cid LIMIT 1;

  qty_a  := COALESCE(qty_a,  250);
  qty_b  := COALESCE(qty_b,  200);
  sku_a  := COALESCE(sku_a,  'BATCH-A');
  sku_b  := COALESCE(sku_b,  'BATCH-B');
  name_a := COALESCE(name_a, 'Batch A Product');
  name_b := COALESCE(name_b, 'Batch B Product');

  -- ── 4. Discover batch_type enum ──────────────────────────────────
  SELECT e.enumlabel INTO bt_first
  FROM   pg_type t
  JOIN   pg_enum e ON e.enumtypid = t.oid
  WHERE  t.typname = 'batch_type'
  ORDER  BY e.enumsortorder
  LIMIT  1;

  IF bt_first IS NULL THEN
    RAISE EXCEPTION 'batch_type enum not found in live schema.';
  END IF;

  RAISE NOTICE '── Resolved ──────────────────────────────────────────';
  RAISE NOTICE 'company_id : %', cid;
  RAISE NOTICE 'Batch A    : po=% product="%" qty=% sku=%', po_a, name_a, qty_a, sku_a;
  RAISE NOTICE 'Batch B    : po=% product="%" qty=% sku=%', po_b, name_b, qty_b, sku_b;
  RAISE NOTICE 'batch_type : %', bt_first;

  -- ── 5a. Resolve or create batches row for Batch A ────────────────
  --
  -- Priority:
  --   a) Use existing row where production_order_id = po_a  (any prior seed)
  --   b) Insert a NEW row with a synthetic lot_number that is globally
  --      unique and cannot collide with uq_active_lot_per_company.
  --      We NEVER write LOT-2025-SS316-0891 here because an active row
  --      with that lot_number already exists.

  SELECT id INTO b_id_a
  FROM   batches
  WHERE  production_order_id = po_a
    AND  company_id          = cid
  LIMIT  1;

  IF b_id_a IS NULL THEN
    b_id_a := gen_random_uuid();
    INSERT INTO batches
      (id, company_id, type, sku, name, lot_number,
       quantity_initial, quantity_remaining, product_id, production_order_id)
    VALUES
      (b_id_a, cid, bt_first::batch_type,
       sku_a,
       name_a || ' — Recall Impact Seed A',
       -- Synthetic lot_number: unique per production order, never conflicts
       'LOT-IMPACT-' || left(po_a::text, 8),
       qty_a, 0, p_id_a, po_a);
    RAISE NOTICE 'Batch A : inserted new batches row id=%', b_id_a;
  ELSE
    RAISE NOTICE 'Batch A : reusing existing batches row id=%', b_id_a;
  END IF;

  -- ── 5b. Resolve or create batches row for Batch B ────────────────
  IF qty_b IS NOT NULL THEN
    SELECT id INTO b_id_b
    FROM   batches
    WHERE  production_order_id = po_b
      AND  company_id          = cid
    LIMIT  1;

    IF b_id_b IS NULL THEN
      b_id_b := gen_random_uuid();
      INSERT INTO batches
        (id, company_id, type, sku, name, lot_number,
         quantity_initial, quantity_remaining, product_id, production_order_id)
      VALUES
        (b_id_b, cid, bt_first::batch_type,
         sku_b,
         name_b || ' — Recall Impact Seed B',
         'LOT-IMPACT-' || left(po_b::text, 8),
         qty_b, 0, p_id_b, po_b);
      RAISE NOTICE 'Batch B : inserted new batches row id=%', b_id_b;
    ELSE
      RAISE NOTICE 'Batch B : reusing existing batches row id=%', b_id_b;
    END IF;
  END IF;

  t_a := now() - interval '28 days';
  t_b := now() - interval '22 days';

  -- ── 6a. Distribution records for Batch A ─────────────────────────
  -- Batch A: up to qty_a units produced; 225 shipped across 4 recipients.
  IF NOT EXISTS (
    SELECT 1 FROM distribution_records
    WHERE company_id = cid AND batch_id = b_id_a
  ) THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (cid, b_id_a, 'distributor'::recipient_type,
       'Riyadh Industrial Supply Co.', 80, t_a,
       'DN-RIS-2025-0112 | 80 units | SS316 ball valves for SADARA complex maintenance. PO SAP-RI-84231. SAPTCO cargo.'),

      (cid, b_id_a, 'distributor'::recipient_type,
       'Jeddah Valve Center', 60, t_a + interval '4 days',
       'DN-JVC-2025-0089 | 60 units | Red Sea industrial corridor capital project. Jeddah port free-zone warehouse.'),

      (cid, b_id_a, 'wholesaler'::recipient_type,
       'Dammam Engineering Trading LLC', 50, t_a + interval '8 days',
       'DN-DET-2025-0044 | 50 units | Quarterly supply agreement QA-2025-DET-003. Consolidated pallet.'),

      (cid, b_id_a, 'distributor'::recipient_type,
       'Yanbu Industrial Services', 35, t_a + interval '12 days',
       'DN-YIS-2025-0027 | 35 units | YASREF facility expansion Phase 2.');

    RAISE NOTICE 'Batch A : 4 distribution records inserted (225 units total)';
  ELSE
    RAISE NOTICE 'Batch A : distribution records already exist — skipped';
  END IF;

  -- ── 6b. Distribution records for Batch B ─────────────────────────
  -- Batch B: up to qty_b units produced; 160 shipped across 3 recipients.
  IF b_id_b IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM distribution_records
    WHERE company_id = cid AND batch_id = b_id_b
  ) THEN
    INSERT INTO distribution_records
      (company_id, batch_id, recipient_type, recipient_name, quantity_shipped, shipped_at, notes)
    VALUES
      (cid, b_id_b, 'distributor'::recipient_type,
       'Riyadh Industrial Supply Co.', 60, t_b,
       'DN-RIS-2025-0118 | 60 units | Secondary order, same facility. PO extension SAP-RI-84239.'),

      (cid, b_id_b, 'government'::recipient_type,
       'Saudi Aramco — Eastern Province', 55, t_b + interval '5 days',
       'DN-SA-2025-0508 | 55 units | Aramco approved vendor list AVO-2025-0044. Dhahran plant utilities.'),

      (cid, b_id_b, 'wholesaler'::recipient_type,
       'Dammam Engineering Trading LLC', 45, t_b + interval '9 days',
       'DN-DET-2025-0051 | 45 units | Scheduled quarterly delivery. Combined pallet with flanges order.');

    RAISE NOTICE 'Batch B : 3 distribution records inserted (160 units total)';
  ELSE
    RAISE NOTICE 'Batch B : distribution records already exist or Batch B was skipped';
  END IF;

  RAISE NOTICE '── Done ───────────────────────────────────────────────';
  RAISE NOTICE 'Run the verification queries below to confirm.';
END;
$$;

-- ============================================================
-- VERIFICATION QUERIES — run these immediately after the DO block
-- ============================================================

-- 1. Confirm batches rows exist and are linked to the production orders
SELECT
  b.id                   AS batches_id,
  b.lot_number,
  b.name,
  b.quantity_initial,
  b.production_order_id,
  po.status              AS po_status
FROM   batches           b
JOIN   production_orders po ON po.id = b.production_order_id
WHERE  b.production_order_id IN (
  '74d19d61-b61f-42ad-b1df-84a954361e6b',
  '22ab30a1-5f65-476c-84fc-8ba06bc5b92d'
);

-- 2. Confirm distribution_records are linked through those batches
SELECT
  dr.recipient_name,
  dr.recipient_type::text,
  dr.quantity_shipped,
  dr.shipped_at::date   AS shipped_date,
  b.production_order_id
FROM   distribution_records dr
JOIN   batches              b  ON b.id = dr.batch_id
WHERE  b.production_order_id IN (
  '74d19d61-b61f-42ad-b1df-84a954361e6b',
  '22ab30a1-5f65-476c-84fc-8ba06bc5b92d'
)
ORDER  BY dr.shipped_at;

-- 3. RPC end-to-end — summary row (expect total_distributors ≥ 5, total_affected_units ≥ 385)
SELECT
  result->>'risk_level'           AS risk_level,
  result->>'has_open_recall'      AS has_open_recall,
  result->>'total_batches'        AS total_batches,
  result->>'total_products'       AS total_products,
  result->>'total_distributors'   AS total_distributors,
  result->>'total_affected_units' AS total_affected_units
FROM (
  SELECT get_recall_impact(p_lot_number := 'LOT-2025-SS316-0891') AS result
) t;

-- 4. RPC end-to-end — full distributor list
SELECT
  d->>'recipient_name' AS recipient,
  d->>'recipient_type' AS type,
  (d->>'quantity')::int AS units,
  left(d->>'shipped_at', 10) AS shipped_date
FROM (
  SELECT get_recall_impact(p_lot_number := 'LOT-2025-SS316-0891') AS result
) t,
LATERAL jsonb_array_elements(t.result->'affected_distributors') d
ORDER  BY shipped_date;
