-- ══════════════════════════════════════════════════════════════════════════════
-- TraceFlow — Profile Hardening Phase C
-- supabase_profile_hardening_phase_c_20260910.sql
--
-- Applied to production on 2026-09-10.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS FILE DOES
--   1. Revokes INSERT, UPDATE, DELETE on user_profiles from authenticated.
--   2. Drops the "up_write" RLS policy (which allowed self-UPDATE/DELETE with
--      no column restriction — a direct role-escalation and tenant-pivot vector).
--   3. Replaces get_recall_impact() with the tenant-boundary-safe version:
--      the company-resolution fallback (Steps 2–4, used by SQL Editor /
--      service-role callers) is now gated on auth.uid() IS NULL, preventing
--      an authenticated user with NULL company from resolving another
--      company's data via parameter-inferred company resolution.
--
-- DEPLOYMENT ORDER — critical, never reverse:
--   Phase A  → ensure_my_profile() created
--   App      → auth-context.tsx using rpc('ensure_my_profile'), deployed + verified
--   Phase C  → THIS FILE — lock down direct DML; fix get_recall_impact
--
-- WHY ORDER MATTERS
--   Reversing Phase C and App: after REVOKE INSERT/UPDATE/DELETE, any session
--   that still calls supabase.from('user_profiles').upsert(...) receives
--   "permission denied for table user_profiles" (error code 42501), causing
--   login failures for first-time users. Phase C must never precede the App
--   deploy.
--
-- EXPLOIT CHAINS CLOSED BY THIS FILE
--
--   Chain 1 (CRITICAL): Authenticated user calls
--     UPDATE user_profiles SET role = 'admin' WHERE user_id = auth.uid()
--   The up_write FOR ALL policy passed (user_id = auth.uid() USING + WITH CHECK).
--   After this file: REVOKE UPDATE removes the privilege; DROP POLICY up_write
--   removes the policy. Both defenses are required (privilege + policy in depth).
--
--   Chain 1b (CRITICAL): Same via SET company_id = 'victim-uuid'. After this
--   file: REVOKE UPDATE blocks it.
--
--   Chain 1c (HIGH): SET company_id = NULL to enable Chain 3. After this file:
--   REVOKE UPDATE blocks it.
--
--   Chain 2 (CRITICAL): Direct INSERT with arbitrary company_id bypasses
--   tf_bootstrap_company's invitation check (NEW.company_id IS NOT NULL → skip).
--   After this file: REVOKE INSERT blocks it.
--
--   Chain 3 (HIGH): Authenticated user with NULL company calls
--     get_recall_impact(p_lot_number := 'LOT-VICTIM')
--   get_my_company_id() returns NULL → function resolves company from lot parameter
--   → SECURITY DEFINER reads another company's data.
--   After this file: the guard `IF v_company_id IS NULL AND auth.uid() IS NULL`
--   means authenticated users with NULL company fall through to Step 5 (RETURN NULL)
--   instead of entering the parameter-based resolution. Only service-role and
--   SQL Editor callers (auth.uid() = NULL) retain the fallback.
--
-- NOTE ON DELETE
--   REVOKE DELETE is included because up_write was FOR ALL (which includes
--   DELETE in PostgreSQL). A self-row DELETE was not an escalation vector but
--   it was a data-destruction vector with no guard. All profile mutations must
--   now go through SECURITY DEFINER RPCs.
--
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Prerequisites ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- 1. ensure_my_profile() must exist (Phase A applied)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ensure_my_profile'
  ) THEN
    RAISE EXCEPTION
      'ABORT Phase C: ensure_my_profile() not found. Apply Phase A first, then deploy app changes, then apply Phase C.';
  END IF;

  -- 2. user_profiles table must exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_profiles'
  ) THEN
    RAISE EXCEPTION 'ABORT Phase C: user_profiles table not found';
  END IF;

  RAISE NOTICE 'Phase C prerequisites: OK';
END;
$$;


-- ── 1. Revoke direct DML from authenticated ───────────────────────────────────
-- After this point, no browser-side supabase.from('user_profiles').insert/update/delete
-- succeeds for the authenticated role. All profile mutations must go through
-- SECURITY DEFINER RPCs (ensure_my_profile, update_member_role, remove_team_member,
-- accept_my_invitation, create_my_company, cancel_invitation).
--
-- SELECT is intentionally NOT revoked — authenticated users still read their
-- own profile (scoped by the up_read RLS policy).
REVOKE INSERT ON TABLE public.user_profiles FROM authenticated;
REVOKE UPDATE ON TABLE public.user_profiles FROM authenticated;
REVOKE DELETE ON TABLE public.user_profiles FROM authenticated;


-- ── 2. Drop the unrestricted write policy ─────────────────────────────────────
-- up_write was: FOR ALL TO authenticated USING (user_id = auth.uid())
--                                         WITH CHECK (user_id = auth.uid())
-- It allowed UPDATE of ANY column including role, company_id, user_id, created_at,
-- and DELETE of the user's own row. The REVOKE above makes it inert, but we drop
-- it explicitly so it cannot be inadvertently re-granted and become active again.
-- IF NOT EXISTS phrasing: use DO to make idempotent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'user_profiles'
      AND policyname = 'up_write'
  ) THEN
    DROP POLICY "up_write" ON public.user_profiles;
    RAISE NOTICE 'up_write policy dropped';
  ELSE
    RAISE NOTICE 'up_write policy not found (already removed or never existed) — continuing';
  END IF;
END;
$$;


-- ── 3. get_recall_impact() — tenant-boundary fix ──────────────────────────────
--
-- ONE-LINE CHANGE vs. supabase_get_recall_impact_match_quality_20260906.sql:
--
--   BEFORE (line 169 of predecessor):
--     IF v_company_id IS NULL THEN
--
--   AFTER:
--     IF v_company_id IS NULL AND auth.uid() IS NULL THEN
--
-- All other code is verbatim from the predecessor (P0-E1).
-- Function name, parameters, RETURNS type, SECURITY DEFINER, SET search_path,
-- all four LOWER(TRIM) lot-number comparisons, ambiguity detection, match_source,
-- risk_level calculation, and all GRANT/REVOKE statements are unchanged.
--
CREATE OR REPLACE FUNCTION public.get_recall_impact(
  p_lot_number          text DEFAULT NULL,
  p_material_name       text DEFAULT NULL,
  p_batch_id            uuid DEFAULT NULL,
  p_raw_material_lot_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── Existing variables (unchanged from P0-A / P0-E1) ─────────────────
  v_company_id          uuid;
  v_batch_ids           uuid[];
  v_dist_batch_ids      uuid[];
  v_products            jsonb;
  v_batches             jsonb;
  v_distribution        jsonb;
  v_total_units         bigint  := 0;
  v_unique_recipients   bigint  := 0;
  v_has_recall          boolean := false;

  -- ── P0-E1: transparency metadata ─────────────────────────────────────
  v_scope_quality       text;
  v_ambiguity_detected  boolean := false;
  v_ambiguous_materials jsonb   := '[]'::jsonb;
  v_exact_batch_ids     uuid[];

BEGIN

  -- ── Step 1: resolve company via session (normal authenticated path) ───
  v_company_id := get_my_company_id();

  -- ── Steps 2–4: fallback for SQL Editor / service-role callers ─────────
  --
  -- SECURITY FIX (Phase C hardening):
  -- Previously: IF v_company_id IS NULL THEN
  -- Now:        IF v_company_id IS NULL AND auth.uid() IS NULL THEN
  --
  -- auth.uid() returns NULL for service-role requests (no sub claim in JWT)
  -- and for SQL Editor sessions. It returns a non-NULL uuid for any PostgREST
  -- request made with an authenticated user's JWT.
  --
  -- Inside SECURITY DEFINER, current_user is always the function owner
  -- (postgres), never 'authenticated'. auth.uid() is the only reliable
  -- discriminator between an authenticated browser call and a service/admin call.
  --
  -- Without this guard:
  --   An authenticated user with company_id = NULL (e.g., removed from their
  --   team, or in the window between profile creation and company assignment)
  --   can call get_recall_impact(p_lot_number := 'LOT-VICTIM') and the function
  --   resolves another company's ID from the lot parameter, then returns that
  --   company's full recall-impact data under SECURITY DEFINER access.
  --
  -- With this guard:
  --   Authenticated users with NULL company reach Step 5 (RETURN NULL).
  --   SQL Editor and service-role callers (auth.uid() = NULL) retain the
  --   parameter-based company resolution as before.
  --
  IF v_company_id IS NULL AND auth.uid() IS NULL THEN
    IF p_batch_id IS NOT NULL THEN
      SELECT company_id
      INTO   v_company_id
      FROM   production_orders
      WHERE  id = p_batch_id
      LIMIT  1;

    ELSIF p_raw_material_lot_id IS NOT NULL THEN
      SELECT rml.company_id
      INTO   v_company_id
      FROM   raw_material_lots rml
      WHERE  rml.id = p_raw_material_lot_id
      LIMIT  1;

    ELSIF p_lot_number IS NOT NULL THEN
      -- Site 1: company resolution from bill_of_materials (P0-A verbatim)
      SELECT bom.company_id
      INTO   v_company_id
      FROM   bill_of_materials bom
      WHERE  LOWER(TRIM(bom.lot_number)) = LOWER(TRIM(p_lot_number))
      LIMIT  1;

      IF v_company_id IS NULL THEN
        -- Site 2: company resolution fallback from raw_material_lots (P0-A verbatim)
        SELECT rml.company_id
        INTO   v_company_id
        FROM   raw_material_lots rml
        WHERE  LOWER(TRIM(rml.lot_number)) = LOWER(TRIM(p_lot_number))
        LIMIT  1;
      END IF;

    ELSIF p_material_name IS NOT NULL THEN
      SELECT bom.company_id
      INTO   v_company_id
      FROM   bill_of_materials bom
      WHERE  LOWER(TRIM(bom.material_name)) = LOWER(TRIM(p_material_name))
      LIMIT  1;
    END IF;
  END IF;

  -- ── Step 5: still no company → give up ───────────────────────────────
  IF v_company_id IS NULL THEN RETURN NULL; END IF;

  -- ── Resolve batch IDs (production_orders.id) ─────────────────────────
  IF p_raw_material_lot_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id)
    INTO   v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id          = v_company_id
      AND  bom.raw_material_lot_id = p_raw_material_lot_id;

    v_exact_batch_ids := v_batch_ids;

  ELSIF p_batch_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT id)
    INTO   v_batch_ids
    FROM   production_orders
    WHERE  id         = p_batch_id
      AND  company_id = v_company_id;

  ELSIF p_lot_number IS NOT NULL THEN

    SELECT ARRAY_AGG(DISTINCT bom.production_order_id)
    INTO   v_exact_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id = v_company_id
      AND  bom.raw_material_lot_id IN (
             SELECT id
             FROM   raw_material_lots
             WHERE  LOWER(TRIM(lot_number)) = LOWER(TRIM(p_lot_number))
               AND  company_id = v_company_id
           );

    SELECT ARRAY_AGG(DISTINCT bom.production_order_id)
    INTO   v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id = v_company_id
      AND  (
        bom.raw_material_lot_id IN (
          SELECT id
          FROM   raw_material_lots
          WHERE  LOWER(TRIM(lot_number)) = LOWER(TRIM(p_lot_number))
            AND  company_id = v_company_id
        )
        OR LOWER(TRIM(bom.lot_number)) = LOWER(TRIM(p_lot_number))
      );

    WITH material_contexts AS (
      SELECT
        LOWER(TRIM(rm.name)) AS norm_ctx,
        TRIM(rm.name)        AS raw_name
      FROM   raw_material_lots rml
      JOIN   raw_materials     rm  ON rm.id = rml.raw_material_id
      WHERE  rml.company_id              = v_company_id
        AND  LOWER(TRIM(rml.lot_number)) = LOWER(TRIM(p_lot_number))
        AND  rm.name IS NOT NULL
        AND  TRIM(rm.name) <> ''

      UNION ALL

      SELECT
        LOWER(TRIM(bom.material_name)) AS norm_ctx,
        TRIM(bom.material_name)        AS raw_name
      FROM   bill_of_materials bom
      WHERE  bom.company_id              = v_company_id
        AND  LOWER(TRIM(bom.lot_number)) = LOWER(TRIM(p_lot_number))
        AND  bom.material_name IS NOT NULL
        AND  TRIM(bom.material_name) <> ''
    ),
    deduped AS (
      SELECT DISTINCT ON (norm_ctx)
        norm_ctx,
        raw_name
      FROM   material_contexts
      WHERE  norm_ctx IS NOT NULL
        AND  norm_ctx <> ''
      ORDER  BY norm_ctx, raw_name
    )
    SELECT
      COUNT(*) > 1,
      CASE WHEN COUNT(*) > 1
           THEN COALESCE(jsonb_agg(raw_name ORDER BY raw_name), '[]'::jsonb)
           ELSE '[]'::jsonb
      END
    INTO v_ambiguity_detected, v_ambiguous_materials
    FROM deduped;

  ELSIF p_material_name IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id)
    INTO   v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id                  = v_company_id
      AND  LOWER(TRIM(bom.material_name)) = LOWER(TRIM(p_material_name));
  END IF;

  -- ── Derive scope_quality ──────────────────────────────────────────────
  v_scope_quality := CASE
    WHEN p_raw_material_lot_id IS NOT NULL THEN 'exact_uuid_lot'
    WHEN p_batch_id            IS NOT NULL THEN 'batch_exact'
    WHEN p_lot_number          IS NOT NULL THEN
      CASE WHEN v_ambiguity_detected
           THEN 'text_lot_ambiguous'
           ELSE 'text_lot_unambiguous'
      END
    WHEN p_material_name       IS NOT NULL THEN 'material_scope'
    ELSE NULL
  END;

  -- ── No matches ────────────────────────────────────────────────────────
  IF v_batch_ids IS NULL OR array_length(v_batch_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'affected_products',     '[]'::jsonb,
      'affected_batches',      '[]'::jsonb,
      'affected_distributors', '[]'::jsonb,
      'total_affected_units',  0,
      'total_batches',         0,
      'total_products',        0,
      'total_distributors',    0,
      'total_shipments',       0,
      'risk_level',            'none',
      'has_open_recall',       false,
      'scope_quality',         v_scope_quality,
      'ambiguity_detected',    v_ambiguity_detected,
      'ambiguous_materials',   v_ambiguous_materials
    );
  END IF;

  -- ── Resolve batches.id for distribution join ──────────────────────────
  SELECT ARRAY_AGG(DISTINCT b.id)
  INTO   v_dist_batch_ids
  FROM   batches b
  WHERE  b.production_order_id = ANY(v_batch_ids)
    AND  b.company_id          = v_company_id;

  -- ── Affected batches ──────────────────────────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'batch_id',     po.id,
        'product_name', COALESCE(p.name, 'Unknown'),
        'sku',          COALESCE(p.sku,  ''),
        'quantity',     po.quantity,
        'status',       po.status,
        'created_at',   po.created_at,
        'completed_at', po.completed_at,
        'match_source', CASE
                          WHEN p_raw_material_lot_id IS NOT NULL THEN 'exact_fk'
                          WHEN p_lot_number IS NOT NULL THEN
                            CASE WHEN po.id = ANY(v_exact_batch_ids)
                                 THEN 'exact_fk'
                                 ELSE 'text_match'
                            END
                          ELSE NULL
                        END
      ) ORDER BY po.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_batches
  FROM  production_orders po
  LEFT  JOIN products p ON p.id = po.product_id
  WHERE po.id         = ANY(v_batch_ids)
    AND po.company_id = v_company_id;

  -- ── Affected products ─────────────────────────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_name',      sub.product_name,
        'sku',               sub.sku,
        'produced_units',    sub.produced_units,
        'distributed_units', sub.distributed_units,
        'batch_count',       sub.batch_count
      ) ORDER BY sub.distributed_units DESC
    ),
    '[]'::jsonb
  )
  INTO v_products
  FROM (
    SELECT
      p.name                                  AS product_name,
      p.sku                                   AS sku,
      SUM(po.quantity)::bigint                AS produced_units,
      COALESCE(SUM(dist.shipped), 0)::bigint  AS distributed_units,
      COUNT(DISTINCT po.id)                   AS batch_count
    FROM  production_orders po
    JOIN  products          p    ON p.id = po.product_id
    LEFT  JOIN (
      SELECT b.production_order_id, SUM(d.quantity_shipped) AS shipped
      FROM   distribution_records d
      JOIN   batches              b ON b.id = d.batch_id
      WHERE  d.batch_id   = ANY(v_dist_batch_ids)
        AND  d.company_id = v_company_id
      GROUP  BY b.production_order_id
    ) dist ON dist.production_order_id = po.id
    WHERE po.id         = ANY(v_batch_ids)
      AND po.company_id = v_company_id
    GROUP BY p.id, p.name, p.sku
  ) sub;

  -- ── Downstream distribution ───────────────────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'batch_id',       dr.batch_id,
        'recipient_name', dr.recipient_name,
        'recipient_type', dr.recipient_type::text,
        'quantity',       dr.quantity_shipped,
        'shipped_at',     dr.shipped_at,
        'notes',          dr.notes
      ) ORDER BY dr.shipped_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_distribution
  FROM  distribution_records dr
  WHERE dr.company_id = v_company_id
    AND dr.batch_id   = ANY(v_dist_batch_ids);

  SELECT COALESCE(SUM(dr.quantity_shipped), 0)
  INTO   v_total_units
  FROM   distribution_records dr
  WHERE  dr.company_id = v_company_id
    AND  dr.batch_id   = ANY(v_dist_batch_ids);

  SELECT COALESCE(COUNT(DISTINCT dr.recipient_name), 0)
  INTO   v_unique_recipients
  FROM   distribution_records dr
  WHERE  dr.company_id = v_company_id
    AND  dr.batch_id   = ANY(v_dist_batch_ids);

  -- ── Open recall check ─────────────────────────────────────────────────
  SELECT EXISTS(
    SELECT 1 FROM recalls
    WHERE  batch_id   = ANY(v_batch_ids)
      AND  company_id = v_company_id
      AND  status    <> 'closed'
  ) INTO v_has_recall;

  -- ── Return full impact document ───────────────────────────────────────
  RETURN jsonb_build_object(
    'affected_products',     v_products,
    'affected_batches',      v_batches,
    'affected_distributors', v_distribution,
    'total_affected_units',  v_total_units,
    'total_batches',         jsonb_array_length(v_batches),
    'total_products',        jsonb_array_length(v_products),
    'total_distributors',    v_unique_recipients,
    'total_shipments',       jsonb_array_length(v_distribution),
    'risk_level',            CASE
                               WHEN v_has_recall AND v_total_units > 0 THEN 'critical'
                               WHEN v_has_recall                       THEN 'high'
                               WHEN v_total_units > 100                THEN 'high'
                               WHEN v_total_units > 0                  THEN 'medium'
                               WHEN jsonb_array_length(v_batches) > 0  THEN 'low'
                               ELSE                                         'none'
                             END,
    'has_open_recall',       v_has_recall,
    'scope_quality',         v_scope_quality,
    'ambiguity_detected',    v_ambiguity_detected,
    'ambiguous_materials',   v_ambiguous_materials
  );
END;
$$;

GRANT  EXECUTE ON FUNCTION public.get_recall_impact(text, text, uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_recall_impact(text, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_recall_impact(text, text, uuid, uuid) FROM anon;


-- ── Post-apply verification ───────────────────────────────────────────────────
DO $$
DECLARE
  rec_body text;
BEGIN
  -- 1. SELECT still granted to authenticated (RLS-protected reads must work)
  ASSERT has_table_privilege('authenticated', 'public.user_profiles', 'SELECT'),
    'FAIL: authenticated lost SELECT on user_profiles — RLS-scoped reads will break';

  -- 2. INSERT revoked from authenticated
  ASSERT NOT has_table_privilege('authenticated', 'public.user_profiles', 'INSERT'),
    'FAIL: authenticated still has INSERT on user_profiles — REVOKE did not take effect';

  -- 3. UPDATE revoked from authenticated
  ASSERT NOT has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE'),
    'FAIL: authenticated still has UPDATE on user_profiles — REVOKE did not take effect';

  -- 4. DELETE revoked from authenticated
  ASSERT NOT has_table_privilege('authenticated', 'public.user_profiles', 'DELETE'),
    'FAIL: authenticated still has DELETE on user_profiles — REVOKE did not take effect';

  -- 5. up_write policy gone
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'user_profiles'
      AND policyname = 'up_write'
  ), 'FAIL: up_write policy still exists after DROP';

  -- 6. get_recall_impact body contains the tenant-boundary guard
  SELECT pg_get_functiondef(p.oid)
  INTO   rec_body
  FROM   pg_proc p
  JOIN   pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'get_recall_impact';

  ASSERT rec_body IS NOT NULL,
    'FAIL: get_recall_impact() not found after CREATE OR REPLACE';

  ASSERT rec_body LIKE '%auth.uid() IS NULL%',
    'FAIL: get_recall_impact() body does not contain ''auth.uid() IS NULL'' — Phase C fix not applied';

  RAISE NOTICE '';
  RAISE NOTICE '=== Phase C Complete ===';
  RAISE NOTICE 'user_profiles:';
  RAISE NOTICE '  authenticated INSERT   REVOKED';
  RAISE NOTICE '  authenticated UPDATE   REVOKED';
  RAISE NOTICE '  authenticated DELETE   REVOKED';
  RAISE NOTICE '  authenticated SELECT   intact (RLS-scoped)';
  RAISE NOTICE '  up_write policy        DROPPED';
  RAISE NOTICE 'get_recall_impact():';
  RAISE NOTICE '  company fallback guard AND auth.uid() IS NULL   APPLIED';
  RAISE NOTICE '';
  RAISE NOTICE 'Chain 1 (role self-escalation)      CLOSED';
  RAISE NOTICE 'Chain 1b (company_id pivot)         CLOSED';
  RAISE NOTICE 'Chain 1c (NULL company self-set)    CLOSED';
  RAISE NOTICE 'Chain 2 (direct INSERT + skip)      CLOSED';
  RAISE NOTICE 'Chain 3 (NULL company recall pivot) CLOSED';
END;
$$;

COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK Phase C  — fully self-contained
--
-- Restores: INSERT/UPDATE/DELETE on user_profiles, up_write policy,
-- and get_recall_impact at the exact P0-E1 version
-- (supabase_get_recall_impact_match_quality_20260906.sql).
--
-- The full P0-E1 function body is embedded below — no external file needed.
--
-- Apply ONLY after confirming no ongoing profile mutations are in flight.
-- Rollback order if both Phase A and Phase C must be reversed:
--   1. This file (Phase C rollback) — restore DML grants + recall function
--   2. Redeploy app to use direct upsert (remove rpc('ensure_my_profile'))
--   3. Phase A rollback — drop ensure_my_profile()
-- ══════════════════════════════════════════════════════════════════════════════
/*

BEGIN;

GRANT INSERT ON TABLE public.user_profiles TO authenticated;
GRANT UPDATE ON TABLE public.user_profiles TO authenticated;
GRANT DELETE ON TABLE public.user_profiles TO authenticated;

-- Restore up_write policy (verbatim from supabase_multitenancy_v2.sql)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'up_write'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "up_write" ON public.user_profiles
      FOR ALL TO authenticated
      USING     (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
    $pol$;
    RAISE NOTICE 'up_write policy restored';
  ELSE
    RAISE NOTICE 'up_write policy already exists — skipping';
  END IF;
END;
$$;

-- Restore get_recall_impact at P0-E1 (supabase_get_recall_impact_match_quality_20260906.sql verbatim).
-- ONE LINE DIFFERENCE FROM PHASE C: "IF v_company_id IS NULL THEN" (no auth.uid() IS NULL guard).
CREATE OR REPLACE FUNCTION public.get_recall_impact(
  p_lot_number          text DEFAULT NULL,
  p_material_name       text DEFAULT NULL,
  p_batch_id            uuid DEFAULT NULL,
  p_raw_material_lot_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id          uuid;
  v_batch_ids           uuid[];
  v_dist_batch_ids      uuid[];
  v_products            jsonb;
  v_batches             jsonb;
  v_distribution        jsonb;
  v_total_units         bigint  := 0;
  v_unique_recipients   bigint  := 0;
  v_has_recall          boolean := false;
  v_scope_quality       text;
  v_ambiguity_detected  boolean := false;
  v_ambiguous_materials jsonb   := '[]'::jsonb;
  v_exact_batch_ids     uuid[];
BEGIN
  v_company_id := get_my_company_id();

  -- P0-E1 original (no auth.uid() IS NULL guard):
  IF v_company_id IS NULL THEN
    IF p_batch_id IS NOT NULL THEN
      SELECT company_id INTO v_company_id
      FROM   production_orders WHERE id = p_batch_id LIMIT 1;
    ELSIF p_raw_material_lot_id IS NOT NULL THEN
      SELECT rml.company_id INTO v_company_id
      FROM   raw_material_lots rml WHERE rml.id = p_raw_material_lot_id LIMIT 1;
    ELSIF p_lot_number IS NOT NULL THEN
      SELECT bom.company_id INTO v_company_id
      FROM   bill_of_materials bom
      WHERE  LOWER(TRIM(bom.lot_number)) = LOWER(TRIM(p_lot_number)) LIMIT 1;
      IF v_company_id IS NULL THEN
        SELECT rml.company_id INTO v_company_id
        FROM   raw_material_lots rml
        WHERE  LOWER(TRIM(rml.lot_number)) = LOWER(TRIM(p_lot_number)) LIMIT 1;
      END IF;
    ELSIF p_material_name IS NOT NULL THEN
      SELECT bom.company_id INTO v_company_id
      FROM   bill_of_materials bom
      WHERE  LOWER(TRIM(bom.material_name)) = LOWER(TRIM(p_material_name)) LIMIT 1;
    END IF;
  END IF;

  IF v_company_id IS NULL THEN RETURN NULL; END IF;

  IF p_raw_material_lot_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id) INTO v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id = v_company_id AND bom.raw_material_lot_id = p_raw_material_lot_id;
    v_exact_batch_ids := v_batch_ids;
  ELSIF p_batch_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT id) INTO v_batch_ids
    FROM   production_orders WHERE id = p_batch_id AND company_id = v_company_id;
  ELSIF p_lot_number IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id) INTO v_exact_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id = v_company_id
      AND  bom.raw_material_lot_id IN (
             SELECT id FROM raw_material_lots
             WHERE  LOWER(TRIM(lot_number)) = LOWER(TRIM(p_lot_number)) AND company_id = v_company_id
           );
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id) INTO v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id = v_company_id
      AND  (
        bom.raw_material_lot_id IN (
          SELECT id FROM raw_material_lots
          WHERE  LOWER(TRIM(lot_number)) = LOWER(TRIM(p_lot_number)) AND company_id = v_company_id
        )
        OR LOWER(TRIM(bom.lot_number)) = LOWER(TRIM(p_lot_number))
      );
    WITH material_contexts AS (
      SELECT LOWER(TRIM(rm.name)) AS norm_ctx, TRIM(rm.name) AS raw_name
      FROM   raw_material_lots rml JOIN raw_materials rm ON rm.id = rml.raw_material_id
      WHERE  rml.company_id = v_company_id AND LOWER(TRIM(rml.lot_number)) = LOWER(TRIM(p_lot_number))
        AND  rm.name IS NOT NULL AND TRIM(rm.name) <> ''
      UNION ALL
      SELECT LOWER(TRIM(bom.material_name)) AS norm_ctx, TRIM(bom.material_name) AS raw_name
      FROM   bill_of_materials bom
      WHERE  bom.company_id = v_company_id AND LOWER(TRIM(bom.lot_number)) = LOWER(TRIM(p_lot_number))
        AND  bom.material_name IS NOT NULL AND TRIM(bom.material_name) <> ''
    ),
    deduped AS (
      SELECT DISTINCT ON (norm_ctx) norm_ctx, raw_name FROM material_contexts
      WHERE  norm_ctx IS NOT NULL AND norm_ctx <> '' ORDER BY norm_ctx, raw_name
    )
    SELECT COUNT(*) > 1,
           CASE WHEN COUNT(*) > 1 THEN COALESCE(jsonb_agg(raw_name ORDER BY raw_name), '[]'::jsonb)
                ELSE '[]'::jsonb END
    INTO v_ambiguity_detected, v_ambiguous_materials FROM deduped;
  ELSIF p_material_name IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT bom.production_order_id) INTO v_batch_ids
    FROM   bill_of_materials bom
    WHERE  bom.company_id = v_company_id
      AND  LOWER(TRIM(bom.material_name)) = LOWER(TRIM(p_material_name));
  END IF;

  v_scope_quality := CASE
    WHEN p_raw_material_lot_id IS NOT NULL THEN 'exact_uuid_lot'
    WHEN p_batch_id            IS NOT NULL THEN 'batch_exact'
    WHEN p_lot_number          IS NOT NULL THEN
      CASE WHEN v_ambiguity_detected THEN 'text_lot_ambiguous' ELSE 'text_lot_unambiguous' END
    WHEN p_material_name       IS NOT NULL THEN 'material_scope'
    ELSE NULL
  END;

  IF v_batch_ids IS NULL OR array_length(v_batch_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'affected_products','[]'::jsonb,'affected_batches','[]'::jsonb,
      'affected_distributors','[]'::jsonb,'total_affected_units',0,
      'total_batches',0,'total_products',0,'total_distributors',0,'total_shipments',0,
      'risk_level','none','has_open_recall',false,
      'scope_quality',v_scope_quality,'ambiguity_detected',v_ambiguity_detected,
      'ambiguous_materials',v_ambiguous_materials
    );
  END IF;

  SELECT ARRAY_AGG(DISTINCT b.id) INTO v_dist_batch_ids
  FROM   batches b WHERE b.production_order_id = ANY(v_batch_ids) AND b.company_id = v_company_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'batch_id',po.id,'product_name',COALESCE(p.name,'Unknown'),'sku',COALESCE(p.sku,''),
    'quantity',po.quantity,'status',po.status,'created_at',po.created_at,'completed_at',po.completed_at,
    'match_source',CASE
      WHEN p_raw_material_lot_id IS NOT NULL THEN 'exact_fk'
      WHEN p_lot_number IS NOT NULL THEN
        CASE WHEN po.id = ANY(v_exact_batch_ids) THEN 'exact_fk' ELSE 'text_match' END
      ELSE NULL END
  ) ORDER BY po.created_at DESC),'[]'::jsonb) INTO v_batches
  FROM production_orders po LEFT JOIN products p ON p.id = po.product_id
  WHERE po.id = ANY(v_batch_ids) AND po.company_id = v_company_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_name',sub.product_name,'sku',sub.sku,'produced_units',sub.produced_units,
    'distributed_units',sub.distributed_units,'batch_count',sub.batch_count
  ) ORDER BY sub.distributed_units DESC),'[]'::jsonb) INTO v_products
  FROM (
    SELECT p.name AS product_name, p.sku, SUM(po.quantity)::bigint AS produced_units,
           COALESCE(SUM(dist.shipped),0)::bigint AS distributed_units, COUNT(DISTINCT po.id) AS batch_count
    FROM   production_orders po JOIN products p ON p.id = po.product_id
    LEFT   JOIN (
      SELECT b.production_order_id, SUM(d.quantity_shipped) AS shipped
      FROM   distribution_records d JOIN batches b ON b.id = d.batch_id
      WHERE  d.batch_id = ANY(v_dist_batch_ids) AND d.company_id = v_company_id
      GROUP  BY b.production_order_id
    ) dist ON dist.production_order_id = po.id
    WHERE  po.id = ANY(v_batch_ids) AND po.company_id = v_company_id
    GROUP  BY p.id, p.name, p.sku
  ) sub;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'batch_id',dr.batch_id,'recipient_name',dr.recipient_name,
    'recipient_type',dr.recipient_type::text,'quantity',dr.quantity_shipped,
    'shipped_at',dr.shipped_at,'notes',dr.notes
  ) ORDER BY dr.shipped_at DESC),'[]'::jsonb) INTO v_distribution
  FROM distribution_records dr
  WHERE dr.company_id = v_company_id AND dr.batch_id = ANY(v_dist_batch_ids);

  SELECT COALESCE(SUM(dr.quantity_shipped),0) INTO v_total_units
  FROM   distribution_records dr
  WHERE  dr.company_id = v_company_id AND dr.batch_id = ANY(v_dist_batch_ids);

  SELECT COALESCE(COUNT(DISTINCT dr.recipient_name),0) INTO v_unique_recipients
  FROM   distribution_records dr
  WHERE  dr.company_id = v_company_id AND dr.batch_id = ANY(v_dist_batch_ids);

  SELECT EXISTS(
    SELECT 1 FROM recalls
    WHERE batch_id = ANY(v_batch_ids) AND company_id = v_company_id AND status <> 'closed'
  ) INTO v_has_recall;

  RETURN jsonb_build_object(
    'affected_products',v_products,'affected_batches',v_batches,'affected_distributors',v_distribution,
    'total_affected_units',v_total_units,'total_batches',jsonb_array_length(v_batches),
    'total_products',jsonb_array_length(v_products),'total_distributors',v_unique_recipients,
    'total_shipments',jsonb_array_length(v_distribution),
    'risk_level',CASE WHEN v_has_recall AND v_total_units > 0 THEN 'critical'
                      WHEN v_has_recall THEN 'high' WHEN v_total_units > 100 THEN 'high'
                      WHEN v_total_units > 0 THEN 'medium'
                      WHEN jsonb_array_length(v_batches) > 0 THEN 'low' ELSE 'none' END,
    'has_open_recall',v_has_recall,'scope_quality',v_scope_quality,
    'ambiguity_detected',v_ambiguity_detected,'ambiguous_materials',v_ambiguous_materials
  );
END;
$$;

GRANT  EXECUTE ON FUNCTION public.get_recall_impact(text, text, uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_recall_impact(text, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_recall_impact(text, text, uuid, uuid) FROM anon;

DO $$
DECLARE rec_body text;
BEGIN
  ASSERT has_table_privilege('authenticated', 'public.user_profiles', 'INSERT'),
    'Rollback FAIL: INSERT not restored';
  ASSERT has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE'),
    'Rollback FAIL: UPDATE not restored';
  ASSERT has_table_privilege('authenticated', 'public.user_profiles', 'DELETE'),
    'Rollback FAIL: DELETE not restored';
  SELECT pg_get_functiondef(p.oid) INTO rec_body
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_recall_impact';
  ASSERT rec_body NOT LIKE '%auth.uid() IS NULL%',
    'Rollback FAIL: get_recall_impact still contains Phase C guard';
  RAISE NOTICE 'Phase C rollback verified.';
END;
$$;

COMMIT;

*/
