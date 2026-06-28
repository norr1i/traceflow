'use client'

import { useState, useEffect } from 'react'
import {
  AlertTriangle, CheckCircle2, XCircle,
  Package, Layers, ClipboardList, ShieldAlert,
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

// Strips seed-script / automated-test records that should never surface in UI.
function isTestRecord(title: string): boolean {
  const t = (title ?? '').toLowerCase().trim()
  return t === 'automatic capa test' || t === 'just testing' ||
    t === 'test' || t === 'testing' || t === 'demo' ||
    (t.startsWith('test ') && t.length < 30)
}

// Demo fallback for supplier name when the DB field is null.
function deriveDemoSupplierRca(materialName: string): string {
  const n = materialName.toLowerCase()
  if (n.includes('steel') || n.includes('metal') || n.includes('iron'))      return 'Gulf Steel Trading Co.'
  if (n.includes('alum'))                                                     return 'Emirates Aluminum LLC'
  if (n.includes('plastic') || n.includes('poly') || n.includes('resin'))    return 'Riyadh Polymers Ltd.'
  if (n.includes('glass'))                                                    return 'Saudi Glass Industries'
  if (n.includes('copper') || n.includes('wire'))                            return 'Arabian Copper Works'
  if (n.includes('silicone') || n.includes('rubber') || n.includes('seal'))  return 'Gulf Elastomers Co.'
  if (n.includes('chemical') || n.includes('acid') || n.includes('solvent')) return 'SABIC Supply Chain'
  if (n.includes('oil') || n.includes('lubric'))                             return 'Petromin Arabia'
  if (n.includes('carbon') || n.includes('composite'))                       return 'Advanced Composites KSA'
  return 'Authorized Supplier Co.'
}

// Demo fallback for lot number when the DB field is null.
function deriveDemoLotRca(mat: RcaMaterial): string {
  if (mat.lot_number) return mat.lot_number
  const year = mat.lot_received_at
    ? new Date(mat.lot_received_at).getFullYear()
    : new Date().getFullYear()
  const tag = mat.bom_id.slice(0, 4).toUpperCase()
  return `LOT-${year}-${tag}`
}

const LOT_STATUS_BADGE: Record<string, string> = {
  available:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  released:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  consumed:    'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  in_use:      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  received:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  quarantine:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  quarantined: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  rejected:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  expired:     'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high:     'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  major:    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  minor:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  low:      'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
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

  // Node 1: Raw Material input (prefer suspect lot, fall back to first in trace)
  const primaryMat =
    data.material_trace.find(m => m.lot_status === 'quarantine' || m.lot_status === 'rejected') ??
    (data.material_trace.length > 0 ? data.material_trace[0] : null)

  if (primaryMat) {
    const isSuspect = primaryMat.lot_status === 'quarantine' || primaryMat.lot_status === 'rejected'
    const lotLabel  = deriveDemoLotRca(primaryMat)
    chain.push({
      id:       'material',
      icon:     <Layers size={14} />,
      label:    primaryMat.material_name,
      sublabel: isSuspect ? `Lot ${lotLabel} · Suspect` : `Lot ${lotLabel}`,
      color:    'text-orange-600 dark:text-orange-400',
      bg:       isSuspect ? 'bg-orange-50 dark:bg-orange-900/20' : 'bg-orange-50/60 dark:bg-orange-900/10',
    })
  }

  // Node 2: Production / batch manufactured
  chain.push({
    id:       'batch',
    icon:     <Package size={14} />,
    label:    (data.batch.product_name as string) ?? 'Production',
    sublabel: (data.batch.sku as string) ?? 'Batch',
    color:    'text-[#3a6f8f] dark:text-[#4a8fb9]',
    bg:       'bg-blue-50 dark:bg-blue-900/20',
  })

  // Nodes 3 + 4: Quality inspection result → issue detected
  if (data.issue_signals.length > 0) {
    const sig    = data.issue_signals[0]
    const isCrit = sig.severity === 'high'
    const isFail = sig.signal_type === 'fail' || sig.signal_type === 'failed'
    chain.push({
      id:       'qc',
      icon:     <FlaskConical size={14} />,
      label:    'Quality Inspection',
      sublabel: isFail ? 'Failed' : 'On Hold',
      color:    isCrit ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400',
      bg:       isCrit ? 'bg-red-50 dark:bg-red-900/20' : 'bg-amber-50 dark:bg-amber-900/20',
    })
    chain.push({
      id:       'issue',
      icon:     <AlertTriangle size={14} />,
      label:    'Issue Detected',
      sublabel: isFail ? 'QC Failure' : 'Inspection Hold',
      color:    'text-red-600 dark:text-red-400',
      bg:       'bg-red-50 dark:bg-red-900/20',
    })
  }

  // Node 5: CAPA opened (skip placeholder/test records)
  const capa = data.capas.filter(c => !isTestRecord(c.title))[0]
  if (capa) {
    chain.push({
      id:       'capa',
      icon:     <ClipboardList size={14} />,
      label:    'CAPA Opened',
      sublabel: capa.capa_number,
      color:    'text-amber-600 dark:text-amber-400',
      bg:       'bg-amber-50 dark:bg-amber-900/20',
    })
  }

  // Node 6: Recall opened (skip placeholder/test records)
  const recall = data.recalls.filter(r => !isTestRecord(r.title))[0]
  if (recall) {
    const isOpen = recall.status !== 'closed'
    chain.push({
      id:       'recall',
      icon:     <ShieldAlert size={14} />,
      label:    'Recall Opened',
      sublabel: recall.recall_number,
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
  const [data,    setData]    = useState<RcaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [open,    setOpen]    = useState(false)

  useEffect(() => {
    if (!batchId) return
    supabase
      .rpc('get_root_cause_analysis', { p_batch_id: batchId })
      .then(({ data: rca, error }) => {
        if (error) { console.error('[RootCausePanel]', error); setLoading(false); return }
        const d = rca as RcaData | null
        setData(d)
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

  const hasIssues   = data.risk_level !== 'none'
  const cleanCapas   = data.capas.filter(c   => !isTestRecord(c.title))
  const cleanRecalls = data.recalls.filter(r => !isTestRecord(r.title))

  const riskColor = ({
    none:     'text-gray-400 dark:text-gray-500',
    low:      'text-emerald-600 dark:text-emerald-400',
    medium:   'text-amber-600 dark:text-amber-400',
    high:     'text-orange-600 dark:text-orange-400',
    critical: 'text-red-600 dark:text-red-400',
  } as Record<string, string>)[data.risk_level] ?? 'text-gray-400'

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">

      {/* Collapsible header — risk score always visible so users know before opening */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 border-b border-gray-100 dark:border-gray-700 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors text-left"
      >
        <AlertTriangle
          size={15}
          className={`shrink-0 ${hasIssues ? 'text-amber-500 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Root Cause Analysis</h2>
            {hasIssues ? (
              <span className={`rounded-md px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ${SEVERITY_BADGE[data.risk_level] ?? ''}`}>
                {data.risk_level}
              </span>
            ) : (
              <span className="rounded-md px-1.5 py-px text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                No Issues
              </span>
            )}
          </div>
          <p className={`text-[11px] font-medium tabular-nums ${riskColor}`}>
            Risk Score: {data.risk_score}/100
          </p>
        </div>
        {open
          ? <ChevronUp   size={13} className="text-gray-400 shrink-0" />
          : <ChevronDown size={13} className="text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="px-4 py-4 space-y-5">

          {/* Clean batch state */}
          {data.risk_score === 0
            && data.material_trace.length === 0
            && cleanCapas.length === 0
            && cleanRecalls.length === 0 ? (
            <div className="py-4 text-center">
              <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-400 dark:text-emerald-500" />
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Clean batch — no issues detected</p>
              <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                No QC failures, CAPA records, or recalls linked to this batch.
              </p>
            </div>
          ) : (() => {
            const primaryCapa   = cleanCapas[0] ?? null
            const primaryRecall = cleanRecalls.find(r => r.status !== 'closed') ?? cleanRecalls[0] ?? null
            const rootCause     = primaryCapa?.root_cause ?? primaryRecall?.root_cause ?? null
            const correctiveAct = primaryCapa?.corrective_action ?? null
            const preventiveAct = primaryCapa?.preventive_action ?? null
            const primarySig    = data.issue_signals[0] ?? null

            return (
              <>
                {/* Causal Chain — the visual narrative */}
                <CausalChain data={data} />

                {/* Divider */}
                <div className="border-t border-gray-100 dark:border-gray-700/60" />

                {/* ROOT CAUSE */}
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                    Root Cause
                  </p>
                  <p className="text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-200">
                    {rootCause ?? 'Root cause investigation is in progress.'}
                  </p>
                </div>

                {/* DETECTION */}
                {primarySig && (
                  <div>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                      Detection
                    </p>
                    <div className="flex items-start gap-2">
                      {primarySig.severity === 'high'
                        ? <XCircle      size={12} className="mt-0.5 shrink-0 text-red-500" />
                        : <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
                      }
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-gray-700 dark:text-gray-200 leading-snug">
                          {primarySig.summary}
                        </p>
                        {primarySig.detail && (
                          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                            {primarySig.detail}
                          </p>
                        )}
                        <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                          Detected {fmtDate(primarySig.occurred_at)}
                          {' · '}
                          <span className={`font-semibold uppercase ${
                            primarySig.severity === 'high'
                              ? 'text-red-500 dark:text-red-400'
                              : 'text-amber-500 dark:text-amber-400'
                          }`}>{primarySig.severity} severity</span>
                        </p>
                      </div>
                    </div>
                    {/* Additional signals count */}
                    {data.issue_signals.length > 1 && (
                      <p className="mt-1.5 text-[10.5px] text-gray-400 dark:text-gray-500">
                        +{data.issue_signals.length - 1} additional signal{data.issue_signals.length > 2 ? 's' : ''} recorded.
                      </p>
                    )}
                  </div>
                )}

                {!primarySig && (
                  <div>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                      Detection
                    </p>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={12} className="shrink-0 text-emerald-500" />
                      <p className="text-[12px] text-gray-500 dark:text-gray-400">
                        No formal QC failure recorded. Issue surfaced via recall process.
                      </p>
                    </div>
                  </div>
                )}

                {/* CORRECTIVE ACTION */}
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                    Corrective Action
                  </p>
                  {correctiveAct ? (
                    <div className="space-y-2">
                      <p className="text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-200">
                        {correctiveAct}
                      </p>
                      {preventiveAct && (
                        <div className="rounded-lg border border-blue-100 dark:border-blue-900/40 bg-blue-50/40 dark:bg-blue-900/10 px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-500 dark:text-blue-400 mb-0.5">
                            Preventive Measure
                          </p>
                          <p className="text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-300">
                            {preventiveAct}
                          </p>
                        </div>
                      )}
                      {(primaryCapa?.owner_name || primaryCapa?.due_date) && (
                        <p className="text-[10.5px] text-gray-400 dark:text-gray-500">
                          {primaryCapa.owner_name && `Owner: ${primaryCapa.owner_name}`}
                          {primaryCapa.owner_name && primaryCapa.due_date && ' · '}
                          {primaryCapa.due_date && `Due: ${fmtDate(primaryCapa.due_date)}`}
                          {primaryCapa.overdue && (
                            <span className="ml-1.5 text-red-500 dark:text-red-400 font-semibold">· Overdue</span>
                          )}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[12.5px] text-gray-400 dark:text-gray-500">
                      Corrective action plan is in progress.
                    </p>
                  )}
                </div>

                {/* MATERIAL TRACE — compact traceability table */}
                {data.material_trace.length > 0 && (
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                      Material Trace
                    </p>
                    <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700/60">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-100 dark:border-gray-700/60 bg-gray-50/60 dark:bg-gray-700/20">
                            <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Material</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Lot</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Qty</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Status</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Supplier</th>
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
                              <td className="px-3 py-2 font-mono text-gray-500 dark:text-gray-400">{deriveDemoLotRca(mat)}</td>
                              <td className="px-3 py-2 tabular-nums text-gray-600 dark:text-gray-300">
                                {mat.quantity.toLocaleString()} {mat.unit}
                              </td>
                              <td className="px-3 py-2">
                                {(() => {
                                  const s = mat.lot_status ?? 'consumed'
                                  return (
                                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${LOT_STATUS_BADGE[s] ?? 'bg-gray-100 text-gray-600'}`}>
                                      {s}
                                    </span>
                                  )
                                })()}
                              </td>
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                                {mat.supplier_name ?? deriveDemoSupplierRca(mat.material_name)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )
          })()}

        </div>
      )}
    </div>
  )
}
