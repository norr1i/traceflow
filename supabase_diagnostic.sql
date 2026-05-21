-- ============================================================
-- TraceFlow — Orphan / Integrity Diagnostic (READ-ONLY)
-- Run this in the Supabase SQL Editor to see the damage.
-- All statements are SELECT/DO-RAISE — nothing is mutated.
-- ============================================================

-- ── 1. Check get_my_role() body ───────────────────────────────────────────────
-- Known bug: was written as  WHERE id = auth.uid()  but column is user_id.
-- If source contains "WHERE id" this function always returns NULL.
SELECT
  proname              AS function_name,
  prosrc               AS source_body
FROM pg_proc
WHERE proname IN ('get_my_role', 'get_my_company', 'get_my_company_id')
ORDER BY proname;


-- ── 2. Orphan user_profiles (user deleted from auth.users) ───────────────────
-- These rows have a user_id that no longer exists in auth.users.
-- They can cause get_my_company_id() to return a stale company for ghost users.
SELECT
  up.user_id                     AS orphan_user_id,
  up.role,
  up.company_id,
  c.name                         AS company_name,
  up.created_at
FROM user_profiles up
LEFT JOIN companies c ON c.id = up.company_id
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users au WHERE au.id = up.user_id
)
ORDER BY up.created_at;


-- ── 3. Companies with missing or deleted owner ────────────────────────────────
SELECT
  c.id,
  c.name,
  c.owner_id,
  c.created_at,
  CASE
    WHEN c.owner_id IS NULL                                          THEN 'owner_id is NULL'
    WHEN NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = c.owner_id)
                                                                     THEN 'owner deleted from auth.users'
    ELSE 'ok'
  END AS status
FROM companies c
WHERE c.owner_id IS NULL
   OR NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = c.owner_id)
ORDER BY c.created_at;


-- ── 4. Invitations whose inviter was deleted ──────────────────────────────────
-- invited_by is ON DELETE SET NULL so already NULL for deleted inviters.
-- This shows you any that slipped through or are still pending with no inviter.
SELECT
  i.id,
  i.email,
  i.role,
  i.status,
  i.invited_by,
  i.expires_at,
  c.name AS company_name
FROM invitations i
JOIN companies c ON c.id = i.company_id
WHERE i.status = 'pending'
  AND i.expires_at > now()
ORDER BY i.created_at;


-- ── 5. Full picture: all auth users vs profiles vs companies ─────────────────
SELECT
  au.id                           AS auth_user_id,
  au.email,
  up.user_id IS NOT NULL          AS has_profile,
  up.role,
  up.company_id,
  c.name                          AS company_name,
  c.owner_id                      AS company_owner_id,
  CASE
    WHEN up.user_id IS NULL                   THEN 'NO PROFILE'
    WHEN up.company_id IS NULL                THEN 'NO COMPANY (needs onboarding)'
    WHEN c.owner_id IS NULL                   THEN 'COMPANY OWNER MISSING'
    ELSE 'ok'
  END AS health
FROM auth.users au
LEFT JOIN user_profiles up ON up.user_id = au.id
LEFT JOIN companies c      ON c.id = up.company_id
ORDER BY au.created_at;


-- ── 6. Active RLS policies on key tables ─────────────────────────────────────
-- If a table has no SELECT policy, authenticated users will see no data.
SELECT
  tablename,
  policyname,
  cmd,
  roles::text
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'products','raw_materials','production_orders',
    'sales','quality_inspections','quality_defects',
    'user_profiles','companies','invitations'
  )
ORDER BY tablename, cmd;


-- ── 7. Tables that have zero authenticated SELECT policies ────────────────────
-- Any table here will return empty results for authenticated users.
WITH target_tables AS (
  SELECT unnest(ARRAY[
    'products','raw_materials','production_orders',
    'sales','quality_inspections','quality_defects'
  ]) AS tbl
),
covered AS (
  SELECT DISTINCT tablename
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd IN ('SELECT', 'ALL')
    AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
)
SELECT t.tbl AS table_with_no_authenticated_select_policy
FROM target_tables t
LEFT JOIN covered c ON c.tablename = t.tbl
WHERE c.tablename IS NULL;
