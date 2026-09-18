import { supabase } from './supabase'

// ── Row types (kept for downstream consumers) ────────────────────────────────

export type BatchRow = {
  id: string
  status: string
  product_id: string
  quantity: number
  created_at: string
  products: { name: string; sku: string } | null
}

export type RawMaterialRow = {
  id: string
  name: string
  unit: string
  quantity_in_stock: number
  reorder_level: number
}

export type SaleRow = {
  id: string
  product_id: string
  product_name: string | null
  quantity: number
  unit_price: number
  total_price: number
  customer_name: string | null
  status: string
  sold_at: string
  created_at: string
}

export type ActivityLogRow = {
  id:          string
  action_type: string
  entity_type: string
  entity_id:   string | null
  message:     string
  actor_email: string | null
  metadata:    Record<string, unknown> | null
  created_at:  string
}

export type TopProduct = {
  product_id:   string
  product_name: string
  units_sold:   number
  revenue:      number
}

// ── RPC return types ─────────────────────────────────────────────────────────

type DashboardRpc = {
  total_batches:       number
  orders_this_week:    number
  orders_by_status:    { pending: number; in_progress: number; completed: number; cancelled: number }
  qc_counts:           { pass: number; fail: number; hold: number }
  weekly_inspections:  number
  qc_trend:            Array<{ date: string; pass: number; fail: number; hold: number }>
  scan_trend:          Array<{ date: string; scans: number; unique_batches: number }>
  total_scans:         number
  recall_risk:         { failed_qc_count: number; failed_with_sales: number; missing_qc_count: number }
  failed_batches:      Array<{
    id: string; batch_status: string; product_id: string; product_name: string; sku: string
    created_at: string; has_sales: boolean
    latest_qc: { batch_id: string; status: string; inspector_name: string; notes: string | null; inspected_at: string } | null
  }>
  recent_qc:           Array<{
    batch_id: string; status: 'pass' | 'fail' | 'hold'; inspector_name: string; notes: string | null
    inspected_at: string; product_name: string; sku: string
  }>
  recent_orders:       Array<BatchRow>
  in_progress_orders:  Array<BatchRow>
  most_scanned:        Array<{ batch_id: string; scan_count: number; product_name: string; sku: string; batch_status: string }>
  recent_scans:        Array<{ batch_id: string; scanned_at: string; device_type: string | null; browser: string | null; product_name: string }>
  low_stock_count:     number
}

type SalesRpc = {
  total_revenue:   number
  total_orders:    number
  avg_order_value: number
  top_product:     string | null
  top_products:    Array<{ product_id: string; product_name: string; units_sold: number; revenue: number }>
}

// ── Main fetch ───────────────────────────────────────────────────────────────

export async function getDashboardStats(companyId: string) {
  // ── Phase 1: RPC aggregates (no full-table scans) + parallel direct queries ──
  const [
    { data: rpcRaw },
    { data: salesRpcRaw },
    { data: recentSalesRaw },
    { data: inventoryRaw },
    { data: activityRaw },
    { data: recallStatsRaw },
    { data: capaStatsRaw },
  ] = await Promise.all([
    supabase.rpc('get_dashboard_stats',         { p_company_id: companyId }),
    supabase.rpc('get_company_sales_stats',      { p_company_id: companyId }),
    supabase
      .from('sales')
      .select('id, product_id, product_name, quantity, unit_price, total_price, customer_name, status, sold_at, created_at')
      .eq('company_id', companyId)
      .order('sold_at', { ascending: false })
      .limit(15),
    supabase
      .from('raw_materials')
      .select('id, name, unit, quantity_in_stock, reorder_level')
      .eq('company_id', companyId)
      .order('quantity_in_stock', { ascending: true })
      .limit(100),
    supabase
      .from('activity_logs')
      .select('id, action_type, entity_type, entity_id, message, actor_email, metadata, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.rpc('get_recall_stats', { p_company_id: companyId }),
    supabase.rpc('get_capa_stats',   { p_company_id: companyId }),
  ])

  const rpc       = (rpcRaw     ?? {}) as DashboardRpc
  const salesRpc  = (salesRpcRaw ?? {}) as SalesRpc

  const qcCounts = rpc.qc_counts ?? { pass: 0, fail: 0, hold: 0 }
  const totalQc  = qcCounts.pass + qcCounts.fail + qcCounts.hold
  const passRate = totalQc > 0 ? Math.round((qcCounts.pass / totalQc) * 100) : null

  // Trend arrays keep the raw ISO date only; chart components format locale-aware
  // day labels at render time (presentation layer), so this stays language-agnostic.
  const qcTrend = rpc.qc_trend ?? []

  const scanTrend = (rpc.scan_trend ?? []).map(r => ({
    date:          r.date,
    scans:         r.scans,
    uniqueBatches: r.unique_batches,
  }))

  // numeric columns arrive as strings from PostgREST; normalise here
  const rawMaterials = ((inventoryRaw ?? []) as unknown as RawMaterialRow[]).map(m => ({
    ...m,
    quantity_in_stock: Number(m.quantity_in_stock),
    reorder_level:     Number(m.reorder_level),
  }))

  const salesList    = (recentSalesRaw ?? []) as unknown as SaleRow[]
  const activityFeed = (activityRaw   ?? []) as unknown as ActivityLogRow[]

  const lowStockCount = Number(rpc.low_stock_count ?? rawMaterials.filter(
    m => isFinite(m.quantity_in_stock) && isFinite(m.reorder_level) && m.quantity_in_stock <= m.reorder_level
  ).length)

  const topProducts: TopProduct[] = ((salesRpc.top_products ?? []) as unknown as TopProduct[]).map(p => ({
    product_id:   p.product_id,
    product_name: p.product_name,
    units_sold:   Number(p.units_sold),
    revenue:      Number(p.revenue),
  }))

  return {
    // Core production (from RPC — full-company counts)
    totalBatches:     Number(rpc.total_batches      ?? 0),
    totalScans:       Number(rpc.total_scans         ?? 0),
    passRate,
    weeklyInspections:Number(rpc.weekly_inspections  ?? 0),
    qcCounts,
    ordersByStatus:   rpc.orders_by_status ?? { pending: 0, in_progress: 0, completed: 0, cancelled: 0 },
    ordersThisWeek:   Number(rpc.orders_this_week    ?? 0),
    // Trend (from RPC — full 7-day window, no row cap)
    qcTrend,
    scanTrend,
    // Lists (from RPC — pre-limited server-side)
    recentQc:     rpc.recent_qc ?? [],
    failedBatches: (rpc.failed_batches ?? []).map(b => ({
      id:           b.id,
      batch_status: b.batch_status,
      product_id:   b.product_id,
      product_name: b.product_name,
      sku:          b.sku,
      created_at:   b.created_at,
      has_sales:    b.has_sales,
      latest_qc:    b.latest_qc as {
        batch_id: string; status: 'pass' | 'fail' | 'hold'
        inspector_name: string; notes: string | null; inspected_at: string
      },
    })),
    mostScanned:      rpc.most_scanned       ?? [],
    recentScans:      rpc.recent_scans       ?? [],
    recallRisk: {
      failedQcCount:   Number(rpc.recall_risk?.failed_qc_count  ?? 0),
      failedWithSales: Number(rpc.recall_risk?.failed_with_sales ?? 0),
      missingQcCount:  Number(rpc.recall_risk?.missing_qc_count  ?? 0),
    },
    recentOrders:     rpc.recent_orders      ?? [],
    inProgressOrders: rpc.in_progress_orders ?? [],
    // Inventory (direct query, capped at 100 — sufficient for the widget)
    rawMaterials,
    lowStockCount,
    // Sales (revenue from RPC — full-company totals; recent list from direct query)
    recentSales:       salesList,
    totalSalesRevenue: Number(salesRpc.total_revenue   ?? 0),
    totalSalesCount:   Number(salesRpc.total_orders    ?? 0),
    topProducts,
    // Activity feed (direct query, already capped at 30)
    activityFeed,
    // CAPA & Recall stats (from new RPCs — null when tables not yet deployed)
    recallStats: recallStatsRaw as {
      open: number; in_progress: number; closed: number
      total: number; critical_open: number; active: number; resolution_rate: number
    } | null,
    capaStats: capaStatsRaw as {
      open: number; investigation: number; corrective_action: number
      verification: number; closed: number; overdue: number; active: number
    } | null,
  }
}

export type DashboardStats = Awaited<ReturnType<typeof getDashboardStats>>
