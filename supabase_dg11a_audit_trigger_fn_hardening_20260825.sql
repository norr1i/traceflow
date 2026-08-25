-- ============================================================
-- DG-11A: audit_trigger_fn SECURITY DEFINER Hardening
-- File: supabase_dg11a_audit_trigger_fn_hardening_20260825.sql
-- Created: 2026-08-25
-- Status: EXECUTED AND VERIFIED LIVE (2026-08-25)
-- ============================================================
--
-- PURPOSE
-- -------
-- Harden public.audit_trigger_fn(), a SECURITY DEFINER trigger
-- function that writes audit records to public.audit_log after
-- DML on six production tables. This file:
--
--   1. Replaces the function in-place (CREATE OR REPLACE) to add a
--      function-level SET search_path and schema-qualify all
--      privileged object references in the body.
--
--   2. Revokes all non-owner EXECUTE grants from the function.
--
--   3. Revokes all direct table privileges from authenticated on
--      public.audit_log.
--
-- No trigger DDL is included. No policy DDL is included.
-- No table DDL is included. No GRANT is issued.
-- Runtime audit behavior is unchanged.
--
-- ── PRE-DG-11A FUNCTION STATE ────────────────────────────────────────────────
--
--   public.audit_trigger_fn():
--
--     RETURNS trigger
--     LANGUAGE plpgsql
--     SECURITY DEFINER = true
--     owner             = postgres
--     proconfig         = NULL      ← no function-level search_path
--
--   Because proconfig was NULL, the function inherited whatever
--   search_path the calling session had at trigger invocation time.
--   The body used unqualified references to:
--
--     audit_log          (resolved via search_path at runtime)
--     audit_action       (resolved via search_path at runtime)
--     current_user_role() (resolved via search_path at runtime)
--
-- ── SECURITY RATIONALE ────────────────────────────────────────────────────────
--
--   The function executes as postgres (BYPASSRLS, superuser) because
--   SECURITY DEFINER runs as the function owner. Inheriting a mutable
--   caller/session search_path in a SECURITY DEFINER function is a
--   confirmed hardening defect: if the search_path were ever manipulated
--   to place a user-controlled schema ahead of public, unqualified object
--   references inside the function body would resolve to attacker-controlled
--   objects rather than their intended targets, all while executing with
--   postgres-level privileges.
--
--   At the time DG-11A was executed, anon, authenticated, and service_role
--   did NOT hold CREATE privilege on the public schema, so immediate
--   object-shadowing was not available to those roles. DG-11A nevertheless
--   closes the defect proactively: a SECURITY DEFINER function must not
--   depend on external search_path state for correct name resolution,
--   regardless of current schema-creation ACL.
--
--   This is the same hardening model applied to current_org_id() and
--   current_user_role() (supabase_helpers_search_path_hardening_20260823.sql)
--   and to get_my_company_id() and get_my_role() (DG-8, 2026-08-24).
--
-- ── FUNCTION HARDENING APPLIED ───────────────────────────────────────────────
--
--   SET search_path = pg_catalog, public, pg_temp
--
--   This becomes a function-level proconfig entry (pg_proc.proconfig).
--   It overrides the session search_path for the entire duration of each
--   function invocation, regardless of caller context.
--
--   Object references explicitly schema-qualified in the replacement body:
--
--     public.audit_log           — INSERT target
--     public.audit_action        — cast type for lower(TG_OP)
--     public.current_user_role() — actor_role value
--
--   auth.uid() was already explicitly qualified and required no change.
--
--   Built-in PostgreSQL functions — lower(), to_jsonb(), now() — resolve
--   from pg_catalog, which is first in the hardened search_path.
--
--   PL/pgSQL special variables — TG_OP, TG_TABLE_NAME, NEW, OLD — are
--   not resolved via search_path and are unaffected.
--
-- ── RUNTIME AUDIT BEHAVIOR — UNCHANGED ───────────────────────────────────────
--
--   The replacement function is semantically identical to the pre-DG-11A
--   function in every observable audit respect:
--
--     DELETE:  v_company_id := OLD.company_id; v_record_id := OLD.id;
--     INSERT:  v_company_id := NEW.company_id; v_record_id := NEW.id;
--     UPDATE:  v_company_id := NEW.company_id; v_record_id := NEW.id;
--
--     old_values:  to_jsonb(OLD) for UPDATE and DELETE; NULL for INSERT
--     new_values:  to_jsonb(NEW) for INSERT and UPDATE; NULL for DELETE
--     actor_id:    auth.uid()                    ← unchanged
--     actor_role:  public.current_user_role()    ← unchanged
--     occurred_at: now()                         ← unchanged
--     RETURN NULL: unchanged (correct for AFTER ROW triggers)
--
--   No additional audit_log columns are populated.
--   The audit_log schema is not modified.
--   The audit_action enum is not modified.
--
-- ── CREATE OR REPLACE SAFETY ─────────────────────────────────────────────────
--
--   CREATE OR REPLACE FUNCTION preserves the existing function OID,
--   owner, ACLs, and SECURITY DEFINER flag while replacing the body
--   and proconfig. All six pg_trigger rows binding to this function
--   by OID continue to reference the same OID without modification.
--   No trigger was recreated or altered by DG-11A.
--
--   After CREATE OR REPLACE, the pre-existing EXECUTE grants (PUBLIC,
--   anon, authenticated, service_role) remain present in the ACL —
--   CREATE OR REPLACE explicitly preserves existing grants. The four
--   REVOKE statements in this transaction remove those grants.
--
-- ── PRE-DG-11A FUNCTION EXECUTE ACL ─────────────────────────────────────────
--
--   Direct EXECUTE grants before DG-11A:
--
--     PUBLIC         direct = true
--     anon           direct = true
--     authenticated  direct = true
--     postgres       direct = true (owner, ACL-derived)
--     service_role   direct = true
--
--   Effective EXECUTE before DG-11A:
--
--     anon           = true
--     authenticated  = true
--     service_role   = true
--
-- ── FINAL FUNCTION EXECUTE ACL ────────────────────────────────────────────────
--
--   DG-11A revoked EXECUTE from:
--
--     PUBLIC
--     anon
--     authenticated
--     service_role
--
--   postgres remains function owner. Owner privilege is not ACL-derived
--   and is unaffected by REVOKE.
--
--   Why triggers continue firing without caller EXECUTE privilege:
--
--     PostgreSQL trigger execution does not check the firing user's
--     EXECUTE privilege on the trigger function. When a DML statement
--     causes an AFTER ROW trigger to fire, the database engine invokes
--     the trigger function internally. Per PostgreSQL documentation:
--     "The user executing the triggering SQL command must have the
--     TRIGGER permission on the table, but the user does not need
--     EXECUTE permission on the trigger function." All six triggers
--     continue operating identically after DG-11A.
--
-- ── PRE-DG-11A audit_log STATE ───────────────────────────────────────────────
--
--   public.audit_log before DG-11A:
--
--     owner             = postgres
--     RLS enabled       = true
--     FORCE RLS         = false
--     RLS policy count  = 0         (audit_log_select dropped by DG-10A)
--
--   authenticated held broad direct table privileges including:
--
--     SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES, MAINTAIN
--
--   RLS with zero policies blocked normal row-level authenticated CRUD
--   (no PERMISSIVE policy evaluates to true for non-BYPASSRLS callers).
--   However, TRUNCATE is not governed by RLS — PostgreSQL explicitly
--   excludes TRUNCATE from row-security evaluation. An authenticated
--   user holding a direct TRUNCATE privilege on audit_log could therefore
--   destroy the entire audit trail without triggering any RLS check.
--   DG-11A removes all direct authenticated table privileges.
--
-- ── FINAL audit_log STATE ────────────────────────────────────────────────────
--
--   public.audit_log after DG-11A (verified 2026-08-25):
--
--     owner                           = postgres
--     RLS enabled                     = true
--     FORCE RLS                       = false
--     RLS policy count                = 0
--     authenticated direct priv count = 0
--
--   anon had no direct CRUD privileges before DG-11A and remains unchanged.
--   service_role privileges were intentionally preserved — service_role
--   may be required for trusted backend, admin, or recovery workflows.
--   postgres owner privilege is unaffected.
--
-- ── AUDIT WRITE PATH ─────────────────────────────────────────────────────────
--
--   The sole write path to audit_log is via audit_trigger_fn(), which
--   executes as postgres (BYPASSRLS). No INSERT policy on audit_log exists
--   or is needed for this path. No application code directly INSERTs into
--   audit_log. The zero-policy RLS state on audit_log is intentional and
--   was established by DG-10A on 2026-08-25.
--
-- ── LIVE TRIGGER INVENTORY (post-DG-11A; triggers unchanged by DG-11A) ───────
--
--   The following six triggers invoke public.audit_trigger_fn().
--   All were confirmed live via pg_trigger evidence (DG-11 investigation,
--   2026-08-25). DG-11A did not create, drop, or alter any trigger.
--
--   trigger               table                    events          timing  level
--   ------------------    -----------------------  --------------- ------  -----
--   audit_batch_lineage   public.batch_lineage     INSERT          AFTER   ROW
--   audit_batches         public.batches           INSERT/DELETE/  AFTER   ROW
--                                                  UPDATE
--   audit_distribution    public.distribution_     INSERT/DELETE/  AFTER   ROW
--                         records                  UPDATE
--   audit_operations      public.operations        INSERT/DELETE/  AFTER   ROW
--                                                  UPDATE
--   audit_qc_inspections  public.qc_inspections    INSERT/DELETE/  AFTER   ROW
--                                                  UPDATE
--   audit_suppliers       public.suppliers         INSERT/DELETE/  AFTER   ROW
--                                                  UPDATE
--
--   All six are in normal enabled state (tgenabled = 'O').
--
-- ── HISTORICAL CORRECTION: audit_batch_lineage EVENT COVERAGE ────────────────
--
--   Repository comment in
--   supabase_dg4_batch_lineage_operations_qci_rls_normalization_20260823.sql
--   line 101 stated: "AFTER INSERT OR UPDATE OR DELETE".
--
--   Live pg_trigger evidence obtained during DG-11 investigation
--   (2026-08-25) proved that audit_batch_lineage currently fires on
--   INSERT ONLY. DG-11A did not alter this trigger or its event coverage.
--   The historical comment is stale and incorrect; the historical
--   migration file is not modified.
--
--   Whether DELETE and UPDATE should be added to audit_batch_lineage
--   remains an unresolved product and governance decision. It is not
--   addressed in DG-11A or DG-11B. Do not silently expand coverage
--   during canonical recovery.
--
-- ── suppliers TENANT SAFETY ───────────────────────────────────────────────────
--
--   Live co_suppliers policy (confirmed 2026-08-25):
--
--     FOR ALL  TO authenticated
--     USING:      (company_id = get_my_company_id())
--     WITH CHECK: (company_id = get_my_company_id())
--
--   UPDATE source rows and proposed new row state are both tenant-scoped.
--   DG-11A did not require any suppliers RLS changes.
--
-- ── DG-11B — DEFERRED CANONICAL TRIGGER AND FUNCTION RECOVERY ────────────────
--
--   DG-11A is NOT the canonical recovery source for audit_trigger_fn or
--   the six associated triggers.
--
--   Before DG-11, no executable CREATE FUNCTION for audit_trigger_fn and
--   no executable CREATE TRIGGER definitions for the six triggers existed
--   in any repository file. All were entirely out-of-band.
--
--   DG-11B (deferred) will close this recovery gap by capturing from the
--   verified post-DG-11A live database:
--
--     - exact pg_get_functiondef(public.audit_trigger_fn())
--     - exact pg_get_triggerdef() for all six triggers
--
--   DG-11B must preserve audit_batch_lineage as INSERT only, exactly as
--   confirmed by live evidence. It must not silently expand coverage.
--
-- ── WHAT DG-11A DOES NOT INCLUDE ─────────────────────────────────────────────
--
--   No CREATE TRIGGER, DROP TRIGGER, ALTER TRIGGER
--   No CREATE POLICY, ALTER POLICY, DROP POLICY
--   No GRANT
--   No CREATE TABLE, ALTER TABLE, DROP TABLE
--   No enum DDL
--   No changes to: current_org_id(), current_user_role() body,
--     get_my_company_id(), get_my_role(), activity_logs, batch_lineage
--     policies, batches policies, distribution_records policies,
--     operations policies, qc_inspections policies, suppliers policies
--
-- ── ROLLBACK NOTE ─────────────────────────────────────────────────────────────
--
--   The exact pre-DG-11A function body is known and documented in the
--   DG-11 read-only audit (2026-08-25). Restoring it would require
--   running CREATE OR REPLACE with the original body (no SET search_path,
--   unqualified audit_log/audit_action/current_user_role()).
--
--   Restoring the pre-DG-11A EXECUTE grants (PUBLIC, anon, authenticated,
--   service_role) and the authenticated table ACL on audit_log is NOT
--   recommended as normal recovery behavior. Both represented confirmed
--   hardening defects. If ACL restoration is ever required, authoritative
--   pre-live ACL evidence must be consulted before issuing any GRANTs.
--
-- ════════════════════════════════════════════════════════════════
-- EXECUTABLE MIGRATION
-- EXECUTED AND VERIFIED LIVE on 2026-08-25 via Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════

BEGIN;

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

REVOKE ALL PRIVILEGES
  ON TABLE public.audit_log
  FROM authenticated;

COMMIT;
