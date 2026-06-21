'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, AlertTriangle, FileWarning, GitBranch,
  Clock, CheckCircle2, Loader2, AlertCircle, ExternalLink,
  Users, Package, ClipboardList,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth-context'
import type { Recall, LinkedCapaSummary } from '../../hooks/useRecalls'

// ── Design tokens (matches RecallClient) ────────────────────────────────────

const card   = 'rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm'
const lbl    = 'mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500'
const val    = 'text-sm text-gray-900 dark:text-white'
const valMuted = 'text-sm text-gray-500 dark:text-gray-400 italic'

const SEVERITY_BADGE: Record<string, string> = {
  low:      'bg-green-100  text-green-700  dark:bg-green-900/20  dark:text-green-400',
  medium:   'bg-amber-100  text-amber-700  dark:bg-amber-900/20  dark:text-amber-400',
  high:     'bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400',
  critical: 'bg-red-100    text-red-700    dark:bg-red-900/20    dark:text-red-400',
}

const STATUS_BADGE: Record<string, string> = {
  open:        'bg-blue-100    text-blue-700    dark:bg-blue-900/20    dark:text-blue-400',
  in_progress: 'bg-amber-100   text-amber-700   dark:bg-amber-900/20   dark:text-amber-400',
  closed:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
}

const CAPA_STATUS_CLS: Record<string, string> = {
  open:              'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  investigation:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  corrective_action: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  verification:      'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  closed:            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
}

function fmt(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function Field({ label: l, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={lbl}>{l}</p>
      <div className={val}>{children}</div>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function RecallDetailClient({ id }: { id: string }) {
  const { companyId } = useAuth()
  const [recall,    setRecall]    = useState<Recall | null>(null)
  const [capas,     setCapas]     = useState<LinkedCapaSummary[]>([])
  const [loading,   setLoading]   = useState(true)
  const [notFound,  setNotFound]  = useState(false)

  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      setLoading(true)

      const { data, error } = await supabase
        .from('recalls')
        .select('*, products(name, sku), production_orders(id, status)')
        .eq('id', id)
        .eq('company_id', companyId)
        .single()

      if (error || !data) {
        setNotFound(true)
        setLoading(false)
        return
      }

      const r = data as Recall

      const { data: capaRows } = await supabase
        .from('capas')
        .select('id, capa_number, status, severity')
        .eq('recall_id', id)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })

      setRecall(r)
      setCapas((capaRows ?? []) as LinkedCapaSummary[])
      setLoading(false)
    })()
  }, [id, companyId])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 size={22} className="animate-spin text-gray-400" />
      </div>
    )
  }

  if (notFound || !recall) {
    return (
      <div className="px-4 sm:px-6 py-8 max-w-4xl mx-auto">
        <Link href="/recall" className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
          <ArrowLeft size={14} />Back to Recall Registry
        </Link>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 py-16 text-gray-400 dark:text-gray-500">
          <AlertCircle size={40} className="opacity-40" />
          <p className="text-sm font-medium">Recall not found.</p>
          <Link href="/recall" className="text-xs text-[#4a8fb9] hover:underline">View all recalls →</Link>
        </div>
      </div>
    )
  }

  const batchId = recall.batch_id ?? null

  return (
    <div className="px-4 sm:px-6 py-8 max-w-4xl mx-auto space-y-5">

      {/* Back */}
      <Link
        href="/recall"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
      >
        <ArrowLeft size={14} />Back to Recall Registry
      </Link>

      {/* Header */}
      <div className={`${card} px-5 py-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
              <AlertTriangle size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-mono text-gray-400 dark:text-gray-500">
                {recall.recall_number ?? `#${recall.id.slice(0, 8)}`}
              </p>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-snug truncate">
                {recall.title}
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${SEVERITY_BADGE[recall.severity] ?? ''}`}>
              {recall.severity}
            </span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[recall.status] ?? ''}`}>
              {recall.status.replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      {(() => {
        const openedDate  = new Date(recall.initiated_at)
        const closedDate  = recall.closed_at ? new Date(recall.closed_at) : null
        const refDate     = closedDate ?? new Date()
        const daysOpen    = Math.floor((refDate.getTime() - openedDate.getTime()) / 86_400_000)
        // Recovery is 100% when closed; for in-progress recalls we show "Tracking"
        const recoveryPct = recall.status === 'closed' ? 100 : null

        return (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className={`${card} px-4 py-3`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">Affected Units</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">
                  {recall.affected_units != null ? recall.affected_units.toLocaleString() : '—'}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">Total impacted</p>
              </div>
              <div className={`${card} px-4 py-3`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">Recovery Rate</p>
                <p className={`text-xl font-bold mt-0.5 ${recoveryPct === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {recoveryPct != null ? `${recoveryPct}%` : 'Tracking'}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {recall.status === 'closed' ? 'Fully recovered' : 'In progress'}
                </p>
              </div>
              <div className={`${card} px-4 py-3`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">Days Open</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{daysOpen}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {recall.status === 'closed' ? 'Time to close' : 'Ongoing'}
                </p>
              </div>
              <div className={`${card} px-4 py-3`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">Open CAPAs</p>
                <p className={`text-xl font-bold mt-0.5 ${capas.filter(c => c.status !== 'closed').length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {capas.filter(c => c.status !== 'closed').length}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">of {capas.length} total</p>
              </div>
            </div>

            {/* Recovery progress bar */}
            <div className={`${card} px-5 py-4`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Recovery Progress</p>
                <span className={`text-[10px] font-bold ${recall.status === 'closed' ? 'text-emerald-600 dark:text-emerald-400' : recall.status === 'in_progress' ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
                  {recall.status === 'closed' ? 'CLOSED' : recall.status.replace('_', ' ').toUpperCase()}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/50">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${recall.status === 'closed' ? 'bg-emerald-500' : recall.status === 'in_progress' ? 'bg-amber-400' : 'bg-blue-500'}`}
                  style={{ width: recall.status === 'closed' ? '100%' : recall.status === 'in_progress' ? '60%' : '20%' }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[9px] text-gray-400 dark:text-gray-600">
                <span>Initiated</span>
                <span>In Progress</span>
                <span>Closed</span>
              </div>
            </div>
          </>
        )
      })()}

      {/* Details grid */}
      <div className={`${card} px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5`}>
        <Field label="Reason">
          {recall.reason || <span className={valMuted}>—</span>}
        </Field>
        <Field label="Initiated By">
          {recall.initiated_by_name
            ? <span className="inline-flex items-center gap-1.5"><Users size={12} className="text-gray-400" />{recall.initiated_by_name}</span>
            : <span className={valMuted}>—</span>}
        </Field>
        <Field label="Initiated">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={12} className="text-gray-400" />{fmt(recall.initiated_at)}
          </span>
        </Field>
        {recall.closed_at && (
          <Field label="Closed">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-emerald-500" />{fmt(recall.closed_at)}
            </span>
          </Field>
        )}
        {recall.affected_units != null && (
          <Field label="Affected Units">
            <span className="font-semibold tabular-nums">
              {recall.affected_units.toLocaleString()}
            </span>
          </Field>
        )}
        {recall.products && (
          <Field label="Product">
            <span className="inline-flex items-center gap-1.5">
              <Package size={12} className="text-gray-400" />
              {recall.products.name}
              {recall.products.sku && <span className="text-gray-400 font-mono text-xs">({recall.products.sku})</span>}
            </span>
          </Field>
        )}
      </div>

      {/* Root Cause */}
      {recall.root_cause && (
        <div className={`${card} px-5 py-4`}>
          <p className={`${lbl} mb-2`}>Root Cause</p>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{recall.root_cause}</p>
        </div>
      )}

      {/* Corrective Action */}
      {recall.corrective_action && (
        <div className={`${card} px-5 py-4`}>
          <p className={`${lbl} mb-2`}>Corrective Action</p>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{recall.corrective_action}</p>
        </div>
      )}

      {/* Linked Batch */}
      {batchId && (
        <div className={`${card} px-5 py-4`}>
          <p className={`${lbl} mb-3`}>Linked Production Batch</p>
          <Link
            href={`/product-journey/${batchId}`}
            className="inline-flex items-center gap-2 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-[#D1CFC9]/40 dark:hover:bg-[#262E36]/70 transition-colors group"
          >
            <ClipboardList size={14} className="shrink-0 text-gray-400 group-hover:text-[#4a8fb9] transition-colors" />
            <span className="font-mono text-xs text-gray-400">···{batchId.slice(-12)}</span>
            <ExternalLink size={11} className="ml-auto shrink-0 text-gray-400 group-hover:text-[#4a8fb9] transition-colors" />
            <span className="text-[11px] text-gray-400 group-hover:text-[#4a8fb9] transition-colors">View Product Journey</span>
          </Link>
        </div>
      )}

      {/* Linked CAPAs */}
      {capas.length > 0 && (
        <div className={`${card} px-5 py-4`}>
          <p className={`${lbl} mb-3`}>Linked CAPAs ({capas.length})</p>
          <div className="space-y-2">
            {capas.map(c => (
              <Link
                key={c.id}
                href={`/capa/${c.id}`}
                className="flex items-center gap-3 rounded-lg border border-[#B3B7BA]/40 dark:border-[#B3B7BA]/[0.08] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2.5 hover:bg-[#D1CFC9]/40 dark:hover:bg-[#262E36]/70 transition-colors group"
              >
                <FileWarning size={14} className="shrink-0 text-purple-500" />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {c.capa_number ?? `#${c.id.slice(0, 8)}`}
                </span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${CAPA_STATUS_CLS[c.status] ?? ''}`}>
                  {c.status.replace('_', ' ')}
                </span>
                <ExternalLink size={11} className="ml-auto shrink-0 text-gray-400 group-hover:text-[#4a8fb9] transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Impact Analysis shortcut */}
      {batchId && (
        <div className={`${card} px-5 py-3`}>
          <Link
            href={`/recall-impact?type=batch&q=${encodeURIComponent(batchId)}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-[#4a8fb9] hover:text-[#2d5a74] dark:hover:text-[#7ab3d0] transition-colors"
          >
            <GitBranch size={14} />Run Impact Analysis for this batch
          </Link>
        </div>
      )}
    </div>
  )
}
