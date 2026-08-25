-- ============================================================
-- DG-11B: audit_trigger_fn + Six Audit Triggers — Canonical Recovery
-- File: supabase_dg11b_audit_trigger_canonical_recovery_20260825.sql
-- Created: 2026-08-25
-- Status: REPOSITORY / RECOVERY ONLY — NOT EXECUTED LIVE
-- ============================================================
--
-- PURPOSE
-- -------
-- Canonical DROP IF EXISTS + CREATE recovery source for:
--
--   public.audit_trigger_fn()  — hardened SECURITY DEFINER audit function
--   Function EXECUTE ACL       — all non-owner grants revoked
--   public.audit_log table ACL — authenticated direct privileges revoked
--   Six audit triggers         — one per audited source table
--
-- DG-11B was NOT executed live. The live database already reflects
-- the correct post-DG-11A state following successful execution and
-- verification of DG-11A on 2026-08-25.
--
-- DG-11B is the idempotent recovery source that allows the hardened
-- function, its ACL state, the audit_log ACL state, and all six triggers
-- to be deterministically rebuilt from scratch, independently of any
-- prior live state.
--
-- ── RELATIONSHIP TO DG-11A ───────────────────────────────────────────────────
--
--   DG-11A (supabase_dg11a_audit_trigger_fn_hardening_20260825.sql)
--   was the live normalization step applied on 2026-08-25. It:
--
--     1. Replaced public.audit_trigger_fn() in-place via CREATE OR REPLACE,
--        adding SET search_path = pg_catalog, public, pg_temp and
--        schema-qualifying all privileged object references in the body.
--
--     2. Revoked EXECUTE on the function from PUBLIC, anon, authenticated,
--        and service_role.
--
--     3. Revoked ALL PRIVILEGES on public.audit_log from authenticated.
--
--   DG-11A did not create, drop, or alter any trigger.
--   DG-11A did not modify any RLS policy.
--   DG-11A did not modify the audit_log schema.
--
--   DG-11B captures that corrected post-DG-11A state as the authoritative
--   repository source. DG-11B does not perform an additional live
--   normalization pass; the live state is already correct.
--
-- ── FUNCTION SOURCE — POST-DG-11A VERIFIED LIVE ──────────────────────────────
--
--   The CREATE OR REPLACE FUNCTION in this file is authoritative because
--   the identical transaction was executed live in DG-11A and the resulting
--   function was subsequently verified through:
--
--     pg_proc.prosecdef          = true
--     pg_proc.proowner::regrole  = postgres
--     pg_proc.proconfig          = {search_path=pg_catalog, public, pg_temp}
--     pg_proc.proacl             = {postgres=X/postgres}
--     pg_get_functiondef()       — confirmed public.audit_log qualified,
--                                  public.audit_action qualified,
--                                  public.current_user_role() qualified
--
-- ── TRIGGER SOURCE — POST-DG-11A VERIFIED LIVE ───────────────────────────────
--
--   The six CREATE TRIGGER statements in this file are derived from the
--   verbatim live output of pg_get_triggerdef(t.oid, true) returned by the
--   post-DG-11A live database on 2026-08-25. Schema qualification has been
--   added to table names and the function reference for recovery safety
--   (see SCHEMA QUALIFICATION section below). Trigger names, timing, events,
--   and row-level behavior are identical to live.
--
-- ── FUNCTION HARDENING STATE ─────────────────────────────────────────────────
--
--   public.audit_trigger_fn() post-DG-11A:
--
--     RETURNS trigger
--     LANGUAGE plpgsql
--     SECURITY DEFINER = true
--     owner             = postgres
--     proconfig         = {search_path=pg_catalog, public, pg_temp}
--
--   The function executes as postgres (BYPASSRLS) because SECURITY DEFINER
--   runs as the function owner. The function-level SET search_path overrides
--   whatever session search_path the calling context has at trigger invocation
--   time, eliminating the inherited-mutable-search_path SECURITY DEFINER
--   hardening defect that existed before DG-11A.
--
--   Privileged object references in the body are explicitly schema-qualified:
--
--     public.audit_log           — INSERT target
--     public.audit_action        — cast type for lower(TG_OP)
--     public.current_user_role() — actor_role value
--
--   auth.uid() was already schema-qualified before DG-11A and is unchanged.
--
--   Built-in PostgreSQL functions — lower(), to_jsonb(), now() — resolve
--   from pg_catalog, which is first in the hardened search_path.
--
-- ── RUNTIME AUDIT BEHAVIOR ───────────────────────────────────────────────────
--
--   DELETE:  v_company_id := OLD.company_id; v_record_id := OLD.id;
--   INSERT:  v_company_id := NEW.company_id; v_record_id := NEW.id;
--   UPDATE:  v_company_id := NEW.company_id; v_record_id := NEW.id;
--
--   old_values:  to_jsonb(OLD) for UPDATE and DELETE; NULL for INSERT
--   new_values:  to_jsonb(NEW) for INSERT and UPDATE; NULL for DELETE
--   actor_id:    auth.uid()
--   actor_role:  public.current_user_role()
--   occurred_at: now()
--   RETURN NULL: correct for AFTER ROW triggers; does not affect source row
--
--   No additional audit_log columns are populated in this version.
--
-- ── FUNCTION EXECUTE ACL — MUST BE PART OF CANONICAL RECOVERY ───────────────
--
--   Post-DG-11A verified raw ACL: {postgres=X/postgres}
--   (Direct EXECUTE for postgres owner only; all other grantees removed.)
--
--   In PostgreSQL, CREATE OR REPLACE FUNCTION on a function that does not
--   yet exist results in a new function with the default ACL for the schema,
--   which typically grants EXECUTE to PUBLIC. If DG-11B contained only
--   CREATE OR REPLACE FUNCTION + CREATE TRIGGER without the REVOKE
--   statements, a disaster recovery application would silently recreate the
--   pre-DG-11A EXECUTE exposure:
--
--     PUBLIC         EXECUTE = true  ← default for new function
--     anon           EXECUTE = true  ← inherits PUBLIC
--     authenticated  EXECUTE = true  ← inherits PUBLIC
--     service_role   EXECUTE = true  ← inherits PUBLIC
--
--   DG-11B therefore includes four explicit REVOKE EXECUTE statements
--   immediately after CREATE OR REPLACE FUNCTION. These are idempotent:
--   REVOKE on an absent privilege is a no-op.
--
--   Why triggers continue firing without caller EXECUTE privilege:
--   PostgreSQL trigger execution does not check the firing user's EXECUTE
--   privilege on the trigger function. Per documentation: "The user executing
--   the triggering SQL command must have the TRIGGER permission on the table,
--   but the user does not need EXECUTE permission on the trigger function."
--
-- ── audit_log TABLE ACL — MUST BE PART OF CANONICAL RECOVERY ─────────────────
--
--   Post-DG-11A verified state: authenticated direct privilege count = 0.
--
--   Before DG-11A, authenticated held broad direct table privileges on
--   public.audit_log including SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
--   TRIGGER, REFERENCES, and MAINTAIN. Although RLS with zero policies
--   blocked normal row-level CRUD (no PERMISSIVE policy evaluates to true),
--   TRUNCATE is not governed by RLS — PostgreSQL explicitly excludes it
--   from row-security evaluation. An authenticated user with a direct
--   TRUNCATE privilege could destroy the entire audit trail.
--
--   DG-11B includes REVOKE ALL PRIVILEGES ON TABLE public.audit_log FROM
--   authenticated to guarantee the table ACL is correct after any recovery
--   run, regardless of the prior state of the target database. This is
--   idempotent. service_role is intentionally not revoked.
--
--   DG-11B does NOT modify audit_log RLS settings or RLS policies:
--     rls_enabled  = true  (unchanged)
--     rls_forced   = false (unchanged)
--     policy count = 0     (unchanged; zero policies is intentional after
--                           DG-10A dropped audit_log_select)
--
-- ── SCHEMA QUALIFICATION IN TRIGGER DEFINITIONS ──────────────────────────────
--
--   The live pg_get_triggerdef(t.oid, true) output returned unqualified
--   table names (e.g., ON batch_lineage) because the Supabase SQL Editor
--   session search_path included public. For canonical recovery, all table
--   references and the function reference are explicitly qualified:
--
--     ON public.batch_lineage           (was: ON batch_lineage)
--     ON public.batches                 (was: ON batches)
--     ON public.distribution_records    (was: ON distribution_records)
--     ON public.operations              (was: ON operations)
--     ON public.qc_inspections          (was: ON qc_inspections)
--     ON public.suppliers               (was: ON suppliers)
--     EXECUTE FUNCTION public.audit_trigger_fn()
--                                       (was: EXECUTE FUNCTION audit_trigger_fn())
--
--   Trigger names, timing (AFTER), event sets, row-level behavior (FOR EACH
--   ROW), and the target function are otherwise identical to live.
--
-- ── LIVE TRIGGER INVENTORY (post-DG-11A; all tgenabled = O) ─────────────────
--
--   trigger               table                    events          timing
--   ------------------    -----------------------  --------------- ------
--   audit_batch_lineage   public.batch_lineage     INSERT          AFTER ROW
--   audit_batches         public.batches           INSERT/DELETE/  AFTER ROW
--                                                  UPDATE
--   audit_distribution    public.distribution_     INSERT/DELETE/  AFTER ROW
--                         records                  UPDATE
--   audit_operations      public.operations        INSERT/DELETE/  AFTER ROW
--                                                  UPDATE
--   audit_qc_inspections  public.qc_inspections    INSERT/DELETE/  AFTER ROW
--                                                  UPDATE
--   audit_suppliers       public.suppliers         INSERT/DELETE/  AFTER ROW
--                                                  UPDATE
--
-- ── HISTORICAL CORRECTION: audit_batch_lineage EVENT COVERAGE ────────────────
--
--   supabase_dg4_batch_lineage_operations_qci_rls_normalization_20260823.sql
--   line 101 stated "AFTER INSERT OR UPDATE OR DELETE" for the audit trigger
--   on batch_lineage. That comment is stale and incorrect.
--
--   Live pg_get_triggerdef() evidence obtained on 2026-08-25 confirmed that
--   audit_batch_lineage covers INSERT ONLY. DG-11A did not alter this trigger.
--   DG-11B preserves the live INSERT-only definition. The historical migration
--   file is not modified.
--
--   Whether DELETE and UPDATE coverage should be added to audit_batch_lineage
--   is an unresolved product and governance decision, deferred beyond DG-11.
--
-- ── IDEMPOTENCY ──────────────────────────────────────────────────────────────
--
--   CREATE OR REPLACE FUNCTION: replaces any existing definition in-place.
--   DROP TRIGGER IF EXISTS: no-op when the trigger does not exist.
--   CREATE TRIGGER: runs only after the DROP ensures the name is free.
--   REVOKE statements: no-op when the target privilege does not exist.
--
--   DG-11B can be applied to:
--     A — current live database (no prior re-run): all statements are
--         effectively no-ops or idempotent replacements. Net result is
--         identical to current live state. ✓
--     B — database after supabase_sfda_tables.sql re-run: recreates correct
--         function, triggers, and ACL state. ✓
--     C — blank schema (after all prerequisites exist): builds function and
--         triggers from scratch. ✓
--
-- ── PREREQUISITES / DEPENDENCY ANALYSIS ─────────────────────────────────────
--
--   DG-11B assumes the following already exist before execution:
--
--   public.audit_log
--
--     A historical CREATE TABLE IF NOT EXISTS public.audit_log definition
--     exists in supabase_sfda_tables.sql (lines 178–188). However, that
--     definition is STALE — it describes a different schema from the live
--     audit_log table that audit_trigger_fn writes to.
--
--     Historical schema (supabase_sfda_tables.sql):
--       id         uuid PRIMARY KEY
--       company_id uuid NOT NULL
--       actor      text NOT NULL
--       role       text
--       action     text NOT NULL
--       entity     text
--       type       text NOT NULL (CHECK: edit/qc/delete/recall/create)
--       created_at timestamptz NOT NULL DEFAULT now()
--
--     Live schema (as confirmed by DG-11A — columns written by the function):
--       company_id  uuid NOT NULL
--       table_name  (text or similar)
--       record_id   uuid NOT NULL
--       action      public.audit_action NOT NULL
--       old_values  jsonb NULL
--       new_values  jsonb NULL
--       actor_id    uuid NULL
--       actor_role  text NULL
--       occurred_at timestamptz NOT NULL DEFAULT now()
--
--     The live schema was applied out-of-band at an unknown prior date. The
--     supabase_sfda_tables.sql CREATE TABLE definition does NOT represent the
--     current live schema. DG-11B must not be applied against a database
--     where audit_log still has the historical column set — the function INSERT
--     would fail at column resolution.
--
--     Full canonical capture of the live audit_log DDL (CREATE TABLE,
--     constraints, indexes, RLS enablement) remains a separate future
--     governance task.
--
--   public.audit_action
--
--     No CREATE TYPE ... AS ENUM ... definition for public.audit_action exists
--     in any repository SQL file. Confirmed by exhaustive grep across all
--     .sql files in the repository on 2026-08-25. public.audit_action is
--     entirely out-of-band — its values, owner, and creation date are unknown
--     from the repository alone. DG-11B cannot be applied to a blank schema
--     until this enum exists.
--
--     Full canonical capture of public.audit_action (CREATE TYPE definition
--     and enum values) remains a separate future governance task.
--
--   public.current_user_role()
--
--     Defined in supabase_rbac.sql and/or supabase_multitenancy_v2.sql.
--     Repository source exists.
--
--   auth.uid()
--
--     Supabase platform function in the auth schema. Not a repository object.
--     Provided by the Supabase runtime.
--
--   public.batch_lineage
--
--     CREATE TABLE source exists in the repository.
--
--   public.batches
--
--     NO CREATE TABLE definition exists in any repository SQL file.
--     public.batches is entirely out-of-band. DG-11B assumes this table
--     already exists. Full DDL capture of public.batches remains a separate
--     future governance task.
--
--   public.distribution_records
--
--     CREATE TABLE source exists in supabase_sfda_tables.sql.
--
--   public.operations, public.qc_inspections, public.suppliers
--
--     CREATE TABLE sources exist in the repository.
--
--   DG-11B is NOT a full blank-database rebuild migration. Applying DG-11B
--   to a blank schema will fail unless all prerequisite objects listed above
--   already exist.
--
-- ── RECOVERY ORDERING ────────────────────────────────────────────────────────
--
--   Within DG-11B, the function must be created before the triggers because
--   CREATE TRIGGER ... EXECUTE FUNCTION public.audit_trigger_fn() requires
--   the function to already exist.
--
--   Within the broader hardening programme, DG-11B is the terminal recovery
--   step for the audit subsystem. Suggested ordering in a full recovery run
--   following supabase_sfda_tables.sql re-run:
--
--     1. supabase_activity_audit_log_hardening_20260822.sql
--     2. supabase_dg9b_stale_policy_rerun_defense_20260824.sql
--     3. supabase_dg10a_batches_distribution_rls_normalization_20260825.sql
--     4. supabase_dg10b_core_trace_canonical_policy_20260825.sql
--     5. supabase_dg11a_audit_trigger_fn_hardening_20260825.sql
--          — or DG-11B (this file) in place of DG-11A; both achieve the
--            same function + ACL state, but DG-11B additionally recreates
--            the six triggers
--
-- ── WHAT DG-11B DOES NOT INCLUDE ─────────────────────────────────────────────
--
--   No CREATE TABLE
--   No ALTER TABLE
--   No CREATE TYPE / ALTER TYPE
--   No CREATE POLICY / ALTER POLICY / DROP POLICY
--   No GRANT
--   No changes to: current_org_id(), current_user_role() body,
--     get_my_company_id(), get_my_role(), activity_logs, any non-audit
--     RLS policies, or any table other than audit_log ACL
--
-- ════════════════════════════════════════════════════════════════
-- EXECUTABLE MIGRATION
-- (idempotent recovery — NOT EXECUTED LIVE; live is already correct)
-- Apply ONLY if reconstructing the audit function/triggers from scratch
-- or recovering from a database state that does not reflect DG-11A.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ── public.audit_trigger_fn() — canonical hardened definition ────────────────
-- Exact body as executed live in DG-11A and verified via pg_get_functiondef().
-- CREATE OR REPLACE preserves the OID when the function already exists,
-- keeping all six pg_trigger dependency rows intact.

CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_company_id uuid;
  v_record_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_company_id := OLD.company_id;
    v_record_id := OLD.id;
  ELSE
    v_company_id := NEW.company_id;
    v_record_id := NEW.id;
  END IF;

  INSERT INTO public.audit_log (
    company_id,
    table_name,
    record_id,
    action,
    old_values,
    new_values,
    actor_id,
    actor_role,
    occurred_at
  )
  VALUES (
    v_company_id,
    TG_TABLE_NAME,
    v_record_id,
    lower(TG_OP)::public.audit_action,
    CASE
      WHEN TG_OP IN ('UPDATE', 'DELETE')
      THEN to_jsonb(OLD)
      ELSE NULL
    END,
    CASE
      WHEN TG_OP IN ('INSERT', 'UPDATE')
      THEN to_jsonb(NEW)
      ELSE NULL
    END,
    auth.uid(),
    public.current_user_role(),
    now()
  );

  RETURN NULL;
END;
$function$;


-- ── Function EXECUTE ACL — revoke all non-owner grants ───────────────────────
-- Required: CREATE OR REPLACE on a non-existent function grants EXECUTE to
-- PUBLIC by default. These REVOKEs guarantee the post-DG-11A hardened ACL
-- regardless of prior state. All four are idempotent (no-op if already absent).

REVOKE EXECUTE
  ON FUNCTION public.audit_trigger_fn()
  FROM PUBLIC;

REVOKE EXECUTE
  ON FUNCTION public.audit_trigger_fn()
  FROM anon;

REVOKE EXECUTE
  ON FUNCTION public.audit_trigger_fn()
  FROM authenticated;

REVOKE EXECUTE
  ON FUNCTION public.audit_trigger_fn()
  FROM service_role;


-- ── public.audit_log — authenticated table ACL ───────────────────────────────
-- Removes all direct table privileges from authenticated. Required because
-- TRUNCATE is not governed by RLS, and audit_log intentionally has zero
-- RLS policies. service_role is intentionally not revoked.
-- Idempotent (no-op if authenticated already has no privileges).

REVOKE ALL PRIVILEGES
  ON TABLE public.audit_log
  FROM authenticated;


-- ── Audit triggers — DROP IF EXISTS + CREATE (idempotent) ────────────────────
-- Source: pg_get_triggerdef(t.oid, true) from post-DG-11A live database
-- (2026-08-25). Table names and function reference are explicitly schema-
-- qualified for search_path-independent recovery. All other properties
-- (name, timing, events, FOR EACH ROW) are identical to live.
--
-- audit_batch_lineage: INSERT ONLY — confirmed by live pg_trigger evidence.
-- Historical repository comments claiming INSERT/UPDATE/DELETE are stale.
-- Do not expand this trigger's event coverage without an explicit product
-- decision.

DROP TRIGGER IF EXISTS audit_batch_lineage
  ON public.batch_lineage;

CREATE TRIGGER audit_batch_lineage
  AFTER INSERT
  ON public.batch_lineage
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_trigger_fn();


DROP TRIGGER IF EXISTS audit_batches
  ON public.batches;

CREATE TRIGGER audit_batches
  AFTER INSERT OR DELETE OR UPDATE
  ON public.batches
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_trigger_fn();


DROP TRIGGER IF EXISTS audit_distribution
  ON public.distribution_records;

CREATE TRIGGER audit_distribution
  AFTER INSERT OR DELETE OR UPDATE
  ON public.distribution_records
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_trigger_fn();


DROP TRIGGER IF EXISTS audit_operations
  ON public.operations;

CREATE TRIGGER audit_operations
  AFTER INSERT OR DELETE OR UPDATE
  ON public.operations
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_trigger_fn();


DROP TRIGGER IF EXISTS audit_qc_inspections
  ON public.qc_inspections;

CREATE TRIGGER audit_qc_inspections
  AFTER INSERT OR DELETE OR UPDATE
  ON public.qc_inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_trigger_fn();


DROP TRIGGER IF EXISTS audit_suppliers
  ON public.suppliers;

CREATE TRIGGER audit_suppliers
  AFTER INSERT OR DELETE OR UPDATE
  ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_trigger_fn();


COMMIT;
