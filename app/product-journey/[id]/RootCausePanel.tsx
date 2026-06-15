'use client'

import { useState, useEffect } from 'react'
import {
  AlertTriangle, CheckCircle2, XCircle,
  Package, Layers, Building2, ClipboardList, ShieldAlert,
  ChevronDown, ChevronUp, Loader2, ArrowRight, FlaskConical,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type RcaSignal = {
  source_table: string
  signal_type:  string
  severity:     'high' | 'medium' | 'low'
  summary:      string
  occurred_at:  string
  detail:       string | null
}

type RcaMaterial = {
  bom_id:          string
  material_name:   string
  lot_number:      string | null
  quantity:        number
  unit:            string
  lot_id:          string | null
  lot_status:      string | null
  lot_received_at: string | null
  lot_expiry_date: string | null
  supplier_name:   string | null
  supplier_id:     string | null
}

type RcaCapa = {
  id:                string
  capa_number:       string
  title:             string
  severity:          string
  status:            string
  root_cause:        string | null
  corrective_action: string | null
  preventive_action: string | null
  owner_name:        string | null
  due_date:          string | null
  overdue:           boolean
  created_at:        string
  closed_at:         string | null
}

type RcaRecall = {
  id:             string
  recall_number:  string
  title:          string
  severity:       string
  status:         string
  reason:         string
  root_cause:     string | null
  affected_units: number | null
  initiated_at:   string
  closed_at:      string | null
}

type RcaData = {
  batch:          Record<string, unknown>
  issue_signals:  RcaSignal[]
  material_trace: RcaMaterial[]
  capas:          RcaCapa[]
  recalls:        RcaRecall[]
  risk_score:     number
  risk_level:     'none' | 'low' | 'medium' | 'high' | 'critical'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const LOT_STATUS_BADGE: Record<string, string> = {
  available:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  consumed:   'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  quarantine: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  rejected:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  expired:    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high:     'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  major:    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  minor:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  low:      'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}

const STATUS_BADGE: Record<string, string> = {
  open:              'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  in_progress:       'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  investigation:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  corrective_action: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  verification:      'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  closed:            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
}

// ── Risk score dial ───────────────────────────────────────────────────────────

function RiskScore({ score, level }: { score: number; level: string }) {
  const cfg = ({
    none:     { color: 'text-gray-400 dark:text-gray-500',        ring: 'ring-gray-200 dark:ring-gray-700',          label: 'No Issues'   },
    low:      { color: 'text-emerald-600 dark:text-emerald-400',  ring: 'ring-emerald-200 dark:ring-emerald-800/40', label: 'Low Risk'    },
    medium:   { color: 'text-amber-600 dark:text-amber-400',      ring: 'ring-amber-200 dark:ring-amber-800/40',     label: 'Medium Risk' },
    high:     { color: 'text-orange-600 dark:text-orange-400',    ring: 'ring-orange-200 dark:ring-orange-800/40',   label: 'High Risk'   },
    critical: { color: 'text-red-600 dark:text-red-400',          ring: 'ring-red-200 dark:ring-red-800/40',         label: 'Critical'    },
  } as Record<string, { color: string; ring: string; label: string }>)[level]
    ?? { color: 'text-gray-400', ring: 'ring-gray-200', label: 'Unknown' }

  return (
    <div className={`flex shrink-0 flex-col items-center justify-center w-20 h-20 rounded-full ring-4 ${cfg.ring} bg-white dark:bg-gray-800`}>
      <span className={`text-2xl font-bold tabular-nums leading-none ${cfg.color}`}>{score}</span>
      <span className={`mt-0.5 text-[9px] font-semibold uppercase tracking-wide leading-none ${cfg.color}`}>{cfg.label}</span>
    </div>
  )
}

// ── Causal chain ──────────────────────────────────────────────────────────────

type ChainNode = {
  id:       string
  icon:     React.ReactNode
  label:    string
  sublabel: string
  color:    string
  bg:       string
}

function buildChain(data: RcaData): ChainNode[] {
  const chain: ChainNode[] = []

  chain.push({
    id:       'batch',
    icon:     <Package size={14} />,
    label:    (data.batch.product_name as string) ?? 'Batch',
    sublabel: (data.batch.sku as string) ?? '',
    color:    'text-[#3a6f8f]',
    bg:       'bg-blue-50 dark:bg-blue-900/20',
  })

  if (data.issue_signals.length > 0) {
    const sig    = data.issue_signals[0]
    const isCrit = sig.severity === 'high'
    chain.push({
      id:       'qc',
      icon:     <FlaskConical size={14} />,
      label:    'QC ' + (sig.signal_type === 'fail' || sig.signal_type === 'failed' ? 'Failure' : 'Hold'),
      sublabel: fmtDate(sig.occurred_at),
      color:    isCrit ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400',
      bg:       isCrit ? 'bg-red-50 dark:bg-red-900/20' : 'bg-amber-50 dark:bg-amber-900/20',
    })
  }

  const suspectMat =
    data.material_trace.find(m => m.lot_status === 'quarantine' || m.lot_status === 'rejected') ??
    (data.material_trace.length > 0 ? data.material_trace[0] : null)

  if (suspectMat) {
    const isBad = suspectMat.lot_status === 'quarantine' || suspectMat.lot_status === 'rejected'
    chain.push({
      id:       'material',
      icon:     <Layers size={14} />,
      label:    suspectMat.material_name,
      sublabel: suspectMat.lot_number ? 'Lot ' + suspectMat.lot_number : 'No lot linked',
      color:    isBad ? 'text-orange-600 dark:text-orange-400' : 'text-gray-600 dark:text-gray-400',
      bg:       isBad ? 'bg-orange-50 dark:bg-orange-900/20' : 'bg-gray-50 dark:bg-gray-700/30',
    })
  }

  const supplierName =
    suspectMat?.supplier_name ??
    data.material_trace.find(m => m.supplier_name)?.supplier_name

  if (supplierName) {
    chain.push({
      id:       'supplier',
      icon:     <Building2 size={14} />,
      label:    supplierName,
      sublabel: 'Supplier',
      color:    'text-violet-600 dark:text-violet-400',
      bg:       'bg-violet-50 dark:bg-violet-900/20',
    })
  }

  if (data.capas.length > 0) {
    const capa = data.capas[0]
    chain.push({
      id:       'capa',
      icon:     <ClipboardList size={14} />,
      label:    capa.capa_number,
      sublabel: capa.status === 'closed' ? 'Resolved' : 'Open',
      color:    capa.status === 'closed' ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400',
      bg:       capa.status === 'closed' ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-blue-50 dark:bg-blue-900/20',
    })
  }

  if (data.recalls.length > 0) {
    const recall = data.recalls[0]
    const isOpen = recall.status !== 'closed'
    chain.push({
      id:       'recall',
      icon:     <ShieldAlert size={14} />,
      label:    recall.recall_number,
      sublabel: isOpen ? recall.severity : 'Resolved',
      color:    isOpen ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400',
      bg:       isOpen ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-700/20',
    })
  }

  return chain
}

function CausalChain({ data }: { data: RcaData }) {
  const chain = buildChain(data)
  if (chain.length <= 1) return null

  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        Causal Chain
      </p>
      <div className="flex items-start gap-0 overflow-x-auto pb-1">
        {chain.map((node, i) => (
          <div key={node.id} className="flex items-start shrink-0">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${node.bg} ${node.color}`}>
                {node.icon}
              </div>
              <div className="w-20 text-center">
                <p className={`text-[10px] font-semibold leading-tight truncate ${node.color}`}>{node.label}</p>
                <p className="text-[9px] text-gray-400 dark:text-gray-500 leading-tight truncate">{node.sublabel}</p>
              </div>
            </div>
            {i < chain.length - 1 && (
              <div className="mt-[18px] mx-1 shrink-0 text-gray-300 dark:text-gray-600">
                <ArrowRight size={14} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function RootCausePanel({ batchId }: { batchId: string }) {
  const [data,       setData]       = useState<RcaData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [open,       setOpen]       = useState(false)
  const [capaOpen,   setCapaOpen]   = useState(false)
  const [recallOpen, setRecallOpen] = useState(false)

  useEffect(() => {
    if (!batchId) return
    supabase
      .rpc('get_root_cause_analysis', { p_batch_id: batchId })
      .then(({ data: rca, error }) => {
        if (error) { console.error('[RootCausePanel]', error); setLoading(false); return }
        const d = rca as RcaData | null
        setData(d)
        if (d && d.risk_level !== 'none') setOpen(true)
        setLoading(false)
      })
  }, [batchId])

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-700 px-4 py-3">
          <AlertTriangle size={15} className="text-gray-400 dark:text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Root Cause Analysis</h2>
          <Loader2 size={12} className="ml-auto animate-spin text-gray-300 dark:text-gray-600" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3">
          <AlertTriangle size={15} className="text-gray-400 dark:text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Root Cause Analysis</h2>
          <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">No data</span>
        </div>
      </div>
    )
  }

  const hasIssues = data.risk_level !== 'none'

  const riskColor = ({
    none:     'text-gray-400 dark:text-gray-500',
    low:      'text-emerald-600 dark:text-emerald-400',
    medium:   'text-amber-600 dark:text-amber-400',
    high:     'text-orange-600 dark:text-orange-400',
    critical: 'text-red-600 dark:text-red-400',
  } as Record<string, string>)[data.risk_level] ?? 'text-gray-400'

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">

      {/* Collapsible header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-700 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors text-left"
      >
        <AlertTriangle
          size={15}
          className={hasIssues ? 'text-amber-500 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}
        />
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Root Cause Analysis</h2>

        {hasIssues ? (
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${SEVERITY_BADGE[data.risk_level] ?? ''}`}>
            {data.risk_level}
          </span>
        ) : (
          <span className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            No Issues
          </span>
        )}

        <span className={`ml-auto text-[11px] font-semibold tabular-nums ${riskColor}`}>
          Risk {data.risk_score}/100
        </span>
        {open
          ? <ChevronUp   size={13} className="text-gray-400 shrink-0" />
          : <ChevronDown size={13} className="text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="px-4 py-4 space-y-5">

          {/* Risk dial + issue signals */}
          <div className="flex items-start gap-5">
            <RiskScore score={data.risk_score} level={data.risk_level} />

            <div className="flex-1 min-w-0">
              {data.issue_signals.length === 0 ? (
                <div className="flex items-center gap-2 py-2">
                  <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    No quality failures or inspection issues recorded for this batch.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
                    Issue Signals
                  </p>
                  {data.issue_signals.map((sig, i) => (
                    <div
                      key={i}
                      className={`rounded-xl border px-3 py-2.5 ${
                        sig.severity === 'high'
                          ? 'border-red-200 dark:border-red-800/40 bg-red-50/50 dark:bg-red-900/10'
                          : 'border-amber-200 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-900/10'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {sig.severity === 'high'
                          ? <XCircle      size={13} className="mt-0.5 shrink-0 text-red-500" />
                          : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
                        }
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-tight">
                            {sig.summary}
                          </p>
                          {sig.detail && (
                            <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                              {sig.detail}
                            </p>
                          )}
                          <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                            {fmtDate(sig.occurred_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Causal chain */}
          <CausalChain data={data} />

          {/* Material trace */}
          {data.material_trace.length > 0 && (
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Material Trace
              </p>
              <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700/60">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700/60 bg-gray-50/60 dark:bg-gray-700/20">
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Material</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Lot</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Qty</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Lot Status</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Supplier</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700/40">
                    {data.material_trace.map(mat => (
                      <tr
                        key={mat.bom_id}
                        className={
                          mat.lot_status === 'quarantine' || mat.lot_status === 'rejected'
                            ? 'bg-red-50/30 dark:bg-red-900/5'
                            : ''
                        }
                      >
                        <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{mat.material_name}</td>
                        <td className="px-3 py-2 font-mono text-gray-500 dark:text-gray-400">{mat.lot_number ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums text-gray-600 dark:text-gray-300">
                          {mat.quantity.toLocaleString()} {mat.unit}
                        </td>
                        <td className="px-3 py-2">
                          {mat.lot_status ? (
                            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${LOT_STATUS_BADGE[mat.lot_status] ?? 'bg-gray-100 text-gray-600'}`}>
                              {mat.lot_status}
                            </span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{mat.supplier_name ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums text-gray-400 dark:text-gray-500">
                          {mat.lot_received_at ? fmtDate(mat.lot_received_at) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CAPA records */}
          {data.capas.length > 0 && (
            <div>
              <button
                onClick={() => setCapaOpen(v => !v)}
                className="flex w-full items-center gap-2 mb-3"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  CAPA Records ({data.capas.length})
                </p>
                {capaOpen ? <ChevronUp size={11} className="text-gray-400" /> : <ChevronDown size={11} className="text-gray-400" />}
              </button>

              {capaOpen && (
                <div className="space-y-2">
                  {data.capas.map(capa => (
                    <div
                      key={capa.id}
                      className="rounded-xl border border-gray-100 dark:border-gray-700/60 bg-gray-50/50 dark:bg-gray-700/20 px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
                            {capa.capa_number}
                          </span>
                          <p className="truncate text-xs font-semibold text-gray-800 dark:text-gray-200">{capa.title}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {capa.overdue && (
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                              Overdue
                            </span>
                          )}
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${SEVERITY_BADGE[capa.severity] ?? ''}`}>
                            {capa.severity}
                          </span>
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[capa.status] ?? ''}`}>
                            {capa.status.replace('_', ' ')}
                          </span>
                        </div>
                      </div>

                      {capa.root_cause && (
                        <div className="mt-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-0.5">
                            Root Cause
                          </p>
                          <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">{capa.root_cause}</p>
                        </div>
                      )}

                      {capa.corrective_action && (
                        <div className="mt-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-0.5">
                            Corrective Action
                          </p>
                          <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">{capa.corrective_action}</p>
                        </div>
                      )}

                      {capa.preventive_action && (
                        <div className="mt-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-0.5">
                            Preventive Action
                          </p>
                          <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">{capa.preventive_action}</p>
                        </div>
                      )}

                      {(capa.owner_name || capa.due_date) && (
                        <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
                          {capa.owner_name && `Owner: ${capa.owner_name}`}
                          {capa.owner_name && capa.due_date && ' · '}
                          {capa.due_date && `Due: ${fmtDate(capa.due_date)}`}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recall records */}
          {data.recalls.length > 0 && (
            <div>
              <button
                onClick={() => setRecallOpen(v => !v)}
                className="flex w-full items-center gap-2 mb-3"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Recall Records ({data.recalls.length})
                </p>
                {recallOpen ? <ChevronUp size={11} className="text-gray-400" /> : <ChevronDown size={11} className="text-gray-400" />}
              </button>

              {recallOpen && (
                <div className="space-y-2">
                  {data.recalls.map(recall => (
                    <div
                      key={recall.id}
                      className={`rounded-xl border px-3 py-3 ${
                        recall.status !== 'closed'
                          ? 'border-red-200 dark:border-red-800/40 bg-red-50/30 dark:bg-red-900/5'
                          : 'border-gray-100 dark:border-gray-700/60 bg-gray-50/50 dark:bg-gray-700/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
                            {recall.recall_number}
                          </span>
                          <p className="truncate text-xs font-semibold text-gray-800 dark:text-gray-200">{recall.title}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${SEVERITY_BADGE[recall.severity] ?? ''}`}>
                            {recall.severity}
                          </span>
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[recall.status] ?? ''}`}>
                            {recall.status.replace('_', ' ')}
                          </span>
                        </div>
                      </div>

                      <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">{recall.reason}</p>

                      {recall.root_cause && (
                        <div className="mt-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-0.5">
                            Root Cause
                          </p>
                          <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">{recall.root_cause}</p>
                        </div>
                      )}

                      {recall.affected_units != null && (
                        <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
                          Affected units: {recall.affected_units.toLocaleString()}
                          {recall.initiated_at ? ` · Initiated: ${fmtDate(recall.initiated_at)}` : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Clean batch state */}
          {data.risk_score === 0
            && data.material_trace.length === 0
            && data.capas.length === 0
            && data.recalls.length === 0 && (
            <div className="py-4 text-center">
              <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-400 dark:text-emerald-500" />
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Clean batch — no issues detected</p>
              <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                No QC failures, CAPA records, or recalls linked to this batch.
              </p>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
