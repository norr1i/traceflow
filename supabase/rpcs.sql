-- ============================================================
-- TraceFlow — pagination RPCs
-- Run this entire file in the Supabase SQL Editor once.
-- All functions use SECURITY INVOKER so RLS still applies.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. get_dashboard_stats
--    Returns all aggregate data needed by the dashboard.
--    No unbounded table scans — uses GROUP BY / COUNT / AVG.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_dashboard_stats(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_result        jsonb := '{}'::jsonb;
  v_week_start    timestamptz := date_trunc('day', now()) - interval '6 days';
  v_batch_ids     uuid[];
BEGIN

  -- Collect this company's batch IDs once for cross-table scoping.
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO   v_batch_ids
  FROM   production_orders
  WHERE  company_id = p_company_id;

  -- ── Production order counts ─────────────────────────────────
  SELECT v_result || jsonb_build_object(
    'total_batches',    COUNT(*),
    'orders_this_week', COUNT(*) FILTER (WHERE created_at >= v_week_start),
    'orders_by_status', jsonb_build_object(
      'pending',     COUNT(*) FILTER (WHERE status = 'pending'),
      'in_progress', COUNT(*) FILTER (WHERE status = 'in_progress'),
      'completed',   COUNT(*) FILTER (WHERE status = 'completed'),
      'cancelled',   COUNT(*) FILTER (WHERE status = 'cancelled')
    )
  )
  INTO v_result
  FROM production_orders
  WHERE company_id = p_company_id;

  -- ── QC aggregate counts ─────────────────────────────────────
  IF cardinality(v_batch_ids) > 0 THEN
    SELECT v_result || jsonb_build_object(
      'qc_counts', jsonb_build_object(
        'pass', COUNT(*) FILTER (WHERE status = 'pass'),
        'fail', COUNT(*) FILTER (WHERE status = 'fail'),
        'hold', COUNT(*) FILTER (WHERE status = 'hold')
      ),
      'weekly_inspections', COUNT(*) FILTER (WHERE inspected_at >= v_week_start)
    )
    INTO v_result
    FROM batch_qc_results
    WHERE batch_id = ANY(v_batch_ids);
  ELSE
    v_result := v_result || '{"qc_counts":{"pass":0,"fail":0,"hold":0},"weekly_inspections":0}'::jsonb;
  END IF;

  -- ── QC 7-day trend ──────────────────────────────────────────
  SELECT v_result || jsonb_build_object(
    'qc_trend', COALESCE(jsonb_agg(
      jsonb_build_object(
        'date', to_char(day, 'YYYY-MM-DD'),
        'pass', COALESCE(q.cnt_pass, 0),
        'fail', COALESCE(q.cnt_fail, 0),
        'hold', COALESCE(q.cnt_hold, 0)
      ) ORDER BY day
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM generate_series(v_week_start::date, CURRENT_DATE, '1 day'::interval) AS day
  LEFT JOIN (
    SELECT
      inspection_date                                       AS d,
      COUNT(*) FILTER (WHERE status = 'passed')::int      AS cnt_pass,
      COUNT(*) FILTER (WHERE status = 'failed')::int      AS cnt_fail,
      COUNT(*) FILTER (WHERE status = 'conditional')::int AS cnt_hold
    FROM quality_inspections
    WHERE company_id = p_company_id
      AND inspection_date >= v_week_start::date
    GROUP BY d
  ) q ON q.d = day;

  -- ── Recall risk ─────────────────────────────────────────────
  IF cardinality(v_batch_ids) > 0 THEN
    SELECT v_result || jsonb_build_object(
      'recall_risk', jsonb_build_object(
        'failed_qc_count', (
          SELECT COUNT(DISTINCT batch_id)
          FROM   batch_qc_results
          WHERE  batch_id = ANY(v_batch_ids) AND status = 'fail'
        ),
        'failed_with_sales', (
          SELECT COUNT(*)
          FROM   production_orders po
          WHERE  po.company_id = p_company_id
            AND  EXISTS (
                   SELECT 1 FROM batch_qc_results qr
                   WHERE  qr.batch_id = po.id AND qr.status = 'fail'
                 )
            AND  EXISTS (
                   SELECT 1 FROM sales s
                   WHERE  s.company_id = p_company_id AND s.product_id = po.product_id
                 )
        ),
        'missing_qc_count', (
          SELECT COUNT(*)
          FROM   production_orders
          WHERE  company_id = p_company_id
            AND  id NOT IN (SELECT DISTINCT batch_id FROM batch_qc_results WHERE batch_id = ANY(v_batch_ids))
        )
      )
    )
    INTO v_result;
  ELSE
    v_result := v_result || '{"recall_risk":{"failed_qc_count":0,"failed_with_sales":0,"missing_qc_count":0}}'::jsonb;
  END IF;

  -- ── Failed QC batches (last 10 for dashboard table) ─────────
  SELECT v_result || jsonb_build_object(
    'failed_batches', COALESCE((
      SELECT jsonb_agg(fb ORDER BY (fb->>'created_at') DESC)
      FROM (
        SELECT jsonb_build_object(
          'id',           po.id,
          'batch_status', po.status,
          'product_id',   po.product_id,
          'product_name', COALESCE(p.name, 'Unknown'),
          'sku',          COALESCE(p.sku, ''),
          'created_at',   po.created_at,
          'has_sales',    EXISTS (
                            SELECT 1 FROM sales s
                            WHERE  s.company_id = p_company_id AND s.product_id = po.product_id
                          ),
          'latest_qc', (
            SELECT jsonb_build_object(
              'batch_id',      qr.batch_id,
              'status',        qr.status,
              'inspector_name',qr.inspector_name,
              'notes',         qr.notes,
              'inspected_at',  qr.inspected_at
            )
            FROM   batch_qc_results qr
            WHERE  qr.batch_id = po.id
            ORDER  BY qr.inspected_at DESC
            LIMIT  1
          )
        ) AS fb
        FROM   production_orders po
        LEFT   JOIN products p ON p.id = po.product_id
        WHERE  po.company_id = p_company_id
          AND  EXISTS (
                 SELECT 1 FROM batch_qc_results qr2
                 WHERE  qr2.batch_id = po.id AND qr2.status = 'fail'
               )
        ORDER  BY po.created_at DESC
        LIMIT  10
      ) sub
    ), '[]'::jsonb)
  )
  INTO v_result;

  -- ── Recent QC results (last 10) ─────────────────────────────
  IF cardinality(v_batch_ids) > 0 THEN
    SELECT v_result || jsonb_build_object(
      'recent_qc', COALESCE((
        SELECT jsonb_agg(rq)
        FROM (
          SELECT jsonb_build_object(
            'batch_id',       qr.batch_id,
            'status',         qr.status,
            'inspector_name', qr.inspector_name,
            'notes',          qr.notes,
            'inspected_at',   qr.inspected_at,
            'product_name',   COALESCE(p.name, 'Unknown'),
            'sku',            COALESCE(p.sku, '')
          ) AS rq
          FROM   batch_qc_results qr
          JOIN   production_orders po ON po.id = qr.batch_id
          LEFT   JOIN products p ON p.id = po.product_id
          WHERE  qr.batch_id = ANY(v_batch_ids)
          ORDER  BY qr.inspected_at DESC
          LIMIT  10
        ) sub
      ), '[]'::jsonb)
    )
    INTO v_result;
  ELSE
    v_result := v_result || '{"recent_qc":[]}'::jsonb;
  END IF;

  -- ── Recent orders (last 10) ─────────────────────────────────
  SELECT v_result || jsonb_build_object(
    'recent_orders', COALESCE((
      SELECT jsonb_agg(ro)
      FROM (
        SELECT jsonb_build_object(
          'id',         po.id,
          'status',     po.status,
          'product_id', po.product_id,
          'quantity',   po.quantity,
          'created_at', po.created_at,
          'products',   jsonb_build_object('name', COALESCE(p.name,''), 'sku', COALESCE(p.sku,''))
        ) AS ro
        FROM   production_orders po
        LEFT   JOIN products p ON p.id = po.product_id
        WHERE  po.company_id = p_company_id
        ORDER  BY po.created_at DESC
        LIMIT  10
      ) sub
    ), '[]'::jsonb)
  )
  INTO v_result;

  -- ── In-progress orders (up to 8) ────────────────────────────
  SELECT v_result || jsonb_build_object(
    'in_progress_orders', COALESCE((
      SELECT jsonb_agg(ip)
      FROM (
        SELECT jsonb_build_object(
          'id',         po.id,
          'status',     po.status,
          'product_id', po.product_id,
          'quantity',   po.quantity,
          'created_at', po.created_at,
          'products',   jsonb_build_object('name', COALESCE(p.name,''), 'sku', COALESCE(p.sku,''))
        ) AS ip
        FROM   production_orders po
        LEFT   JOIN products p ON p.id = po.product_id
        WHERE  po.company_id = p_company_id AND po.status = 'in_progress'
        ORDER  BY po.created_at DESC
        LIMIT  8
      ) sub
    ), '[]'::jsonb)
  )
  INTO v_result;

  -- ── Scan trend 7 days ────────────────────────────────────────
  IF cardinality(v_batch_ids) > 0 THEN
    SELECT v_result || jsonb_build_object(
      'scan_trend', COALESCE(jsonb_agg(
        jsonb_build_object(
          'date',           to_char(day, 'YYYY-MM-DD'),
          'scans',          COALESCE(s.scan_count, 0),
          'unique_batches', COALESCE(s.unique_batches, 0)
        ) ORDER BY day
      ), '[]'::jsonb)
    )
    INTO v_result
    FROM generate_series(v_week_start::date, CURRENT_DATE, '1 day'::interval) AS day
    LEFT JOIN (
      SELECT
        date_trunc('day', scanned_at)::date AS d,
        COUNT(*)::int                        AS scan_count,
        COUNT(DISTINCT batch_id)::int        AS unique_batches
      FROM   scan_events
      WHERE  batch_id = ANY(v_batch_ids)
        AND  scanned_at >= v_week_start
      GROUP  BY d
    ) s ON s.d = day;
  ELSE
    v_result := v_result || '{"scan_trend":[]}'::jsonb;
  END IF;

  -- ── Total scan count ─────────────────────────────────────────
  IF cardinality(v_batch_ids) > 0 THEN
    SELECT v_result || jsonb_build_object(
      'total_scans', (SELECT COUNT(*) FROM scan_events WHERE batch_id = ANY(v_batch_ids))
    )
    INTO v_result;
  ELSE
    v_result := v_result || '{"total_scans":0}'::jsonb;
  END IF;

  -- ── Most scanned batches (top 8) ────────────────────────────
  IF cardinality(v_batch_ids) > 0 THEN
    SELECT v_result || jsonb_build_object(
      'most_scanned', COALESCE((
        SELECT jsonb_agg(ms)
        FROM (
          SELECT jsonb_build_object(
            'batch_id',     se.batch_id,
            'scan_count',   COUNT(*)::int,
            'product_name', COALESCE(p.name, 'Unknown batch'),
            'sku',          COALESCE(p.sku, ''),
            'batch_status', COALESCE(po.status, '')
          ) AS ms
          FROM   scan_events se
          JOIN   production_orders po ON po.id = se.batch_id
          LEFT   JOIN products p ON p.id = po.product_id
          WHERE  se.batch_id = ANY(v_batch_ids)
          GROUP  BY se.batch_id, p.name, p.sku, po.status
          ORDER  BY COUNT(*) DESC
          LIMIT  8
        ) sub
      ), '[]'::jsonb)
    )
    INTO v_result;
  ELSE
    v_result := v_result || '{"most_scanned":[]}'::jsonb;
  END IF;

  -- ── Recent scan events (last 12) ────────────────────────────
  IF cardinality(v_batch_ids) > 0 THEN
    SELECT v_result || jsonb_build_object(
      'recent_scans', COALESCE((
        SELECT jsonb_agg(rs)
        FROM (
          SELECT jsonb_build_object(
            'batch_id',     se.batch_id,
            'scanned_at',   se.scanned_at,
            'device_type',  se.device_type,
            'browser',      se.browser,
            'product_name', COALESCE(p.name, 'Unknown batch')
          ) AS rs
          FROM   scan_events se
          JOIN   production_orders po ON po.id = se.batch_id
          LEFT   JOIN products p ON p.id = po.product_id
          WHERE  se.batch_id = ANY(v_batch_ids)
          ORDER  BY se.scanned_at DESC
          LIMIT  12
        ) sub
      ), '[]'::jsonb)
    )
    INTO v_result;
  ELSE
    v_result := v_result || '{"recent_scans":[]}'::jsonb;
  END IF;

  -- ── Low stock count ──────────────────────────────────────────
  SELECT v_result || jsonb_build_object(
    'low_stock_count', (
      SELECT COUNT(*)
      FROM   raw_materials
      WHERE  company_id = p_company_id
        AND  quantity_in_stock::numeric <= reorder_level::numeric
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 2. get_company_sales_stats
--    Used by useSales hook (metrics panel) and dashboard.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_company_sales_stats(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_revenue',    COALESCE(SUM(total_price::numeric) FILTER (WHERE status = 'completed'), 0),
    'total_orders',     COUNT(*),
    'avg_order_value',  CASE
                          WHEN COUNT(*) FILTER (WHERE status = 'completed') > 0
                          THEN ROUND(AVG(total_price::numeric) FILTER (WHERE status = 'completed'), 2)
                          ELSE 0
                        END,
    'top_product', (
      SELECT product_name
      FROM   sales
      WHERE  company_id = p_company_id AND status = 'completed'
        AND  product_name IS NOT NULL
      GROUP  BY product_name
      ORDER  BY SUM(total_price::numeric) DESC
      LIMIT  1
    )
  )
  INTO v_result
  FROM sales
  WHERE company_id = p_company_id;

  -- Top 6 products for dashboard chart
  v_result := v_result || jsonb_build_object(
    'top_products', COALESCE((
      SELECT jsonb_agg(t ORDER BY (t->>'revenue')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'product_id',   COALESCE(product_id::text, ''),
          'product_name', COALESCE(product_name, COALESCE(product_id::text, 'Unknown')),
          'units_sold',   SUM(quantity::numeric)::int,
          'revenue',      ROUND(SUM(total_price::numeric), 2)
        ) AS t
        FROM   sales
        WHERE  company_id = p_company_id AND status = 'completed'
        GROUP  BY product_id, product_name
        ORDER  BY SUM(total_price::numeric) DESC
        LIMIT  6
      ) sub
    ), '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 3. get_qc_aggregate_stats
--    Used by useQualityInspections for the QC page metric cards.
--    Returns accurate counts and averages across ALL inspections.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_qc_aggregate_stats(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_result       jsonb;
  v_insp_ids     uuid[];
  v_month_start  timestamptz := date_trunc('month', now());
BEGIN
  -- Inspection totals and average score
  SELECT jsonb_build_object(
    'total_inspections', COUNT(*),
    'passed_count',      COUNT(*) FILTER (WHERE status = 'passed'),
    'average_score',     COALESCE(ROUND(AVG(overall_score::numeric))::int, 0),
    'pass_rate',         CASE WHEN COUNT(*) > 0
                              THEN ROUND(COUNT(*) FILTER (WHERE status = 'passed')::numeric
                                         / COUNT(*)::numeric * 100)::int
                              ELSE 0 END
  )
  INTO v_result
  FROM quality_inspections
  WHERE company_id = p_company_id;

  -- Defects this month scoped through inspection IDs
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO   v_insp_ids
  FROM   quality_inspections
  WHERE  company_id = p_company_id;

  v_result := v_result || jsonb_build_object(
    'defects_this_month', CASE WHEN cardinality(v_insp_ids) > 0 THEN (
      SELECT COUNT(*)
      FROM   quality_defects
      WHERE  inspection_id = ANY(v_insp_ids)
        AND  created_at >= v_month_start
    ) ELSE 0 END
  );

  RETURN v_result;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 4. search_recall_by_lot
--    Replaces the client-side ID scrape in RecallClient.
--    Scopes bill_of_materials through production_orders.company_id.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_recall_by_lot(p_company_id uuid, p_lot_number text)
RETURNS TABLE(production_order_id uuid)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT bom.production_order_id
  FROM   bill_of_materials bom
  JOIN   production_orders po ON po.id = bom.production_order_id
  WHERE  po.company_id = p_company_id
    AND  bom.lot_number ILIKE '%' || p_lot_number || '%';
END;
$$;
