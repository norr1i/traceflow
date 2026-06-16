-- ============================================================
-- TraceFlow — CAPA Module v2 Extensions
-- File: supabase_capa_v2.sql
-- ============================================================
-- Prereq: supabase_capa_recall.sql must already be applied
--         (capas table + set_updated_at trigger must exist)
--
-- This migration adds:
--   1. source_type column on capas
--   2. capa_actions  — individual action items per CAPA
--   3. capa_evidence — uploaded files / attachments per CAPA
--   4. capa_status_history — immutable audit trail of status changes
--   5. get_capa_analytics(uuid) RPC
--   6. Storage bucket instructions for evidence files
--
-- IDEMPOTENT — safe to re-run.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

-- ── 1. source_type on capas ───────────────────────────────────────────────────

ALTER TABLE public.capas
  ADD COLUMN IF NOT EXISTS source_type text
    CHECK (source_type IN (
      'quality_issue', 'recall', 'audit', 'complaint', 'supplier', 'other'
    ));

CREATE INDEX IF NOT EXISTS capas_source_type ON public.capas (company_id, source_type);
CREATE INDEX IF NOT EXISTS capas_status      ON public.capas (company_id, status);
CREATE INDEX IF NOT EXISTS capas_due_date    ON public.capas (company_id, due_date);

-- ── 2. capa_actions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.capa_actions (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  capa_id      uuid        NOT NULL REFERENCES public.capas(id)     ON DELETE CASCADE,
  description  text        NOT NULL,
  assigned_to  text,
  due_date     date,
  status       text        NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'in_progress', 'completed')),
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS capa_actions_capa    ON public.capa_actions (capa_id);
CREATE INDEX IF NOT EXISTS capa_actions_company ON public.capa_actions (company_id);

ALTER TABLE public.capa_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "co_capa_actions_select" ON public.capa_actions;
DROP POLICY IF EXISTS "co_capa_actions_insert" ON public.capa_actions;
DROP POLICY IF EXISTS "co_capa_actions_update" ON public.capa_actions;
DROP POLICY IF EXISTS "co_capa_actions_delete" ON public.capa_actions;

CREATE POLICY "co_capa_actions_select" ON public.capa_actions FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());
CREATE POLICY "co_capa_actions_insert" ON public.capa_actions FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "co_capa_actions_update" ON public.capa_actions FOR UPDATE TO authenticated
  USING    (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "co_capa_actions_delete" ON public.capa_actions FOR DELETE TO authenticated
  USING (company_id = get_my_company_id());

DROP TRIGGER IF EXISTS capa_actions_updated_at ON public.capa_actions;
CREATE TRIGGER capa_actions_updated_at
  BEFORE UPDATE ON public.capa_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 3. capa_evidence ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.capa_evidence (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  capa_id      uuid        NOT NULL REFERENCES public.capas(id)     ON DELETE CASCADE,
  file_name    text        NOT NULL,
  file_url     text        NOT NULL,
  file_type    text,
  file_size    bigint,
  uploaded_by  text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS capa_evidence_capa    ON public.capa_evidence (capa_id);
CREATE INDEX IF NOT EXISTS capa_evidence_company ON public.capa_evidence (company_id);

ALTER TABLE public.capa_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "co_capa_evidence_select" ON public.capa_evidence;
DROP POLICY IF EXISTS "co_capa_evidence_insert" ON public.capa_evidence;
DROP POLICY IF EXISTS "co_capa_evidence_delete" ON public.capa_evidence;

CREATE POLICY "co_capa_evidence_select" ON public.capa_evidence FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());
CREATE POLICY "co_capa_evidence_insert" ON public.capa_evidence FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "co_capa_evidence_delete" ON public.capa_evidence FOR DELETE TO authenticated
  USING (company_id = get_my_company_id());

-- ── 4. capa_status_history ────────────────────────────────────────────────────
-- Immutable audit trail: no UPDATE / DELETE policies.

CREATE TABLE IF NOT EXISTS public.capa_status_history (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  capa_id      uuid        NOT NULL REFERENCES public.capas(id)     ON DELETE CASCADE,
  from_status  text,
  to_status    text        NOT NULL,
  changed_by   text,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS capa_status_history_capa    ON public.capa_status_history (capa_id);
CREATE INDEX IF NOT EXISTS capa_status_history_company ON public.capa_status_history (company_id, created_at DESC);

ALTER TABLE public.capa_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "co_capa_sh_select" ON public.capa_status_history;
DROP POLICY IF EXISTS "co_capa_sh_insert" ON public.capa_status_history;

CREATE POLICY "co_capa_sh_select" ON public.capa_status_history FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());
CREATE POLICY "co_capa_sh_insert" ON public.capa_status_history FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());

-- ── 5. get_capa_analytics ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_capa_analytics(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_avg_days    numeric;
  v_by_priority jsonb;
  v_by_source   jsonb;
  v_monthly     jsonb;
BEGIN
  -- Average closure time in days for closed CAPAs
  SELECT ROUND(AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400), 1)
  INTO   v_avg_days
  FROM   capas
  WHERE  company_id = p_company_id
    AND  status     = 'closed'
    AND  closed_at  IS NOT NULL;

  -- Count by severity (priority)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('severity', severity, 'count', cnt)
      ORDER BY cnt DESC
    ),
    '[]'::jsonb
  )
  INTO v_by_priority
  FROM (
    SELECT severity, COUNT(*) AS cnt
    FROM   capas
    WHERE  company_id = p_company_id
    GROUP  BY severity
  ) t;

  -- Count by source type
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'source_type', COALESCE(source_type, 'unspecified'),
        'count',       cnt
      )
      ORDER BY cnt DESC
    ),
    '[]'::jsonb
  )
  INTO v_by_source
  FROM (
    SELECT source_type, COUNT(*) AS cnt
    FROM   capas
    WHERE  company_id = p_company_id
    GROUP  BY source_type
  ) t;

  -- Monthly trend: last 6 months
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'month',  TO_CHAR(m, 'Mon YY'),
        'opened', opened,
        'closed', closed_count
      )
      ORDER BY m
    ),
    '[]'::jsonb
  )
  INTO v_monthly
  FROM (
    SELECT
      gs.m,
      COUNT(c.id) FILTER (
        WHERE DATE_TRUNC('month', c.created_at) = gs.m
      ) AS opened,
      COUNT(c.id) FILTER (
        WHERE c.status = 'closed'
          AND DATE_TRUNC('month', c.closed_at) = gs.m
      ) AS closed_count
    FROM (
      SELECT GENERATE_SERIES(
        DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
        DATE_TRUNC('month', NOW()),
        INTERVAL '1 month'
      ) AS m
    ) gs
    LEFT JOIN capas c ON c.company_id = p_company_id
    GROUP BY gs.m
    ORDER BY gs.m
  ) t;

  RETURN jsonb_build_object(
    'avg_closure_days', COALESCE(v_avg_days, 0),
    'by_priority',      v_by_priority,
    'by_source',        v_by_source,
    'monthly_trend',    v_monthly
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_capa_analytics(uuid) TO authenticated;

-- ── 6. Storage bucket ────────────────────────────────────────────────────────
-- Run this block separately in Supabase Dashboard → SQL Editor if the
-- storage schema is available.  Safe to skip if using URL-only evidence.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'capa-evidence',
      'capa-evidence',
      false,
      52428800,   -- 50 MB per file
      ARRAY['image/jpeg','image/png','image/webp','application/pdf',
            'text/plain','application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    )
    ON CONFLICT (id) DO NOTHING;

    -- Authenticated users can upload to their company prefix
    DROP POLICY IF EXISTS "capa_evidence_upload"  ON storage.objects;
    DROP POLICY IF EXISTS "capa_evidence_read"    ON storage.objects;
    DROP POLICY IF EXISTS "capa_evidence_delete"  ON storage.objects;

    CREATE POLICY "capa_evidence_upload" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'capa-evidence');

    CREATE POLICY "capa_evidence_read" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'capa-evidence');

    CREATE POLICY "capa_evidence_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'capa-evidence');

    RAISE NOTICE '✓ storage bucket "capa-evidence" created with RLS policies.';
  ELSE
    RAISE NOTICE 'storage schema not found — create bucket manually in Supabase Dashboard → Storage.';
  END IF;
END;
$$;

-- ── Completion notice ─────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '✓ supabase_capa_v2.sql applied.';
  RAISE NOTICE '  Column:  capas.source_type';
  RAISE NOTICE '  Tables:  capa_actions, capa_evidence, capa_status_history';
  RAISE NOTICE '  RPC:     get_capa_analytics(uuid)';
  RAISE NOTICE '  Indexes: capas_source_type, capas_status, capas_due_date + child tables';
END;
$$;
