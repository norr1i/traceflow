-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- PRIVILEGE REGRESSION WARNING — READ BEFORE RUNNING
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
--
-- This file is NOT superseded. Its CREATE TABLE, index, and column
-- definitions remain current and valid for schema recovery. Do NOT discard
-- this file.
--
-- HOWEVER: the RLS section (lines ~33–43) is STALE relative to the live
-- hardened policy state established by:
--   supabase_activity_audit_log_hardening_20260822.sql
--
-- WHAT HAPPENS WHEN THIS FILE IS RE-RUN AFTER THAT HARDENING:
--
--   The RLS section uses DROP POLICY IF EXISTS + CREATE POLICY (not ALTER).
--   The live policy names match the names in this file exactly. Therefore:
--
--     DROP POLICY IF EXISTS "activity_logs: select own company"
--       → FIRES — drops the hardened TO authenticated SELECT policy
--     CREATE POLICY "activity_logs: select own company" ... (no TO clause)
--       → RECREATES as TO PUBLIC (PostgreSQL default when no TO is supplied)
--       → Directly reverses the policy-role normalization from TO authenticated
--         back to TO PUBLIC
--
--     DROP POLICY IF EXISTS "activity_logs: insert own company"
--       → FIRES — drops the hardened TO authenticated INSERT policy
--     CREATE POLICY "activity_logs: insert own company" ... (no TO clause)
--       → RECREATES as TO PUBLIC
--       → Same regression on the INSERT path
--
-- WHAT IS NOT REVERSED:
--
--   The anon table-level REVOKE applied by the hardening file is DURABLE.
--   This file contains no GRANT statement. Re-running does NOT restore anon
--   table-level privileges. The practical data exposure for anon remains zero.
--   However, the policy-role designation reverts to TO PUBLIC, which violates
--   the least-privilege model established by the hardening programme.
--
-- REQUIRED RECOVERY SEQUENCE:
--
--   If this file is run as part of schema recovery, you MUST immediately
--   also run:
--     supabase_activity_audit_log_hardening_20260822.sql
--
--   That file re-applies REVOKE ALL FROM anon and ALTERs both policies back
--   to TO authenticated, restoring the hardened state. Failure to run it
--   leaves both activity_logs policies as TO PUBLIC.
--
-- NOTE ON THE "IDEMPOTENT" CLAIM BELOW:
--   The original file header states "Idempotent: safe to run multiple times."
--   That claim is NO LONGER CORRECT as a complete standalone recovery
--   instruction after the hardening applied on 2026-08-22. Re-running this
--   file alone produces a different policy-role state than the current live
--   database. Run the hardening file immediately after.
--
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

-- ============================================================
-- TraceFlow — Activity Logs Table
-- ============================================================
-- Records important user actions inside each company.
-- RLS ensures company isolation: users only ever see their
-- own company's activity.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
--
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ── Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_user_id uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email   text,
  action_type   text        NOT NULL,
  entity_type   text        NOT NULL,
  entity_id     text,
  message       text        NOT NULL,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Index ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS activity_logs_company_created
  ON public.activity_logs (company_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_logs: select own company" ON public.activity_logs;
CREATE POLICY "activity_logs: select own company"
  ON public.activity_logs FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "activity_logs: insert own company" ON public.activity_logs;
CREATE POLICY "activity_logs: insert own company"
  ON public.activity_logs FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

-- No UPDATE or DELETE — activity logs are immutable.

DO $$
BEGIN
  RAISE NOTICE 'activity_logs table and RLS policies applied successfully.';
END $$;
