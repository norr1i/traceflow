-- ============================================================
-- TraceFlow — DG-7B: operations + qc_inspections Canonical Policy Capture
-- ============================================================
-- Migration:   DG-7B
-- File:        supabase_dg7b_operations_qci_canonical_policy_20260824.sql
-- Date:        2026-08-24
-- Status:      REPOSITORY / RECOVERY SOURCE-OF-TRUTH ONLY
--              Do NOT execute against the live database unless
--              recovering from policy loss. See section VI.
-- ============================================================


-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- EXECUTION GATE — READ BEFORE RUNNING
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
--
-- DG-7B was committed on 2026-08-24 as a canonical repository source-of-truth
-- and recovery migration. The live database state on that date already matched
-- the definitions below (applied by DG-7A on 2026-08-23/24).
-- Executing DG-7B live when the policies are already correct produces no
-- intended net change and is an unnecessary live mutation.
--
-- ── WHEN TO RUN DG-7B ────────────────────────────────────────────────────
--
--   Run DG-7B only when one or more of the six policies are missing or
--   their definitions have regressed.
--
--   Verify current policy state before running:
--
--     SELECT tablename, policyname, cmd, roles, qual, with_check
--     FROM pg_policies
--     WHERE schemaname = 'public'
--       AND tablename IN ('operations', 'qc_inspections')
--     ORDER BY tablename, policyname;
--
--   Expected: 6 rows matching the canonical definitions in this file.
--
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


-- ── I. HARDENING SERIES POSITION ─────────────────────────────────────────
--
--   DG-4  supabase_dg4_batch_lineage_operations_qci_rls_normalization_20260823.sql
--         Commit: 9a355d0
--         Revoked anon table grants on operations and qc_inspections.
--         ALTERed all six policies from TO PUBLIC to TO authenticated.
--         Contains NO CREATE POLICY statements for either table.
--
--   DG-7A (live execution — no repository file)
--         Executed: 2026-08-23/24
--         Normalized four drifted write policies:
--           operations_insert, operations_update,
--           qci_insert, qci_update
--         Fixed two defects in the live database:
--           (1) Authorization drift — stale legacy role allowlists
--           (2) Tenant-isolation gap — missing company_id in UPDATE WITH CHECK
--         Contains NO CREATE POLICY statements (ALTER POLICY only).
--
--   DG-7B  THIS FILE
--         Commits the canonical CREATE POLICY source-of-truth for
--         all six policies across public.operations and public.qc_inspections.
--         Closes the repository recovery gap left by DG-4 and DG-7A.


-- ── II. SOURCE-OF-TRUTH GAP (CLOSED BY THIS FILE) ────────────────────────
--
--   Prior to DG-7B (2026-08-24), neither public.operations nor
--   public.qc_inspections had a CREATE POLICY statement anywhere in the
--   TraceFlow repository.
--
--   Repository-wide search results (confirmed 2026-08-24):
--
--     grep -r "CREATE POLICY.*operations_"   . → 0 hits
--     grep -r "CREATE POLICY.*qci_"          . → 0 hits
--     grep -r "CREATE TABLE.*operations"     . → 0 hits
--     grep -r "CREATE TABLE.*qc_inspections" . → 0 hits
--
--   All six policies were created out-of-band at an earlier point in the
--   project. DG-4 used ALTER POLICY (which cannot create missing policies);
--   DG-7A used ALTER POLICY (same limitation). This file is the first and
--   authoritative CREATE POLICY source for all six policies.
--
--   REMAINING SOURCE-OF-TRUTH GAPS (not closed by this file):
--
--   1. CREATE TABLE source-of-truth:
--      Neither public.operations nor public.qc_inspections has a
--      CREATE TABLE definition in any repository file. This file closes
--      the POLICY recovery gap only. Full DDL capture (columns, indexes,
--      constraints, foreign keys) is a separate future task.
--
--   2. audit_trigger_fn:
--      The SECURITY DEFINER audit trigger function (confirmed live: AFTER
--      INSERT OR UPDATE on both tables) has no CREATE OR REPLACE FUNCTION
--      statement in any repository file. Its body, search_path, and LANGUAGE
--      are unknown from the repository alone.
--
--   3. Trigger CREATE statements:
--      The CREATE TRIGGER statements for the audit triggers on both tables
--      (audit_operations → audit_trigger_fn, audit_qc_inspections →
--      audit_trigger_fn) have no repository source. Both exist live as
--      out-of-band objects.


-- ── III. PRE-DG-7A DRIFT (CORRECTED BY DG-7A, DOCUMENTED HERE) ───────────
--
-- ── Authorization drift ───────────────────────────────────────────────────
--
--   The four write policies (operations_insert, operations_update,
--   qci_insert, qci_update) contained legacy role allowlists that predated
--   the current user_profiles role model.
--
--   Live allowlists before DG-7A (verbatim from pg_policies):
--
--     operations_insert WITH CHECK:
--       current_user_role() = ANY (
--         ARRAY['owner'::text, 'admin'::text, 'quality_manager'::text,
--               'supervisor'::text, 'operator'::text])
--
--     operations_update WITH CHECK:
--       current_user_role() = ANY (
--         ARRAY['owner'::text, 'admin'::text, 'quality_manager'::text,
--               'supervisor'::text])
--
--     qci_insert WITH CHECK:
--       (company_id = current_org_id()) AND
--       current_user_role() = ANY (
--         ARRAY['owner'::text, 'admin'::text, 'quality_manager'::text,
--               'supervisor'::text, 'operator'::text])
--
--     qci_update WITH CHECK:
--       current_user_role() = ANY (
--         ARRAY['owner'::text, 'admin'::text, 'quality_manager'::text,
--               'supervisor'::text])
--
--   Stale role analysis (against user_profiles_role_check constraint,
--   supabase_team_management.sql:22-24):
--
--     owner           → NOT a valid role. Cannot exist in user_profiles.role.
--     quality_manager → NOT a valid role. Cannot exist in user_profiles.role.
--     supervisor      → NOT a valid role. Cannot exist in user_profiles.role.
--     operator        → NOT a valid role. Cannot exist in user_profiles.role.
--     admin           → Valid.
--
--   Effect: before DG-7A, only 'admin' users could INSERT or UPDATE into
--   either table. The roles that should have had write access per the
--   current authorization model — manager and operations for operations,
--   qc_inspector and inspector for qc_inspections — were effectively
--   locked out.
--
-- ── Tenant-isolation gap ──────────────────────────────────────────────────
--
--   operations_update and qci_update had:
--
--     USING:      (company_id = current_org_id())   ← row-targeting guard
--     WITH CHECK: role check only — NO company_id
--
--   PostgreSQL UPDATE RLS semantics:
--     USING   = evaluated against the current (pre-update) row
--     WITH CHECK = evaluated against the proposed (post-update) row
--
--   Because WITH CHECK contained no company_id guard, an authorized updater
--   could set company_id to another tenant's valid UUID. The proposed new
--   row would pass WITH CHECK (role check satisfied) even though company_id
--   was changed to a different tenant. This permitted cross-tenant row
--   movement — a multitenancy isolation defect.
--
--   DG-7A fixed both defects by altering all four WITH CHECK expressions:
--     (1) Replaced stale legacy allowlists with current role models.
--     (2) Added (company_id = current_org_id()) to UPDATE WITH CHECK.


-- ── IV. CURRENT AUTHORIZATION MODEL ──────────────────────────────────────
--
-- ── public.operations ─────────────────────────────────────────────────────
--
--   Business role: manufacturing work orders. One row per operation linked
--   to a production_order and product. Tracks operational status and
--   associates QC inspections via FK (qc_inspections.operation_id →
--   operations.id).
--
--   Authorization model: edit:production permission
--   (app/lib/permissions.ts — directly evidenced):
--
--     SELECT:  all authenticated company members
--              (no role restriction — broad production visibility)
--     INSERT:  admin, manager, operations
--     UPDATE:  admin, manager, operations  (company-scoped USING + WITH CHECK)
--     DELETE:  not supported (no DELETE policy exists)
--
-- ── public.qc_inspections ─────────────────────────────────────────────────
--
--   Business role: quality-control inspection results per manufacturing
--   operation. FK: qc_inspections.operation_id → operations.id.
--
--   Note: this is a DIFFERENT table from public.quality_inspections.
--   quality_inspections is the app's general QC table (queried directly
--   by app/hooks/useQualityInspections.ts). qc_inspections is a
--   manufacturing-floor QC table linked to the operations workflow.
--
--   Authorization model: edit:quality-control permission
--   (app/lib/permissions.ts — directly evidenced):
--
--     SELECT:  all authenticated company members
--              (no role restriction — broad QC visibility)
--     INSERT:  admin, qc_inspector, inspector
--     UPDATE:  admin, qc_inspector, inspector  (company-scoped USING + WITH CHECK)
--     DELETE:  not supported (no DELETE policy exists)
--
--   manager is INTENTIONALLY EXCLUDED from qci INSERT and UPDATE.
--   Rationale: app/lib/permissions.ts:105 explicitly states manager has
--   "Full write access (cannot edit QC or override it)". Database RLS must
--   not grant broader QC-write authorization than the application permission
--   model. The admin role retains QC write access via override:qc.


-- ── V. GRANT / REVOKE SCOPE ───────────────────────────────────────────────
--
--   DG-7B contains NO GRANT and NO REVOKE statements.
--
--   Anon table-level grants on public.operations and public.qc_inspections
--   were revoked by DG-4 (REVOKE ALL ON TABLE ... FROM anon). Those revokes
--   are durable. DG-7B does not touch table-level privileges. DG-4 owns
--   all REVOKE/GRANT operations for these tables.


-- ── VI. WHY DG-7B IS REPOSITORY/RECOVERY-ONLY TODAY ──────────────────────
--
--   The live database state on 2026-08-24 already matches the canonical
--   definitions in this file. DG-7A applied the four ALTER POLICY statements
--   live on 2026-08-23/24. The verification query confirmed:
--
--     authenticated_only = true
--     exact_expected_state = true
--
--   Executing DG-7B live today would:
--     For each of 6 policies:
--       DROP POLICY IF EXISTS → drops the correct live policy
--       CREATE POLICY         → recreates with identical definition
--
--   No intended net change. The momentary absence of each policy inside
--   the transaction is not externally visible, but the mutation is
--   unnecessary. DG-7B exists to commit the canonical definitions as a
--   repository source-of-truth and to enable reliable recovery.


-- ── VII. RECOVERY SCENARIOS ───────────────────────────────────────────────
--
--   Scenario A — policies lost or corrupted (manual recreation needed):
--     Run DG-7B. All six DROP IF EXISTS + CREATE POLICY statements execute.
--     Result: all six policies restored to canonical state.
--
--   Scenario B — DG-7A re-normalization needed (regression after DG-7B):
--     Run DG-7B directly. No need to re-run DG-7A separately; DG-7B
--     creates the complete canonical post-DG-7A state in one pass.
--
--   Scenario C — DG-4 anon table grant revoke lost:
--     DG-7B does NOT re-apply the REVOKE. Run DG-4 separately.
--     DG-7B is focused on policy definitions only.
--
--   Operations and qc_inspections are NOT in the multitenancy clean-slate
--   loop (supabase_multitenancy_v2.sql:372–377). A multitenancy re-run
--   does NOT wipe their policies. The recovery urgency is therefore lower
--   than for batch_lineage (DG-6), but the source-of-truth gap is equally
--   real.
--
--   Post-run verification:
--
--     SELECT tablename, policyname, cmd, roles, qual, with_check
--     FROM pg_policies
--     WHERE schemaname = 'public'
--       AND tablename IN ('operations', 'qc_inspections')
--     ORDER BY tablename, policyname;
--
--   Expected: 6 rows. See section VIII for exact expected values.


-- ── VIII. IDEMPOTENCY ─────────────────────────────────────────────────────
--
--   DG-7B is idempotent for all six policies.
--
--   DROP POLICY IF EXISTS before each CREATE POLICY ensures:
--
--   Scenario A — policy exists (current live state or prior DG-7B run):
--     DROP IF EXISTS → drops the existing policy
--     CREATE POLICY  → recreates with identical canonical definition
--
--   Scenario B — policy does not exist (after manual removal or corruption):
--     DROP IF EXISTS → no-op
--     CREATE POLICY  → creates the policy
--
--   All 12 statements execute within a single BEGIN/COMMIT block.
--   The transaction is atomic; no partial state is externally visible.
--   Running DG-7B multiple times is safe.


-- ── IX. POST-EXECUTION VERIFICATION ──────────────────────────────────────
--
--   After running DG-7B in a recovery scenario, verify with:
--
--   SELECT tablename, policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('operations', 'qc_inspections')
--   ORDER BY tablename, policyname;
--
--   Expected 6 rows:
--
--   tablename    policyname          cmd     roles            qual                            with_check
--   operations   operations_insert   INSERT  {authenticated}  (null)                          ((company_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'operations'::text])))
--   operations   operations_select   SELECT  {authenticated}  (company_id = current_org_id()) (null)
--   operations   operations_update   UPDATE  {authenticated}  (company_id = current_org_id()) ((company_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::text, 'manager'::text, 'operations'::text])))
--   qc_insp...   qci_insert          INSERT  {authenticated}  (null)                          ((company_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::text, 'qc_inspector'::text, 'inspector'::text])))
--   qc_insp...   qci_select          SELECT  {authenticated}  (company_id = current_org_id()) (null)
--   qc_insp...   qci_update          UPDATE  {authenticated}  (company_id = current_org_id()) ((company_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::text, 'qc_inspector'::text, 'inspector'::text])))
--
--   Anon grant verification:
--
--   SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public'
--     AND table_name IN ('operations', 'qc_inspections')
--     AND grantee = 'anon';
--
--   Expected: 0 rows.


-- ── X. ROLLBACK ───────────────────────────────────────────────────────────
--
--   NOTE: The SQL below is documentation only. It is NOT part of the
--   executable DG-7B section. Do not run it unless intentionally reverting
--   to the pre-DG-7A state.
--
--   Rolling back DG-7B drops all six policies from the live database,
--   returning both tables to the out-of-band, source-of-truth-gap state.
--   This is almost never the correct action. If policy definitions need
--   correction, write a new DG-8 migration.
--
--   -- ROLLBACK (documentation only — do not execute):
--   -- BEGIN;
--   -- DROP POLICY IF EXISTS operations_select ON public.operations;
--   -- DROP POLICY IF EXISTS operations_insert ON public.operations;
--   -- DROP POLICY IF EXISTS operations_update ON public.operations;
--   -- DROP POLICY IF EXISTS qci_select        ON public.qc_inspections;
--   -- DROP POLICY IF EXISTS qci_insert        ON public.qc_inspections;
--   -- DROP POLICY IF EXISTS qci_update        ON public.qc_inspections;
--   -- COMMIT;
--
--   To restore the pre-DG-7A stale allowlists (NOT recommended — those
--   roles are dead under the current user_profiles_role_check constraint):
--   recreate with the verbatim stale WITH CHECK expressions documented
--   in section III.


-- ============================================================
-- EXECUTABLE SECTION — DG-7B
-- ============================================================
-- Statements: 12 (6 DROP POLICY IF EXISTS + 6 CREATE POLICY)
-- Scope:      public.operations  — 3 policies
--             public.qc_inspections — 3 policies
-- No GRANT. No REVOKE. No table/function/trigger DDL.
-- ============================================================

BEGIN;

-- ── public.operations ─────────────────────────────────────────────────────

-- Verified live 2026-08-24: cmd=SELECT, roles={authenticated},
-- qual=(company_id = current_org_id()), with_check=NULL
DROP POLICY IF EXISTS operations_select ON public.operations;
CREATE POLICY operations_select ON public.operations
  FOR SELECT TO authenticated
  USING (company_id = current_org_id());

-- edit:production authorization model (admin, manager, operations).
-- Normalized by DG-7A from stale legacy allowlist.
DROP POLICY IF EXISTS operations_insert ON public.operations;
CREATE POLICY operations_insert ON public.operations
  FOR INSERT TO authenticated
  WITH CHECK (
    (company_id = current_org_id()) AND
    (current_user_role() = ANY (
      ARRAY[
        'admin'::text,
        'manager'::text,
        'operations'::text
      ]
    ))
  );

-- company_id in both USING and WITH CHECK closes the cross-tenant UPDATE
-- gap present before DG-7A (WITH CHECK previously had no company_id guard).
DROP POLICY IF EXISTS operations_update ON public.operations;
CREATE POLICY operations_update ON public.operations
  FOR UPDATE TO authenticated
  USING (company_id = current_org_id())
  WITH CHECK (
    (company_id = current_org_id()) AND
    (current_user_role() = ANY (
      ARRAY[
        'admin'::text,
        'manager'::text,
        'operations'::text
      ]
    ))
  );

-- ── public.qc_inspections ─────────────────────────────────────────────────

-- Verified live 2026-08-24: cmd=SELECT, roles={authenticated},
-- qual=(company_id = current_org_id()), with_check=NULL
DROP POLICY IF EXISTS qci_select ON public.qc_inspections;
CREATE POLICY qci_select ON public.qc_inspections
  FOR SELECT TO authenticated
  USING (company_id = current_org_id());

-- edit:quality-control authorization model (admin, qc_inspector, inspector).
-- manager intentionally excluded per app/lib/permissions.ts:105.
DROP POLICY IF EXISTS qci_insert ON public.qc_inspections;
CREATE POLICY qci_insert ON public.qc_inspections
  FOR INSERT TO authenticated
  WITH CHECK (
    (company_id = current_org_id()) AND
    (current_user_role() = ANY (
      ARRAY[
        'admin'::text,
        'qc_inspector'::text,
        'inspector'::text
      ]
    ))
  );

-- company_id in both USING and WITH CHECK closes the cross-tenant UPDATE
-- gap present before DG-7A.
DROP POLICY IF EXISTS qci_update ON public.qc_inspections;
CREATE POLICY qci_update ON public.qc_inspections
  FOR UPDATE TO authenticated
  USING (company_id = current_org_id())
  WITH CHECK (
    (company_id = current_org_id()) AND
    (current_user_role() = ANY (
      ARRAY[
        'admin'::text,
        'qc_inspector'::text,
        'inspector'::text
      ]
    ))
  );

COMMIT;
