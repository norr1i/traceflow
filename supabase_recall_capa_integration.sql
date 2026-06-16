-- ============================================================
-- TraceFlow — Recall ↔ CAPA Integration
-- File: supabase_recall_capa_integration.sql
-- ============================================================
--
-- Prereqs:
--   supabase_capa_recall.sql applied (recalls + capas tables)
--   supabase_capa_v2.sql applied     (capas.source_type column)
--
-- This migration adds:
--   1. Index capas(company_id, recall_id) for fast recall→CAPA lookups
--   2. get_recall_open_capa_count(uuid, uuid) helper RPC
--
-- The auto-CAPA creation is handled client-side in useRecalls.ts
-- (createRecall), not via a DB trigger, so this SQL is intentionally
-- minimal and focuses on read-path performance.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

-- ── 1. Performance index: CAPAs keyed by recall ─────────────────────────────

CREATE INDEX IF NOT EXISTS capas_recall_id
  ON public.capas (company_id, recall_id)
  WHERE recall_id IS NOT NULL;

-- ── 2. get_recall_open_capa_count ────────────────────────────────────────────
-- Returns the count of non-closed CAPAs linked to a specific recall.
-- Used by the Recall Registry to show the open CAPA badge.

CREATE OR REPLACE FUNCTION public.get_recall_open_capa_count(
  p_company_id uuid,
  p_recall_id  uuid
)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM   capas
  WHERE  company_id = p_company_id
    AND  recall_id  = p_recall_id
    AND  status    <> 'closed';
$$;

GRANT EXECUTE ON FUNCTION public.get_recall_open_capa_count(uuid, uuid) TO authenticated;

-- ── Completion notice ─────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '✓ supabase_recall_capa_integration.sql applied.';
  RAISE NOTICE '  Index: capas_recall_id (company_id, recall_id) WHERE recall_id IS NOT NULL';
  RAISE NOTICE '  RPC:   get_recall_open_capa_count(uuid, uuid)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Deploy supabase_recall_capa_integration.sql (this file)';
  RAISE NOTICE '  2. Ensure supabase_capa_v2.sql was applied (capas.source_type must exist)';
  RAISE NOTICE '  3. Create a new recall via /recall — a CAPA is auto-generated';
END;
$$;
