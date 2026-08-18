-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- SUPERSEDED — DO NOT EXECUTE THIS FILE STANDALONE
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- This file was the v2 multi-tenancy migration and is retained in full
-- for historical reference. It contains a scan_events policy definition
-- that is now stale relative to the live hardened state.
--
-- The authoritative current state for scan_events/log_scan_event is:
--
--   supabase_log_scan_event_hardening_20260819.sql
--
-- Running THIS file standalone would:
--   • Recreate "public_scan_insert" ON scan_events
--     FOR INSERT TO anon, authenticated WITH CHECK (true) —
--     a fully permissive INSERT policy with no batch validation.
--     The live database intentionally has NO such policy.
--     This is the most dangerous item in this file if executed against
--     the current hardened schema.
--
-- If you must re-run this file for schema recovery purposes, run
-- supabase_log_scan_event_hardening_20260819.sql immediately afterwards
-- to restore the hardened state.
--
-- This file is retained for historical reference only.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

-- ══════════════════════════════════════════════════════════════════════════════
-- TraceFlow — Multi-Tenancy Migration v2 (DEFINITIVE)
--
-- Fully idempotent. Safe to run on a fresh DB, after the original failed run,
-- or after the resume script failed. Every step uses IF NOT EXISTS / CREATE OR
-- REPLACE / WHERE IS NULL guards so re-running never duplicates or corrupts data.
--
-- Run the entire file in one paste in the Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Prerequisite ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'user_profiles' AND table_schema = 'public'
  ) THEN
    RAISE EXCEPTION 'user_profiles not found — run supabase_migration_user_ownership.sql first.';
  END IF;
END;
$$;

-- ── 1. companies table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL DEFAULT 'My Factory',
  slug       text        UNIQUE,
  plan       text        NOT NULL DEFAULT 'starter'
               CHECK (plan IN ('starter', 'growth', 'enterprise')),
  owner_id   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- ── 2. company_id on user_profiles ───────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE SET NULL;

-- ── 3. Bootstrap one company per existing user ────────────────────────────────
-- WHERE NOT EXISTS prevents duplicates on re-run.
INSERT INTO companies (id, name, owner_id, created_at)
SELECT
  gen_random_uuid(),
  CASE
    WHEN au.email IS NOT NULL
      THEN INITCAP(SPLIT_PART(SPLIT_PART(au.email, '@', 2), '.', 1)) || ' Industries'
    ELSE 'My Factory'
  END,
  up.user_id,
  now()
FROM user_profiles up
LEFT JOIN auth.users au ON au.id = up.user_id
WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE c.owner_id = up.user_id);

-- ── 4. Link user_profiles → company ──────────────────────────────────────────
UPDATE user_profiles up
SET company_id = c.id
FROM companies c
WHERE c.owner_id = up.user_id
  AND up.company_id IS NULL;

-- ── 5. get_my_company_id() helper ────────────────────────────────────────────
-- SECURITY DEFINER bypasses RLS to avoid circular dependency.
CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM user_profiles WHERE user_id = auth.uid() LIMIT 1
$$;

-- ── 6. Add company_id column to every business table ─────────────────────────
-- ADD COLUMN IF NOT EXISTS: safe to re-run.
-- ALTER COLUMN SET DEFAULT: always safe to re-run.

ALTER TABLE products        ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE products        ALTER COLUMN company_id SET DEFAULT get_my_company_id();

ALTER TABLE suppliers       ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE suppliers       ALTER COLUMN company_id SET DEFAULT get_my_company_id();

ALTER TABLE raw_materials   ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE raw_materials   ALTER COLUMN company_id SET DEFAULT get_my_company_id();

ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE production_orders ALTER COLUMN company_id SET DEFAULT get_my_company_id();

ALTER TABLE sales            ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE sales            ALTER COLUMN company_id SET DEFAULT get_my_company_id();

ALTER TABLE quality_inspections ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE quality_inspections ALTER COLUMN company_id SET DEFAULT get_my_company_id();

-- quality_defects: company_id is populated by trigger, no DEFAULT
ALTER TABLE quality_defects ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bill_of_materials' AND table_schema = 'public') THEN
    ALTER TABLE bill_of_materials ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
    ALTER TABLE bill_of_materials ALTER COLUMN company_id SET DEFAULT get_my_company_id();
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batch_qc_results' AND table_schema = 'public') THEN
    ALTER TABLE batch_qc_results ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
    ALTER TABLE batch_qc_results ALTER COLUMN company_id SET DEFAULT get_my_company_id();
  END IF;
END;
$$;

-- scan_events: public inserts (no auth context) — populated by trigger, no DEFAULT
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scan_events' AND table_schema = 'public') THEN
    ALTER TABLE scan_events ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  END IF;
END;
$$;

-- batch_lineage: populated by trigger, no DEFAULT
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batch_lineage' AND table_schema = 'public') THEN
    ALTER TABLE batch_lineage ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  END IF;
END;
$$;

-- ── 7. Backfill existing rows ─────────────────────────────────────────────────
-- All WHERE company_id IS NULL — safe to re-run, only touches unlinked rows.

UPDATE products t SET company_id = up.company_id
FROM user_profiles up WHERE t.user_id = up.user_id AND t.company_id IS NULL;

UPDATE suppliers t SET company_id = up.company_id
FROM user_profiles up WHERE t.user_id = up.user_id AND t.company_id IS NULL;

UPDATE raw_materials t SET company_id = up.company_id
FROM user_profiles up WHERE t.user_id = up.user_id AND t.company_id IS NULL;

UPDATE production_orders t SET company_id = up.company_id
FROM user_profiles up WHERE t.user_id = up.user_id AND t.company_id IS NULL;

UPDATE sales t SET company_id = up.company_id
FROM user_profiles up WHERE t.user_id = up.user_id AND t.company_id IS NULL;

UPDATE quality_inspections t SET company_id = up.company_id
FROM user_profiles up WHERE t.user_id = up.user_id AND t.company_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bill_of_materials' AND table_schema = 'public') THEN
    UPDATE bill_of_materials t SET company_id = up.company_id
    FROM user_profiles up WHERE t.user_id = up.user_id AND t.company_id IS NULL;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batch_qc_results' AND table_schema = 'public') THEN
    UPDATE batch_qc_results t SET company_id = up.company_id
    FROM user_profiles up WHERE t.user_id = up.user_id AND t.company_id IS NULL;
  END IF;
END;
$$;

-- quality_defects: derive company from parent inspection
UPDATE quality_defects qd SET company_id = qi.company_id
FROM quality_inspections qi
WHERE qd.inspection_id = qi.id AND qd.company_id IS NULL;

-- scan_events: batch_id is uuid — compare directly (no ::text cast)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scan_events' AND table_schema = 'public') THEN
    UPDATE scan_events se SET company_id = po.company_id
    FROM production_orders po
    WHERE po.id = se.batch_id AND se.company_id IS NULL;
  END IF;
END;
$$;

-- batch_lineage: parent_batch_id is uuid — compare directly
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batch_lineage' AND table_schema = 'public') THEN
    UPDATE batch_lineage bl SET company_id = po.company_id
    FROM production_orders po
    WHERE po.id = bl.parent_batch_id AND bl.company_id IS NULL;
  END IF;
END;
$$;

-- ── 8. Trigger: auto-create company for new user_profiles rows ────────────────
CREATE OR REPLACE FUNCTION tf_bootstrap_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid        uuid;
  user_email text;
  cname      text;
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT email INTO user_email FROM auth.users WHERE id = NEW.user_id;
    cname := CASE
      WHEN user_email IS NOT NULL
        THEN INITCAP(SPLIT_PART(SPLIT_PART(user_email, '@', 2), '.', 1)) || ' Industries'
      ELSE 'My Factory'
    END;
    INSERT INTO companies (name, owner_id)
    VALUES (cname, NEW.user_id)
    RETURNING id INTO cid;
    NEW.company_id := cid;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bootstrap_company ON user_profiles;
CREATE TRIGGER trg_bootstrap_company
  BEFORE INSERT ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION tf_bootstrap_company();

-- ── 9. Trigger: quality_defects inherits company from parent inspection ────────
CREATE OR REPLACE FUNCTION tf_defect_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := (
      SELECT company_id FROM quality_inspections WHERE id = NEW.inspection_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_defect_company ON quality_defects;
CREATE TRIGGER trg_defect_company
  BEFORE INSERT ON quality_defects
  FOR EACH ROW EXECUTE FUNCTION tf_defect_company();

-- ── 10. Trigger: scan_events derives company from production_orders ────────────
-- batch_id is uuid — compare directly, no ::text cast.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scan_events' AND table_schema = 'public') THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION tf_scan_company()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $inner$
      BEGIN
        IF NEW.company_id IS NULL THEN
          BEGIN
            NEW.company_id := (
              SELECT company_id FROM production_orders WHERE id = NEW.batch_id LIMIT 1
            );
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
        END IF;
        RETURN NEW;
      END;
      $inner$;
    $func$;
    DROP TRIGGER IF EXISTS trg_scan_company ON scan_events;
    CREATE TRIGGER trg_scan_company
      BEFORE INSERT ON scan_events
      FOR EACH ROW EXECUTE FUNCTION tf_scan_company();
  END IF;
END;
$$;

-- ── 11. Trigger: batch_lineage derives company from production_orders ──────────
-- parent_batch_id is uuid — compare directly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batch_lineage' AND table_schema = 'public') THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION tf_lineage_company()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $inner$
      BEGIN
        IF NEW.company_id IS NULL THEN
          BEGIN
            NEW.company_id := (
              SELECT company_id FROM production_orders WHERE id = NEW.parent_batch_id LIMIT 1
            );
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
        END IF;
        RETURN NEW;
      END;
      $inner$;
    $func$;
    DROP TRIGGER IF EXISTS trg_lineage_company ON batch_lineage;
    CREATE TRIGGER trg_lineage_company
      BEFORE INSERT ON batch_lineage
      FOR EACH ROW EXECUTE FUNCTION tf_lineage_company();
  END IF;
END;
$$;

-- ── 12. Drop all existing RLS policies (clean slate before recreating) ─────────
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'companies','user_profiles','products','suppliers','raw_materials',
        'production_orders','sales','quality_inspections','quality_defects',
        'bill_of_materials','batch_qc_results','scan_events','batch_lineage',
        'bom_usage','qc_results'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END;
$$;

-- ── 13. Company-scoped RLS policies ──────────────────────────────────────────

-- companies: members read their own; owner can update
CREATE POLICY "co_read" ON companies
  FOR SELECT TO authenticated USING (id = get_my_company_id());

CREATE POLICY "co_owner_update" ON companies
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- user_profiles: own row always + any row in same company (admin can list team)
CREATE POLICY "up_read" ON user_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR company_id = get_my_company_id());

CREATE POLICY "up_write" ON user_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Core business tables: full CRUD within company
CREATE POLICY "co_products" ON products
  FOR ALL TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "co_suppliers" ON suppliers
  FOR ALL TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "co_raw_materials" ON raw_materials
  FOR ALL TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "co_production_orders" ON production_orders
  FOR ALL TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "co_sales" ON sales
  FOR ALL TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "co_quality_inspections" ON quality_inspections
  FOR ALL TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "co_quality_defects" ON quality_defects
  FOR ALL TO authenticated
  USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bill_of_materials' AND table_schema = 'public') THEN
    EXECUTE $q$
      CREATE POLICY "co_bill_of_materials" ON bill_of_materials
        FOR ALL TO authenticated
        USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
    $q$;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batch_qc_results' AND table_schema = 'public') THEN
    EXECUTE $q$
      CREATE POLICY "co_batch_qc_results" ON batch_qc_results
        FOR ALL TO authenticated
        USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
    $q$;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scan_events' AND table_schema = 'public') THEN
    -- anon role can INSERT (QR scan page has no auth); authenticated can read own company
    EXECUTE $q$
      CREATE POLICY "co_scan_read" ON scan_events
        FOR SELECT TO authenticated USING (company_id = get_my_company_id());
      CREATE POLICY "public_scan_insert" ON scan_events
        FOR INSERT TO anon, authenticated WITH CHECK (true);
    $q$;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batch_lineage' AND table_schema = 'public') THEN
    EXECUTE $q$
      CREATE POLICY "co_batch_lineage" ON batch_lineage
        FOR ALL TO authenticated
        USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
    $q$;
  END IF;
END;
$$;

-- Legacy tables without company_id — scope via production_orders join
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bom_usage' AND table_schema = 'public') THEN
    EXECUTE $q$
      CREATE POLICY "co_bom_usage" ON bom_usage
        FOR ALL TO authenticated
        USING (EXISTS (
          SELECT 1 FROM production_orders po
          WHERE po.id = bom_usage.production_order_id
            AND po.company_id = get_my_company_id()
        ));
    $q$;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'qc_results' AND table_schema = 'public') THEN
    EXECUTE $q$
      CREATE POLICY "co_qc_results" ON qc_results
        FOR ALL TO authenticated
        USING (EXISTS (
          SELECT 1 FROM production_orders po
          WHERE po.id = qc_results.production_order_id
            AND po.company_id = get_my_company_id()
        ));
    $q$;
  END IF;
END;
$$;

-- ── 14. Public /trace/[id] anon reads ────────────────────────────────────────
-- The 128-bit UUID is the access token — guessing one is computationally infeasible.
CREATE POLICY "public_trace_orders" ON production_orders
  FOR SELECT TO anon USING (true);

CREATE POLICY "public_trace_products" ON products
  FOR SELECT TO anon USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bill_of_materials' AND table_schema = 'public') THEN
    EXECUTE $q$ CREATE POLICY "public_trace_bom" ON bill_of_materials FOR SELECT TO anon USING (true); $q$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batch_qc_results' AND table_schema = 'public') THEN
    EXECUTE $q$ CREATE POLICY "public_trace_qc" ON batch_qc_results FOR SELECT TO anon USING (true); $q$;
  END IF;
END;
$$;

-- ── 15. Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE
  company_count int;
  user_count    int;
  orphan_count  int;
BEGIN
  SELECT COUNT(*) INTO company_count FROM companies;
  SELECT COUNT(*) INTO user_count    FROM user_profiles WHERE company_id IS NOT NULL;
  SELECT COUNT(*) INTO orphan_count  FROM user_profiles WHERE company_id IS NULL;

  RAISE NOTICE '=== TraceFlow Multi-Tenancy Migration Complete ===';
  RAISE NOTICE 'Companies  : %', company_count;
  RAISE NOTICE 'Users linked     : %', user_count;
  RAISE NOTICE 'Users unlinked   : %  (auto-links on next login via trigger)', orphan_count;
  RAISE NOTICE 'Confirm with: SELECT id, name, owner_id FROM companies;';
END;
$$;
