import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'

// ── Types ────────────────────────────────────────────────────────────────────

export type CapaStatus =
  | 'open'
  | 'investigation'
  | 'corrective_action'
  | 'verification'
  | 'closed'

export type Capa = {
  id:                   string
  company_id:           string
  capa_number:          string | null
  recall_id:            string | null
  inspection_id:        string | null
  batch_id:             string | null
  title:                string
  severity:             'minor' | 'major' | 'critical'
  root_cause:           string | null
  corrective_action:    string | null
  preventive_action:    string | null
  owner_name:           string | null
  due_date:             string | null
  status:               CapaStatus
  investigation_at:     string | null
  corrective_action_at: string | null
  verification_at:      string | null
  closed_at:            string | null
  created_at:           string
  updated_at:           string
}

export type CapaStats = {
  open:              number
  investigation:     number
  corrective_action: number
  verification:      number
  closed:            number
  overdue:           number
  active:            number
}

export type CapaFormData = {
  title:             string
  severity:          'minor' | 'major' | 'critical'
  root_cause:        string
  corrective_action: string
  preventive_action: string
  owner_name:        string
  due_date:          string
  status:            CapaStatus
  recall_id:         string | null
  inspection_id:     string | null
  batch_id:          string | null
}

// Advance map: each status → the next status in the lifecycle
export const NEXT_STATUS: Partial<Record<CapaStatus, CapaStatus>> = {
  open:             'investigation',
  investigation:    'corrective_action',
  corrective_action:'verification',
  verification:     'closed',
}

export const ADVANCE_LABEL: Partial<Record<CapaStatus, string>> = {
  open:             'Start Investigation',
  investigation:    'Start Corrective Action',
  corrective_action:'Submit for Verification',
  verification:     'Close CAPA',
}

export const PAGE_SIZE = 50

function extractMessage(err: unknown): string {
  return (err instanceof Error ? err.message : (err as { message?: string })?.message) ?? 'Unknown error'
}

export function useCapas() {
  const { companyId } = useAuth()

  const [capas,      setCapas]      = useState<Capa[]>([])
  const [stats,      setStats]      = useState<CapaStats | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [page,       setPageState]  = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const load = useCallback(async (pageNum: number) => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setError(null)

    try {
      const offset = (pageNum - 1) * PAGE_SIZE

      const { data, count, error: listErr } = await supabase
        .from('capas')
        .select('*', { count: 'exact' })
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)

      if (listErr) throw listErr
      setCapas((data ?? []) as Capa[])
      setTotalCount(count ?? 0)

      // Aggregate stats via RPC
      const { data: rpc, error: rpcErr } = await supabase
        .rpc('get_capa_stats', { p_company_id: companyId })

      if (!rpcErr && rpc) {
        setStats(rpc as CapaStats)
      } else {
        // Derive from page data as fallback (RPC not yet deployed)
        const now = new Date().toISOString().slice(0, 10)
        const list = (data ?? []) as Capa[]
        setStats({
          open:              list.filter(c => c.status === 'open').length,
          investigation:     list.filter(c => c.status === 'investigation').length,
          corrective_action: list.filter(c => c.status === 'corrective_action').length,
          verification:      list.filter(c => c.status === 'verification').length,
          closed:            list.filter(c => c.status === 'closed').length,
          overdue:           list.filter(c => c.status !== 'closed' && !!c.due_date && c.due_date < now).length,
          active:            list.filter(c => c.status !== 'closed').length,
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

  const createCapa = async (data: CapaFormData): Promise<Capa | null> => {
    if (!companyId) return null
    const { data: row, error: err } = await supabase
      .from('capas')
      .insert([{ ...data, company_id: companyId }])
      .select()
      .single()
    if (err) { setError(err.message); return null }
    await load(1); setPageState(1)
    return row as Capa
  }

  const advanceStatus = async (id: string, currentStatus: CapaStatus): Promise<boolean> => {
    const next = NEXT_STATUS[currentStatus]
    if (!next) return false

    const now = new Date().toISOString()
    const patch: Partial<Capa> = { status: next }
    if (next === 'investigation')     patch.investigation_at     = now
    if (next === 'corrective_action') patch.corrective_action_at = now
    if (next === 'verification')      patch.verification_at      = now
    if (next === 'closed')            patch.closed_at            = now

    const { error: err } = await supabase
      .from('capas')
      .update(patch)
      .eq('id', id)
      .eq('company_id', companyId ?? '')
    if (err) { setError(err.message); return false }
    await load(page)
    return true
  }

  const updateCapa = async (id: string, data: Partial<CapaFormData>): Promise<boolean> => {
    const { error: err } = await supabase
      .from('capas')
      .update(data)
      .eq('id', id)
      .eq('company_id', companyId ?? '')
    if (err) { setError(err.message); return false }
    await load(page)
    return true
  }

  const deleteCapa = async (id: string): Promise<boolean> => {
    const { error: err } = await supabase
      .from('capas')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId ?? '')
    if (err) { setError(err.message); return false }
    const nextPage = capas.length === 1 && page > 1 ? page - 1 : page
    setPageState(nextPage)
    await load(nextPage)
    return true
  }

  return {
    capas, stats, loading, error,
    page, totalCount, totalPages, goToPage,
    createCapa, advanceStatus, updateCapa, deleteCapa,
    refresh: () => load(page),
  }
}
