-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- PRIVILEGE / RLS RECOVERY WARNING — READ BEFORE RUNNING
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
--
-- This file is NOT superseded. The CREATE TABLE definitions and indexes
-- for audit_log, batch_events, recall_affected_batches, and
-- distribution_records remain the schema baseline. Do NOT discard this file.
--
-- HOWEVER: this file is NOT SAFE TO RE-RUN STANDALONE. Its historical RLS
-- sections do NOT match the current live policy model. Re-running will create
-- overlapping TO PUBLIC policies that conflict with or bypass the live
-- hardened policies. After any recovery use of this file, the hardening
-- migrations listed below MUST be applied immediately.
--
-- The "Idempotent: safe to run multiple times" claim below does NOT account
-- for the post-2026-08-22 hardening programme and is NO LONGER ACCURATE as a
-- standalone recovery instruction.
--
-- ── AFFECTED TABLES ──────────────────────────────────────────────────────────
--
-- public.audit_log
--
--   Live authoritative policy after hardening (2026-08-22):
--     audit_log_select   roles = {authenticated}   FOR SELECT
--       (out-of-band policy; USING preserved)
--     [No INSERT policy exists live]
--
--   This file creates (lines 35–43):
--     "audit_log: select own company"   FOR SELECT   TO PUBLIC (implicit)
--       USING (company_id = get_my_company_id())
--     "audit_log: insert own company"   FOR INSERT   TO PUBLIC (implicit)
--       WITH CHECK (company_id = get_my_company_id())
--
--   Re-run impact:
--     DROP IF EXISTS "audit_log: select own company" — NO-OP (live policy
--       is named audit_log_select; name mismatch means DROP never fires)
--     CREATE "audit_log: select own company" — CREATES a new TO PUBLIC SELECT
--       policy alongside the live audit_log_select. PostgreSQL permissive OR
--       semantics: authenticated users can SELECT via the new company-only
--       policy, bypassing audit_log_select's role restriction entirely.
--     DROP IF EXISTS "audit_log: insert own company" — NO-OP (no live INSERT
--       policy exists)
--     CREATE "audit_log: insert own company" — CREATES a new TO PUBLIC INSERT
--       policy that does not currently exist. Any authenticated company member
--       would be able to INSERT into audit_log.
--     anon REVOKE: DURABLE — this file has no GRANT, so anon remains revoked.
--
--   Required recovery step after running this file:
--     supabase_activity_audit_log_hardening_20260822.sql
--     (re-applies REVOKE and normalizes policy roles to TO authenticated)
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- public.batch_events
--
--   Live authoritative policies after DG-2 (2026-08-22):
--     events_select   roles = {authenticated}   FOR SELECT
--     events_insert   roles = {authenticated}   FOR INSERT
--
--   This file creates (lines 67–75):
--     "batch_events: select own company"   FOR SELECT   TO PUBLIC (implicit)
--     "batch_events: insert own company"   FOR INSERT   TO PUBLIC (implicit)
--
--   Re-run impact:
--     The live policies are named events_select / events_insert. The DROP IF
--     EXISTS targets the old names — NO-OP. CREATE adds new TO PUBLIC policies
--     alongside the live TO authenticated policies. Permissive OR broadens
--     access back toward TO PUBLIC for authenticated users.
--
--   Required recovery step:
--     supabase_rls_policy_role_normalization_20260822.sql  (DG-2)
--     PLUS a dedicated cleanup migration to DROP the old-named stale policies.
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- public.distribution_records
--
--   Live authoritative policies after DG-2 (2026-08-22):
--     dist_select   roles = {authenticated}   FOR SELECT
--     dist_insert   roles = {authenticated}   FOR INSERT
--     (dist_update also exists, out-of-band, normalized by DG-2)
--
--   This file creates (lines 130–138):
--     "distribution_records: select own company"   FOR SELECT   TO PUBLIC (implicit)
--     "distribution_records: insert own company"   FOR INSERT   TO PUBLIC (implicit)
--
--   Re-run impact:
--     Same pattern as batch_events: old names → DROP is NO-OP; CREATE adds
--     new TO PUBLIC policies alongside live TO authenticated policies.
--     Permissive OR broadens access.
--
--   Required recovery step:
--     supabase_rls_policy_role_normalization_20260822.sql  (DG-2)
--     PLUS a dedicated cleanup migration to DROP the old-named stale policies.
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- public.recall_affected_batches
--
--   Live authoritative policy state after DG-3 (2026-08-22):
--     rab_select    roles = {authenticated}   FOR SELECT
--                   USING (company_id = current_org_id())
--     rab_insert    roles = {authenticated}   FOR INSERT
--                   WITH CHECK ((company_id = current_org_id()) AND
--                               (current_user_role() = ANY (
--                                 ARRAY['admin'::text, 'manager'::text])))
--     co_rab_delete roles = {authenticated}   FOR DELETE   (retained by DG-3)
--
--   This file creates (lines 97–110):
--     "recall_affected_batches: select own company"   FOR SELECT   TO PUBLIC
--     "recall_affected_batches: insert own company"   FOR INSERT   TO PUBLIC
--     "recall_affected_batches: update own company"   FOR UPDATE   TO PUBLIC
--     All USING/WITH CHECK: company_id = get_my_company_id() only (no role
--     restriction).
--
--   Re-run impact:
--     DROP IF EXISTS for the three old names — NO-OP (live policies are
--     rab_select, rab_insert, co_rab_delete; name mismatch). CREATE adds
--     three new TO PUBLIC policies. Permissive OR means:
--       SELECT: any authenticated company member can SELECT (bypasses
--               rab_select's role normalization via OR)
--       INSERT: any authenticated company member can INSERT (bypasses
--               rab_insert's admin/manager role restriction entirely — the
--               DG-3 security fix is reversed for INSERT)
--       UPDATE: a new TO PUBLIC UPDATE policy appears (no current UPDATE policy
--               exists in the live database)
--     anon REVOKE: DURABLE — this file has no GRANT.
--
--   Required recovery steps:
--     supabase_recall_affected_batches.sql  (v6 — for table structure)
--     supabase_dg3_recall_rls_normalization_20260822.sql  (DG-3 — must run
--       immediately after to restore the admin/manager role restriction)
--     NOTE: the old sfda-era policy names created by re-running this file
--       ("recall_affected_batches: select/insert/update own company") are NOT
--       dropped by DG-3. A separate cleanup migration is needed to remove them.
--
-- ── HARDENING MIGRATION REFERENCE ────────────────────────────────────────────
--
--   After using this file for schema recovery, apply ALL of the following
--   in order:
--
--   1. supabase_rls_policy_role_normalization_20260822.sql  (DG-2)
--      Normalizes batch_events and distribution_records TO authenticated.
--
--   2. supabase_dg3_recall_rls_normalization_20260822.sql  (DG-3)
--      Restores rab_insert admin/manager role restriction on
--      recall_affected_batches.
--
--   3. supabase_activity_audit_log_hardening_20260822.sql
--      Restores audit_log_select TO authenticated.
--
--   Cleanup of the old-named TO PUBLIC policies created by this file is a
--   separate dedicated migration not yet written. Those policies are safe to
--   leave temporarily because the live TO authenticated policies take
--   precedence via permissive OR only in one direction — they cannot make
--   access MORE restrictive than the TO PUBLIC policies allow. The cleanup
--   migration removes the TO PUBLIC surface entirely.
--
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

-- ============================================================
-- TraceFlow — SFDA Compliance Tables
--
-- Creates: audit_log, batch_events, recall_affected_batches,
--          distribution_records
--
-- RLS : company-scoped via get_my_company_id()
-- Idempotent: safe to run multiple times.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

-- ── audit_log ─────────────────────────────────────────────────
-- Immutable record of user-driven system events (edits, QC
-- actions, recalls, deletions).  Written by the app on each
-- significant action; never updated or deleted.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor      text        NOT NULL,
  role       text,
  action     text        NOT NULL,
  entity     text,
  type       text        NOT NULL DEFAULT 'edit'
               CHECK (type IN ('edit', 'qc', 'delete', 'recall', 'create')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_company_created
  ON public.audit_log (company_id, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log: select own company" ON public.audit_log;
CREATE POLICY "audit_log: select own company"
  ON public.audit_log FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "audit_log: insert own company" ON public.audit_log;
CREATE POLICY "audit_log: insert own company"
  ON public.audit_log FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

-- No UPDATE / DELETE — audit_log rows are immutable.

-- ── batch_events ───────────────────────────────────────────────
-- Lifecycle events attached to a batch: shipments, recalls,
-- QC outcomes, simulation steps.
CREATE TABLE IF NOT EXISTS public.batch_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_id    text        NOT NULL,
  event_type  text        NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS batch_events_company_batch
  ON public.batch_events (company_id, batch_id);

CREATE INDEX IF NOT EXISTS batch_events_company_created
  ON public.batch_events (company_id, created_at DESC);

ALTER TABLE public.batch_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "batch_events: select own company" ON public.batch_events;
CREATE POLICY "batch_events: select own company"
  ON public.batch_events FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "batch_events: insert own company" ON public.batch_events;
CREATE POLICY "batch_events: insert own company"
  ON public.batch_events FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

-- ── recall_affected_batches ───────────────────────────────────
-- Active and historical recall events scoped to a batch.
-- status: 'active' = live recall, 'resolved' = closed,
--         'simulation' = drill run (excluded from live metrics).
CREATE TABLE IF NOT EXISTS public.recall_affected_batches (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_id           text        NOT NULL,
  recall_reason      text,
  status             text        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'resolved', 'simulation')),
  customers_affected int         NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recall_affected_company_status
  ON public.recall_affected_batches (company_id, status);

ALTER TABLE public.recall_affected_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recall_affected_batches: select own company" ON public.recall_affected_batches;
CREATE POLICY "recall_affected_batches: select own company"
  ON public.recall_affected_batches FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "recall_affected_batches: insert own company" ON public.recall_affected_batches;
CREATE POLICY "recall_affected_batches: insert own company"
  ON public.recall_affected_batches FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "recall_affected_batches: update own company" ON public.recall_affected_batches;
CREATE POLICY "recall_affected_batches: update own company"
  ON public.recall_affected_batches FOR UPDATE
  USING (company_id = get_my_company_id());

-- ── distribution_records ───────────────────────────────────────
-- Outbound shipments: one row per batch × recipient.
-- Used to compute "downstream recipients" in recall readiness.
CREATE TABLE IF NOT EXISTS public.distribution_records (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_id    text        NOT NULL,
  recipient   text,
  quantity    int,
  shipped_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS distribution_records_company_batch
  ON public.distribution_records (company_id, batch_id);

ALTER TABLE public.distribution_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "distribution_records: select own company" ON public.distribution_records;
CREATE POLICY "distribution_records: select own company"
  ON public.distribution_records FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "distribution_records: insert own company" ON public.distribution_records;
CREATE POLICY "distribution_records: insert own company"
  ON public.distribution_records FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

DO $$
BEGIN
  RAISE NOTICE 'SFDA tables created/verified: audit_log, batch_events, recall_affected_batches, distribution_records';
END $$;
