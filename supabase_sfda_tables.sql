-- ============================================================
-- TraceFlow — SFDA Compliance Tables
--
-- Creates: audit_log, batch_events, recall_affected_batches,
--          distribution_records
--
-- RLS : company-scoped via get_my_company_id()
-- Idempotent: safe to run multiple times.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

-- ── audit_log ─────────────────────────────────────────────────
-- Immutable record of user-driven system events (edits, QC
-- actions, recalls, deletions).  Written by the app on each
-- significant action; never updated or deleted.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor      text        NOT NULL,
  role       text,
  action     text        NOT NULL,
  entity     text,
  type       text        NOT NULL DEFAULT 'edit'
               CHECK (type IN ('edit', 'qc', 'delete', 'recall', 'create')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_company_created
  ON public.audit_log (company_id, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log: select own company" ON public.audit_log;
CREATE POLICY "audit_log: select own company"
  ON public.audit_log FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "audit_log: insert own company" ON public.audit_log;
CREATE POLICY "audit_log: insert own company"
  ON public.audit_log FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

-- No UPDATE / DELETE — audit_log rows are immutable.

-- ── batch_events ───────────────────────────────────────────────
-- Lifecycle events attached to a batch: shipments, recalls,
-- QC outcomes, simulation steps.
CREATE TABLE IF NOT EXISTS public.batch_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_id    text        NOT NULL,
  event_type  text        NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS batch_events_company_batch
  ON public.batch_events (company_id, batch_id);

CREATE INDEX IF NOT EXISTS batch_events_company_created
  ON public.batch_events (company_id, created_at DESC);

ALTER TABLE public.batch_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "batch_events: select own company" ON public.batch_events;
CREATE POLICY "batch_events: select own company"
  ON public.batch_events FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "batch_events: insert own company" ON public.batch_events;
CREATE POLICY "batch_events: insert own company"
  ON public.batch_events FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

-- ── recall_affected_batches ───────────────────────────────────
-- Active and historical recall events scoped to a batch.
-- status: 'active' = live recall, 'resolved' = closed,
--         'simulation' = drill run (excluded from live metrics).
CREATE TABLE IF NOT EXISTS public.recall_affected_batches (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_id           text        NOT NULL,
  recall_reason      text,
  status             text        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'resolved', 'simulation')),
  customers_affected int         NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recall_affected_company_status
  ON public.recall_affected_batches (company_id, status);

ALTER TABLE public.recall_affected_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recall_affected_batches: select own company" ON public.recall_affected_batches;
CREATE POLICY "recall_affected_batches: select own company"
  ON public.recall_affected_batches FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "recall_affected_batches: insert own company" ON public.recall_affected_batches;
CREATE POLICY "recall_affected_batches: insert own company"
  ON public.recall_affected_batches FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "recall_affected_batches: update own company" ON public.recall_affected_batches;
CREATE POLICY "recall_affected_batches: update own company"
  ON public.recall_affected_batches FOR UPDATE
  USING (company_id = get_my_company_id());

-- ── distribution_records ───────────────────────────────────────
-- Outbound shipments: one row per batch × recipient.
-- Used to compute "downstream recipients" in recall readiness.
CREATE TABLE IF NOT EXISTS public.distribution_records (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_id    text        NOT NULL,
  recipient   text,
  quantity    int,
  shipped_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS distribution_records_company_batch
  ON public.distribution_records (company_id, batch_id);

ALTER TABLE public.distribution_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "distribution_records: select own company" ON public.distribution_records;
CREATE POLICY "distribution_records: select own company"
  ON public.distribution_records FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "distribution_records: insert own company" ON public.distribution_records;
CREATE POLICY "distribution_records: insert own company"
  ON public.distribution_records FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

DO $$
BEGIN
  RAISE NOTICE 'SFDA tables created/verified: audit_log, batch_events, recall_affected_batches, distribution_records';
END $$;
