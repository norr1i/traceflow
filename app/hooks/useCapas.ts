import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'

// ── Core types ────────────────────────────────────────────────────────────────

export type CapaStatus =
  | 'open'
  | 'investigation'
  | 'corrective_action'
  | 'verification'
  | 'closed'

export type CapaSourceType =
  | 'quality_issue'
  | 'recall'
  | 'audit'
  | 'complaint'
  | 'supplier'
  | 'other'

export type Capa = {
  id:                   string
  company_id:           string
  capa_number:          string | null
  recall_id:            string | null
  inspection_id:        string | null
  batch_id:             string | null
  title:                string
  severity:             'minor' | 'major' | 'critical'
  source_type:          CapaSourceType | null
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

export type CapaAction = {
  id:           string
  company_id:   string
  capa_id:      string
  description:  string
  assigned_to:  string | null
  due_date:     string | null
  status:       'open' | 'in_progress' | 'completed'
  completed_at: string | null
  created_at:   string
  updated_at:   string
}

export type CapaEvidence = {
  id:          string
  company_id:  string
  capa_id:     string
  file_name:   string
  file_url:    string
  file_type:   string | null
  file_size:   number | null
  uploaded_by: string | null
  notes:       string | null
  created_at:  string
}

export type CapaStatusHistory = {
  id:          string
  company_id:  string
  capa_id:     string
  from_status: string | null
  to_status:   string
  changed_by:  string | null
  note:        string | null
  created_at:  string
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

export type CapaAnalytics = {
  avg_closure_days: number
  by_priority:      { severity: string; count: number }[]
  by_source:        { source_type: string; count: number }[]
  monthly_trend:    { month: string; opened: number; closed: number }[]
}

// ── Recall-linked types (used in useCapaDetail) ───────────────────────────────

export type RecallForCapa = {
  id:                string
  recall_number:     string | null
  title:             string
  reason:            string
  severity:          string
  status:            string
  affected_units:    number | null
  initiated_at:      string
  batch_id:          string | null
  product_id:        string | null
}

export type RecallImpactProduct = {
  product_name:   string
  sku:            string
  affected_units: number
  batch_count:    number
}

export type RecallImpactBatch = {
  batch_id:     string
  product_name: string
  sku:          string
  quantity:     number
  status:       string
  created_at:   string
  completed_at: string | null
}

export type RecallImpactDistributor = {
  batch_id:       string
  recipient_name: string
  recipient_type: string
  quantity:       number
  shipped_at:     string | null
  notes:          string | null
}

export type RecallImpact = {
  affected_products:     RecallImpactProduct[]
  affected_batches:      RecallImpactBatch[]
  affected_distributors: RecallImpactDistributor[]
  total_affected_units:  number
  total_batches:         number
  total_products:        number
  total_distributors:    number
  risk_level:            string
  has_open_recall:       boolean
}

export type CapaFormData = {
  title:             string
  severity:          'minor' | 'major' | 'critical'
  source_type:       CapaSourceType | null
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

// ── Constants ─────────────────────────────────────────────────────────────────

export const NEXT_STATUS: Partial<Record<CapaStatus, CapaStatus>> = {
  open:              'investigation',
  investigation:     'corrective_action',
  corrective_action: 'verification',
  verification:      'closed',
}

export const ADVANCE_LABEL: Partial<Record<CapaStatus, string>> = {
  open:              'Start Investigation',
  investigation:     'Start Corrective Action',
  corrective_action: 'Submit for Verification',
  verification:      'Close CAPA',
}

export const SOURCE_LABELS: Record<CapaSourceType | 'unspecified', string> = {
  quality_issue: 'Quality Issue',
  recall:        'Recall',
  audit:         'Audit',
  complaint:     'Complaint',
  supplier:      'Supplier',
  other:         'Other',
  unspecified:   'Unspecified',
}

export const PAGE_SIZE = 50

function extractMessage(err: unknown): string {
  return (err instanceof Error ? err.message : (err as { message?: string })?.message) ?? 'Unknown error'
}

// ── useCapas (list / dashboard) ───────────────────────────────────────────────

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

      const { data: rpc, error: rpcErr } = await supabase
        .rpc('get_capa_stats', { p_company_id: companyId })

      if (!rpcErr && rpc) {
        setStats(rpc as CapaStats)
      } else {
        const now  = new Date().toISOString().slice(0, 10)
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

  const advanceStatus = async (
    id: string,
    currentStatus: CapaStatus,
    changedBy?: string,
  ): Promise<boolean> => {
    const next = NEXT_STATUS[currentStatus]
    if (!next) return false

    const now   = new Date().toISOString()
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

    if (companyId) {
      await supabase.from('capa_status_history').insert({
        company_id:  companyId,
        capa_id:     id,
        from_status: currentStatus,
        to_status:   next,
        changed_by:  changedBy ?? null,
      })
    }

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

// ── useCapaDetail (single CAPA page) ─────────────────────────────────────────

export function useCapaDetail(capaId: string | undefined) {
  const { companyId, user } = useAuth()

  const [capa,          setCapa]          = useState<Capa | null>(null)
  const [actions,       setActions]       = useState<CapaAction[]>([])
  const [evidence,      setEvidence]      = useState<CapaEvidence[]>([])
  const [history,       setHistory]       = useState<CapaStatusHistory[]>([])
  const [linkedRecall,  setLinkedRecall]  = useState<RecallForCapa | null>(null)
  const [recallImpact,  setRecallImpact]  = useState<RecallImpact | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [saving,        setSaving]        = useState(false)
  const [uploading,     setUploading]     = useState(false)

  const loadDetail = useCallback(async () => {
    if (!capaId || !companyId) { setLoading(false); return }
    setLoading(true); setError(null)
    setLinkedRecall(null); setRecallImpact(null)

    try {
      const [capaRes, actRes, evRes, histRes] = await Promise.all([
        supabase.from('capas').select('*').eq('id', capaId).eq('company_id', companyId).single(),
        supabase.from('capa_actions').select('*').eq('capa_id', capaId).eq('company_id', companyId).order('created_at'),
        supabase.from('capa_evidence').select('*').eq('capa_id', capaId).eq('company_id', companyId).order('created_at', { ascending: false }),
        supabase.from('capa_status_history').select('*').eq('capa_id', capaId).eq('company_id', companyId).order('created_at'),
      ])

      if (capaRes.error) throw capaRes.error
      const capaData = capaRes.data as Capa
      setCapa(capaData)
      setActions((actRes.data ?? []) as CapaAction[])
      setEvidence((evRes.data ?? []) as CapaEvidence[])
      setHistory((histRes.data ?? []) as CapaStatusHistory[])

      // If linked to a recall, fetch recall details + impact in parallel
      if (capaData.recall_id) {
        const { data: recallData } = await supabase
          .from('recalls')
          .select('id, recall_number, title, reason, severity, status, affected_units, initiated_at, batch_id, product_id')
          .eq('id', capaData.recall_id)
          .eq('company_id', companyId)
          .maybeSingle()

        if (recallData) {
          setLinkedRecall(recallData as RecallForCapa)
          if (recallData.batch_id) {
            const { data: impact } = await supabase
              .rpc('get_recall_impact', { p_batch_id: recallData.batch_id as string })
            if (impact) setRecallImpact(impact as RecallImpact)
          }
        }
      }
    } catch (err) {
      setError(extractMessage(err))
    } finally {
      setLoading(false)
    }
  }, [capaId, companyId])

  useEffect(() => { loadDetail() }, [loadDetail])

  // ── Advance status ──────────────────────────────────────────────────────────

  const advanceStatus = async (currentStatus: CapaStatus): Promise<boolean> => {
    if (!capaId || !companyId) return false
    const next = NEXT_STATUS[currentStatus]
    if (!next) return false

    setSaving(true)
    const now   = new Date().toISOString()
    const patch: Partial<Capa> = { status: next }
    if (next === 'investigation')     patch.investigation_at     = now
    if (next === 'corrective_action') patch.corrective_action_at = now
    if (next === 'verification')      patch.verification_at      = now
    if (next === 'closed')            patch.closed_at            = now

    const { error: err } = await supabase
      .from('capas')
      .update(patch)
      .eq('id', capaId)
      .eq('company_id', companyId)

    if (!err) {
      await supabase.from('capa_status_history').insert({
        company_id:  companyId,
        capa_id:     capaId,
        from_status: currentStatus,
        to_status:   next,
        changed_by:  user?.email ?? null,
      })
    }

    setSaving(false)
    if (err) return false
    await loadDetail()
    return true
  }

  // ── Update CAPA fields ──────────────────────────────────────────────────────

  const updateCapa = async (data: Partial<CapaFormData>): Promise<boolean> => {
    if (!capaId || !companyId) return false
    setSaving(true)
    const { error: err } = await supabase
      .from('capas')
      .update(data)
      .eq('id', capaId)
      .eq('company_id', companyId)
    setSaving(false)
    if (err) return false
    await loadDetail()
    return true
  }

  // ── capa_actions mutations ──────────────────────────────────────────────────

  const addAction = async (description: string, assignedTo: string, dueDate: string): Promise<boolean> => {
    if (!capaId || !companyId) return false
    const { error: err } = await supabase.from('capa_actions').insert({
      company_id:  companyId,
      capa_id:     capaId,
      description: description.trim(),
      assigned_to: assignedTo.trim() || null,
      due_date:    dueDate || null,
    })
    if (err) return false
    await loadDetail()
    return true
  }

  const completeAction = async (actionId: string): Promise<boolean> => {
    if (!companyId) return false
    const { error: err } = await supabase
      .from('capa_actions')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', actionId)
      .eq('company_id', companyId)
    if (err) return false
    await loadDetail()
    return true
  }

  const deleteAction = async (actionId: string): Promise<boolean> => {
    if (!companyId) return false
    const { error: err } = await supabase
      .from('capa_actions')
      .delete()
      .eq('id', actionId)
      .eq('company_id', companyId)
    if (err) return false
    await loadDetail()
    return true
  }

  // ── capa_evidence mutations ─────────────────────────────────────────────────

  const uploadEvidence = async (file: File, notes: string): Promise<boolean> => {
    if (!capaId || !companyId) return false
    setUploading(true)

    try {
      const path  = `${companyId}/${capaId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
      const { error: upErr } = await supabase.storage.from('capa-evidence').upload(path, file)
      if (upErr) throw upErr

      const { data: { publicUrl } } = supabase.storage.from('capa-evidence').getPublicUrl(path)

      const { error: dbErr } = await supabase.from('capa_evidence').insert({
        company_id:  companyId,
        capa_id:     capaId,
        file_name:   file.name,
        file_url:    publicUrl,
        file_type:   file.type || null,
        file_size:   file.size,
        uploaded_by: user?.email ?? null,
        notes:       notes.trim() || null,
      })
      if (dbErr) throw dbErr

      await loadDetail()
      return true
    } catch {
      return false
    } finally {
      setUploading(false)
    }
  }

  const deleteEvidence = async (evidenceId: string, fileUrl: string): Promise<boolean> => {
    if (!companyId) return false
    // Extract storage path from URL and delete from storage
    try {
      const url     = new URL(fileUrl)
      const parts   = url.pathname.split('/capa-evidence/')
      if (parts[1]) {
        await supabase.storage.from('capa-evidence').remove([parts[1]])
      }
    } catch { /* URL parse failed — skip storage deletion */ }

    const { error: err } = await supabase
      .from('capa_evidence')
      .delete()
      .eq('id', evidenceId)
      .eq('company_id', companyId)
    if (err) return false
    await loadDetail()
    return true
  }

  return {
    capa, actions, evidence, history,
    linkedRecall, recallImpact,
    loading, error, saving, uploading,
    advanceStatus, updateCapa,
    addAction, completeAction, deleteAction,
    uploadEvidence, deleteEvidence,
    refresh: loadDetail,
  }
}

// ── useCapaAnalytics ──────────────────────────────────────────────────────────

export function useCapaAnalytics() {
  const { companyId } = useAuth()
  const [data,    setData]    = useState<CapaAnalytics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    supabase
      .rpc('get_capa_analytics', { p_company_id: companyId })
      .then(({ data: d, error: e }) => {
        if (!e && d) setData(d as CapaAnalytics)
        setLoading(false)
      })
  }, [companyId])

  return { data, loading }
}
