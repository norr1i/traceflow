-- ============================================================
-- DG-10B: Core Trace Canonical Policy Recovery
-- File: supabase_dg10b_core_trace_canonical_policy_20260825.sql
-- Created: 2026-08-25
-- Status: REPOSITORY / RECOVERY ONLY — NOT EXECUTED LIVE
-- ============================================================
--
-- PURPOSE
-- -------
-- Canonical CREATE POLICY source-of-truth for the eight hardened RLS
-- policies governing the core traceability and distribution tables:
--
--   public.batch_events          — 2 policies (SELECT, INSERT)
--   public.distribution_records  — 3 policies (SELECT, INSERT, UPDATE)
--   public.batches               — 3 policies (SELECT, INSERT, UPDATE)
--
-- DG-10B was NOT executed live. The live database already reflects these
-- exact definitions following successful execution and verification of
-- DG-10A on 2026-08-25. DG-10B is the idempotent DROP IF EXISTS + CREATE
-- recovery source that allows these eight policies to be deterministically
-- rebuilt from scratch, independently of any prior live policy state.
--
-- ── RELATIONSHIP TO DG-10A ───────────────────────────────────────────────────
--
--   DG-10A (supabase_dg10a_batches_distribution_rls_normalization_20260825.sql)
--   was the live normalization step applied on 2026-08-25. It:
--
--     1. Dropped public.audit_log.audit_log_select (no replacement created).
--     2. ALTERed batches_insert WITH CHECK — replaced stale role allowlist
--        with admin, manager, operations.
--     3. ALTERed batches_update WITH CHECK — replaced stale role allowlist
--        AND added company_id = current_org_id() to close the confirmed
--        cross-tenant UPDATE defect.
--     4. ALTERed dist_insert WITH CHECK — replaced stale role allowlist
--        with admin, manager, operations.
--     5. ALTERed dist_update WITH CHECK — replaced stale role allowlist
--        AND added company_id = current_org_id() to close the confirmed
--        cross-tenant UPDATE defect.
--
--   DG-10B captures that corrected post-DG-10A state as canonical DROP +
--   CREATE definitions. DG-10B does not perform another live normalization
--   pass; the live state is already correct.
--
-- ── public.audit_log — ZERO CANONICAL RLS POLICIES ──────────────────────────
--
--   public.audit_log has zero canonical RLS policies after DG-10A.
--   This is intentional.
--
--   audit_log is a legacy SFDA compliance table superseded by
--   public.activity_logs for all current application audit and activity
--   functionality. No application code reads from or writes to audit_log
--   via authenticated direct-table access. service_role and the postgres
--   owner retain unconditional access independent of RLS.
--
--   DG-10B MUST NOT recreate:
--     • audit_log_select (dropped by DG-10A)
--     • any audit_log INSERT policy
--     • any historical "audit_log: * own company" policy
--     • any other audit_log RLS policy
--
-- ── STALE ROLES — ABSENT FROM CANONICAL SQL ──────────────────────────────────
--
--   The following role values appear in NO executable statement in DG-10B.
--   They were present in pre-DG-10A policies and have been permanently
--   retired:
--
--     owner          — not a current valid role
--     operator       — not a current valid role
--     supervisor     — not a current valid role
--     quality_manager — not a current valid role
--     auditor        — not a current valid role
--
-- ── CANONICAL WRITE AUTHORIZATION MODEL ──────────────────────────────────────
--
--   Batch and distribution write access is scoped to the production lifecycle
--   ownership roles:
--
--     admin       ✓
--     manager     ✓
--     operations  ✓
--
--   Excluded:
--     sales        ✗  (no production/traceability write permission)
--     warehouse    ✗  (raw materials only; no production/SFDA permission)
--     qc_inspector ✗  (quality inspections only; no batch/distribution write)
--     inspector    ✗  (legacy alias for qc_inspector; same exclusion)
--
--   Source: edit:production permission in app/lib/permissions.ts, which maps
--   to admin, manager, and operations. Distribution records represent the
--   downstream output of production and share the same ownership model.
--
-- ── TENANT ISOLATION — UPDATE POLICIES ───────────────────────────────────────
--
--   Both UPDATE policies (batches_update, dist_update) enforce company_id
--   tenant scoping in TWO independent clauses:
--
--     USING      — evaluated against the CURRENT (pre-update) row.
--                  Ensures only rows owned by the caller's tenant are visible
--                  and eligible for update.
--
--     WITH CHECK — evaluated against the PROPOSED (post-update) row.
--                  Ensures the new row state also belongs to the caller's
--                  tenant. Prevents moving an existing row into another
--                  tenant by setting company_id to a foreign value.
--
--   Both clauses require company_id = current_org_id(). A caller cannot
--   satisfy USING for a row in their own tenant and then set company_id to
--   another tenant's value — WITH CHECK will reject the proposed new state.
--
-- ── IDEMPOTENCY ──────────────────────────────────────────────────────────────
--
--   Every policy block uses DROP POLICY IF EXISTS followed by CREATE POLICY.
--   This pattern:
--
--     • Is a no-op if the policy does not currently exist (IF EXISTS).
--     • Replaces the policy unconditionally if it does exist.
--     • Does not depend on the prior role assignment or expression state.
--     • Can be applied to recover from any policy state — including missing
--       policies, incorrect expressions, or wrong role assignments.
--
--   This is the key advantage over the ALTER-only approach in DG-2:
--   ALTER POLICY requires the policy to already exist under the correct name.
--   DG-10B is unconditionally correct regardless of prior live state.
--
-- ── RELATIONSHIP TO HISTORICAL MIGRATIONS ────────────────────────────────────
--
--   DG-10B supersedes the policy-recovery role of ALTER-only migrations for
--   these eight policies. Specifically:
--
--   supabase_rls_policy_role_normalization_20260822.sql (DG-2):
--     Contains 8 ALTER POLICY statements that require the target policies to
--     already exist by their current names. DG-2 cannot recreate a missing
--     policy — it can only change the roles list on an existing one. DG-10B
--     provides the unconditional recovery that DG-2 cannot.
--
--   supabase_sfda_tables.sql:
--     Contains CREATE TABLE definitions for batch_events and
--     distribution_records. Its policy definitions are STALE — they use old
--     naming conventions ("batch_events: select own company" etc.) with
--     implicit TO PUBLIC. They must NOT be treated as the canonical policy
--     source. DG-10B is the authoritative source for the final hardened
--     policy definitions on these tables.
--
--   supabase_dg9b_stale_policy_rerun_defense_20260824.sql (DG-9B):
--     Responsible for stale historical policy-name cleanup after unsafe
--     re-runs of supabase_sfda_tables.sql or supabase_activity_logs.sql.
--     DG-9B and DG-10B have distinct, non-overlapping responsibilities:
--
--       DG-9B  → DROP stale names that re-run of historical files may
--                 recreate; ALTER activity_logs policies after re-run reverts
--                 them to TO PUBLIC.
--
--       DG-10B → DROP IF EXISTS + CREATE the final canonical policies for
--                 batch_events, distribution_records, and batches with
--                 correct expressions and correct role assignments.
--
--     Do not conflate their responsibilities.
--
-- ── OUT-OF-BAND DEPENDENCY: public.batches ───────────────────────────────────
--
--   public.batches has NO CREATE TABLE definition in any repository SQL file.
--   The table exists entirely out-of-band — created directly in the Supabase
--   SQL Editor or dashboard at an unknown prior date.
--
--   Consequence: DG-10B assumes public.batches already exists. Applying
--   DG-10B against a blank schema without public.batches will fail at the
--   batches_select, batches_insert, and batches_update blocks.
--
--   Full public.batches schema/DDL capture (CREATE TABLE, column definitions,
--   constraints, indexes, RLS enablement) remains a separate future
--   governance task. DG-10B does not and cannot substitute for it.
--
--   public.batch_events and public.distribution_records have historical CREATE
--   TABLE definitions in supabase_sfda_tables.sql. Their table structure is
--   reproducible from that file. Their policy definitions from that file are
--   stale and superseded by DG-10B.
--
-- ── RECOVERY SEQUENCE NOTE ───────────────────────────────────────────────────
--
--   In a full schema recovery after supabase_sfda_tables.sql re-run, the
--   correct application order is:
--
--     1. supabase_activity_audit_log_hardening_20260822.sql
--          Revokes anon ACLs; normalizes audit_log_select and activity_logs
--          policies.
--     2. supabase_dg9b_stale_policy_rerun_defense_20260824.sql
--          Drops stale SFDA policy names; re-normalizes activity_logs.
--     3. supabase_dg10a_batches_distribution_rls_normalization_20260825.sql
--          Drops audit_log_select; normalizes drifted write policies.
--     4. supabase_dg10b_core_trace_canonical_policy_20260825.sql  ← THIS FILE
--          Recreates the eight hardened policies in their canonical form.
--
--   Applying DG-10B after DG-10A is safe and idempotent: the DROP IF EXISTS
--   steps remove the current live policies and CREATE rebuilds them from the
--   canonical definitions in this file. Net result is identical to the
--   pre-DG-10B live state.
--
-- ── WHAT DG-10B DOES NOT INCLUDE ─────────────────────────────────────────────
--
--   • GRANT / REVOKE — no ACL changes
--   • ALTER POLICY   — all statements are DROP IF EXISTS + CREATE
--   • ALTER TABLE    — no table DDL
--   • CREATE TABLE   — no table DDL
--   • Function DDL   — no function changes
--   • Trigger DDL    — no trigger changes
--   • audit_log policies — zero; intentionally absent
--   • activity_logs changes — not in scope
--   • invitation policy changes — not in scope
--   • recall policy changes — not in scope
--   • public trace ACL changes — not in scope
--
-- ── CANONICAL POLICY DEFINITIONS ─────────────────────────────────────────────
--
--   Post-DG-10A live state verified 2026-08-25. Eight policies, all
--   TO authenticated, sourced verbatim from pg_policies output after
--   DG-10A execution.
--
--   public.batch_events (2 policies):
--
--     events_select   SELECT  {authenticated}
--       USING:      (company_id = current_org_id())
--       WITH CHECK: N/A
--
--     events_insert   INSERT  {authenticated}
--       USING:      N/A
--       WITH CHECK: (company_id = current_org_id())
--
--   public.distribution_records (3 policies):
--
--     dist_select     SELECT  {authenticated}
--       USING:      (company_id = current_org_id())
--       WITH CHECK: N/A
--
--     dist_insert     INSERT  {authenticated}
--       USING:      N/A
--       WITH CHECK: ((company_id = current_org_id()) AND
--                    (current_user_role() = ANY (ARRAY['admin'::text,
--                      'manager'::text, 'operations'::text])))
--
--     dist_update     UPDATE  {authenticated}
--       USING:      (company_id = current_org_id())
--       WITH CHECK: ((company_id = current_org_id()) AND
--                    (current_user_role() = ANY (ARRAY['admin'::text,
--                      'manager'::text, 'operations'::text])))
--
--   public.batches (3 policies — table is out-of-band; see dependency note):
--
--     batches_select  SELECT  {authenticated}
--       USING:      (company_id = current_org_id())
--       WITH CHECK: N/A
--
--     batches_insert  INSERT  {authenticated}
--       USING:      N/A
--       WITH CHECK: ((company_id = current_org_id()) AND
--                    (current_user_role() = ANY (ARRAY['admin'::text,
--                      'manager'::text, 'operations'::text])))
--
--     batches_update  UPDATE  {authenticated}
--       USING:      (company_id = current_org_id())
--       WITH CHECK: ((company_id = current_org_id()) AND
--                    (current_user_role() = ANY (ARRAY['admin'::text,
--                      'manager'::text, 'operations'::text])))
--
-- ════════════════════════════════════════════════════════════════
-- EXECUTABLE MIGRATION
-- (idempotent recovery — DROP IF EXISTS is a no-op when absent;
--  CREATE rebuilds the canonical policy unconditionally)
-- NOT YET APPLIED TO THE LIVE DATABASE
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ── public.batch_events ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS events_select
  ON public.batch_events;

CREATE POLICY events_select
  ON public.batch_events
  FOR SELECT
  TO authenticated
  USING (company_id = current_org_id());


DROP POLICY IF EXISTS events_insert
  ON public.batch_events;

CREATE POLICY events_insert
  ON public.batch_events
  FOR INSERT
  TO authenticated
  WITH CHECK (company_id = current_org_id());


-- ── public.distribution_records ──────────────────────────────────────────────

DROP POLICY IF EXISTS dist_select
  ON public.distribution_records;

CREATE POLICY dist_select
  ON public.distribution_records
  FOR SELECT
  TO authenticated
  USING (company_id = current_org_id());


DROP POLICY IF EXISTS dist_insert
  ON public.distribution_records;

CREATE POLICY dist_insert
  ON public.distribution_records
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (company_id = current_org_id())
    AND (current_user_role() = ANY (
      ARRAY['admin'::text, 'manager'::text, 'operations'::text]
    ))
  );


DROP POLICY IF EXISTS dist_update
  ON public.distribution_records;

CREATE POLICY dist_update
  ON public.distribution_records
  FOR UPDATE
  TO authenticated
  USING (company_id = current_org_id())
  WITH CHECK (
    (company_id = current_org_id())
    AND (current_user_role() = ANY (
      ARRAY['admin'::text, 'manager'::text, 'operations'::text]
    ))
  );


-- ── public.batches ────────────────────────────────────────────────────────────
-- NOTE: public.batches has no CREATE TABLE definition in any repository file.
-- These policies presuppose the table already exists in the target schema.

DROP POLICY IF EXISTS batches_select
  ON public.batches;

CREATE POLICY batches_select
  ON public.batches
  FOR SELECT
  TO authenticated
  USING (company_id = current_org_id());


DROP POLICY IF EXISTS batches_insert
  ON public.batches;

CREATE POLICY batches_insert
  ON public.batches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (company_id = current_org_id())
    AND (current_user_role() = ANY (
      ARRAY['admin'::text, 'manager'::text, 'operations'::text]
    ))
  );


DROP POLICY IF EXISTS batches_update
  ON public.batches;

CREATE POLICY batches_update
  ON public.batches
  FOR UPDATE
  TO authenticated
  USING (company_id = current_org_id())
  WITH CHECK (
    (company_id = current_org_id())
    AND (current_user_role() = ANY (
      ARRAY['admin'::text, 'manager'::text, 'operations'::text]
    ))
  );


COMMIT;
