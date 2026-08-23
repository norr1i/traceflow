-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- TraceFlow — Harden current_org_id() and current_user_role():
--             add SET search_path = public; revoke temporary anon EXECUTE
-- File:       supabase_helpers_search_path_hardening_20260823.sql
-- Live-applied and smoke-tested: 2026-08-23
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
--
-- SCOPE
--   public.current_org_id() and public.current_user_role():
--     1. Add SET search_path = public to both SECURITY DEFINER functions.
--        Applied 2026-08-23 immediately after pg_get_functiondef verified
--        the live bodies.
--     2. ACL finalization: revoke temporary anon EXECUTE grant.
--        Applied 2026-08-23 after DG-4 normalization confirmed zero
--        helper-dependent TO PUBLIC policies remain.
--
--   No RLS policies are modified.
--   No application code is modified.
--   No table-level grants are modified.
--
-- FIRST AUTHORITATIVE REPOSITORY CAPTURE
--
--   This file is the first repository definition of public.current_org_id()
--   and public.current_user_role(). Prior to this file, both functions existed
--   only as out-of-band live objects with no repository representation — created
--   directly in the Supabase SQL Editor and never committed to version control.
--
--   The function bodies below were verified verbatim via pg_get_functiondef()
--   immediately before writing this file (2026-08-23). The live bodies are
--   reproduced exactly.
--
-- THE ONLY FUNCTION-DEFINITION CHANGE: SET search_path = public
--
--   The following properties are UNCHANGED from the live definitions:
--     • Return types  — uuid (current_org_id), text (current_user_role)
--     • Language      — plpgsql
--     • Volatility    — STABLE
--     • Security      — SECURITY DEFINER
--     • JWT fallback  — auth.jwt() -> 'app_metadata' ->> 'company_id'/'role'
--     • EXCEPTION     — WHEN others THEN RETURN NULL
--     • auth.uid()    — schema-qualified; unaffected by search_path
--     • auth.jwt()    — schema-qualified; unaffected by search_path
--     • NULL behavior — returns NULL when no user_profiles row and no JWT match
--
--   SET search_path = public anchors the unqualified 'user_profiles' identifier
--   to public.user_profiles unconditionally, regardless of the calling session's
--   search_path. auth.uid() and auth.jwt() are explicitly schema-qualified as
--   auth.* and are completely unaffected by any search_path setting.
--
-- WHY search_path MATTERS FOR SECURITY DEFINER FUNCTIONS
--
--   A SECURITY DEFINER function without SET search_path resolves unqualified
--   object names using the CALLING SESSION's search_path at execution time, not
--   the function owner's. A session with search_path = 'evil_schema, public'
--   where evil_schema.user_profiles returns an attacker-controlled company_id or
--   role value could bypass company isolation (USING clauses) or role restriction
--   (WITH CHECK clauses) on any table that uses these helpers in its RLS policies.
--
--   In Supabase's PostgREST environment, the practical attack surface is low
--   (PostgREST sets search_path = public for all API connections and clients
--   cannot issue SET search_path directly via the REST API). The formal
--   vulnerability exists nevertheless, and this programme closes it consistently
--   across all SECURITY DEFINER objects.
--
-- EXECUTE ACL — CONFIRMED LIVE STATE AND FINALIZATION
--
--   PRE-CHANGE ACL (verified via aclexplode before any hardening, 2026-08-23):
--
--     aclexplode(proacl) confirmed NO PUBLIC grantee row — all grants were
--     explicit per-role entries. How these explicit grants were originally
--     created is unverified (aclexplode shows only the current ACL state,
--     not grant provenance):
--
--       postgres      — explicit direct EXECUTE (owner)
--       authenticated — explicit direct EXECUTE (confirmed; provenance unverified)
--       service_role  — explicit direct EXECUTE (confirmed; provenance unverified)
--       anon          — explicit direct EXECUTE (confirmed; provenance unverified)
--
--     Because no PUBLIC grantee row existed, REVOKE FROM PUBLIC would have
--     been a no-op. The ACL finalization target was therefore anon directly.
--
--   WHY anon EXECUTE WAS REVOKED:
--
--     After DG-4 (supabase_dg4_batch_lineage_operations_qci_rls_normalization_
--     20260823.sql) all 19 helper-dependent RLS policies across 8 tables are
--     TO authenticated. anon sessions no longer trigger any policy evaluation
--     that calls current_org_id() or current_user_role(). The explicit anon
--     EXECUTE grant is structurally unnecessary and violates least privilege.
--
--     DG-4 precondition: this ACL finalization was deliberately deferred until
--     DG-4 confirmed zero helper-dependent TO PUBLIC policies (post-DG-4
--     verification: dg4_public_policies_remaining = 0). Revoking anon EXECUTE
--     before DG-4 would have caused "permission denied for function" errors on
--     the three tables whose policies were still TO PUBLIC at that time.
--
--   WHY authenticated EXECUTE IS RETAINED:
--
--     Authenticated sessions trigger all 19 TO authenticated policies.
--     PostgreSQL evaluates each USING/WITH CHECK expression with the privileges
--     of the authenticated role. SECURITY DEFINER does not waive the caller
--     EXECUTE requirement — it only changes what the function body runs as.
--     authenticated must hold EXECUTE for RLS policy evaluation to proceed.
--     The explicit direct grant already existed; GRANT TO authenticated here
--     is redundant but explicit for documentation and idempotency.
--
--   WHY service_role EXECUTE IS PRESERVED:
--
--     service_role holds an explicit direct EXECUTE grant confirmed via
--     aclexplode. This grant is independent of the anon revoke. service_role
--     bypasses RLS (BYPASSRLS attribute) and therefore never needs EXECUTE
--     on these functions for policy evaluation, but the grant is retained
--     to avoid regressions in any direct operational or diagnostic SQL that
--     calls these functions under the service_role session.
--
--   POST-FINALIZATION ACL (live-verified 2026-08-23 after DG-4):
--
--       postgres      — explicit direct EXECUTE (owner; unchanged)
--       authenticated — explicit direct EXECUTE (retained; unchanged)
--       service_role  — explicit direct EXECUTE (retained; unchanged)
--       anon          — EXECUTE = false (explicit grant revoked)
--
-- KNOWN DEPENDENT RLS POLICIES (all TO authenticated after DG-2/DG-3/activity
--   hardening + DG-4; 19 policies across 8 tables)
--
--   public.distribution_records:
--     dist_select   FOR SELECT  USING  (company_id = current_org_id())
--     dist_insert   FOR INSERT  WITH CHECK  (current_org_id() + current_user_role())
--     dist_update   FOR UPDATE  USING/WITH CHECK (current_org_id() + current_user_role())
--
--   public.batches:
--     batches_select  FOR SELECT  USING  (company_id = current_org_id())
--     batches_insert  FOR INSERT  WITH CHECK  (current_org_id() + current_user_role())
--     batches_update  FOR UPDATE  USING/WITH CHECK (current_org_id() + current_user_role())
--
--   public.batch_events:
--     events_select  FOR SELECT  USING  (company_id = current_org_id())
--     events_insert  FOR INSERT  WITH CHECK  (company_id = current_org_id())
--
--   public.recall_affected_batches:
--     rab_select  FOR SELECT  USING  (company_id = current_org_id())
--     rab_insert  FOR INSERT  WITH CHECK  ((company_id = current_org_id()) AND
--                               (current_user_role() = ANY (ARRAY['admin','manager'])))
--
--   public.audit_log:
--     audit_log_select  FOR SELECT  USING  (company_id = current_org_id() +
--                                           current_user_role() authorization logic)
--
--   public.batch_lineage:                  normalized by DG-4
--     lineage_select  FOR SELECT  USING  (company_id = current_org_id())
--     lineage_insert  FOR INSERT  WITH CHECK  (current_org_id() + current_user_role())
--
--   public.operations:                     normalized by DG-4
--     operations_select  FOR SELECT  USING  (company_id = current_org_id())
--     operations_insert  FOR INSERT  WITH CHECK  (current_org_id() + current_user_role())
--     operations_update  FOR UPDATE  USING/WITH CHECK (current_org_id() + current_user_role())
--
--   public.qc_inspections:                 normalized by DG-4
--     qci_select  FOR SELECT  USING  (company_id = current_org_id())
--     qci_insert  FOR INSERT  WITH CHECK  (current_org_id() + current_user_role())
--     qci_update  FOR UPDATE  USING/WITH CHECK (current_org_id() + current_user_role())
--
--   Total: 19 known dependent policies across 8 tables.
--   No policy definitions are modified by this file.
--
-- PUBLIC /TRACE ROUTE — UNAFFECTED
--
--   The public /trace route is served by get_public_batch_trace(uuid) and
--   get_batch_journey(uuid) — SECURITY DEFINER functions that execute as the
--   postgres superuser (BYPASSRLS). These functions read from production_orders,
--   products, bill_of_materials, suppliers, batch_qc_results, and sales. Neither
--   function calls current_org_id() or current_user_role(). The /trace route is
--   completely independent of anon EXECUTE on these helpers and is unaffected by
--   this change.
--
-- EXISTING DEFERRED GOVERNANCE ITEMS (separate future tasks; NOT addressed here)
--
--   1. get_my_company_id() / get_my_role() anon EXECUTE:
--      Both repository helpers have SET search_path = public and GRANT TO
--      authenticated. Their anon EXECUTE state has not been explicitly audited
--      via aclexplode. A follow-on review and targeted revoke may be warranted
--      for consistency with the model applied here.
--
--   2. batches table DDL capture:
--      public.batches has no CREATE TABLE in any repository file. Its schema and
--      index definitions exist only as live out-of-band objects.
--
--   3. Verbatim USING/WITH CHECK capture for dist_insert, dist_update,
--      batches_insert, batches_update:
--      These expressions were preserved in place by DG-2 ALTER POLICY statements
--      but have never been captured verbatim in any repository file.
--
--   4. sfda_tables.sql old-named stale policy cleanup:
--      supabase_sfda_tables.sql creates old-named TO PUBLIC policies on
--      batch_events and distribution_records that coexist with the live
--      TO authenticated policies post-DG-2. A dedicated cleanup migration to
--      DROP those old-named policies is documented but not yet written.
--
--   5. co_batch_lineage permissive-policy overlap on batch_lineage:
--      co_batch_lineage (FOR ALL TO authenticated, USING/WITH CHECK:
--      company_id = get_my_company_id()) coexists with lineage_insert and
--      lineage_select. Because permissive policies combine with OR, co_batch_lineage
--      bypasses lineage_insert's current_user_role() role restriction. This is a
--      pre-existing gap not introduced by DG-4. Future DG-5 candidate: consolidate
--      batch_lineage to a single policy with correct role restriction.
--
--   6. operations and qc_inspections DDL:
--      Both tables are entirely out-of-band with no CREATE TABLE or DDL in any
--      repository file. A future governance task should capture their schema,
--      indexes, and trigger definitions.
--
-- PRE-CHANGE LIVE STATE (verified 2026-08-23 before applying this file)
--
--   current_org_id():
--     SECURITY DEFINER  = true
--     STABLE            = true
--     SET search_path   = MISSING
--     postgres  EXECUTE = true  (explicit direct — owner)
--     auth      EXECUTE = true  (explicit direct — confirmed via aclexplode; provenance unverified)
--     svc       EXECUTE = true  (explicit direct — confirmed via aclexplode; provenance unverified)
--     anon      EXECUTE = true  (explicit direct — confirmed via aclexplode; provenance unverified)
--     PUBLIC             = no grantee row in proacl
--
--   current_user_role():
--     SECURITY DEFINER  = true
--     STABLE            = true
--     SET search_path   = MISSING
--     postgres  EXECUTE = true  (explicit direct — owner)
--     auth      EXECUTE = true  (explicit direct — confirmed via aclexplode; provenance unverified)
--     svc       EXECUTE = true  (explicit direct — confirmed via aclexplode; provenance unverified)
--     anon      EXECUTE = true  (explicit direct — confirmed via aclexplode; provenance unverified)
--     PUBLIC             = no grantee row in proacl
--
--   helper-dependent TO PUBLIC policies: 8 (batch_lineage ×2, operations ×3,
--     qc_inspections ×3) — normalized by DG-4 before ACL finalization
--
-- POST-CHANGE LIVE STATE (verified 2026-08-23 after DG-4 + ACL finalization)
--
--   Both functions:
--     SECURITY DEFINER  = true          (unchanged)
--     STABLE            = true          (unchanged)
--     SET search_path   = public        ✓ (added)
--     postgres  EXECUTE = true          (unchanged — owner)
--     auth      EXECUTE = true          (unchanged — explicit direct)
--     svc       EXECUTE = true          (unchanged — explicit direct)
--     anon      EXECUTE = false         ✓ (explicit direct grant revoked)
--
--   All 19 dependent policies: TO authenticated, USING/WITH CHECK unchanged  ✓
--   helper-dependent TO PUBLIC policies: 0  ✓
--
-- IDEMPOTENCY
--
--   This file is safe to re-run:
--     CREATE OR REPLACE on unchanged body + signature — no-op on subsequent runs
--     REVOKE EXECUTE FROM anon — idempotent (no-op if anon grant already absent)
--     GRANT EXECUTE TO authenticated — idempotent (no-op if grant already present)
--
-- HARDENING / GOVERNANCE SERIES CONTEXT (chronological)
--   supabase_log_scan_event_hardening_20260819.sql
--     scan_events: anon grants revoked, log_scan_event hardened
--   supabase_public_trace_table_hardening_20260820.sql
--     products, production_orders: anon grants revoked
--   supabase_public_trace_batch1_hardening_20260820.sql
--     batch_qc_results, bill_of_materials: anon grants revoked
--   supabase_public_trace_batch2_hardening_20260821.sql
--     recalls, capas: anon grants revoked
--   supabase_public_trace_batch3_hardening_20260821.sql
--     raw_material_lots, raw_materials: anon grants revoked
--   supabase_public_trace_batch4_hardening_20260821.sql
--     quality_inspections, distribution_records: anon grants revoked
--   supabase_public_trace_batch5_hardening_20260821.sql
--     batches, batch_journey_events: anon grants revoked
--   supabase_public_trace_batch6_hardening_20260821.sql
--     batch_events: anon grants revoked
--   supabase_lookup_invitation_hardening_20260821.sql
--     lookup_invitation: PUBLIC EXECUTE revoked
--   supabase_rls_policy_role_normalization_20260822.sql  (DG-2)
--     distribution_records, batches, batch_events:
--     8 live TO PUBLIC policies normalized to TO authenticated
--   supabase_dg3_recall_rls_normalization_20260822.sql   (DG-3)
--     recall_affected_batches: 5-policy coexistence collapsed to 3-policy
--     TO authenticated; stale INSERT allowlist corrected to admin + manager
--   supabase_activity_audit_log_hardening_20260822.sql
--     audit_log: anon grants revoked, audit_log_select TO authenticated
--     activity_logs: anon grants revoked, both policies TO authenticated
--   supabase_helpers_search_path_hardening_20260823.sql  ← THIS FILE (phase 1)
--     current_org_id(), current_user_role():
--     SET search_path = public added (phase 1, applied before DG-4)
--   supabase_dg4_batch_lineage_operations_qci_rls_normalization_20260823.sql (DG-4)
--     batch_lineage, operations, qc_inspections:
--     8 TO PUBLIC policies normalized to TO authenticated; anon grants revoked
--   supabase_helpers_search_path_hardening_20260823.sql  ← THIS FILE (phase 2)
--     current_org_id(), current_user_role():
--     anon EXECUTE revoked (applied after DG-4 verification)
--
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

BEGIN;

CREATE OR REPLACE FUNCTION public.current_org_id()
  RETURNS uuid
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $function$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id
  INTO v_company_id
  FROM public.user_profiles
  WHERE user_id = auth.uid();

  IF v_company_id IS NOT NULL THEN
    RETURN v_company_id;
  END IF;

  RETURN (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid;

EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$;

-- anon held EXECUTE via explicit direct grant confirmed via aclexplode (not PUBLIC;
-- provenance unverified). REVOKE FROM anon removes that grant. Safe after DG-4
-- confirms zero helper-dependent TO PUBLIC policies remain.
REVOKE EXECUTE ON FUNCTION public.current_org_id() FROM anon;
-- authenticated already held explicit direct EXECUTE; this GRANT is idempotent.
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_role()
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $function$
DECLARE
  v_role text;
BEGIN
  SELECT role
  INTO v_role
  FROM public.user_profiles
  WHERE user_id = auth.uid();

  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;

  RETURN auth.jwt() -> 'app_metadata' ->> 'role';

EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$;

-- Same rationale as current_org_id() above.
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

COMMIT;
