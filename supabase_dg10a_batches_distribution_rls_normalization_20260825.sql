-- ============================================================
-- DG-10A: Batches + Distribution RLS Normalization
-- File: supabase_dg10a_batches_distribution_rls_normalization_20260825.sql
-- Created: 2026-08-25
-- Status: EXECUTED AND VERIFIED LIVE (2026-08-25)
-- ============================================================
--
-- PURPOSE
-- -------
-- Live normalization of five out-of-band RLS policies across three tables:
--
--   public.audit_log:
--     DROP the legacy audit_log_select SELECT policy (no replacement).
--
--   public.batches:
--     ALTER batches_insert WITH CHECK — replace stale role allowlist.
--     ALTER batches_update WITH CHECK — replace stale role allowlist AND add
--       company_id tenant guard to close a confirmed cross-tenant UPDATE defect.
--
--   public.distribution_records:
--     ALTER dist_insert WITH CHECK — replace stale role allowlist.
--     ALTER dist_update WITH CHECK — replace stale role allowlist AND add
--       company_id tenant guard to close a confirmed cross-tenant UPDATE defect.
--
-- This file does NOT create any new policy.
-- This file does NOT touch USING expressions on batches_update or dist_update.
-- This file does NOT touch events_select, events_insert, dist_select,
--   batches_select, activity_logs, invitation, or recall policies.
--
-- ── TABLES COVERED ────────────────────────────────────────────────────────────
--
--   public.audit_log               — 1 policy dropped, 0 created
--   public.batches                 — 2 policies altered
--   public.distribution_records    — 2 policies altered
--
-- ── PRE-DG-10A LIVE STATE (verified before execution, 2026-08-25) ─────────────
--
-- ── Authorization drift (stale role allowlists) ─────────────────────────────
--
--   The following five policies were created out-of-band (original date
--   unknown) under a role model that no longer exists in the live database.
--   The live user_profiles.role column exclusively contains values from the
--   current role model: admin, manager, inspector, operations, warehouse,
--   qc_inspector, sales.
--
--   None of the roles auditor, owner, quality_manager, supervisor, or operator
--   appear in any live user_profiles row. As a result, every stale allowlist
--   entry was permanently unreachable — only admin could pass any of the five
--   policies.
--
--   audit_log_select  FOR SELECT
--     Stale allowlist: admin, auditor, owner, quality_manager
--     Current valid matches: admin only
--
--   batches_insert    FOR INSERT
--     Stale allowlist: admin, operator, owner, quality_manager, supervisor
--     Current valid matches: admin only
--
--   batches_update    FOR UPDATE
--     Stale allowlist: admin, owner, quality_manager, supervisor
--     Current valid matches: admin only
--
--   dist_insert       FOR INSERT
--     Stale allowlist: admin, operator, owner, quality_manager, supervisor
--     Current valid matches: admin only
--
--   dist_update       FOR UPDATE
--     Stale allowlist: admin, owner, quality_manager, supervisor
--     Current valid matches: admin only
--
-- ── Cross-tenant UPDATE defects ─────────────────────────────────────────────
--
--   PostgreSQL UPDATE policies evaluate two distinct clauses:
--
--     USING:      applied to the CURRENT (pre-update) row — filters which
--                 rows are visible to the caller for update.
--     WITH CHECK: applied to the PROPOSED (post-update) row — gates whether
--                 the new state of the row is permitted.
--
--   Both batches_update and dist_update had:
--     USING:      company_id = current_org_id()  ← correct tenant filter
--     WITH CHECK: current_user_role() IN (stale roles)  ← role gate only
--
--   The absence of company_id = current_org_id() in WITH CHECK created a
--   cross-tenant data migration vector:
--
--     1. Authenticated user at Company A (company_id = A, role = admin)
--        targets a row with company_id = A — USING passes.
--
--     2. User executes UPDATE ... SET company_id = '<company_B_uuid>'.
--
--     3. WITH CHECK evaluates the PROPOSED row: only checks role — PASSES.
--        company_id = B is never validated against current_org_id() = A.
--
--     4. Row is committed with company_id = B. The row disappears from
--        Company A's view and appears in Company B's data without
--        Company B's knowledge or consent.
--
--   DG-10A adds (company_id = current_org_id()) to WITH CHECK for both
--   batches_update and dist_update. The USING clause is preserved verbatim
--   and unchanged — only WITH CHECK is specified in the ALTER statement.
--
-- ── PRE-DG-10A FULL POLICY INVENTORY (all four tables) ──────────────────────
--
--   Source: pg_policies SELECT verified live before execution (2026-08-25).
--
--   public.audit_log (1 policy):
--     audit_log_select  SELECT  {authenticated}
--       USING: company_id = current_org_id() AND current_user_role()
--              authorization logic  ← stale allowlist; not reproduced verbatim
--       [No INSERT policy]
--
--   public.batch_events (2 policies — unchanged by DG-10A):
--     events_select  SELECT  {authenticated}
--       USING:      (company_id = current_org_id())
--     events_insert  INSERT  {authenticated}
--       WITH CHECK: (company_id = current_org_id())
--
--   public.batches (3 policies):
--     batches_select  SELECT  {authenticated}           ← unchanged
--       USING: (company_id = current_org_id())
--     batches_insert  INSERT  {authenticated}
--       WITH CHECK: stale role allowlist (above)
--     batches_update  UPDATE  {authenticated}
--       USING:      (company_id = current_org_id())     ← preserved verbatim
--       WITH CHECK: stale role allowlist, no company_id guard (cross-tenant defect)
--
--   public.distribution_records (3 policies):
--     dist_select  SELECT  {authenticated}              ← unchanged
--       USING: (company_id = current_org_id())
--     dist_insert  INSERT  {authenticated}
--       WITH CHECK: stale role allowlist (above)
--     dist_update  UPDATE  {authenticated}
--       USING:      (company_id = current_org_id())     ← preserved verbatim
--       WITH CHECK: stale role allowlist, no company_id guard (cross-tenant defect)
--
-- ── AUDIT_LOG_SELECT — INTENTIONAL REMOVAL ──────────────────────────────────
--
--   public.audit_log is a legacy table. It was created in
--   supabase_sfda_tables.sql as an SFDA compliance activity log. The
--   application has since migrated all audit and activity functionality to
--   public.activity_logs.
--
--   Evidence for removal:
--     • Zero .from('audit_log') calls exist in any application file.
--     • The SFDA compliance audit tab (SFDAClient.tsx) reads exclusively from
--       public.activity_logs, not public.audit_log.
--     • NotificationPanel.tsx, dashboard.ts, and app/lib/activity.ts all
--       use public.activity_logs exclusively.
--     • No authenticated application feature requires direct audit_log SELECT.
--
--   DG-10A drops audit_log_select and creates no replacement SELECT policy.
--
--   Effects:
--     • Authenticated Supabase client sessions cannot SELECT from audit_log
--       via any RLS-evaluated path.
--     • service_role bypasses RLS — administrative queries and Supabase
--       platform maintenance retain unconditional read access.
--     • The postgres owner retains unconditional read access.
--     • audit_log TABLE and all existing rows: NOT deleted, NOT altered.
--     • public.activity_logs and all its policies: NOT changed.
--
-- ── FINAL WRITE AUTHORIZATION MODEL ─────────────────────────────────────────
--
--   batches INSERT / UPDATE:     admin, manager, operations
--   distribution_records INSERT / UPDATE:  admin, manager, operations
--
--   Rationale:
--     These roles correspond to the edit:production permission in
--     app/lib/permissions.ts, which governs the production lifecycle.
--     distribution_records represent the downstream output of production
--     (outbound shipments) and shares the same ownership model.
--     sales, warehouse, qc_inspector, and inspector have no write
--     authorization for batch or distribution data.
--
-- ── POLICIES NOT TOUCHED BY DG-10A ──────────────────────────────────────────
--
--   public.batch_events:
--     events_select    — NOT touched
--     events_insert    — NOT touched
--
--   public.distribution_records:
--     dist_select      — NOT touched
--
--   public.batches:
--     batches_select   — NOT touched
--
--   public.activity_logs:
--     "activity_logs: select own company"  — NOT touched
--     "activity_logs: insert own company"  — NOT touched
--
--   public.invitations:
--     inv_select       — NOT touched
--     inv_insert       — NOT touched
--
--   public.recall_affected_batches:
--     co_rab_delete    — NOT touched
--     rab_insert       — NOT touched
--     rab_select       — NOT touched
--
--   All helper functions, triggers, table ACLs, and table DDL:  NOT touched.
--
-- ── POST-DG-10A LIVE STATE (verified after execution, 2026-08-25) ─────────────
--
--   Total policy count across audit_log, batch_events, batches,
--   distribution_records: exactly 8 (was 9 before DROP of audit_log_select).
--
--   public.audit_log:
--     audit_log_select — ABSENT  ✓
--
--   public.batch_events (unchanged):
--     events_select   SELECT  {authenticated}  ✓
--     events_insert   INSERT  {authenticated}  ✓
--
--   public.batches:
--     batches_select  SELECT  {authenticated}  ✓  (unchanged)
--     batches_insert  INSERT  {authenticated}  ✓
--       WITH CHECK: (company_id = current_org_id()) AND
--                   (current_user_role() = ANY (ARRAY['admin'::text,
--                     'manager'::text, 'operations'::text]))
--     batches_update  UPDATE  {authenticated}  ✓
--       USING:      (company_id = current_org_id())  (unchanged)
--       WITH CHECK: (company_id = current_org_id()) AND
--                   (current_user_role() = ANY (ARRAY['admin'::text,
--                     'manager'::text, 'operations'::text]))
--
--   public.distribution_records:
--     dist_select   SELECT  {authenticated}  ✓  (unchanged)
--     dist_insert   INSERT  {authenticated}  ✓
--       WITH CHECK: (company_id = current_org_id()) AND
--                   (current_user_role() = ANY (ARRAY['admin'::text,
--                     'manager'::text, 'operations'::text]))
--     dist_update   UPDATE  {authenticated}  ✓
--       USING:      (company_id = current_org_id())  (unchanged)
--       WITH CHECK: (company_id = current_org_id()) AND
--                   (current_user_role() = ANY (ARRAY['admin'::text,
--                     'manager'::text, 'operations'::text]))
--
--   Post-execution exact-state verification:
--     exact_expected_state = true for all 4 mutated write policies  ✓
--     no_stale_roles       = true for all 4 mutated write policies  ✓
--
-- ── WHAT DG-10A DOES NOT CAPTURE ────────────────────────────────────────────
--
--   This file does NOT contain canonical CREATE POLICY source-of-truth
--   definitions for the eight remaining policies. It records the normalization
--   steps (1 DROP + 4 ALTER) that were applied live. The verbatim USING and
--   WITH CHECK expressions for events_select, events_insert, dist_select, and
--   batches_select are not reproduced here.
--
--   DG-10B (separate file, not yet created) will capture the final hardened
--   state of all eight policies as idempotent DROP POLICY IF EXISTS + CREATE
--   POLICY statements, using verbatim pg_policies output from the
--   post-DG-10A live database.
--
--   DG-10B canonical scope (8 policies):
--
--     public.batch_events:
--       events_select
--       events_insert
--
--     public.batches:
--       batches_select
--       batches_insert      ← post-DG-10A expressions
--       batches_update      ← post-DG-10A expressions (company guard in WITH CHECK)
--
--     public.distribution_records:
--       dist_select
--       dist_insert         ← post-DG-10A expressions
--       dist_update         ← post-DG-10A expressions (company guard in WITH CHECK)
--
--     public.audit_log:
--       zero canonical RLS policies by design (audit_log_select removed by DG-10A)
--
--   DG-10B must NOT recreate audit_log_select.
--
-- ── OUT-OF-BAND DEPENDENCY NOTE ─────────────────────────────────────────────
--
--   public.batches has no CREATE TABLE definition in any repository SQL file.
--   The table exists entirely out-of-band (created directly in the Supabase
--   SQL Editor at an unknown prior date). DG-10B policy recovery for the
--   batches_* policies therefore presupposes that public.batches already exists
--   in the target schema. Full batches DDL capture (CREATE TABLE, indexes,
--   RLS enablement) remains a separate governance task.
--
-- ── EXECUTION AND VERIFICATION ───────────────────────────────────────────────
--
--   Executed live via Supabase Dashboard SQL Editor on 2026-08-25.
--
--   Pre-execution verification (SELECT-only, run before execution):
--
--     SELECT tablename, policyname, cmd, roles, qual, with_check
--     FROM pg_policies
--     WHERE schemaname = 'public'
--       AND (
--            (tablename = 'audit_log'             AND policyname = 'audit_log_select')
--         OR (tablename = 'batches'               AND policyname IN ('batches_insert','batches_update'))
--         OR (tablename = 'distribution_records'  AND policyname IN ('dist_insert','dist_update'))
--       )
--     ORDER BY tablename, policyname;
--
--     Confirmed: 5 rows, stale allowlists present,
--     batches_update and dist_update WITH CHECK lacked company_id guard.
--
--   Post-execution verification (SELECT-only, run after execution):
--
--     SELECT tablename, policyname, cmd, roles,
--            qual AS using_expr, with_check AS with_check_expr
--     FROM pg_policies
--     WHERE schemaname = 'public'
--       AND tablename IN (
--         'audit_log', 'batch_events', 'distribution_records', 'batches'
--       )
--     ORDER BY tablename, policyname;
--
--     Confirmed: exactly 8 rows (0 audit_log + 2 batch_events +
--       3 batches + 3 distribution_records).
--     audit_log_select: ABSENT  ✓
--     All 8 remaining policies: roles = {authenticated}  ✓
--     exact_expected_state = true for all 4 mutated policies  ✓
--     no_stale_roles       = true for all 4 mutated policies  ✓
--
-- ════════════════════════════════════════════════════════════════
-- EXECUTABLE MIGRATION
-- (already applied live — included here as repository record)
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- 1 of 5 — Drop legacy audit_log SELECT policy (no replacement created)
DROP POLICY audit_log_select
  ON public.audit_log;

-- 2 of 5 — batches_insert: normalize role allowlist
ALTER POLICY batches_insert
  ON public.batches
  WITH CHECK (
    (company_id = current_org_id())
    AND (current_user_role() = ANY (
      ARRAY['admin'::text, 'manager'::text, 'operations'::text]
    ))
  );

-- 3 of 5 — batches_update: add tenant guard to WITH CHECK + normalize allowlist
--          USING (company_id = current_org_id()) preserved verbatim
ALTER POLICY batches_update
  ON public.batches
  WITH CHECK (
    (company_id = current_org_id())
    AND (current_user_role() = ANY (
      ARRAY['admin'::text, 'manager'::text, 'operations'::text]
    ))
  );

-- 4 of 5 — dist_insert: normalize role allowlist
ALTER POLICY dist_insert
  ON public.distribution_records
  WITH CHECK (
    (company_id = current_org_id())
    AND (current_user_role() = ANY (
      ARRAY['admin'::text, 'manager'::text, 'operations'::text]
    ))
  );

-- 5 of 5 — dist_update: add tenant guard to WITH CHECK + normalize allowlist
--          USING (company_id = current_org_id()) preserved verbatim
ALTER POLICY dist_update
  ON public.distribution_records
  WITH CHECK (
    (company_id = current_org_id())
    AND (current_user_role() = ANY (
      ARRAY['admin'::text, 'manager'::text, 'operations'::text]
    ))
  );

COMMIT;

-- ════════════════════════════════════════════════════════════════
-- ROLLBACK NOTES
-- ════════════════════════════════════════════════════════════════
--
-- WARNING: Restoring the pre-DG-10A state is NOT recommended in
-- production. The historical state contained:
--   1. Authorization drift (stale roles that no live user can hold)
--   2. Cross-tenant UPDATE defects on batches_update and dist_update
--
-- ── audit_log_select ─────────────────────────────────────────────
--
--   Rollback would require recreating audit_log_select with its
--   original verbatim USING expression. That expression included a
--   current_user_role() authorization component whose exact SQL was not
--   fully captured as a verified verbatim CREATE POLICY definition in
--   any repository file before DG-10A was applied.
--
--   Fabricating the USING expression from prose descriptions would
--   introduce transcription risk. Safe reconstruction requires
--   authoritative historical evidence (e.g., the original pg_policies
--   output row captured before DG-10A was applied).
--
--   Rollback of audit_log_select DROP is NOT documented as a safe
--   executable step. If restoration is required for historical
--   compliance review purposes, use a service_role connection, which
--   bypasses RLS and can read audit_log regardless of policy state.
--
-- ── batches_insert, batches_update, dist_insert, dist_update ─────
--
--   Rollback would restore stale roles (auditor, owner, operator,
--   quality_manager, supervisor) that are dead in the live role model,
--   and would restore the cross-tenant UPDATE defects. This is not safe
--   or useful. Not documented.
--
-- ── activity_logs, batch_events, dist_select, batches_select ─────
--
--   These policies were not modified by DG-10A and do not require
--   rollback consideration.
