-- ============================================================
-- TraceFlow — DG-6: batch_lineage Canonical Policy Capture
-- ============================================================
-- Migration:   DG-6
-- File:        supabase_dg6_batch_lineage_canonical_policy_20260823.sql
-- Date:        2026-08-23
-- Status:      REPOSITORY / RECOVERY SOURCE-OF-TRUTH ONLY
--              Do NOT execute against the live database unless
--              recovering from a multitenancy clean-slate re-run.
--              See section VI for rationale.
-- ============================================================


-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- EXECUTION GATE — READ BEFORE RUNNING
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
--
-- DG-6 was committed on 2026-08-23 as a canonical repository source-of-truth
-- and recovery migration. The live database state on that date already
-- matched the definitions below. Executing DG-6 against the current live
-- database when lineage_select and lineage_insert are already correct
-- produces no intended net change and constitutes an unnecessary live
-- mutation. Do not run it unless a recovery scenario applies.
--
-- ── WHEN TO RUN DG-6 ─────────────────────────────────────────────────────
--
--   Run DG-6 only when either:
--
--   (a) lineage_select does not exist on public.batch_lineage, OR
--   (b) lineage_insert does not exist on public.batch_lineage.
--
--   Both conditions arise after any multitenancy clean-slate re-run.
--   See section VII for the full recovery sequence.
--
--   Verify current policy state before running:
--
--     SELECT policyname, cmd, roles, qual, with_check
--     FROM pg_policies
--     WHERE schemaname = 'public'
--       AND tablename = 'batch_lineage'
--     ORDER BY policyname;
--
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


-- ── I. HARDENING SERIES POSITION ─────────────────────────────────────────
--
--   DG-4  supabase_dg4_batch_lineage_operations_qci_rls_normalization_20260823.sql
--         Commit: 9a355d0
--         Revokes anon table grants on batch_lineage, operations,
--         qc_inspections. ALTERs all affected policies to TO authenticated.
--         Contains NO CREATE POLICY statements.
--
--   DG-5  supabase_dg5_batch_lineage_policy_consolidation_20260823.sql
--         Commit: 8c82e79
--         Drops co_batch_lineage (permissive OR bypass).
--         ALTERs lineage_insert WITH CHECK to the normalized admin/manager/
--         operations allowlist.
--         Contains NO CREATE POLICY statements.
--
--   DG-6  THIS FILE
--         Commits the canonical CREATE POLICY source-of-truth for
--         lineage_select and lineage_insert.
--         Closes the repository recovery gap left by DG-4 and DG-5.
--
--   CRITICAL CONSTRAINT:
--     Neither DG-4 nor DG-5 contains a CREATE POLICY statement for
--     lineage_select or lineage_insert. Both migrations use ALTER POLICY
--     only. ALTER POLICY on a non-existent policy is a PostgreSQL error.
--     DG-6 is therefore a precondition for both DG-4 and DG-5 in any
--     recovery scenario where these policies do not already exist.


-- ── II. SOURCE-OF-TRUTH GAP (CLOSED BY THIS FILE) ────────────────────────
--
--   Prior to DG-6 (2026-08-23), neither lineage_select nor lineage_insert
--   had a CREATE POLICY statement anywhere in the TraceFlow repository.
--
--   Repository-wide search results (confirmed 2026-08-23):
--
--     grep -r "CREATE POLICY lineage_select" .  →  0 hits
--     grep -r "CREATE POLICY lineage_insert"  .  →  0 hits
--
--   Both policies were created out-of-band at an earlier point in the
--   project. They existed in the live database with no corresponding
--   repository migration.
--
--   This file is the first and authoritative CREATE POLICY source for
--   both policies.
--
--   co_batch_lineage status:
--     The policy "co_batch_lineage" (FOR ALL TO authenticated,
--     USING/WITH CHECK company_id = get_my_company_id()) was dropped
--     live by DG-5 on 2026-08-23. It still appears in three multitenancy
--     files (supabase_multitenancy_v2.sql:463,
--     supabase_multitenancy_migration.sql:534,
--     supabase_multitenancy_resume.sql:297) and will be recreated by any
--     multitenancy re-run. DG-5 owns the DROP of co_batch_lineage.
--     DG-6 does not touch co_batch_lineage.


-- ── III. CANONICAL lineage_select DEFINITION ─────────────────────────────
--
--   Live verification executed 2026-08-23 (directly from pg_policies):
--
--     policyname  lineage_select
--     cmd         SELECT
--     roles       {authenticated}
--     qual        (company_id = current_org_id())
--
--   This definition is confirmed from the live database, not inferred.
--   The USING clause was read directly from pg_policies.qual on 2026-08-23.
--
--   Canonical form (committed here as source-of-truth):
--
--     CREATE POLICY lineage_select ON public.batch_lineage
--       FOR SELECT TO authenticated
--       USING (company_id = current_org_id());
--
--   Semantics:
--     Any authenticated session whose JWT maps to a company_id matching
--     the row's company_id may SELECT that row. current_org_id() reads
--     the company_id claim from the Supabase JWT; its SET search_path =
--     public anchoring was applied by the helpers hardening file
--     (supabase_helpers_search_path_hardening_20260823.sql).


-- ── IV. CANONICAL lineage_insert DEFINITION ──────────────────────────────
--
--   Post-DG-5 live state (normalized 2026-08-23):
--
--   Pre-DG-5 WITH CHECK (stale allowlist — verbatim from live capture):
--     (current_user_role() = ANY
--      (ARRAY['owner'::text, 'admin'::text, 'quality_manager'::text,
--             'supervisor'::text, 'operator'::text]))
--
--   Stale role analysis (against user_profiles_role_check constraint):
--     owner            — NOT a valid role under current constraint
--     admin            — valid
--     quality_manager  — NOT a valid role under current constraint
--     supervisor       — NOT a valid role under current constraint
--     operator         — NOT a valid role under current constraint
--     → 4 of 5 roles were dead; the allowlist predated the current
--       user_profiles role model.
--
--   DG-5 normalized the allowlist to match the edit:production permission
--   model defined in app/lib/permissions.ts:
--     edit:production  →  admin, manager, operations
--
--   Post-DG-5 WITH CHECK (canonical — committed here as source-of-truth):
--     ((company_id = current_org_id()) AND
--      (current_user_role() = ANY (
--        ARRAY['admin'::text, 'manager'::text, 'operations'::text]
--      )))
--
--   Canonical form:
--
--     CREATE POLICY lineage_insert ON public.batch_lineage
--       FOR INSERT TO authenticated
--       WITH CHECK (
--         (company_id = current_org_id()) AND
--         (current_user_role() = ANY (
--           ARRAY[
--             'admin'::text,
--             'manager'::text,
--             'operations'::text
--           ]
--         ))
--       );
--
--   App consumer audit (confirmed 2026-08-23):
--     The only app-layer consumer of batch_lineage is app/recall/
--     RecallClient.tsx (SELECT only). Zero app-layer INSERT consumers
--     exist. Lineage rows are written by the trg_lineage_company trigger
--     (BEFORE INSERT, SECURITY DEFINER, supabase_multitenancy_v2.sql:356).


-- ── V. GRANT / REVOKE SCOPE ───────────────────────────────────────────────
--
--   DG-6 contains NO GRANT and NO REVOKE statements.
--
--   Anon table-level grants on public.batch_lineage were revoked by DG-4:
--     REVOKE ALL ON TABLE public.batch_lineage FROM anon;
--   That revoke is durable. DG-6 does not touch table-level privileges.
--   DG-4 owns all REVOKE/GRANT operations for this table.


-- ── VI. WHY DG-6 IS REPOSITORY/RECOVERY-ONLY TODAY ───────────────────────
--
--   The live database state on 2026-08-23 already matches the canonical
--   definitions in this file:
--
--     lineage_select:  FOR SELECT TO authenticated, USING current_org_id()
--     lineage_insert:  FOR INSERT TO authenticated, WITH CHECK current_org_id()
--                      + admin/manager/operations allowlist
--     co_batch_lineage: absent (dropped by DG-5)
--     anon grants:      absent (revoked by DG-4)
--
--   Executing DG-6 live today would:
--     1. DROP lineage_select (momentarily absent inside the transaction)
--     2. CREATE lineage_select with identical definition
--     3. DROP lineage_insert (momentarily absent)
--     4. CREATE lineage_insert with identical definition
--
--   No intended net change. The momentary absence inside the transaction
--   is not externally visible, but the mutation is unnecessary. DG-6
--   exists to commit the canonical definitions as a repository source-of-
--   truth and to enable reliable recovery after a multitenancy re-run.


-- ── VII. MULTITENANCY CLEAN-SLATE RE-RUN RECOVERY ────────────────────────
--
--   Trigger: any of the three multitenancy files is re-run:
--     supabase_multitenancy_v2.sql
--     supabase_multitenancy_migration.sql
--     supabase_multitenancy_resume.sql
--
--   The clean-slate loop (multitenancy_v2.sql:364–383) drops ALL policies
--   on public.batch_lineage, then recreates only co_batch_lineage
--   (multitenancy_v2.sql:461–467). After the re-run:
--
--     lineage_select   → DROPPED by clean-slate loop
--     lineage_insert   → DROPPED by clean-slate loop
--     co_batch_lineage → RECREATED (FOR ALL TO authenticated,
--                         get_my_company_id() — no role restriction)
--
--   Note: public.operations and public.qc_inspections are NOT in the
--   multitenancy clean-slate loop. Their policies survive a re-run.
--
--   ── RECOVERY SEQUENCE ────────────────────────────────────────────────
--
--   Step 1 — DG-6  (THIS FILE)
--
--     Restores the two missing policies:
--
--     DROP POLICY IF EXISTS lineage_select  → no-op (already dropped)
--     CREATE POLICY lineage_select          → creates with current_org_id()
--     DROP POLICY IF EXISTS lineage_insert  → no-op (already dropped)
--     CREATE POLICY lineage_insert          → creates with current_org_id()
--                                             + admin/manager/operations
--
--     co_batch_lineage is intentionally left in place for Step 3.
--
--   Step 2 — DG-4
--   (supabase_dg4_batch_lineage_operations_qci_rls_normalization_20260823.sql)
--
--     Re-applies table-level anon revoke and policy role normalization.
--     After Step 1, both policies exist and are already TO authenticated;
--     DG-4's ALTER POLICY statements are no-ops for batch_lineage.
--     DG-4 also re-applies REVOKE ALL FROM anon on operations and
--     qc_inspections, which is a no-op if already revoked.
--
--     CRITICAL: DG-4 DOES NOT CREATE lineage_select or lineage_insert.
--     DG-4 contains ALTER POLICY only. Without Step 1, DG-4 errors on
--     ALTER POLICY targeting non-existent policies.
--
--   Step 3 — DG-5
--   (supabase_dg5_batch_lineage_policy_consolidation_20260823.sql)
--
--     DROP POLICY "co_batch_lineage"  → SUCCEEDS (co_batch_lineage was
--                                        recreated by multitenancy re-run
--                                        and left in place by Step 1)
--     ALTER POLICY lineage_insert WITH CHECK → no-op (lineage_insert
--                                              already has the correct
--                                              WITH CHECK from Step 1)
--
--     CRITICAL: DG-5 DOES NOT CREATE lineage_select or lineage_insert.
--     DG-5 contains DROP + ALTER POLICY only. Without Step 1, DG-5 errors
--     on ALTER POLICY targeting a non-existent lineage_insert.
--
--   Final state after Steps 1–3:
--     lineage_select   present, FOR SELECT TO authenticated
--     lineage_insert   present, FOR INSERT TO authenticated, correct WITH CHECK
--     co_batch_lineage absent
--     anon grants      absent


-- ── VIII. IDEMPOTENCY ────────────────────────────────────────────────────
--
--   DG-6 is idempotent for its two canonical policies.
--
--   DROP POLICY IF EXISTS before each CREATE POLICY ensures:
--
--   Scenario A — policies do not exist (post-multitenancy re-run):
--     DROP IF EXISTS → no-op
--     CREATE POLICY  → creates the policy
--
--   Scenario B — policies already exist (current live state or prior
--                  DG-6 run):
--     DROP IF EXISTS → drops the existing policy
--     CREATE POLICY  → recreates with identical canonical definition
--
--   All four statements execute within a single BEGIN/COMMIT block.
--   The transaction is atomic; no partial state is externally visible.
--
--   Running DG-6 multiple times is safe. Each run leaves batch_lineage
--   in the identical canonical state.


-- ── IX. ROLLBACK ─────────────────────────────────────────────────────────
--
--   NOTE: The SQL below is documentation only. It is NOT part of the
--   executable DG-6 section. Do not run it unless intentionally reverting
--   to the pre-DG-6 state.
--
--   A rollback of DG-6 removes both canonical policies from the live
--   database, returning both policies to the out-of-band, source-of-truth-
--   gap state that existed before 2026-08-23. This is almost never the
--   correct action. DG-6 creates no net state change on a database that
--   already has the correct policies. Rolling back only makes sense if
--   the policy definitions themselves are being corrected.
--
--   If the policy definitions need correction, the correct action is a
--   new DG-7 migration that ALTERs or replaces the policies, not a
--   rollback of DG-6.
--
--   -- ROLLBACK (documentation only — do not execute):
--   -- BEGIN;
--   -- DROP POLICY IF EXISTS lineage_select ON public.batch_lineage;
--   -- DROP POLICY IF EXISTS lineage_insert ON public.batch_lineage;
--   -- COMMIT;
--   --
--   -- To restore the pre-DG-5 stale allowlist on lineage_insert
--   -- (not recommended):
--   -- BEGIN;
--   -- CREATE POLICY lineage_select ON public.batch_lineage
--   --   FOR SELECT TO authenticated
--   --   USING (company_id = current_org_id());
--   -- CREATE POLICY lineage_insert ON public.batch_lineage
--   --   FOR INSERT TO authenticated
--   --   WITH CHECK (
--   --     (company_id = current_org_id()) AND
--   --     (current_user_role() = ANY (
--   --       ARRAY['owner'::text, 'admin'::text, 'quality_manager'::text,
--   --             'supervisor'::text, 'operator'::text]
--   --     ))
--   --   );
--   -- COMMIT;


-- ── X. POST-EXECUTION VERIFICATION ───────────────────────────────────────
--
--   After running DG-6 in a recovery scenario, verify with:
--
--   SELECT
--     policyname,
--     cmd,
--     roles,
--     qual,
--     with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename  = 'batch_lineage'
--   ORDER BY policyname;
--
--   Expected results:
--
--   policyname      lineage_insert
--   cmd             INSERT
--   roles           {authenticated}
--   qual            (null)
--   with_check      ((company_id = current_org_id()) AND
--                    (current_user_role() = ANY (
--                      ARRAY['admin'::text, 'manager'::text,
--                            'operations'::text])))
--
--   policyname      lineage_select
--   cmd             SELECT
--   roles           {authenticated}
--   qual            (company_id = current_org_id())
--   with_check      (null)
--
--   policy count = 2 (lineage_select + lineage_insert only)
--   co_batch_lineage must NOT appear (verify count = 0 for that name)
--
--   Anon grant verification:
--
--   SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public'
--     AND table_name   = 'batch_lineage'
--     AND grantee      = 'anon';
--
--   Expected: 0 rows.


-- ============================================================
-- EXECUTABLE SECTION — DG-6
-- ============================================================
-- Statements: 4 (2 DROP POLICY IF EXISTS + 2 CREATE POLICY)
-- Scope:      public.batch_lineage — lineage_select, lineage_insert
-- No GRANT. No REVOKE. No co_batch_lineage handling.
-- ============================================================

BEGIN;

-- Canonical lineage_select
-- Verified live 2026-08-23: cmd=SELECT, roles={authenticated},
-- qual=(company_id = current_org_id())
DROP POLICY IF EXISTS lineage_select ON public.batch_lineage;
CREATE POLICY lineage_select ON public.batch_lineage
  FOR SELECT TO authenticated
  USING (company_id = current_org_id());

-- Canonical lineage_insert
-- Post-DG-5 authorization model: company-scoped + edit:production roles
-- (admin, manager, operations per app/lib/permissions.ts)
DROP POLICY IF EXISTS lineage_insert ON public.batch_lineage;
CREATE POLICY lineage_insert ON public.batch_lineage
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

COMMIT;
