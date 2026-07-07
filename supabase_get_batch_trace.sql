-- ============================================================
-- TraceFlow — get_batch_trace RPC (v2)
-- File: supabase_get_batch_trace.sql
-- ============================================================
--
-- What changed vs the previous version:
--   materials[] now includes supplier_name via the join chain:
--     bill_of_materials
--       → raw_material_lots  (raw_material_lot_id FK, nullable)
--       → suppliers          (supplier_id FK, nullable)
--
--   supplier_name is NULL when:
--     (a) bom.raw_material_lot_id is not set (legacy BOM rows), or
--     (b) the raw_material_lot has no linked supplier.
--
--   lot_number prefers rml.lot_number (formal record) and falls
--   back to bom.lot_number (legacy free-text field).
--
-- Everything else (order, qc_results, sales) is unchanged.
-- Safe to re-run — CREATE OR REPLACE is idempotent.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

CREATE OR REPLACE FUNCTION get_batch_trace(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id  uuid;
  v_order       jsonb;
  v_qc_results  jsonb;
  v_materials   jsonb;
  v_sales       jsonb;
BEGIN

  -- ── Resolve company_id ────────────────────────────────────
  -- SECURITY DEFINER means anon callers (QR scan page) bypass
  -- RLS. All downstream queries are explicitly company-scoped.
  SELECT po.company_id
  INTO   v_company_id
  FROM   production_orders po
  WHERE  po.id = p_batch_id;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- ── Batch header ──────────────────────────────────────────
  SELECT jsonb_build_object(
    'id',           po.id,
    'product_name', p.name,
    'sku',          p.sku,
    'quantity',     po.quantity,
    'status',       po.status,
    'created_at',   po.created_at,
    'started_at',   po.started_at,
    'completed_at', po.completed_at
  )
  INTO  v_order
  FROM  production_orders po
  JOIN  products           p ON p.id = po.product_id
  WHERE po.id         = p_batch_id
    AND po.company_id = v_company_id;

  -- ── QC Results ────────────────────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'status',         qr.status,
        'inspector_name', qr.inspector_name,
        'notes',          qr.notes,
        'inspected_at',   qr.inspected_at
      ) ORDER BY qr.inspected_at DESC
    ),
    '[]'::jsonb
  )
  INTO  v_qc_results
  FROM  batch_qc_results qr
  WHERE qr.batch_id   = p_batch_id
    AND qr.company_id = v_company_id;

  -- ── Materials ─────────────────────────────────────────────
  --
  -- Join chain (both joins are LEFT so legacy rows still appear):
  --
  --   bill_of_materials bom
  --     LEFT JOIN raw_material_lots rml
  --       ON rml.id = bom.raw_material_lot_id
  --     LEFT JOIN suppliers s
  --       ON s.id = rml.supplier_id
  --
  -- Columns returned per row:
  --   material_name  — from bom.material_name
  --   lot_number     — rml.lot_number if the formal lot is linked,
  --                    otherwise falls back to bom.lot_number
  --   supplier_name  — s.name; NULL when FK is unpopulated or the
  --                    lot has no linked supplier
  --   quantity       — bom.quantity (amount consumed in this batch)
  --   unit           — bom.unit
  --
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'material_name', bom.material_name,
        'lot_number',    COALESCE(rml.lot_number, bom.lot_number),
        'supplier_name', s.name,
        'quantity',      bom.quantity,
        'unit',          bom.unit
      ) ORDER BY bom.created_at
    ),
    '[]'::jsonb
  )
  INTO  v_materials
  FROM      bill_of_materials bom
  LEFT JOIN raw_material_lots rml ON rml.id = bom.raw_material_lot_id
  LEFT JOIN suppliers         s   ON s.id   = rml.supplier_id
  WHERE bom.production_order_id = p_batch_id
    AND bom.company_id          = v_company_id;

  -- ── Sales / Distribution ──────────────────────────────────
  -- sales rows are linked to the batch via product_id (the sales
  -- table has no direct production_order_id FK).
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'customer_name', sa.customer_name,
        'quantity',      sa.quantity,
        'sold_at',       sa.sold_at
      ) ORDER BY sa.sold_at DESC
    ),
    '[]'::jsonb
  )
  INTO  v_sales
  FROM  sales sa
  WHERE sa.product_id IN (
    SELECT po.product_id
    FROM   production_orders po
    WHERE  po.id         = p_batch_id
      AND  po.company_id = v_company_id
  );

  RETURN jsonb_build_object(
    'order',      v_order,
    'qc_results', v_qc_results,
    'materials',  v_materials,
    'sales',      v_sales
  );
END;
$$;

-- Grant to both roles: anon for the public QR scan page,
-- authenticated for internal staff views.
GRANT EXECUTE ON FUNCTION get_batch_trace(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_batch_trace(uuid) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✓ get_batch_trace(uuid) redeployed.';
  RAISE NOTICE '  materials[].supplier_name now populated via:';
  RAISE NOTICE '    bill_of_materials → raw_material_lots → suppliers';
  RAISE NOTICE '  supplier_name is NULL for BOM rows where raw_material_lot_id is not set.';
  RAISE NOTICE '  lot_number: prefers rml.lot_number, falls back to bom.lot_number.';
END;
$$;
