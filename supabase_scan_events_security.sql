-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- SUPERSEDED — DO NOT EXECUTE THIS FILE STANDALONE
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- This file was an intermediate security hardening step.
-- The live Supabase database was hardened to its final state on 2026-08-19.
-- The authoritative current state is recorded in:
--
--   supabase_log_scan_event_hardening_20260819.sql
--
-- Running THIS file standalone would:
--   • Recreate the "public_scan_insert" INSERT policy for anon and
--     authenticated on scan_events — the live database intentionally
--     has NO such policy; the SECURITY DEFINER function is the only
--     sanctioned insert path
--   • The recreated policy would be dormant (anon has no table grant),
--     but its presence is misleading and should not exist
--
-- The tf_scan_company trigger hardening and NOT NULL constraint in this
-- file are still consistent with live state and are not harmful to re-run.
-- The INSERT policy creation is the unsafe part.
--
-- This file is retained for historical reference only.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

-- ============================================================
-- TraceFlow — scan_events security hardening
-- ============================================================
-- Fixes HIGH severity: the previous INSERT policy used
-- WITH CHECK (true), allowing any unauthenticated client to
-- insert scan_events rows for arbitrary or non-existent
-- batch_ids, with no company isolation guarantee.
--
-- Three changes (all idempotent / safe to re-run):
--
--   1. Replace the permissive INSERT policy with one that
--      requires batch_id to reference a real production order.
--      Legitimate QR scans continue to work unchanged.
--      Inserts for unknown batch_ids are rejected (403).
--
--   2. Harden the BEFORE INSERT trigger so that if company_id
--      cannot be resolved it raises an exception and aborts
--      the insert, instead of silently accepting a NULL row.
--
--   3. Clean up any existing NULL company_id orphan rows, then
--      add a NOT NULL constraint so the guarantee is enforced
--      at the schema layer going forward.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

-- ── 1. Replace the INSERT policy ─────────────────────────────
-- Old: WITH CHECK (true)  — no validation whatsoever
-- New: WITH CHECK (EXISTS (...))  — batch_id must exist in
--      production_orders. The anon role can already SELECT
--      production_orders via the "public_trace_orders" policy,
--      so the subquery resolves correctly for unauthenticated
--      requests.

DROP POLICY IF EXISTS "public_scan_insert" ON scan_events;

CREATE POLICY "public_scan_insert" ON scan_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM production_orders WHERE id = batch_id)
  );

-- ── 2. Harden the BEFORE INSERT trigger ──────────────────────
-- Old: EXCEPTION WHEN OTHERS THEN NULL — swallowed every error
--      and let the insert proceed with company_id = NULL.
-- New: raise an exception if company_id cannot be resolved,
--      which aborts the INSERT entirely.

CREATE OR REPLACE FUNCTION tf_scan_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id
    FROM production_orders
    WHERE id = NEW.batch_id
    LIMIT 1;

    IF NEW.company_id IS NULL THEN
      RAISE EXCEPTION
        'scan_events: batch_id % does not reference a valid production order',
        NEW.batch_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. Enforce NOT NULL on company_id ────────────────────────
-- First recover orphan rows whose batch_id still resolves.
UPDATE scan_events se
SET    company_id = po.company_id
FROM   production_orders po
WHERE  po.id = se.batch_id
  AND  se.company_id IS NULL;

-- Remove rows that remain unresolvable. They are already
-- invisible to every authenticated user (the SELECT policy
-- filters on company_id = get_my_company_id()), so no data
-- visible to any tenant is lost.
DELETE FROM scan_events WHERE company_id IS NULL;

-- Safe to add NOT NULL now that no NULL rows exist.
ALTER TABLE scan_events
  ALTER COLUMN company_id SET NOT NULL;

DO $$
BEGIN
  RAISE NOTICE 'scan_events security hardening applied successfully.';
END $$;
