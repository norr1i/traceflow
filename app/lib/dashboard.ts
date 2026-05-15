import { supabase } from './supabase'

export async function getDashboardStats() {
  const [
    { data: batches },
    { data: qcResults },
    { data: scans },
    { count: totalScans },
    { data: salesProducts },
  ] = await Promise.all([
    supabase
      .from('production_orders')
      .select('id, status, product_id, created_at, products(name, sku)'),
    supabase
      .from('batch_qc_results')
      .select('batch_id, status, inspector_name, notes, inspected_at')
      .order('inspected_at', { ascending: false }),
    supabase
      .from('scan_events')
      .select('batch_id, scanned_at, device_type, browser')
      .order('scanned_at', { ascending: false })
      .limit(500),
    supabase.from('scan_events').select('*', { count: 'exact', head: true }),
    supabase.from('sales').select('product_id'),
  ])

  type BatchRow = {
    id: string
    status: string
    product_id: string
    created_at: string
    products: { name: string; sku: string } | null
  }

  const batchList  = (batches ?? []) as unknown as BatchRow[]
  const qcList     = qcResults ?? []
  const scanList   = scans ?? []

  // ── QC counts ───────────────────────────────────────────────────────────
  const qcCounts = {
    pass: qcList.filter(q => q.status === 'pass').length,
    fail: qcList.filter(q => q.status === 'fail').length,
    hold: qcList.filter(q => q.status === 'hold').length,
  }

  // ── Batch lookup (for joining names to events) ───────────────────────────
  const batchMap = new Map<string, BatchRow>(batchList.map(b => [b.id, b]))

  // ── Latest QC per batch (qcList sorted desc — first hit = latest) ────────
  const latestQcMap = new Map<string, typeof qcList[0]>()
  for (const q of qcList) {
    if (!latestQcMap.has(q.batch_id)) latestQcMap.set(q.batch_id, q)
  }

  // ── Recall risk ──────────────────────────────────────────────────────────
  const batchesWithQc       = new Set(qcList.map(q => q.batch_id))
  const productIdsWithSales = new Set((salesProducts ?? []).map(s => s.product_id as string))

  const failedBatchIds = batchList
    .filter(b => latestQcMap.get(b.id)?.status === 'fail')
    .map(b => b.id)
  const failedBatchSet = new Set(failedBatchIds)

  const failedWithSalesCount = batchList.filter(
    b => failedBatchSet.has(b.id) && productIdsWithSales.has(b.product_id)
  ).length
  const missingQcCount = batchList.filter(b => !batchesWithQc.has(b.id)).length

  // ── Failed QC batches (for table) ────────────────────────────────────────
  const failedBatches = batchList
    .filter(b => failedBatchSet.has(b.id))
    .slice(0, 10)
    .map(b => ({
      id:           b.id,
      batch_status: b.status,
      product_id:   b.product_id,
      product_name: b.products?.name ?? 'Unknown',
      sku:          b.products?.sku  ?? '',
      created_at:   b.created_at,
      has_sales:    productIdsWithSales.has(b.product_id),
      latest_qc:    latestQcMap.get(b.id)!,
    }))

  // ── Recent QC inspections (with product context) ─────────────────────────
  const recentQc = qcList.slice(0, 10).map(q => {
    const b = batchMap.get(q.batch_id)
    return {
      batch_id:      q.batch_id,
      status:        q.status as 'pass' | 'fail' | 'hold',
      inspector_name: q.inspector_name,
      notes:         q.notes as string | null,
      inspected_at:  q.inspected_at,
      product_name:  b?.products?.name ?? 'Unknown',
      sku:           b?.products?.sku  ?? '',
    }
  })

  // ── Most scanned batches ─────────────────────────────────────────────────
  const scanCountMap = new Map<string, number>()
  for (const s of scanList) {
    scanCountMap.set(s.batch_id, (scanCountMap.get(s.batch_id) ?? 0) + 1)
  }
  const mostScanned = [...scanCountMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([batchId, count]) => {
      const b = batchMap.get(batchId)
      return {
        batch_id:     batchId,
        scan_count:   count,
        product_name: b?.products?.name ?? 'Unknown batch',
        sku:          b?.products?.sku  ?? '',
        batch_status: b?.status ?? '',
      }
    })

  // ── Recent scan events (with product context) ────────────────────────────
  const recentScans = scanList.slice(0, 12).map(s => {
    const b = batchMap.get(s.batch_id)
    return {
      batch_id:     s.batch_id,
      scanned_at:   s.scanned_at,
      device_type:  s.device_type as string | null,
      browser:      s.browser as string | null,
      product_name: b?.products?.name ?? 'Unknown batch',
    }
  })

  // ── Production orders by status ──────────────────────────────────────────
  const ordersByStatus = {
    pending:     batchList.filter(b => b.status === 'pending').length,
    in_progress: batchList.filter(b => b.status === 'in_progress').length,
    completed:   batchList.filter(b => b.status === 'completed').length,
    cancelled:   batchList.filter(b => b.status === 'cancelled').length,
  }

  return {
    totalBatches: batchList.length,
    totalScans:   totalScans ?? 0,
    qcCounts,
    ordersByStatus,
    recentQc,
    failedBatches,
    mostScanned,
    recentScans,
    recallRisk: {
      failedQcCount:   failedBatchIds.length,
      failedWithSales: failedWithSalesCount,
      missingQcCount,
    },
  }
}

export type DashboardStats = Awaited<ReturnType<typeof getDashboardStats>>
