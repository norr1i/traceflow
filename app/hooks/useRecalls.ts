import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'

// ── Types ────────────────────────────────────────────────────────────────────

export type RecallSeverity = 'low' | 'medium' | 'high' | 'critical'
export type RecallStatus   = 'open' | 'in_progress' | 'closed'

export type LinkedCapaSummary = {
  id:          string
  capa_number: string | null
  status:      string
  severity:    string
}

export type Recall = {
  id:                string
  company_id:        string
  recall_number:     string | null
  product_id:        string | null
  batch_id:          string | null
  title:             string
  reason:            string
  severity:          RecallSeverity
  status:            RecallStatus
  root_cause:        string | null
  corrective_action: string | null
  affected_units:    number | null
  initiated_by_name: string | null
  initiated_at:      string
  closed_at:         string | null
  created_at:        string
  updated_at:        string
  // joined fields
  products?:          { name: string; sku: string } | null
  production_orders?: { id: string; status: string } | null
  // enriched client-side: CAPAs linked to this recall
  linked_capas?:      LinkedCapaSummary[]
}

export type RecallStats = {
  open:            number
  in_progress:     number
  closed:          number
  total:           number
  critical_open:   number
  active:          number
  resolution_rate: number
}

export type RecallFormData = {
  title:             string
  reason:            string
  severity:          RecallSeverity
  root_cause:        string
  corrective_action: string
  affected_units:    string        // string for form binding, parsed on save
  initiated_by_name: string
  batch_id:          string | null
  product_id:        string | null
}

export const RECALL_PAGE_SIZE = 50

function extractMessage(err: unknown): string {
  return (err instanceof Error ? err.message : (err as { message?: string })?.message) ?? 'Unknown error'
}

export function useRecalls() {
  const { companyId } = useAuth()

  const [recalls,    setRecalls]    = useState<Recall[]>([])
  const [stats,      setStats]      = useState<RecallStats | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [page,       setPageState]  = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  const totalPages = Math.max(1, Math.ceil(totalCount / RECALL_PAGE_SIZE))

  const load = useCallback(async (pageNum: number) => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setError(null)

    try {
      const offset = (pageNum - 1) * RECALL_PAGE_SIZE

      const { data, count, error: listErr } = await supabase
        .from('recalls')
        .select('*, products(name, sku)', { count: 'exact' })
        .eq('company_id', companyId)
        .order('initiated_at', { ascending: false })
        .range(offset, offset + RECALL_PAGE_SIZE - 1)

      if (listErr) throw listErr
      const recallList = (data ?? []) as Recall[]
      setTotalCount(count ?? 0)

      // Load stats + linked CAPAs in parallel
      const recallIds = recallList.map(r => r.id)
      const [rpcRes, capaRes] = await Promise.all([
        supabase.rpc('get_recall_stats', { p_company_id: companyId }),
        recallIds.length > 0
          ? supabase
              .from('capas')
              .select('id, capa_number, status, severity, recall_id')
              .eq('company_id', companyId)
              .in('recall_id', recallIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      // Group linked CAPAs by recall_id
      const capasByRecall = new Map<string, LinkedCapaSummary[]>()
      for (const c of ((capaRes.data ?? []) as Array<{
        id: string; capa_number: string | null; status: string; severity: string; recall_id: string | null
      }>)) {
        if (!c.recall_id) continue
        const list = capasByRecall.get(c.recall_id) ?? []
        list.push({ id: c.id, capa_number: c.capa_number, status: c.status, severity: c.severity })
        capasByRecall.set(c.recall_id, list)
      }

      setRecalls(recallList.map(r => ({ ...r, linked_capas: capasByRecall.get(r.id) ?? [] })))

      if (!rpcRes.error && rpcRes.data) {
        setStats(rpcRes.data as RecallStats)
      } else {
        setStats({
          open:            recallList.filter(r => r.status === 'open').length,
          in_progress:     recallList.filter(r => r.status === 'in_progress').length,
          closed:          recallList.filter(r => r.status === 'closed').length,
          total:           recallList.length,
          critical_open:   recallList.filter(r => r.severity === 'critical' && r.status !== 'closed').length,
          active:          recallList.filter(r => r.status !== 'closed').length,
          resolution_rate: 0,
        })
      }
    } catch (err) {
      setError(extractMessage(err))
    } finally {
      setLoading(false)
    }
  }, [companyId])

  const goToPage = useCallback((p: number) => { setPageState(p); load(p) }, [load])
  useEffect(() => { load(1); setPageState(1) }, [load])

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createRecall = async (data: RecallFormData): Promise<Recall | null> => {
    if (!companyId) return null
    const payload = {
      company_id:        companyId,
      title:             data.title,
      reason:            data.reason,
      severity:          data.severity,
      root_cause:        data.root_cause || null,
      corrective_action: data.corrective_action || null,
      affected_units:    data.affected_units ? parseInt(data.affected_units, 10) : null,
      initiated_by_name: data.initiated_by_name || null,
      batch_id:          data.batch_id   || null,
      product_id:        data.product_id || null,
    }
    const { data: row, error: err } = await supabase
      .from('recalls')
      .insert([payload])
      .select()
      .single()
    if (err) { setError(err.message); return null }

    const recall = row as Recall

    // Auto-create a linked CAPA investigation (non-blocking; errors are swallowed)
    const capaRootCause = [
      `Auto-generated CAPA for recall ${recall.recall_number ?? recall.title}.`,
      `Recall Reason: ${data.reason}`,
      data.root_cause         ? `Initial Root Cause: ${data.root_cause}` : null,
      data.corrective_action  ? `Proposed Corrective Action: ${data.corrective_action}` : null,
      data.affected_units     ? `Affected Units: ${parseInt(data.affected_units, 10).toLocaleString()}` : null,
      data.initiated_by_name  ? `Initiated By: ${data.initiated_by_name}` : null,
    ].filter(Boolean).join('\n')

    void supabase.from('capas').insert([{
      company_id:   companyId,
      recall_id:    recall.id,
      batch_id:     data.batch_id ?? null,
      title:        `Recall Investigation — ${recall.recall_number ?? recall.title}`,
      severity:     'critical',
      source_type:  'recall',
      status:       'open',
      owner_name:   data.initiated_by_name || null,
      due_date:     new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      root_cause:   capaRootCause,
    }])

    await load(1); setPageState(1)
    return recall
  }

  const updateStatus = async (id: string, status: RecallStatus): Promise<boolean> => {
    const patch: Partial<Recall> = { status }
    if (status === 'closed') patch.closed_at = new Date().toISOString()
    const { error: err } = await supabase
      .from('recalls')
      .update(patch)
      .eq('id', id)
      .eq('company_id', companyId ?? '')
    if (err) { setError(err.message); return false }
    await load(page)
    return true
  }

  const deleteRecall = async (id: string): Promise<boolean> => {
    const { error: err } = await supabase
      .from('recalls')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId ?? '')
    if (err) { setError(err.message); return false }
    const nextPage = recalls.length === 1 && page > 1 ? page - 1 : page
    setPageState(nextPage)
    await load(nextPage)
    return true
  }

  return {
    recalls, stats, loading, error,
    page, totalCount, totalPages, goToPage,
    createRecall, updateStatus, deleteRecall,
    refresh: () => load(page),
  }
}
