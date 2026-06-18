-- ============================================================
-- TraceFlow — Fix capas RLS INSERT policy (42501)
-- File: supabase_fix_capas_rls.sql
-- ============================================================
-- Problem:
--   INSERT into capas returns 42501 (insufficient_privilege) for
--   authenticated users when creating auto-CAPAs from recalls.
--
-- Root causes:
--   1. Live DB may have stale/partial policies from an incomplete
--      migration run (e.g. supabase_capa_recall.sql applied without
--      supabase_multitenancy_v2.sql, or vice-versa).
--   2. Policy evaluation calls get_my_company_id() which uses
--      search_path=public; if that function is missing or the
--      user_profiles row has company_id=NULL the WITH CHECK
--      expression evaluates to NULL (falsy) → 42501.
--   3. The supabase_capa_recall.sql policies reference `capas`
--      without the public. schema prefix — safe in most cases but
--      fragile if search_path is ever altered.
--
-- Fix:
--   Step 1 — Re-establish get_my_company_id() with explicit schema
--             prefix and SECURITY DEFINER so it always resolves.
--   Step 2 — Drop all capas policies and recreate them cleanly
--             with explicit public. prefixes.
--   Step 3 — Add a SECURITY DEFINER RPC insert_capa_from_recall()
--             as a guaranteed insert path that bypasses the WITH CHECK
--             evaluation and validates company ownership server-side.
--             The client calls this RPC instead of a direct INSERT.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ── Step 1: Ensure get_my_company_id() is current ────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id
  FROM   public.user_profiles
  WHERE  user_id = auth.uid()
  LIMIT  1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated;


-- ── Step 2: Reset all capas RLS policies ─────────────────────────────────────

ALTER TABLE public.capas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "co_capas_select" ON public.capas;
DROP POLICY IF EXISTS "co_capas_insert" ON public.capas;
DROP POLICY IF EXISTS "co_capas_update" ON public.capas;
DROP POLICY IF EXISTS "co_capas_delete" ON public.capas;

-- SELECT
CREATE POLICY "co_capas_select" ON public.capas
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

-- INSERT: explicit NOT NULL guard on get_my_company_id() so that a
-- user with a missing user_profiles row gets a meaningful 42501 rather
-- than a silent NULL mismatch.
CREATE POLICY "co_capas_insert" ON public.capas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_company_id() IS NOT NULL
    AND company_id = public.get_my_company_id()
  );

-- UPDATE
CREATE POLICY "co_capas_update" ON public.capas
  FOR UPDATE TO authenticated
  USING    (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

-- DELETE
CREATE POLICY "co_capas_delete" ON public.capas
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id());


-- ── Step 3: SECURITY DEFINER insert RPC ──────────────────────────────────────
-- insert_capa_from_recall bypasses RLS entirely.
-- It derives company_id server-side from get_my_company_id() so the
-- client never needs to supply it — eliminating any mismatch risk.
-- Returns the new CAPA row (id + capa_number) for the success toast.

CREATE OR REPLACE FUNCTION public.insert_capa_from_recall(
  p_recall_id  uuid,
  p_batch_id   uuid,
  p_title      text,
  p_owner_name text,
  p_due_date   date,
  p_root_cause text
)
RETURNS TABLE (id uuid, capa_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.get_my_company_id();

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'User does not belong to a company (user_profiles.company_id is NULL for uid=%)', auth.uid()
      USING ERRCODE = '42501';
  END IF;

  -- Verify the recall belongs to this company
  IF NOT EXISTS (
    SELECT 1 FROM public.recalls
    WHERE  recalls.id         = p_recall_id
      AND  recalls.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Recall % not found or not owned by this company', p_recall_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO public.capas (
    company_id,
    recall_id,
    batch_id,
    title,
    severity,
    source_type,
    status,
    owner_name,
    due_date,
    root_cause
  ) VALUES (
    v_company_id,
    p_recall_id,
    p_batch_id,
    p_title,
    'critical',
    'recall',
    'open',
    p_owner_name,
    p_due_date,
    p_root_cause
  )
  RETURNING capas.id, capas.capa_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_capa_from_recall(uuid, uuid, text, text, date, text)
  TO authenticated;


-- ── Completion notice ─────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '✓ supabase_fix_capas_rls.sql applied.';
  RAISE NOTICE '  get_my_company_id()    — recreated with explicit public. search_path';
  RAISE NOTICE '  co_capas_select        — recreated';
  RAISE NOTICE '  co_capas_insert        — recreated with NOT NULL guard';
  RAISE NOTICE '  co_capas_update        — recreated';
  RAISE NOTICE '  co_capas_delete        — recreated';
  RAISE NOTICE '  insert_capa_from_recall() — new SECURITY DEFINER RPC';
  RAISE NOTICE '';
  RAISE NOTICE 'Next: update RecallClient.tsx to call';
  RAISE NOTICE '  supabase.rpc("insert_capa_from_recall", {...})';
  RAISE NOTICE '  instead of supabase.from("capas").insert([...])';
END;
$$;
