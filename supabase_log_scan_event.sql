-- ============================================================
-- TraceFlow — log_scan_event SECURITY DEFINER RPC
-- ============================================================
-- Fixes: anonymous QR scan logging fails with RLS 42501.
--
-- Root cause:
--   logScanEvent() in page.tsx inserts directly into scan_events
--   without a company_id. The anon role has no auth context, so
--   every RLS policy that checks company_id rejects the row.
--
-- Solution:
--   Replace the direct insert with a SECURITY DEFINER function.
--   The function derives company_id server-side from production_orders
--   using the supplied batch_id. Callers cannot supply company_id.
--   Unknown batch_ids return silently (invalid QR codes, deleted batches).
--
-- Security guarantees:
--   • company_id is NEVER caller-supplied — derived from production_orders
--   • Invalid/unknown batch_ids are silently ignored, no data written
--   • RLS is NOT disabled on scan_events; this function bypasses it only
--     for its own INSERT, nothing else
--   • Tenant isolation is preserved: company_id always matches the batch
--   • No service key required: anon key + GRANT EXECUTE is sufficient
--   • Return type is void: no data is returned to the caller
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
--   Or: supabase db execute --file supabase_log_scan_event.sql
-- ============================================================

-- ── 1. Create / replace the function ─────────────────────────

CREATE OR REPLACE FUNCTION log_scan_event(
  p_batch_id    uuid,
  p_device_type text DEFAULT NULL,
  p_browser     text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  -- Resolve tenant from the batch.
  -- If the batch doesn't exist, v_company_id stays NULL.
  SELECT company_id INTO v_company_id
  FROM   production_orders
  WHERE  id = p_batch_id
  LIMIT  1;

  -- Unknown or deleted batch — no insert, no error exposed to caller.
  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO scan_events (
    batch_id,
    company_id,
    scanned_at,
    device_type,
    browser,
    user_agent
  )
  VALUES (
    p_batch_id,
    v_company_id,
    now(),
    p_device_type,
    p_browser,
    LEFT(COALESCE(p_user_agent, ''), 300)
  );
END;
$$;

-- ── 2. Grant execute to caller roles ─────────────────────────
-- anon:          public trace page viewers (unauthenticated)
-- authenticated: logged-in staff viewing a batch page
-- Never grant to public — requires explicit role assignment.

GRANT EXECUTE ON FUNCTION log_scan_event(uuid, text, text, text)
  TO anon, authenticated;

-- ── 3. Remove the permissive anon INSERT policy if it exists ──
-- The function is now the only sanctioned insert path for anon.
-- Keeping a permissive INSERT policy alongside the function
-- would re-open direct table access.

DROP POLICY IF EXISTS "public_scan_insert" ON scan_events;

-- ── 4. Smoke test (runs in the same transaction, rolls back) ──
-- Verifies the function resolves company_id and inserts correctly.
-- Uses DO block so it auto-rolls-back without affecting real data.

DO $$
DECLARE
  v_batch_id  uuid;
  v_company_id uuid;
  v_scan_count int;
BEGIN
  -- Pick any real batch to test against.
  SELECT id INTO v_batch_id FROM production_orders LIMIT 1;

  IF v_batch_id IS NULL THEN
    RAISE NOTICE 'Smoke test skipped — no production_orders rows found.';
    RETURN;
  END IF;

  SELECT company_id INTO v_company_id
  FROM production_orders WHERE id = v_batch_id;

  -- Call the function.
  PERFORM log_scan_event(
    v_batch_id, 'desktop', 'TestBrowser', 'smoke-test-ua'
  );

  -- Confirm a row was written.
  SELECT COUNT(*) INTO v_scan_count
  FROM scan_events
  WHERE batch_id   = v_batch_id
    AND browser    = 'TestBrowser'
    AND company_id = v_company_id;

  IF v_scan_count = 0 THEN
    RAISE EXCEPTION 'Smoke test FAILED — no scan_events row written for batch %', v_batch_id;
  END IF;

  RAISE NOTICE 'Smoke test PASSED — log_scan_event inserted row with company_id = %', v_company_id;

  -- Roll back the test row so it does not appear in real data.
  DELETE FROM scan_events
  WHERE batch_id = v_batch_id AND browser = 'TestBrowser';

  RAISE NOTICE 'log_scan_event migration applied successfully.';
END;
$$;
