-- ═══════════════════════════════════════════════════════════════════════════
-- TraceFlow: Multi-Tenancy Migration — RESUME SCRIPT
--
-- The original migration failed at the scan_events backfill because
-- scan_events.batch_id is a uuid column, not text. PostgreSQL has no
-- implicit cast for (text = uuid).
--
-- Everything up to and including quality_defects backfill already ran.
-- Paste and run ONLY this file in the Supabase SQL editor.
-- It is safe to re-run (idempotent via IF NOT EXISTS / DROP IF EXISTS /
-- WHERE company_id IS NULL guards).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Fix: scan_events backfill ─────────────────────────────────────────────
-- se.batch_id is uuid, so compare directly (no ::text cast needed).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scan_events' AND table_schema = 'public') THEN
    UPDATE scan_events se
    SET company_id = po.company_id
    FROM production_orders po
    WHERE po.id = se.batch_id
      AND se.company_id IS NULL;
  END IF;
END;
$$;

-- ── 2. batch_lineage backfill ─────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batch_lineage' AND table_schema = 'public') THEN
    UPDATE batch_lineage bl
    SET company_id = po.company_id
    FROM production_orders po
    WHERE po.id = bl.parent_batch_id
      AND bl.company_id IS NULL;
  END IF;
END;
$$;

-- ── 3. Auto-create company for new user_profiles rows ────────────────────────
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

-- ── 4. quality_defects: inherit company from parent inspection ────────────────
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

-- ── 5. scan_events trigger (fixed: uuid = uuid) ───────────────────────────────
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

-- ── 6. batch_lineage trigger (fixed: uuid = uuid) ────────────────────────────
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

-- ── 7. Drop existing RLS policies ────────────────────────────────────────────
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

-- ── 8. Company-scoped RLS policies ───────────────────────────────────────────

CREATE POLICY "co_read" ON companies
  FOR SELECT TO authenticated USING (id = get_my_company_id());

CREATE POLICY "co_owner_update" ON companies
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "up_read" ON user_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR company_id = get_my_company_id());

CREATE POLICY "up_write" ON user_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

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

-- Legacy tables scoped via production_orders join
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

-- ── 9. Public /trace/[id] anon reads ─────────────────────────────────────────
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

-- ── 10. Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE
  company_count int;
  user_count    int;
  orphan_count  int;
BEGIN
  SELECT COUNT(*) INTO company_count FROM companies;
  SELECT COUNT(*) INTO user_count    FROM user_profiles WHERE company_id IS NOT NULL;
  SELECT COUNT(*) INTO orphan_count  FROM user_profiles WHERE company_id IS NULL;

  RAISE NOTICE '=== TraceFlow Multi-Tenant Migration Complete ===';
  RAISE NOTICE 'Companies created : %', company_count;
  RAISE NOTICE 'Users linked      : %', user_count;
  RAISE NOTICE 'Users unlinked    : %  (auto-links on next login)', orphan_count;
  RAISE NOTICE 'Verify with: SELECT id, name, owner_id FROM companies;';
END;
$$;
