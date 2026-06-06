-- ============================================================
-- TraceFlow — CAPA & Recall module foundation
-- ============================================================
-- Creates the formal CAPA and Recall tables, RLS policies,
-- auto-number triggers, and aggregate stat RPCs required by:
--   /capa          — dedicated CAPA management page
--   /recall        — Recall Registry tab (alongside impact lookup)
--   /             (dashboard) — CAPA/Recall KPI cards
--   /sfda          — CAPA tab (connected to real DB data)
--
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE.
--
-- PREREQUISITES
--   supabase_rbac.sql applied (get_my_company_id, companies table,
--   production_orders, products, quality_inspections all exist).
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

-- ── 0. inspector_name column on quality_inspections ──────────────────────
-- Adds a human-readable name alongside the existing inspector_id field.

ALTER TABLE quality_inspections
  ADD COLUMN IF NOT EXISTS inspector_name text;

-- ── 1. recalls table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.recalls (
  id                uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  recall_number     text,                    -- trigger-populated: RC-YYYY-XXXXXX
  -- Product / batch context
  product_id        uuid        REFERENCES products(id)          ON DELETE SET NULL,
  batch_id          uuid        REFERENCES production_orders(id) ON DELETE SET NULL,
  -- Core fields
  title             text        NOT NULL,
  reason            text        NOT NULL,
  severity          text        NOT NULL DEFAULT 'medium'
                                CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status            text        NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open', 'in_progress', 'closed')),
  root_cause        text,
  corrective_action text,
  affected_units    integer,
  initiated_by_name text,                    -- free-text; no FK to auth.users for anon compatibility
  initiated_at      timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- recall_number: RC-YYYY-XXXXXX (first 6 hex chars of UUID)
CREATE OR REPLACE FUNCTION tf_recall_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recall_number IS NULL THEN
    NEW.recall_number :=
      'RC-' || to_char(now(), 'YYYY') || '-' || upper(substr(NEW.id::text, 1, 6));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recalls_number     ON recalls;
DROP TRIGGER IF EXISTS recalls_updated_at ON recalls;

CREATE TRIGGER recalls_number
  BEFORE INSERT ON recalls
  FOR EACH ROW EXECUTE FUNCTION tf_recall_number();

CREATE TRIGGER recalls_updated_at
  BEFORE UPDATE ON recalls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. capas table ───────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS capa_number_seq START 1;

CREATE TABLE IF NOT EXISTS public.capas (
  id                     uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id             uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  capa_number            text        UNIQUE,  -- trigger-populated: CAPA-YYYY-NNNN
  -- Source linkage (all optional — at least one recommended for audit trail)
  recall_id              uuid        REFERENCES recalls(id)             ON DELETE SET NULL,
  inspection_id          uuid        REFERENCES quality_inspections(id) ON DELETE SET NULL,
  batch_id               uuid        REFERENCES production_orders(id)   ON DELETE SET NULL,
  -- Content
  title                  text        NOT NULL,
  severity               text        NOT NULL DEFAULT 'major'
                                     CHECK (severity IN ('minor', 'major', 'critical')),
  root_cause             text,
  corrective_action      text,
  preventive_action      text,
  -- Ownership
  owner_name             text,
  due_date               date,
  -- Five-stage lifecycle: open → investigation → corrective_action → verification → closed
  status                 text        NOT NULL DEFAULT 'open'
                                     CHECK (status IN (
                                       'open',
                                       'investigation',
                                       'corrective_action',
                                       'verification',
                                       'closed'
                                     )),
  -- Status transition timestamps (populated automatically on advance)
  investigation_at       timestamptz,
  corrective_action_at   timestamptz,
  verification_at        timestamptz,
  closed_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- capa_number: CAPA-YYYY-NNNN (sequential per year via shared sequence)
CREATE OR REPLACE FUNCTION tf_capa_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.capa_number IS NULL THEN
    NEW.capa_number :=
      'CAPA-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('capa_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capas_number     ON capas;
DROP TRIGGER IF EXISTS capas_updated_at ON capas;

CREATE TRIGGER capas_number
  BEFORE INSERT ON capas
  FOR EACH ROW EXECUTE FUNCTION tf_capa_number();

CREATE TRIGGER capas_updated_at
  BEFORE UPDATE ON capas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 3. Row-Level Security ─────────────────────────────────────────────────

ALTER TABLE recalls ENABLE ROW LEVEL SECURITY;
ALTER TABLE capas   ENABLE ROW LEVEL SECURITY;

-- recalls
DROP POLICY IF EXISTS "co_recalls_select" ON recalls;
DROP POLICY IF EXISTS "co_recalls_insert" ON recalls;
DROP POLICY IF EXISTS "co_recalls_update" ON recalls;
DROP POLICY IF EXISTS "co_recalls_delete" ON recalls;

CREATE POLICY "co_recalls_select" ON recalls FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());
CREATE POLICY "co_recalls_insert" ON recalls FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "co_recalls_update" ON recalls FOR UPDATE TO authenticated
  USING    (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "co_recalls_delete" ON recalls FOR DELETE TO authenticated
  USING (company_id = get_my_company_id());

-- capas
DROP POLICY IF EXISTS "co_capas_select" ON capas;
DROP POLICY IF EXISTS "co_capas_insert" ON capas;
DROP POLICY IF EXISTS "co_capas_update" ON capas;
DROP POLICY IF EXISTS "co_capas_delete" ON capas;

CREATE POLICY "co_capas_select" ON capas FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());
CREATE POLICY "co_capas_insert" ON capas FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "co_capas_update" ON capas FOR UPDATE TO authenticated
  USING    (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "co_capas_delete" ON capas FOR DELETE TO authenticated
  USING (company_id = get_my_company_id());

-- ── 4. get_recall_stats ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_recall_stats(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_open        int := 0;
  v_in_progress int := 0;
  v_closed      int := 0;
  v_total       int := 0;
  v_critical    int := 0;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status = 'open'),
    COUNT(*) FILTER (WHERE status = 'in_progress'),
    COUNT(*) FILTER (WHERE status = 'closed'),
    COUNT(*),
    COUNT(*) FILTER (WHERE severity = 'critical' AND status <> 'closed')
  INTO v_open, v_in_progress, v_closed, v_total, v_critical
  FROM recalls
  WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'open',            v_open,
    'in_progress',     v_in_progress,
    'closed',          v_closed,
    'total',           v_total,
    'critical_open',   v_critical,
    'active',          v_open + v_in_progress,
    'resolution_rate', CASE WHEN v_total > 0
                            THEN round((v_closed::numeric / v_total) * 100, 1)
                            ELSE 0::numeric END
  );
END;
$$;

-- ── 5. get_capa_stats ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_capa_stats(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_open             int := 0;
  v_investigation    int := 0;
  v_corrective       int := 0;
  v_verification     int := 0;
  v_closed           int := 0;
  v_overdue          int := 0;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status = 'open'),
    COUNT(*) FILTER (WHERE status = 'investigation'),
    COUNT(*) FILTER (WHERE status = 'corrective_action'),
    COUNT(*) FILTER (WHERE status = 'verification'),
    COUNT(*) FILTER (WHERE status = 'closed'),
    COUNT(*) FILTER (WHERE status <> 'closed' AND due_date < current_date)
  INTO v_open, v_investigation, v_corrective, v_verification, v_closed, v_overdue
  FROM capas
  WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'open',              v_open,
    'investigation',     v_investigation,
    'corrective_action', v_corrective,
    'verification',      v_verification,
    'closed',            v_closed,
    'overdue',           v_overdue,
    'active',            v_open + v_investigation + v_corrective + v_verification
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_recall_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_capa_stats(uuid)   TO authenticated;

-- ── 6. Smoke test ─────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE 'CAPA & Recall migration applied successfully.';
  RAISE NOTICE '  Tables: recalls, capas';
  RAISE NOTICE '  Functions: get_recall_stats, get_capa_stats';
  RAISE NOTICE '  Column added: quality_inspections.inspector_name';
END;
$$;
