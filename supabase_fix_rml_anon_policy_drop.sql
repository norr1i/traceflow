-- ============================================================
-- TraceFlow — Security Fix: Remove anon SELECT exposure on raw_material_lots
-- File: supabase_fix_rml_anon_policy_drop.sql
-- ============================================================
--
-- WHAT THIS FILE DOES
--   Drops the "public_trace_rml" anon SELECT policy from
--   public.raw_material_lots. No other change is made.
--
-- BACKGROUND
--   supabase_fix_rml_supplier.sql added:
--
--     CREATE POLICY "public_trace_rml"
--       ON public.raw_material_lots
--       FOR SELECT TO anon
--       USING (true);
--
--   The stated intent was to allow get_batch_trace (a SECURITY
--   DEFINER function) to join raw_material_lots when called by an
--   unauthenticated visitor on the public QR scan page.
--
--   That reasoning is incorrect. SECURITY DEFINER functions run as
--   the function owner (the Supabase database superuser), not as the
--   calling role. FORCE ROW LEVEL SECURITY is not set on
--   raw_material_lots, so the owner is unconditionally exempt from
--   RLS. get_batch_trace reads raw_material_lots via a direct SQL
--   LEFT JOIN inside the function body — it never goes through
--   PostgREST and is not subject to the anon SELECT policy at all.
--
-- WHAT THE POLICY ACTUALLY EXPOSED
--   With USING (true), any unauthenticated HTTP request to:
--     GET /rest/v1/raw_material_lots?select=*
--   returned ALL rows from ALL companies, including:
--     company_id, lot_number, supplier_id, quantity, status, and
--     internal quality/NCR notes.
--   Confirmed live: 15 rows returned on 2026-07-13 using only the
--   public anon key, no user session required.
--
-- WHY REMOVAL IS SAFE
--   get_batch_trace (supabase_get_batch_trace.sql):
--     - Is SECURITY DEFINER  (line 29)
--     - Has SET search_path = public  (line 30)
--     - Accesses raw_material_lots via direct SQL LEFT JOIN  (line 119)
--     - Is the only function granted to the anon role that touches
--       raw_material_lots
--   Removing the anon policy has no effect on get_batch_trace's
--   ability to read raw_material_lots. The public QR trace page
--   calls get_batch_trace via RPC and will continue to return
--   lot_number and supplier_name without any change.
--
-- WHAT IS PRESERVED
--   "rml: all own company" — authenticated company-scoped CRUD policy
--   get_batch_trace         — untouched; SECURITY DEFINER bypasses RLS
--   All other RLS policies  — untouched
--
-- IDEMPOTENT: DROP POLICY IF EXISTS is safe to re-run.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================


-- ── Step 1: Remove the anon SELECT policy ────────────────────
DROP POLICY IF EXISTS "public_trace_rml" ON public.raw_material_lots;


-- ── Step 2: Verification ─────────────────────────────────────
DO $$
DECLARE
  v_anon_policy_exists  boolean;
  v_auth_policy_exists  boolean;
  v_rls_enabled         boolean;
  v_rls_forced          boolean;
  v_fn_security_definer boolean;
  v_fn_search_path      text;
BEGIN

  -- 2a. Confirm anon policy no longer exists
  SELECT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'public'
      AND  tablename  = 'raw_material_lots'
      AND  policyname = 'public_trace_rml'
  ) INTO v_anon_policy_exists;

  -- 2b. Confirm authenticated company-scoped policy still exists
  SELECT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'public'
      AND  tablename  = 'raw_material_lots'
      AND  policyname = 'rml: all own company'
  ) INTO v_auth_policy_exists;

  -- 2c. Confirm RLS is enabled on raw_material_lots
  SELECT relrowsecurity, relforcerowsecurity
  INTO   v_rls_enabled, v_rls_forced
  FROM   pg_class
  WHERE  relname      = 'raw_material_lots'
    AND  relnamespace = 'public'::regnamespace;

  -- 2d. Confirm get_batch_trace is still SECURITY DEFINER
  SELECT prosecdef
  INTO   v_fn_security_definer
  FROM   pg_proc
  WHERE  proname      = 'get_batch_trace'
    AND  pronamespace = 'public'::regnamespace
  LIMIT  1;

  -- 2e. Confirm get_batch_trace still has SET search_path = public
  SELECT array_to_string(proconfig, ', ')
  INTO   v_fn_search_path
  FROM   pg_proc
  WHERE  proname      = 'get_batch_trace'
    AND  pronamespace = 'public'::regnamespace
  LIMIT  1;

  -- ── Report ─────────────────────────────────────────────────
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE 'supabase_fix_rml_anon_policy_drop — verification';
  RAISE NOTICE '══════════════════════════════════════════════════════';

  -- Policy removal
  IF NOT v_anon_policy_exists THEN
    RAISE NOTICE '✓  "public_trace_rml" anon SELECT policy: REMOVED';
  ELSE
    RAISE WARNING '✗  "public_trace_rml" still exists — DROP did not apply';
  END IF;

  -- Authenticated policy intact
  IF v_auth_policy_exists THEN
    RAISE NOTICE '✓  "rml: all own company" authenticated policy: PRESENT';
  ELSE
    RAISE WARNING '✗  "rml: all own company" policy missing — verify RLS';
  END IF;

  -- RLS still enabled
  IF v_rls_enabled THEN
    RAISE NOTICE '✓  RLS enabled on raw_material_lots';
  ELSE
    RAISE WARNING '✗  RLS is NOT enabled on raw_material_lots — table is open';
  END IF;

  -- FORCE RLS not set (expected — owner must bypass RLS for get_batch_trace)
  IF NOT v_rls_forced THEN
    RAISE NOTICE '✓  FORCE ROW LEVEL SECURITY not set (owner bypasses RLS — correct)';
  ELSE
    RAISE WARNING '!  FORCE ROW LEVEL SECURITY is set — get_batch_trace owner is';
    RAISE WARNING '   subject to RLS. Verify the function still returns materials data.';
  END IF;

  -- get_batch_trace is SECURITY DEFINER
  IF v_fn_security_definer THEN
    RAISE NOTICE '✓  get_batch_trace: SECURITY DEFINER';
  ELSE
    RAISE WARNING '✗  get_batch_trace is NOT SECURITY DEFINER — redeploy the function';
  END IF;

  -- get_batch_trace has SET search_path = public
  IF v_fn_search_path ILIKE '%search_path=public%' THEN
    RAISE NOTICE '✓  get_batch_trace: SET search_path = public';
  ELSE
    RAISE WARNING '~  get_batch_trace search_path config: [%]', v_fn_search_path;
    RAISE WARNING '   Expected to contain "search_path=public"';
  END IF;

  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Post-migration manual checks:';
  RAISE NOTICE '';
  RAISE NOTICE '1. Anonymous REST access must return no rows:';
  RAISE NOTICE '   curl "https://<project>.supabase.co/rest/v1/raw_material_lots?select=id&limit=5" \';
  RAISE NOTICE '     -H "apikey: <anon_key>"';
  RAISE NOTICE '   Expected: []';
  RAISE NOTICE '';
  RAISE NOTICE '2. Authenticated app access must still work:';
  RAISE NOTICE '   Log in → Raw Materials → Lots — lot records must be visible.';
  RAISE NOTICE '';
  RAISE NOTICE '3. get_batch_trace must return supplier_name and lot_number:';
  RAISE NOTICE '   SELECT get_batch_trace(''<valid-production-order-uuid>''::uuid);';
  RAISE NOTICE '   Check: result->''materials'' contains lot_number and supplier_name.';
  RAISE NOTICE '';
  RAISE NOTICE '4. List all remaining policies on raw_material_lots:';
  RAISE NOTICE '   SELECT policyname, roles, cmd, qual';
  RAISE NOTICE '   FROM   pg_policies';
  RAISE NOTICE '   WHERE  schemaname = ''public''';
  RAISE NOTICE '     AND  tablename  = ''raw_material_lots'';';
  RAISE NOTICE '   Expected: exactly one row — "rml: all own company".';
  RAISE NOTICE '══════════════════════════════════════════════════════';
END;
$$;
