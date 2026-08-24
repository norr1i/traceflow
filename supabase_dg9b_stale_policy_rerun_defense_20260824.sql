-- ============================================================
-- DG-9B: Stale Policy Re-Run Defense
-- File: supabase_dg9b_stale_policy_rerun_defense_20260824.sql
-- Created: 2026-08-24
-- Status: EXECUTED AND VERIFIED LIVE (2026-08-24)
-- ============================================================
--
-- PURPOSE
-- -------
-- Defensive migration that:
--   1. Drops six stale historical policy names that supabase_sfda_tables.sql
--      can recreate as implicit TO PUBLIC if re-run without subsequent
--      hardening migrations.
--   2. Re-normalizes both activity_logs RLS policies to TO authenticated,
--      which supabase_activity_logs.sql can regress to TO PUBLIC if re-run
--      alone.
--
-- This file does NOT capture canonical CREATE POLICY definitions for
-- audit_log_select, events_select/insert, or dist_select/insert/update.
-- Canonical capture of those live policy expressions is a future DG-10 task.
--
-- TABLES COVERED
-- --------------
--   public.audit_log              — 2 stale SFDA policy names dropped
--   public.batch_events           — 2 stale SFDA policy names dropped
--   public.distribution_records   — 2 stale SFDA policy names dropped
--   public.activity_logs          — 2 live policies re-normalized TO authenticated
--
-- ── HISTORICAL RE-RUN HAZARDS ────────────────────────────────────────────────
--
-- Hazard 1: supabase_sfda_tables.sql
--
--   This file creates four SFDA compliance tables (audit_log, batch_events,
--   recall_affected_batches, distribution_records) and includes RLS policies
--   using old naming conventions with no TO clause — implicit TO PUBLIC.
--   A warning header was added to supabase_sfda_tables.sql during the
--   hardening programme, but the executable policy bodies remain unchanged
--   to preserve historical integrity.
--
--   The six stale policy names and their re-run impact:
--
--   public.audit_log (supabase_sfda_tables.sql lines 196, 201):
--     "audit_log: select own company"  FOR SELECT  TO PUBLIC (implicit)
--     "audit_log: insert own company"  FOR INSERT  TO PUBLIC (implicit)
--
--     Re-run impact on SELECT:
--       Live policy is named audit_log_select (TO authenticated). The sfda
--       DROP IF EXISTS targets the old name — no-op. The sfda CREATE adds a
--       new TO PUBLIC SELECT policy alongside audit_log_select. PostgreSQL
--       permissive OR semantics: both policies combine with OR, so the
--       TO PUBLIC policy broadens effective SELECT access beyond what
--       audit_log_select restricts.
--
--     Re-run impact on INSERT:
--       No INSERT policy currently exists on audit_log. The sfda CREATE
--       introduces a new TO PUBLIC INSERT policy on a table that otherwise
--       has no direct INSERT RLS policy. This creates an unrestricted
--       authenticated-and-anon (post-DG-8: authenticated only, due to
--       EXECUTE denial for anon) INSERT surface on a table whose write
--       behavior is governed separately (see audit_trigger_fn section below).
--
--   public.batch_events (supabase_sfda_tables.sql lines 228, 233):
--     "batch_events: select own company"  FOR SELECT  TO PUBLIC (implicit)
--     "batch_events: insert own company"  FOR INSERT  TO PUBLIC (implicit)
--
--     Live policies: events_select, events_insert (both TO authenticated,
--     normalized by DG-2 on 2026-08-22). Name mismatch means sfda DROP IF
--     EXISTS is a no-op; sfda CREATE adds new TO PUBLIC policies alongside
--     the live TO authenticated policies. Permissive OR broadens access.
--
--   public.distribution_records (supabase_sfda_tables.sql lines 291, 296):
--     "distribution_records: select own company"  FOR SELECT  TO PUBLIC (implicit)
--     "distribution_records: insert own company"  FOR INSERT  TO PUBLIC (implicit)
--
--     Live policies: dist_select, dist_insert, dist_update (all TO authenticated,
--     normalized by DG-2 on 2026-08-22). Same name-mismatch → DROP no-op →
--     CREATE adds TO PUBLIC alongside TO authenticated. Same permissive OR risk.
--
-- Hazard 2: supabase_activity_logs.sql
--
--   supabase_activity_logs.sql lines 92–99:
--
--     DROP POLICY IF EXISTS "activity_logs: select own company" ON public.activity_logs;
--     CREATE POLICY "activity_logs: select own company"
--       ON public.activity_logs FOR SELECT
--       USING (company_id = get_my_company_id());   -- no TO clause
--
--     DROP POLICY IF EXISTS "activity_logs: insert own company" ON public.activity_logs;
--     CREATE POLICY "activity_logs: insert own company"
--       ON public.activity_logs FOR INSERT
--       WITH CHECK (company_id = get_my_company_id());   -- no TO clause
--
--   Unlike the sfda stale names, these SAME policy names are the current
--   valid live policies. Re-running supabase_activity_logs.sql therefore:
--     1. DROPs the current valid TO authenticated policy
--     2. RECREATEs it as implicit TO PUBLIC
--   This directly reverses the hardening applied by
--   supabase_activity_audit_log_hardening_20260822.sql. The correct defense
--   is ALTER POLICY ... TO authenticated (NOT DROP), which normalizes the
--   role scope without touching the policy expressions.
--
-- ── DEFENSE STRATEGY — WHY TWO DIFFERENT APPROACHES ─────────────────────────
--
--   DROP POLICY IF EXISTS (used for the six stale SFDA names):
--     The old policy names ("audit_log: select own company", etc.) must NOT
--     exist in the final canonical state. They have no live equivalent and
--     no legitimate use case. When created by sfda re-run, they are entirely
--     spurious. Dropping them by name is the correct and complete action.
--
--   ALTER POLICY ... TO authenticated (used for activity_logs):
--     The policy names "activity_logs: select own company" and
--     "activity_logs: insert own company" ARE the current valid live policies.
--     Dropping them would delete the legitimate policies. ALTER POLICY changes
--     only the roles list while preserving command, permissive mode, and all
--     USING/WITH CHECK expressions verbatim.
--
-- ── PRE-DG-9B LIVE STATE (verified 2026-08-24 before execution) ─────────────
--
--   Six stale SFDA policy names: all ABSENT live (confirmed).
--     The sfda re-run hazard had not materialized; DG-9B closes it defensively.
--
--   activity_logs policies: already TO authenticated (confirmed).
--     supabase_activity_audit_log_hardening_20260822.sql had previously
--     applied the ALTER on 2026-08-22. DG-9B re-applies them idempotently.
--
--   Full verified live policy matrix across the four tables:
--
--     public.activity_logs:
--       "activity_logs: insert own company"  INSERT  {authenticated}
--       "activity_logs: select own company"  SELECT  {authenticated}
--
--     public.audit_log:
--       audit_log_select  SELECT  {authenticated}
--
--     public.batch_events:
--       events_insert  INSERT  {authenticated}
--       events_select  SELECT  {authenticated}
--
--     public.distribution_records:
--       dist_insert  INSERT  {authenticated}
--       dist_select  SELECT  {authenticated}
--       dist_update  UPDATE  {authenticated}
--
-- ── POST-DG-9B LIVE STATE (verified 2026-08-24 after execution) ──────────────
--
--   Six stale SFDA names: ABSENT (DROP IF EXISTS were no-ops; confirmed absent).
--   activity_logs policies: TO authenticated (ALTER was idempotent; confirmed).
--   All other policies across the four tables: unchanged.
--
-- ── IDEMPOTENCY AND REPLAY SCENARIOS ─────────────────────────────────────────
--
--   DG-9B is idempotent with respect to the current live state:
--
--   Scenario A — supabase_sfda_tables.sql re-run, then DG-9B:
--     sfda creates six TO PUBLIC stale policies. DG-9B DROPs all six.
--     Final state: only hardened live policies remain.  ✓
--
--   Scenario B — supabase_activity_logs.sql re-run, then DG-9B:
--     activity_logs.sql DROPs then RECREATEs both policies as TO PUBLIC.
--     DG-9B ALTERs both back to TO authenticated.
--     Final state: activity_logs policies restored to correct scope.  ✓
--
--   Scenario C — both historical files re-run, then DG-9B:
--     Both hazards materialize. DG-9B resolves both.
--     Final state: fully hardened policy surface restored.  ✓
--
--   Scenario D — DG-9B run on current live database (no prior re-runs):
--     All 8 statements are no-ops. No pg_policies change.  ✓
--
-- ── IMPORTANT LIMITATION ─────────────────────────────────────────────────────
--
--   A committed DG-9B file does NOT automatically protect the live database.
--   If supabase_sfda_tables.sql or supabase_activity_logs.sql is manually
--   re-run, the hazards materialize immediately. DG-9B must be explicitly
--   applied AFTER those historical files during any recovery operation.
--
--   Recovery order after supabase_sfda_tables.sql:
--     1. supabase_rls_policy_role_normalization_20260822.sql  (DG-2)
--     2. supabase_dg3_recall_rls_normalization_20260822.sql  (DG-3)
--     3. supabase_activity_audit_log_hardening_20260822.sql
--     4. supabase_dg9b_stale_policy_rerun_defense_20260824.sql  ← THIS FILE
--
--   Recovery order after supabase_activity_logs.sql:
--     1. supabase_dg9b_stale_policy_rerun_defense_20260824.sql  ← THIS FILE
--
--   The historical files themselves remain unsafe to run standalone.
--
-- ── AUDIT_LOG INSERT POLICY — FINAL STATE ────────────────────────────────────
--
--   The final hardened live state contains NO direct RLS INSERT policy on
--   public.audit_log. DG-9B does not introduce a replacement INSERT policy.
--
--   Note on audit_trigger_fn: audit_log table write behavior in relation to
--   audit_trigger_fn (a SECURITY DEFINER audit function identified during
--   prior governance work) is a separate future governance scope that has not
--   been fully audited. This file makes no claims about whether write paths
--   to audit_log exist via triggers or SECURITY DEFINER functions. That
--   analysis is deferred to a dedicated future task.
--
-- ── WHAT DG-9B DOES NOT CAPTURE ─────────────────────────────────────────────
--
--   DG-9B does NOT capture canonical CREATE POLICY definitions for:
--     audit_log_select, events_select, events_insert,
--     dist_select, dist_insert, dist_update.
--
--   These live policies exist out-of-band. Their verbatim USING/WITH CHECK
--   expressions have not been fully captured in any repository file. Canonical
--   source-of-truth capture for these policies is deferred to DG-10.
--
-- ── EXECUTION AND VERIFICATION ───────────────────────────────────────────────
--
--   Executed live via Supabase Dashboard SQL Editor on 2026-08-24.
--
--   Post-execution verification (SELECT-only):
--
--     SELECT tablename, policyname, cmd, roles
--     FROM pg_policies
--     WHERE schemaname = 'public'
--       AND tablename IN (
--         'audit_log','batch_events',
--         'distribution_records','activity_logs'
--       )
--     ORDER BY tablename, policyname;
--
--   Expected: exactly 8 rows, all roles = {authenticated}.
--   Confirmed: 8 rows returned, all {authenticated}.  ✓
--
--   Stale names confirmed absent:
--     "audit_log: select own company"          — ABSENT  ✓
--     "audit_log: insert own company"          — ABSENT  ✓
--     "batch_events: select own company"       — ABSENT  ✓
--     "batch_events: insert own company"       — ABSENT  ✓
--     "distribution_records: select own company" — ABSENT  ✓
--     "distribution_records: insert own company" — ABSENT  ✓
--
-- ════════════════════════════════════════════════════════════════
-- EXECUTABLE MIGRATION
-- (idempotent — DROP IF EXISTS on absent policies is a no-op;
--  ALTER POLICY to the same role is a no-op)
-- ════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS "audit_log: select own company"
  ON public.audit_log;

DROP POLICY IF EXISTS "audit_log: insert own company"
  ON public.audit_log;

DROP POLICY IF EXISTS "batch_events: select own company"
  ON public.batch_events;

DROP POLICY IF EXISTS "batch_events: insert own company"
  ON public.batch_events;

DROP POLICY IF EXISTS "distribution_records: select own company"
  ON public.distribution_records;

DROP POLICY IF EXISTS "distribution_records: insert own company"
  ON public.distribution_records;

ALTER POLICY "activity_logs: select own company"
  ON public.activity_logs
  TO authenticated;

ALTER POLICY "activity_logs: insert own company"
  ON public.activity_logs
  TO authenticated;

COMMIT;

-- ════════════════════════════════════════════════════════════════
-- ROLLBACK
-- WARNING: Restoring the pre-DG-9B state is NOT recommended in
-- production. The historical state included stale TO PUBLIC hazards
-- and is intentionally superseded by this migration.
-- ════════════════════════════════════════════════════════════════
--
-- For the six stale SFDA policy names:
--   Their pre-DG-9B state was ABSENT live (the hazard had not
--   materialized). Recreating them from scratch would require
--   canonical USING/WITH CHECK expressions that cannot be safely
--   reconstructed from verified evidence without running
--   supabase_sfda_tables.sql, which carries its own re-run hazards.
--   Rollback of the DROP IF EXISTS statements is therefore NOT
--   documented as a safe executable step. If recovery is needed,
--   consult the sfda_tables warning header and apply the full
--   recovery sequence.
--
-- For the two activity_logs policies, rollback to the insecure
-- historical state (TO PUBLIC) is documented below for completeness
-- only. DO NOT apply this in a production environment:
--
-- -- Restores insecure historical (TO PUBLIC) state — NOT recommended:
-- ALTER POLICY "activity_logs: select own company"
--   ON public.activity_logs
--   TO PUBLIC;
--
-- ALTER POLICY "activity_logs: insert own company"
--   ON public.activity_logs
--   TO PUBLIC;
