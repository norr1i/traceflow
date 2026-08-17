import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'

export const SALES_PAGE_SIZE = 50

export interface SaleRecord {
  id: string
  product_id?: string
  product_name?: string
  quantity: number
  unit_price?: number
  total_price: number
  customer_name?: string
  status: string
  sold_at: string
}

export type SaleFormData = {
  product_name: string
  customer_name: string
  quantity: number
  unit_price: number
  total_price: number
  status: string
}

export interface SalesMetrics {
  total_revenue: number
  total_orders: number
  avg_order_value: number
  top_product?: string
}

// Shape returned by get_company_sales_stats RPC
type SalesStatsRpc = {
  total_revenue:   number
  total_orders:    number
  avg_order_value: number
  top_product:     string | null
}

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  return (err as { message?: string })?.message ?? fallback
}

export function useSales() {
  const { companyId } = useAuth()

  const [sales,      setSales]      = useState<SaleRecord[]>([])
  const [metrics,    setMetrics]    = useState<SalesMetrics | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [page,       setPageState]  = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  const totalPages = Math.max(1, Math.ceil(totalCount / SALES_PAGE_SIZE))

  // ── Core load: paginated sales rows + RPC-backed aggregate metrics ──────
  const load = useCallback(async (pageNum: number) => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const offset = (pageNum - 1) * SALES_PAGE_SIZE

      // Paginated rows with total count
      const { data, count, error: fetchError } = await supabase
        .from('sales')
        .select('*', { count: 'exact' })
        .eq('company_id', companyId)
        .order('sold_at', { ascending: false })
        .range(offset, offset + SALES_PAGE_SIZE - 1)

      if (fetchError) throw fetchError

      setSales(data ?? [])
      setTotalCount(count ?? 0)

      // Full-company aggregate metrics via RPC
      const { data: rpc, error: rpcErr } = await supabase
        .rpc('get_company_sales_stats', { p_company_id: companyId })

      if (!rpcErr && rpc) {
        const r = rpc as SalesStatsRpc
        setMetrics({
          total_revenue:   Number(r.total_revenue   ?? 0),
          total_orders:    Number(r.total_orders    ?? 0),
          avg_order_value: Number(r.avg_order_value ?? 0),
          top_product:     r.top_product ?? undefined,
        })
      } else {
        // RPC not yet deployed — metrics unavailable until SQL is run
        setMetrics(null)
      }
    } catch (err) {
      setError(extractMessage(err, 'Failed to fetch sales'))
    } finally {
      setLoading(false)
    }
  }, [companyId])

  const goToPage = useCallback((p: number) => {
    setPageState(p)
    load(p)
  }, [load])

  // Initial load
  useEffect(() => { load(1); setPageState(1) }, [load])

  // ── Mutations ────────────────────────────────────────────────────────────

  const createSale = async (data: SaleFormData): Promise<SaleRecord | null> => {
    if (!companyId) return null
    try {
      const { data: newSale, error: insertError } = await supabase
        .from('sales')
        .insert([{ ...data, company_id: companyId, sold_at: new Date().toISOString() }])
        .select()
        .single()

      if (insertError) throw insertError

      // Reload page 1 so the new record is visible and metrics refresh
      setPageState(1)
      await load(1)
      return newSale
    } catch (err) {
      setError(extractMessage(err, 'Failed to create sale'))
      return null
    }
  }

  const deleteSale = async (id: string): Promise<boolean> => {
    if (!companyId) return false
    try {
      const { error: deleteError } = await supabase
        .from('sales')
        .delete()
        .eq('id', id)
        .eq('company_id', companyId)

      if (deleteError) throw deleteError

      const nextPage = sales.length === 1 && page > 1 ? page - 1 : page
      setPageState(nextPage)
      await load(nextPage)
      return true
    } catch (err) {
      setError(extractMessage(err, 'Failed to delete sale'))
      return false
    }
  }

  return {
    sales,
    metrics,
    loading,
    error,
    page,
    totalCount,
    totalPages,
    goToPage,
    refetch: () => load(page),
    createSale,
    deleteSale,
  }
}
