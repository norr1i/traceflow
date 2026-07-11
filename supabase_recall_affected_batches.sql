-- ============================================================
-- TraceFlow — recall_affected_batches migration (v6 — FK establishment)
-- File: supabase_recall_affected_batches.sql
-- ============================================================
--
-- TABLE HISTORY
-- ─────────────
-- v1 (supabase_sfda_tables.sql):
--   Created as an SFDA compliance table.
--   Intended columns: id, company_id, batch_id (text in that file, no FK),
--   recall_reason, status, customers_affected, created_at.
--
-- v? (unknown migration, no longer in repo):
--   Created or replaced the table. batch_id is UUID in the live database
--   (confirmed by ERROR 42883 when comparing po.id::text = rab.batch_id).
--   Added: recall_id, depth (NOT NULL no DEFAULT), computed_at (NOT NULL no DEFAULT).
--   Added FK: batch_id → public.batches(id).
--   Did NOT include: status, recall_reason, customers_affected.
--
-- v2–v4 (previous supabase_recall_affected_batches.sql versions):
--   Added is_anchor, added_at, company_id, status, recall_reason,
--   customers_affected, created_at via ADD COLUMN IF NOT EXISTS.
--   Fixed depth/computed_at NOT NULL.
--   Guarded the (company_id, status) index.
--   Did NOT touch the legacy FK to batches(id).
--   ERROR 23503 on INSERT: production_orders UUIDs not in batches table.
--   ERROR 42883 on data safety check: po.id::text = rab.batch_id
--   compared text to uuid — cast was wrong direction.
--
-- v5:
--   Dropped legacy FK batch_id → batches(id).
--   Fixed data safety comparison: po.id = rab.batch_id (both uuid, no cast).
--   Did NOT recreate the batch_id FK — left table with zero FKs.
--
-- v6 (this file):
--   Step 4 now establishes all three required FKs idempotently:
--     recall_id  → public.recalls(id)           ON DELETE CASCADE
--     batch_id   → public.production_orders(id) ON DELETE CASCADE
--     company_id → public.companies(id)         ON DELETE CASCADE
--   For each FK: checks pg_constraint by column name + target table (not by
--   constraint name), drops any wrong FK on that column, runs a data safety
--   check, then creates the correct FK if data is clean.
--
-- NOTE ON batch_id COLUMN TYPE
-- ─────────────────────────────
-- The live database has batch_id as UUID (confirmed by the type error).
-- The CREATE TABLE fresh-install block and all comments now reflect UUID.
--
-- IDEMPOTENT — safe to re-run in any order or any number of times.
-- Prereqs: supabase_capa_recall.sql applied (recalls table must exist).
-- ============================================================


-- ── 1. Create table (fresh-install path) ─────────────────────────────────────
--
-- Only runs when the table does not exist at all.
-- On all existing databases this is a no-op; steps 2–4 handle upgrades.

CREATE TABLE IF NOT EXISTS public.recall_affected_batches (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id)   ON DELETE CASCADE,
  batch_id           uuid        NOT NULL,
  recall_id          uuid                 REFERENCES public.recalls(id)     ON DELETE CASCADE,
  recall_reason      text,
  status             text        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'resolved', 'simulation')),
  customers_affected int         NOT NULL DEFAULT 0,
  is_anchor          boolean     NOT NULL DEFAULT false,
  added_at           timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  depth              int,               -- legacy: BOM tree depth (nullable; feature removed)
  computed_at        timestamptz,       -- legacy: depth computation timestamp (nullable; feature removed)

  CONSTRAINT rab_recall_batch_unique UNIQUE (recall_id, batch_id)
);


-- ── 2. Add columns missing from older schema versions ────────────────────────
--
-- Each statement is a no-op when the column already exists.
-- Order matters: SFDA columns first (app reads them), then junction columns.

-- recall_id: FK for the Recall Center junction-table use case.
ALTER TABLE public.recall_affected_batches
  ADD COLUMN IF NOT EXISTS recall_id uuid REFERENCES public.recalls(id) ON DELETE CASCADE;

-- status: required by SFDAClient.tsx (.eq('status','active') query and
-- simulation INSERT). The unknown migration that created the real table
-- omitted this column — it must be added explicitly.
-- DEFAULT 'active' correctly classifies all pre-existing rows as active events.
ALTER TABLE public.recall_affected_batches
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- recall_reason: optional text describing why a batch was recalled.
ALTER TABLE public.recall_affected_batches
  ADD COLUMN IF NOT EXISTS recall_reason text;

-- customers_affected: integer count used by SFDA recall readiness score.
ALTER TABLE public.recall_affected_batches
  ADD COLUMN IF NOT EXISTS customers_affected int NOT NULL DEFAULT 0;

-- created_at: standard audit timestamp.
ALTER TABLE public.recall_affected_batches
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- is_anchor: true for the single row per recall that matches recalls.batch_id.
ALTER TABLE public.recall_affected_batches
  ADD COLUMN IF NOT EXISTS is_anchor boolean NOT NULL DEFAULT false;

-- added_at: insertion timestamp for Recall Center rows.
ALTER TABLE public.recall_affected_batches
  ADD COLUMN IF NOT EXISTS added_at timestamptz NOT NULL DEFAULT now();


-- ── 3. Fix legacy columns: drop NOT NULL, add safe defaults ──────────────────
--
-- depth and computed_at were left behind by a removed BOM-depth feature.
-- They have NOT NULL with no DEFAULT, causing every INSERT that omits them
-- to fail with ERROR 23502.
-- No code in the current codebase reads or writes these columns.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'recall_affected_batches'
      AND  column_name  = 'depth'
      AND  is_nullable  = 'NO'
  ) THEN
    ALTER TABLE public.recall_affected_batches ALTER COLUMN depth DROP NOT NULL;
    RAISE NOTICE '  depth: NOT NULL dropped';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'recall_affected_batches'
      AND  column_name  = 'depth'
  ) THEN
    ALTER TABLE public.recall_affected_batches ALTER COLUMN depth SET DEFAULT 0;
    RAISE NOTICE '  depth: DEFAULT 0 set';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'recall_affected_batches'
      AND  column_name  = 'computed_at'
      AND  is_nullable  = 'NO'
  ) THEN
    ALTER TABLE public.recall_affected_batches ALTER COLUMN computed_at DROP NOT NULL;
    RAISE NOTICE '  computed_at: NOT NULL dropped';
  END IF;
END;
$$;


-- ── 4. Backfill company_id from parent recall on rows where it is NULL ────────
--
-- Run before FK establishment so the company_id validator in step 4c
-- sees a clean dataset even if ADD COLUMN left some rows with NULL.

UPDATE public.recall_affected_batches rab
SET    company_id = r.company_id
FROM   public.recalls r
WHERE  rab.recall_id   = r.id
  AND  rab.company_id IS NULL;


-- ── 5. Establish required foreign keys ───────────────────────────────────────
--
-- For each of the three FK columns the logic is identical:
--   a. If the correct FK (pointing to the right table) already exists → skip.
--   b. Drop every wrong FK on that column (regardless of its name).
--   c. Data safety: count rows that would violate the new FK.
--      Report any violations; do NOT delete rows.
--   d. If no violations → create the FK with an explicit constraint name.
--      If violations exist → skip FK creation and report; re-run after cleanup.
--
-- recall_id is nullable — only non-NULL values are checked against recalls.
-- batch_id and company_id are NOT NULL — every row is checked.
--
-- NOTE on batch_id and SFDA simulation:
--   SFDAClient.tsx:1221 generates synthetic string IDs ("SIM-*") and inserts
--   them into batch_events (text column) AND recall_affected_batches.
--   Since recall_affected_batches.batch_id is UUID, those inserts always fail
--   with "invalid input syntax for type uuid" (swallowed at console.error).
--   No SIM-* rows exist in this table. The FK to production_orders is safe.

DO $$
DECLARE
  v_cname         text;
  v_target        text;
  v_invalid_count int;
BEGIN

  -- ── 4a. recall_id → public.recalls(id) ON DELETE CASCADE ─────────────────

  IF EXISTS (
    SELECT 1
    FROM   pg_constraint c
    JOIN   pg_class t       ON t.oid       = c.conrelid
    JOIN   pg_namespace tn  ON tn.oid      = t.relnamespace
    JOIN   pg_class ref_t   ON ref_t.oid   = c.confrelid
    JOIN   pg_namespace rn  ON rn.oid      = ref_t.relnamespace
    JOIN   pg_attribute a   ON a.attrelid  = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE  t.relname = 'recall_affected_batches' AND tn.nspname = 'public'
      AND  c.contype = 'f'
      AND  a.attname = 'recall_id'
      AND  ref_t.relname = 'recalls' AND rn.nspname = 'public'
  ) THEN
    RAISE NOTICE '  recall_id FK → recalls(id): already correct, skipped';

  ELSE
    -- Drop any existing wrong FK on recall_id
    FOR v_cname IN
      SELECT c.conname
      FROM   pg_constraint c
      JOIN   pg_class t      ON t.oid      = c.conrelid
      JOIN   pg_namespace tn ON tn.oid     = t.relnamespace
      JOIN   pg_attribute a  ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE  t.relname = 'recall_affected_batches' AND tn.nspname = 'public'
        AND  c.contype = 'f' AND a.attname = 'recall_id'
    LOOP
      EXECUTE format('ALTER TABLE public.recall_affected_batches DROP CONSTRAINT %I', v_cname);
      RAISE NOTICE '  recall_id: dropped wrong FK %', v_cname;
    END LOOP;

    -- Data safety: non-NULL recall_id must exist in recalls
    SELECT COUNT(*) INTO v_invalid_count
    FROM   public.recall_affected_batches rab
    WHERE  rab.recall_id IS NOT NULL
      AND  NOT EXISTS (SELECT 1 FROM public.recalls r WHERE r.id = rab.recall_id);

    IF v_invalid_count > 0 THEN
      RAISE NOTICE '  recall_id: % row(s) reference non-existent recalls — not deleted', v_invalid_count;
      RAISE NOTICE '  recall_id FK NOT added. Resolve orphaned rows and re-run.';
    ELSE
      ALTER TABLE public.recall_affected_batches
        ADD CONSTRAINT rab_recall_id_fkey
          FOREIGN KEY (recall_id) REFERENCES public.recalls(id) ON DELETE CASCADE;
      RAISE NOTICE '  recall_id FK → recalls(id) ON DELETE CASCADE: created';
    END IF;
  END IF;


  -- ── 4b. batch_id → public.production_orders(id) ON DELETE CASCADE ─────────

  IF EXISTS (
    SELECT 1
    FROM   pg_constraint c
    JOIN   pg_class t       ON t.oid       = c.conrelid
    JOIN   pg_namespace tn  ON tn.oid      = t.relnamespace
    JOIN   pg_class ref_t   ON ref_t.oid   = c.confrelid
    JOIN   pg_namespace rn  ON rn.oid      = ref_t.relnamespace
    JOIN   pg_attribute a   ON a.attrelid  = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE  t.relname = 'recall_affected_batches' AND tn.nspname = 'public'
      AND  c.contype = 'f'
      AND  a.attname = 'batch_id'
      AND  ref_t.relname = 'production_orders' AND rn.nspname = 'public'
  ) THEN
    RAISE NOTICE '  batch_id FK → production_orders(id): already correct, skipped';

  ELSE
    -- Drop every wrong FK on batch_id (catches legacy → batches(id) and any other)
    FOR v_cname IN
      SELECT c.conname
      FROM   pg_constraint c
      JOIN   pg_class t      ON t.oid      = c.conrelid
      JOIN   pg_namespace tn ON tn.oid     = t.relnamespace
      JOIN   pg_attribute a  ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE  t.relname = 'recall_affected_batches' AND tn.nspname = 'public'
        AND  c.contype = 'f' AND a.attname = 'batch_id'
    LOOP
      EXECUTE format('ALTER TABLE public.recall_affected_batches DROP CONSTRAINT %I', v_cname);
      RAISE NOTICE '  batch_id: dropped wrong FK %', v_cname;
    END LOOP;

    -- Data safety: every batch_id must exist in production_orders
    SELECT COUNT(*) INTO v_invalid_count
    FROM   public.recall_affected_batches rab
    WHERE  NOT EXISTS (SELECT 1 FROM public.production_orders po WHERE po.id = rab.batch_id);

    IF v_invalid_count > 0 THEN
      RAISE NOTICE '  batch_id: % row(s) have batch_id not in production_orders — not deleted', v_invalid_count;
      RAISE NOTICE '  batch_id FK NOT added. Resolve orphaned rows and re-run.';
    ELSE
      RAISE NOTICE '  batch_id: all existing values present in production_orders — safe to add FK';
      ALTER TABLE public.recall_affected_batches
        ADD CONSTRAINT rab_batch_id_fkey
          FOREIGN KEY (batch_id) REFERENCES public.production_orders(id) ON DELETE CASCADE;
      RAISE NOTICE '  batch_id FK → production_orders(id) ON DELETE CASCADE: created';
    END IF;
  END IF;


  -- ── 4c. company_id → public.companies(id) ON DELETE CASCADE ──────────────

  IF EXISTS (
    SELECT 1
    FROM   pg_constraint c
    JOIN   pg_class t       ON t.oid       = c.conrelid
    JOIN   pg_namespace tn  ON tn.oid      = t.relnamespace
    JOIN   pg_class ref_t   ON ref_t.oid   = c.confrelid
    JOIN   pg_namespace rn  ON rn.oid      = ref_t.relnamespace
    JOIN   pg_attribute a   ON a.attrelid  = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE  t.relname = 'recall_affected_batches' AND tn.nspname = 'public'
      AND  c.contype = 'f'
      AND  a.attname = 'company_id'
      AND  ref_t.relname = 'companies' AND rn.nspname = 'public'
  ) THEN
    RAISE NOTICE '  company_id FK → companies(id): already correct, skipped';

  ELSE
    -- Drop any wrong FK on company_id
    FOR v_cname IN
      SELECT c.conname
      FROM   pg_constraint c
      JOIN   pg_class t      ON t.oid      = c.conrelid
      JOIN   pg_namespace tn ON tn.oid     = t.relnamespace
      JOIN   pg_attribute a  ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE  t.relname = 'recall_affected_batches' AND tn.nspname = 'public'
        AND  c.contype = 'f' AND a.attname = 'company_id'
    LOOP
      EXECUTE format('ALTER TABLE public.recall_affected_batches DROP CONSTRAINT %I', v_cname);
      RAISE NOTICE '  company_id: dropped wrong FK %', v_cname;
    END LOOP;

    -- Data safety: every company_id must exist in companies
    SELECT COUNT(*) INTO v_invalid_count
    FROM   public.recall_affected_batches rab
    WHERE  NOT EXISTS (SELECT 1 FROM public.companies co WHERE co.id = rab.company_id);

    IF v_invalid_count > 0 THEN
      RAISE NOTICE '  company_id: % row(s) have company_id not in companies — not deleted', v_invalid_count;
      RAISE NOTICE '  company_id FK NOT added. Resolve orphaned rows and re-run.';
    ELSE
      ALTER TABLE public.recall_affected_batches
        ADD CONSTRAINT rab_company_id_fkey
          FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
      RAISE NOTICE '  company_id FK → companies(id) ON DELETE CASCADE: created';
    END IF;
  END IF;

END;
$$;


-- ── 6. Unique constraint ──────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint c
    JOIN   pg_class      t ON t.oid = c.conrelid
    JOIN   pg_namespace  n ON n.oid = t.relnamespace
    WHERE  c.conname  = 'rab_recall_batch_unique'
      AND  t.relname  = 'recall_affected_batches'
      AND  n.nspname  = 'public'
  ) THEN
    ALTER TABLE public.recall_affected_batches
      ADD CONSTRAINT rab_recall_batch_unique UNIQUE (recall_id, batch_id);
    RAISE NOTICE '  rab_recall_batch_unique constraint added';
  END IF;
END;
$$;


-- ── 7. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_rab_recall_id
  ON public.recall_affected_batches (recall_id);

CREATE INDEX IF NOT EXISTS idx_rab_batch_id
  ON public.recall_affected_batches (batch_id);

CREATE INDEX IF NOT EXISTS idx_rab_company_id
  ON public.recall_affected_batches (company_id);

-- (company_id, status) index guarded because step 2 may be a no-op on
-- databases where status already existed; belt-and-suspenders check.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'recall_affected_batches'
      AND  column_name  = 'status'
  ) THEN
    CREATE INDEX IF NOT EXISTS recall_affected_company_status
      ON public.recall_affected_batches (company_id, status);
    RAISE NOTICE '  recall_affected_company_status index created/verified';
  ELSE
    RAISE NOTICE '  recall_affected_company_status index SKIPPED (status column absent)';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_rab_anchor
  ON public.recall_affected_batches (recall_id)
  WHERE is_anchor = true;


-- ── 8. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.recall_affected_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recall_affected_batches: select own company" ON public.recall_affected_batches;
DROP POLICY IF EXISTS "recall_affected_batches: insert own company" ON public.recall_affected_batches;
DROP POLICY IF EXISTS "recall_affected_batches: update own company" ON public.recall_affected_batches;
DROP POLICY IF EXISTS "co_rab_select" ON public.recall_affected_batches;
DROP POLICY IF EXISTS "co_rab_insert" ON public.recall_affected_batches;
DROP POLICY IF EXISTS "co_rab_delete" ON public.recall_affected_batches;

CREATE POLICY "co_rab_select" ON public.recall_affected_batches
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

CREATE POLICY "co_rab_insert" ON public.recall_affected_batches
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "co_rab_delete" ON public.recall_affected_batches
  FOR DELETE TO authenticated
  USING (company_id = get_my_company_id());


-- ── 9. Comments ───────────────────────────────────────────────────────────────

COMMENT ON TABLE public.recall_affected_batches IS
  'Dual-purpose table. '
  '(1) SFDA compliance: tracks active/resolved/simulation recall events per batch. '
  '(2) Recall Center: junction table persisting every production order in a '
  'recall scope. is_anchor=true marks the batch stored in recalls.batch_id. '
  'FKs: recall_id → recalls, batch_id → production_orders, company_id → companies. '
  'Legacy columns depth/computed_at are nullable; no current code uses them.';

COMMENT ON COLUMN public.recall_affected_batches.depth IS
  'LEGACY — BOM tree depth from a removed batch-lineage feature. Nullable. DEFAULT 0.';

COMMENT ON COLUMN public.recall_affected_batches.computed_at IS
  'LEGACY — timestamp of the last depth computation. Nullable.';


-- ── 10. Completion notice ─────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '✓ supabase_recall_affected_batches.sql (v6) applied.';
  RAISE NOTICE '';
  RAISE NOTICE '  Step 4 — FK establishment (new in v6):';
  RAISE NOTICE '    recall_id  → recalls(id)           ON DELETE CASCADE';
  RAISE NOTICE '    batch_id   → production_orders(id) ON DELETE CASCADE';
  RAISE NOTICE '    company_id → companies(id)         ON DELETE CASCADE';
  RAISE NOTICE '    Each FK: checked by column+target, not by constraint name.';
  RAISE NOTICE '    Wrong FKs on each column dropped before re-creating.';
  RAISE NOTICE '    Data safety checked before each ADD CONSTRAINT.';
  RAISE NOTICE '    If any data safety check found violations, that FK was skipped.';
  RAISE NOTICE '    Re-run after resolving orphaned rows to add skipped FKs.';
  RAISE NOTICE '';
  RAISE NOTICE '  Carried forward from v4/v5:';
  RAISE NOTICE '    status, recall_reason, customers_affected, created_at: ADD COLUMN IF NOT EXISTS';
  RAISE NOTICE '    depth: NOT NULL dropped, DEFAULT 0 set';
  RAISE NOTICE '    computed_at: NOT NULL dropped';
  RAISE NOTICE '    recall_id column: ADD COLUMN IF NOT EXISTS';
  RAISE NOTICE '    (company_id,status) index: guarded by column-existence check';
  RAISE NOTICE '';
  RAISE NOTICE '  Existing data: untouched. No DROP, no DELETE, no TRUNCATE.';
END;
$$;
