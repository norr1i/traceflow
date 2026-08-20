-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- TraceFlow — Revoke residual anon table grants
-- File:       supabase_public_trace_table_hardening_20260820.sql
-- Live-applied and smoke-tested: 2026-08-20
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
--
-- WHAT THIS FILE RECORDS
--   Revocation of all Supabase-default anon table grants from
--   public.products and public.production_orders. These grants existed
--   because Supabase applies GRANT ALL ON ALL TABLES ... TO anon at
--   table-creation time; they were never relied upon by any production
--   code path and represented a residual direct-REST attack surface.
--
-- LIVE VERIFICATION (2026-08-20)
--   • has_table_privilege('anon','public.products','SELECT')          = false
--   • has_table_privilege('anon','public.production_orders','SELECT') = false
--   • No anon RLS policies exist on either table (pg_policies: 0 rows)
--   • public /trace/<valid UUID> smoke test:                  PASS
--   • get_public_batch_trace returned product + QC + timeline: PASS
--   • log_scan_event inserted correct row in scan_events:      PASS
--
-- WHY THE REVOKES ARE SAFE
--
--   1. app/trace/[id]/page.tsx is UUID-only (commit 4d16026) and calls
--      ONLY two RPCs:
--        • get_public_batch_trace(p_batch_id uuid)
--        • log_scan_event(p_batch_id uuid, ...)
--      It performs NO direct .from('products') or .from('production_orders')
--      reads. Zero direct anon table access exists in the trace route.
--
--   2. Both RPCs are SECURITY DEFINER SET search_path = public.
--      They execute as the function owner (postgres superuser), which is
--      unconditionally exempt from table-level privilege checks (and from
--      RLS when FORCE ROW LEVEL SECURITY is not set). Revoking anon's
--      table grants has zero effect on these functions.
--
--   3. The tf_scan_company BEFORE INSERT trigger on scan_events is also
--      SECURITY DEFINER and queries production_orders as postgres superuser.
--      It is unaffected by this revocation.
--
--   4. All remaining consumers of products and production_orders are
--      authenticated routes (ProductsClient.tsx, ProductionClient.tsx,
--      ProductJourneyClient.tsx, AllBatchesClient.tsx, etc.) running under
--      the authenticated role with company-scoped RLS (co_products,
--      co_production_orders). authenticated grants are intentionally
--      untouched by this migration.
--
-- SCOPE
--   • Revokes: anon on public.products
--              anon on public.production_orders
--   • Does NOT touch: authenticated grants, RLS policies, function grants,
--     scan_events, or any other table
--
-- RELATED FILES
--   supabase_log_scan_event_hardening_20260819.sql — previous hardening step:
--     scan_events anon grants revoked, log_scan_event body hardened,
--     rate guard added, browser/device_type input caps added
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

BEGIN;

REVOKE ALL ON TABLE public.products            FROM anon;
REVOKE ALL ON TABLE public.production_orders   FROM anon;

COMMIT;
