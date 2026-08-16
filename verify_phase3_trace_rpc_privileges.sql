-- ══════════════════════════════════════════════════════════════════════════════
-- PHASE 3 VERIFICATION: Confirm privilege state after running
--                       phase3_lock_legacy_trace_rpcs.sql
-- TraceFlow Security Hardening
-- ══════════════════════════════════════════════════════════════════════════════
--
-- READ-ONLY — no writes, no side effects.  Safe to run in the Supabase
-- SQL editor on production after the migration file has been executed.
--
-- Run this file SECTION BY SECTION (or all at once — Supabase shows the last
-- result set, so run the three SELECT blocks individually for full output).
--
-- EXPECTED RESULTS
-- ────────────────
--   Legacy RPCs (get_batch_trace, get_batch_journey, get_root_cause_analysis):
--     anon_execute          = false
--     authenticated_execute = true
--     service_role_execute  = true
--     public_execute        = false
--     status                = PASS
--
--   get_public_batch_trace:
--     anon_execute          = true
--     authenticated_execute = true
--     service_role_execute  = true
--     public_execute        = false
--     status                = PASS
--
--   Security check on get_public_batch_trace:
--     is_security_definer   = true
--     has_search_path_set   = true
--     security_status       = PASS
--
--   Final verdict (Section C): PASS — PHASE 3 PRIVILEGES CORRECT
-- ══════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION A: Privilege matrix (one row per function, PASS/FAIL per row)
-- Run this first.
-- ─────────────────────────────────────────────────────────────────────────────

WITH func_info AS (
  SELECT
    p.oid,
    p.proname    AS function_name,
    p.proacl,
    p.prosecdef,
    p.proconfig
  FROM pg_proc      p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname       = 'public'
    AND p.proname       IN (
          'get_batch_trace',
          'get_batch_journey',
          'get_root_cause_analysis',
          'get_public_batch_trace'
        )
    AND p.pronargs      = 1
    AND p.proargtypes[0] = 'uuid'::regtype
),

privilege_matrix AS (
  SELECT
    function_name,
    has_function_privilege('anon',          oid, 'execute')  AS anon_execute,
    has_function_privilege('authenticated', oid, 'execute')  AS authenticated_execute,
    has_function_privilege('service_role',  oid, 'execute')  AS service_role_execute,
    -- public_execute: proacl IS NULL means the PostgreSQL default applies and
    -- PUBLIC still has EXECUTE.  After REVOKE FROM PUBLIC the acl is non-null
    -- but contains no entry of the form '=X/...' (empty grantee = PUBLIC).
    CASE
      WHEN proacl IS NULL THEN true
      WHEN EXISTS (
        SELECT 1
        FROM   unnest(proacl) AS acl(entry)
        WHERE  acl.entry::text LIKE '=X%'   -- '=X/grantor' means PUBLIC has EXECUTE
      ) THEN true
      ELSE false
    END                                                       AS public_execute
  FROM func_info
)

SELECT
  function_name,
  anon_execute,
  authenticated_execute,
  service_role_execute,
  public_execute,
  CASE function_name
    WHEN 'get_public_batch_trace'
      THEN 'anon=T  auth=T  svc=T  pub=F'
    ELSE
      'anon=F  auth=T  svc=T  pub=F'
  END                                                                       AS expected_state,
  CASE function_name
    WHEN 'get_public_batch_trace' THEN
      CASE
        WHEN      anon_execute
         AND      authenticated_execute
         AND      service_role_execute
         AND  NOT public_execute
        THEN 'PASS'
        ELSE 'FAIL'
      END
    ELSE
      CASE
        WHEN  NOT anon_execute
         AND      authenticated_execute
         AND      service_role_execute
         AND  NOT public_execute
        THEN 'PASS'
        ELSE 'FAIL'
      END
  END                                                                       AS status
FROM privilege_matrix
ORDER BY function_name;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION B: Security attributes of get_public_batch_trace
-- Confirms SECURITY DEFINER + search_path lockdown are still in place.
-- Run this second.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  'get_public_batch_trace'                                              AS function_name,
  p.prosecdef                                                           AS is_security_definer,
  COALESCE(p.proconfig IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS cfg(entry)
      WHERE  cfg.entry LIKE 'search_path=%'
    ), false)                                                           AS has_search_path_set,
  COALESCE(
    (SELECT cfg.entry
     FROM   unnest(p.proconfig) AS cfg(entry)
     WHERE  cfg.entry LIKE 'search_path=%'
     LIMIT  1),
    '(not set)'
  )                                                                     AS search_path_value,
  CASE
    WHEN p.prosecdef
     AND p.proconfig IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM unnest(p.proconfig) AS cfg(entry)
       WHERE  cfg.entry LIKE 'search_path=%public%'
     )
    THEN 'PASS'
    ELSE 'FAIL — must be SECURITY DEFINER with search_path including public'
  END                                                                   AS security_status
FROM pg_proc      p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname       = 'public'
  AND p.proname       = 'get_public_batch_trace'
  AND p.pronargs      = 1
  AND p.proargtypes[0] = 'uuid'::regtype;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION C: Final verdict
-- Run this last.  Returns a single cell: PASS or FAIL.
-- ─────────────────────────────────────────────────────────────────────────────

WITH func_info AS (
  SELECT
    p.oid,
    p.proname    AS function_name,
    p.proacl,
    p.prosecdef,
    p.proconfig
  FROM pg_proc      p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname       = 'public'
    AND p.proname       IN (
          'get_batch_trace',
          'get_batch_journey',
          'get_root_cause_analysis',
          'get_public_batch_trace'
        )
    AND p.pronargs      = 1
    AND p.proargtypes[0] = 'uuid'::regtype
),

privilege_checks AS (
  SELECT
    function_name,
    CASE function_name
      WHEN 'get_public_batch_trace' THEN
            has_function_privilege('anon',          oid, 'execute')
        AND has_function_privilege('authenticated', oid, 'execute')
        AND has_function_privilege('service_role',  oid, 'execute')
        AND NOT (
              CASE
                WHEN proacl IS NULL THEN true
                WHEN EXISTS (SELECT 1 FROM unnest(proacl) AS acl(e) WHERE acl.e::text LIKE '=X%') THEN true
                ELSE false
              END
            )
      ELSE
            NOT has_function_privilege('anon',          oid, 'execute')
        AND     has_function_privilege('authenticated', oid, 'execute')
        AND     has_function_privilege('service_role',  oid, 'execute')
        AND NOT (
              CASE
                WHEN proacl IS NULL THEN true
                WHEN EXISTS (SELECT 1 FROM unnest(proacl) AS acl(e) WHERE acl.e::text LIKE '=X%') THEN true
                ELSE false
              END
            )
    END AS privilege_ok
  FROM func_info
),

security_check AS (
  SELECT
    p.prosecdef
    AND p.proconfig IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS cfg(entry)
      WHERE  cfg.entry LIKE 'search_path=%public%'
    ) AS ok
  FROM pg_proc      p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname       = 'public'
    AND p.proname       = 'get_public_batch_trace'
    AND p.pronargs      = 1
    AND p.proargtypes[0] = 'uuid'::regtype
),

all_functions_found AS (
  SELECT COUNT(*) = 4 AS ok FROM func_info
)

SELECT
  CASE
    WHEN (SELECT ok  FROM all_functions_found)
     AND (SELECT bool_and(privilege_ok) FROM privilege_checks)
     AND (SELECT ok  FROM security_check)
    THEN 'PASS — PHASE 3 PRIVILEGES CORRECT'
    ELSE 'FAIL — DO NOT CONTINUE'
  END AS final_verdict;
