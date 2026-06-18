'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { useAuth, useRole } from '../lib/auth-context'
import { useT, fmtNum } from '../lib/i18n'
import { canEdit } from '../lib/permissions'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { logActivity, actorName } from '../lib/activity'
import { useRecalls, type RecallFormData, type RecallSeverity, type RecallStatus, type LinkedCapaSummary } from '../hooks/useRecalls'
import {
  AlertTriangle, Search, Download, ChevronDown, ChevronRight,
  Package, FlaskConical, Layers, ShoppingCart, Network,
  XCircle, AlertCircle, Loader2, X, ClipboardList,
  Plus, RefreshCw, Trash2, GitBranch, FileWarning, ExternalLink,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

type QcStatus = 'pass' | 'fail' | 'hold'

type QcEntry = {
  status: QcStatus
  inspector_name: string
  notes: string | null
  inspected_at: string
}

type Material = {
  material_name: string
  lot_number: string | null
  quantity: number
  unit: string
}

type SaleEntry = {
  customer_name: string | null
  quantity: number
  total_price: number
  sold_at: string
}

type RecallBatch = {
  id: string
  product_id: string
  product_name: string
  sku: string
  quantity: number
  status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  qc_results: QcEntry[]
  materials: Material[]
  sales: SaleEntry[]
  scan_count: number
}

type LineageEdge = {
  parent_batch_id: string
  child_batch_id: string
  relationship_type: string
}

type SearchType = 'lot' | 'batch_id' | 'sku'

// ── Constants ──────────────────────────────────────────────────────────────

const qcColors: Record<QcStatus, string> = {
  pass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  fail: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  hold: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
}

const statusColors: Record<string, string> = {
  completed:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pending:     'bg-gray-100 text-gray-600 dark:bg-[#262E36]/55 dark:text-gray-400',
  cancelled:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const qcNodeColors: Record<string, { fill: string; stroke: string; text: string }> = {
  pass: { fill: '#d1fae5', stroke: '#10b981', text: '#065f46' },
  fail: { fill: '#fee2e2', stroke: '#ef4444', text: '#7f1d1d' },
  hold: { fill: '#fef3c7', stroke: '#f59e0b', text: '#78350f' },
  none: { fill: '#f9fafb', stroke: '#e5e7eb', text: '#374151' },
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${className}`}>
      {label.replace('_', ' ')}
    </span>
  )
}

// ── Graph layout ───────────────────────────────────────────────────────────

const NODE_W = 172
const NODE_H = 62
const H_GAP  = 54
const V_GAP  = 14

function computeLayout(batches: RecallBatch[], edges: LineageEdge[]) {
  const allIds = new Set(batches.map(b => b.id))

  const childrenOf = new Map<string, Set<string>>()
  const parentsOf  = new Map<string, Set<string>>()
  for (const b of batches) {
    childrenOf.set(b.id, new Set())
    parentsOf.set(b.id, new Set())
  }
  for (const e of edges) {
    if (allIds.has(e.parent_batch_id) && allIds.has(e.child_batch_id)) {
      childrenOf.get(e.parent_batch_id)?.add(e.child_batch_id)
      parentsOf.get(e.child_batch_id)?.add(e.parent_batch_id)
    }
  }

  // BFS from roots to assign layers
  const layer = new Map<string, number>()
  const roots = batches.filter(b => parentsOf.get(b.id)!.size === 0)
  const queue: string[] = roots.map(r => r.id)
  for (const id of queue) layer.set(id, 0)

  let qi = 0
  while (qi < queue.length) {
    const id = queue[qi++]
    const l  = layer.get(id)!
    for (const child of childrenOf.get(id) ?? []) {
      const prev = layer.get(child)
      if (prev === undefined || prev <= l) {
        layer.set(child, l + 1)
        queue.push(child)
      }
    }
  }
  for (const b of batches) {
    if (!layer.has(b.id)) layer.set(b.id, 0)
  }

  const byLayer = new Map<number, string[]>()
  for (const [id, l] of layer) {
    if (!byLayer.has(l)) byLayer.set(l, [])
    byLayer.get(l)!.push(id)
  }

  const positions = new Map<string, { x: number; y: number }>()
  const maxCount  = Math.max(...Array.from(byLayer.values()).map(v => v.length), 1)
  const totalH    = maxCount * NODE_H + (maxCount - 1) * V_GAP

  for (const [l, ids] of byLayer) {
    const colH = ids.length * NODE_H + (ids.length - 1) * V_GAP
    let y = (totalH - colH) / 2
    for (const id of ids) {
      positions.set(id, { x: l * (NODE_W + H_GAP) + 16, y: y + 16 })
      y += NODE_H + V_GAP
    }
  }

  const allPos = Array.from(positions.values())
  const svgW = allPos.length ? Math.max(...allPos.map(p => p.x)) + NODE_W + 24 : 200
  const svgH = allPos.length ? Math.max(...allPos.map(p => p.y)) + NODE_H + 24 : 120

  return { positions, svgW, svgH }
}

// ── Lineage graph ──────────────────────────────────────────────────────────

function LineageGraph({ batches, edges, t, lang }: { batches: RecallBatch[]; edges: LineageEdge[]; t: (k: string, v?: Record<string, string | number>) => string; lang: string }) {
  const capped = batches.slice(0, 30)
  const { positions, svgW, svgH } = useMemo(
    () => computeLayout(capped, edges),
    [capped, edges],
  )

  return (
    <div className="rounded-2xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] px-5 py-3">
        <Network size={15} className="text-gray-400" />
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('recall.lineage_graph')}</span>
        {batches.length > 30 && (
          <span className="ml-auto text-xs text-amber-600 dark:text-amber-400">
            {t('recall.first_n_of', { total: fmtNum(batches.length, lang as 'en' | 'ar') })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-gray-400">
          {(['pass', 'fail', 'hold', 'none'] as const).map(s => (
            <span key={s} className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm border"
                style={{ background: qcNodeColors[s].fill, borderColor: qcNodeColors[s].stroke }}
              />
              {s === 'none' ? t('recall.no_qc_label') : t(`status.${s}`)}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto p-2">
        <svg
          width={svgW}
          height={Math.max(svgH, 100)}
          style={{ display: 'block', minWidth: svgW }}
        >
          {/* White canvas background */}
          <rect width={svgW} height={Math.max(svgH, 100)} fill="white" />

          <defs>
            <marker id="rc-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0,8 3,0 6" fill="#9ca3af" />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map((e, i) => {
            const p1 = positions.get(e.parent_batch_id)
            const p2 = positions.get(e.child_batch_id)
            if (!p1 || !p2) return null
            const x1 = p1.x + NODE_W
            const y1 = p1.y + NODE_H / 2
            const x2 = p2.x
            const y2 = p2.y + NODE_H / 2
            const cx = (x1 + x2) / 2
            return (
              <g key={i}>
                <path
                  d={`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke="#d1d5db"
                  strokeWidth="1.5"
                  markerEnd="url(#rc-arr)"
                />
                {e.relationship_type && e.relationship_type !== 'material_flow' && (
                  <text
                    x={cx}
                    y={Math.min(y1, y2) - 5}
                    textAnchor="middle"
                    fontSize="9"
                    fill="#9ca3af"
                    fontFamily="system-ui,sans-serif"
                  >
                    {e.relationship_type}
                  </text>
                )}
              </g>
            )
          })}

          {/* Nodes */}
          {capped.map(batch => {
            const pos = positions.get(batch.id)
            if (!pos) return null
            const latestQc = batch.qc_results[0]
            const colors   = qcNodeColors[latestQc?.status ?? 'none']
            const name     = batch.product_name.length > 21
              ? batch.product_name.slice(0, 21) + '…'
              : batch.product_name

            return (
              <g key={batch.id}>
                <rect
                  x={pos.x} y={pos.y}
                  width={NODE_W} height={NODE_H}
                  rx="8"
                  fill={colors.fill}
                  stroke={colors.stroke}
                  strokeWidth="1.5"
                />
                <text
                  x={pos.x + 12} y={pos.y + 20}
                  fontSize="11" fontWeight="600"
                  fill={colors.text}
                  fontFamily="system-ui,sans-serif"
                >
                  {name}
                </text>
                <text
                  x={pos.x + 12} y={pos.y + 36}
                  fontSize="9"
                  fill="#6b7280"
                  fontFamily="'Courier New',monospace"
                >
                  {batch.id.slice(0, 10)}…
                </text>
                <text
                  x={pos.x + 12} y={pos.y + 52}
                  fontSize="9"
                  fill={colors.text}
                  fontFamily="system-ui,sans-serif"
                >
                  {batch.sku}  ·  {latestQc ? t(`status.${latestQc.status}`) : t('recall.no_qc_label')}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ── CSV export ─────────────────────────────────────────────────────────────

function exportToCSV(batches: RecallBatch[]) {
  const cols = [
    'Batch ID', 'Product', 'SKU', 'Quantity', 'Status',
    'Latest QC', 'QC Inspector', 'Materials',
    'Sale Records', 'Scan Count', 'Created At', 'Completed At',
  ]
  const rows = batches.map(b => {
    const qc = b.qc_results[0]
    return [
      b.id,
      b.product_name,
      b.sku,
      b.quantity,
      b.status,
      qc?.status ?? '',
      qc?.inspector_name ?? '',
      b.materials.map(m => `${m.material_name}${m.lot_number ? `(lot:${m.lot_number})` : ''}`).join('; '),
      b.sales.length,
      b.scan_count,
      b.created_at,
      b.completed_at ?? '',
    ]
  })
  const csv = [cols, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `recall-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Recall Registry ────────────────────────────────────────────────────────
// Formal recall record management — separate from the impact lookup tool.

const SEVERITY_BADGE: Record<RecallSeverity, string> = {
  low:      'bg-green-100  text-green-700  dark:bg-green-900/20  dark:text-green-400',
  medium:   'bg-amber-100  text-amber-700  dark:bg-amber-900/20  dark:text-amber-400',
  high:     'bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400',
  critical: 'bg-red-100    text-red-700    dark:bg-red-900/20    dark:text-red-400',
}

const STATUS_BADGE: Record<RecallStatus, string> = {
  open:        'bg-blue-100    text-blue-700    dark:bg-blue-900/20    dark:text-blue-400',
  in_progress: 'bg-amber-100   text-amber-700   dark:bg-amber-900/20   dark:text-amber-400',
  closed:      'bg-emerald-100 text-emerald-700  dark:bg-emerald-900/20 dark:text-emerald-400',
}

const EMPTY_RECALL: RecallFormData = {
  title: '', reason: '', severity: 'medium', root_cause: '',
  corrective_action: '', affected_units: '', initiated_by_name: '',
  batch_id: null, product_id: null,
}

// ── CAPA status badge ───────────────────────────────────────────────────────

const CAPA_STATUS_CLS: Record<string, string> = {
  open:              'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  investigation:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  corrective_action: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  verification:      'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  closed:            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
}

function CapaCell({ capas, onOpen }: { capas: LinkedCapaSummary[]; onOpen: (id: string) => void }) {
  if (capas.length === 0) {
    return <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
  }
  const first    = capas[0]
  const openCount = capas.filter(c => c.status !== 'closed').length
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => onOpen(first.id)}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider hover:opacity-80 transition-opacity ${CAPA_STATUS_CLS[first.status] ?? CAPA_STATUS_CLS.open}`}
        title={`Open CAPA: ${first.capa_number ?? first.id.slice(0, 8)}`}
      >
        <FileWarning size={9} />
        {first.capa_number ?? `#${first.id.slice(0, 8)}`}
      </button>
      {openCount > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
          {openCount} open
        </span>
      )}
      {capas.length > 1 && (
        <span className="text-[10px] text-gray-400">+{capas.length - 1} more</span>
      )}
    </div>
  )
}

function RecallCreateModal({ onClose, onSave, saving }: {
  onClose: () => void
  onSave:  (d: RecallFormData) => Promise<void>
  saving:  boolean
}) {
  const [form, setForm] = useState<RecallFormData>(EMPTY_RECALL)
  const f = (k: keyof RecallFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [k]: e.target.value }))

  const cls = 'w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]'
  const lbl = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">New Recall</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <form onSubmit={async e => { e.preventDefault(); await onSave(form) }} className="space-y-4">
          <div>
            <label className={lbl}>Title *</label>
            <input required value={form.title} onChange={f('title')} className={cls} placeholder="Recall title or reference" />
          </div>
          <div>
            <label className={lbl}>Reason *</label>
            <textarea required rows={2} value={form.reason} onChange={f('reason')} className={cls} placeholder="Reason for recall" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Severity *</label>
              <select value={form.severity} onChange={f('severity')} className={cls}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className={lbl}>Affected Units</label>
              <input type="number" min={0} value={form.affected_units} onChange={f('affected_units')} className={cls} placeholder="0" />
            </div>
          </div>
          <div>
            <label className={lbl}>Initiated By</label>
            <input value={form.initiated_by_name} onChange={f('initiated_by_name')} className={cls} placeholder="Name of initiating officer" />
          </div>
          <div>
            <label className={lbl}>Root Cause</label>
            <textarea rows={2} value={form.root_cause} onChange={f('root_cause')} className={cls} placeholder="Root cause analysis" />
          </div>
          <div>
            <label className={lbl}>Corrective Action</label>
            <textarea rows={2} value={form.corrective_action} onChange={f('corrective_action')} className={cls} placeholder="Actions taken or planned" />
          </div>
          <div>
            <label className={lbl}>Linked Batch ID <span className="font-normal text-gray-400">(optional UUID)</span></label>
            <input value={form.batch_id ?? ''} onChange={f('batch_id')} className={cls} placeholder="e.g. 6db4527d-cbe8-…" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] disabled:opacity-60">
              {saving ? 'Creating…' : 'Create Recall'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RecallRegistry() {
  const { user, companyId } = useAuth()
  const role    = useRole()
  const toast   = useToast()
  const confirm = useConfirm()
  const router  = useRouter()
  const canEditRecall = canEdit(role, 'recall')

  const { recalls, stats, loading, error, refresh, createRecall, updateStatus, deleteRecall } = useRecalls()

  const [showCreate, setShowCreate] = useState(false)
  const [saving,     setSaving]     = useState(false)

  async function handleCreate(data: RecallFormData) {
    if (!companyId) return
    setSaving(true)

    // Step 1: create the recall
    const result = await createRecall(data)
    if (!result) {
      setSaving(false)
      toast.error('Failed to create recall')
      return
    }

    // Step 2: create the linked CAPA via SECURITY DEFINER RPC — bypasses RLS
    const rootCause = [
      `Auto-generated CAPA for recall ${result.recall_number ?? result.title}.`,
      `Recall Reason: ${data.reason}`,
      data.root_cause        ? `Initial Root Cause: ${data.root_cause}` : null,
      data.corrective_action ? `Proposed Corrective Action: ${data.corrective_action}` : null,
      data.affected_units    ? `Affected Units: ${parseInt(data.affected_units, 10).toLocaleString()}` : null,
      data.initiated_by_name ? `Initiated By: ${data.initiated_by_name}` : null,
    ].filter(Boolean).join('\n')

    const { data: capaRows, error: capaErr } = await supabase
      .rpc('insert_capa_from_recall', {
        p_recall_id:  result.id,
        p_batch_id:   data.batch_id || null,
        p_title:      `Recall Investigation — ${result.recall_number ?? result.title}`,
        p_owner_name: data.initiated_by_name || null,
        p_due_date:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        p_root_cause: rootCause,
      })
    const capaRow = (capaRows as Array<{ id: string; capa_number: string | null }> | null)?.[0] ?? null

    setSaving(false)
    setShowCreate(false)

    if (capaErr) {
      // Recall was created; CAPA failed — show exact error so user can diagnose
      toast.error(
        `Recall ${result.recall_number ?? ''} created, but CAPA auto-creation failed: ` +
        `[${capaErr.code}] ${capaErr.message}`
      )
      console.error('[handleCreate] CAPA insert error:', capaErr)
    } else {
      toast.success(
        `Recall ${result.recall_number ?? ''} created — CAPA ${capaRow?.capa_number ?? ''} opened automatically`
      )
    }

    // Refresh to pick up linked_capas
    refresh()

    if (companyId) {
      void logActivity({
        companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'recall.initiated', entityType: 'recall', entityId: result.id,
        message: `${actorName(user?.email)} initiated recall: ${data.title}`,
        metadata: { recall_number: result.recall_number, severity: data.severity },
      })
    }
  }

  async function handleStatusChange(id: string, current: RecallStatus) {
    const next: RecallStatus = current === 'open' ? 'in_progress' : 'closed'
    const ok = await updateStatus(id, next)
    if (!ok) toast.error('Failed to update status')
    else toast.success(next === 'closed' ? 'Recall closed' : 'Recall status updated')
  }

  async function handleDelete(id: string, num: string | null) {
    const ok = await confirm({
      title: 'Delete Recall', message: `Delete ${num ?? 'this recall'}?`,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    const deleted = await deleteRecall(id)
    if (deleted) toast.success('Recall deleted')
    else         toast.error('Failed to delete recall')
  }

  return (
    <div className="space-y-4">
      {showCreate && (
        <RecallCreateModal onClose={() => setShowCreate(false)} onSave={handleCreate} saving={saving} />
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Open',        value: stats?.open        ?? '—', cls: 'text-blue-600 dark:text-blue-400'   },
          { label: 'In Progress', value: stats?.in_progress ?? '—', cls: 'text-amber-600 dark:text-amber-400' },
          { label: 'Critical',    value: stats?.critical_open ?? '—', cls: 'text-red-600 dark:text-red-400'   },
          { label: 'Closed',      value: stats?.closed      ?? '—', cls: 'text-emerald-600 dark:text-emerald-400' },
        ].map(s => (
          <div key={s.label}
            className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
            <p className={`text-xl font-bold ${s.cls}`}>{loading ? '—' : s.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <button onClick={refresh}
          className="flex items-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 shadow-sm hover:bg-[#D1CFC9]/30 transition">
          <RefreshCw size={14} />Refresh
        </button>
        {canEditRecall && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#2d5a74] transition">
            <Plus size={14} />New Recall
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle size={14} />{error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-[#262E36]/55" />
            ))}
          </div>
        ) : recalls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <AlertTriangle size={40} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">No recalls on record.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] bg-[#D1CFC9]/50 dark:bg-[#262E36]/38 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-5 py-3 text-start">Recall #</th>
                  <th className="px-5 py-3 text-start">Title</th>
                  <th className="px-5 py-3 text-start">Severity</th>
                  <th className="px-5 py-3 text-start">Status</th>
                  <th className="px-5 py-3 text-start">CAPA</th>
                  <th className="px-5 py-3 text-start">Initiated</th>
                  <th className="px-5 py-3 text-start">Affected</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-[#B3B7BA]/[0.07]">
                {recalls.map(recall => (
                  <tr key={recall.id} className="hover:bg-blue-50/40 dark:hover:bg-blue-900/10 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {recall.recall_number ?? `#${recall.id.slice(0, 8)}`}
                    </td>
                    <td className="px-5 py-3.5 max-w-xs">
                      <p className="font-medium text-gray-900 dark:text-white leading-snug">{recall.title}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{recall.reason}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${SEVERITY_BADGE[recall.severity]}`}>
                        {recall.severity}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[recall.status]}`}>
                        {recall.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <CapaCell
                        capas={recall.linked_capas ?? []}
                        onOpen={id => router.push(`/capa/${id}`)}
                      />
                    </td>
                    <td className="px-5 py-3.5 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">
                      {new Date(recall.initiated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3.5 text-gray-700 dark:text-gray-300">
                      {recall.affected_units != null ? recall.affected_units.toLocaleString() : '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        {recall.batch_id && (
                          <a
                            href={`/product-journey/${recall.batch_id}`}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#3a6f8f] dark:text-[#7ab3d0] hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors whitespace-nowrap"
                            title="View Product Journey"
                          >
                            <GitBranch size={12} />Journey
                          </a>
                        )}
                        {(recall.linked_capas?.length ?? 0) > 0 && (
                          <button
                            onClick={() => router.push(`/capa/${recall.linked_capas![0].id}`)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#3a6f8f] dark:text-[#7ab3d0] hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors whitespace-nowrap"
                            title="Open linked CAPA"
                          >
                            <ExternalLink size={12} />CAPA
                          </button>
                        )}
                        {canEditRecall && recall.status !== 'closed' && (
                          <button
                            onClick={() => handleStatusChange(recall.id, recall.status)}
                            className="rounded-md border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 transition whitespace-nowrap">
                            {recall.status === 'open' ? 'Start' : 'Close'}
                          </button>
                        )}
                        {canEditRecall && (
                          <button
                            onClick={() => handleDelete(recall.id, recall.recall_number)}
                            className="rounded p-1 text-gray-300 dark:text-gray-600 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function RecallClient() {
  const { t, lang } = useT()
  const { companyId } = useAuth()
  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'

  const [searchType, setSearchType] = useState<SearchType>('lot')
  const [query,      setQuery]      = useState('')
  const [searching,  setSearching]  = useState(false)
  const [batches,    setBatches]    = useState<RecallBatch[] | null>(null)
  const [edges,      setEdges]      = useState<LineageEdge[]>([])
  const [searched,   setSearched]   = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const summary = useMemo(() => {
    if (!batches) return null
    return {
      totalBatches:   batches.length,
      uniqueProducts: new Set(batches.map(b => b.product_id)).size,
      failedQc:       batches.filter(b => b.qc_results.some(q => q.status === 'fail')).length,
      totalSales:     batches.reduce((s, b) => s + b.sales.length, 0),
    }
  }, [batches])

  const highRiskBatches = useMemo(
    () => (batches ?? []).filter(b => b.qc_results.some(q => q.status === 'fail') && b.sales.length > 0),
    [batches],
  )

  const handleSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setBatches(null)
    setEdges([])
    setSearched(false)
    setExpandedId(null)

    if (!companyId) return

    try {
      // ── Step 1: resolve batch IDs (all paths scoped by company) ────────

      let batchIds: string[] = []

      if (searchType === 'lot') {
        // RPC handles company scoping inside SQL — no unbounded ID scrape
        const { data } = await supabase
          .rpc('search_recall_by_lot', { p_company_id: companyId, p_lot_number: q })
        batchIds = [...new Set(
          ((data ?? []) as Array<{ production_order_id: string }>)
            .map(r => r.production_order_id)
        )]

      } else if (searchType === 'batch_id') {
        batchIds = [q]

      } else {
        const { data: prods } = await supabase
          .from('products')
          .select('id')
          .eq('company_id', companyId)
          .ilike('sku', `%${q}%`)
        const productIds = (prods ?? []).map(p => p.id as string)
        if (productIds.length > 0) {
          const { data: ords } = await supabase
            .from('production_orders')
            .select('id')
            .eq('company_id', companyId)
            .in('product_id', productIds)
          batchIds = (ords ?? []).map(o => o.id as string)
        }
      }

      if (batchIds.length === 0) {
        setBatches([])
        setSearched(true)
        return
      }

      // ── Step 2: fetch order details (company_id guard + batch ID list) ──

      const { data: orders } = await supabase
        .from('production_orders')
        .select('*, products(name, sku)')
        .eq('company_id', companyId)
        .in('id', batchIds)

      if (!orders || orders.length === 0) {
        setBatches([])
        setSearched(true)
        return
      }

      const productIds = [...new Set(orders.map(o => o.product_id as string))]

      // ── Step 3: parallel fetch of related data ──────────────────────────

      const [
        { data: qcData },
        { data: matData },
        { data: scanData },
        { data: salesData },
      ] = await Promise.all([
        supabase
          .from('batch_qc_results')
          .select('*')
          .in('batch_id', batchIds)
          .order('inspected_at', { ascending: false }),
        supabase
          .from('bill_of_materials')
          .select('*')
          .in('production_order_id', batchIds),
        supabase
          .from('scan_events')
          .select('batch_id')
          .in('batch_id', batchIds),
        supabase
          .from('sales')
          .select('customer_name, quantity, total_price, sold_at, product_id')
          .in('product_id', productIds)
          .order('sold_at', { ascending: false })
          .limit(500),
      ])

      // ── Step 4: lineage edges (table may not exist yet) ─────────────────

      const orFilter = `parent_batch_id.in.(${batchIds.join(',')}),child_batch_id.in.(${batchIds.join(',')})`
      const { data: edgesRaw } = await supabase
        .from('batch_lineage')
        .select('parent_batch_id, child_batch_id, relationship_type')
        .or(orFilter)

      // ── Step 5: assemble result ─────────────────────────────────────────

      const assembled: RecallBatch[] = orders.map(o => ({
        id:           o.id,
        product_id:   o.product_id,
        product_name: (o.products as { name: string; sku: string } | null)?.name ?? 'Unknown',
        sku:          (o.products as { name: string; sku: string } | null)?.sku ?? '',
        quantity:     o.quantity,
        status:       o.status,
        created_at:   o.created_at,
        started_at:   o.started_at ?? null,
        completed_at: o.completed_at ?? null,
        qc_results: (qcData ?? [])
          .filter(q => q.batch_id === o.id)
          .map(q => ({
            status:         q.status as QcStatus,
            inspector_name: q.inspector_name,
            notes:          q.notes ?? null,
            inspected_at:   q.inspected_at,
          })),
        materials: (matData ?? [])
          .filter(m => m.production_order_id === o.id)
          .map(m => ({
            material_name: m.material_name,
            lot_number:    m.lot_number ?? null,
            quantity:      m.quantity,
            unit:          m.unit,
          })),
        sales: (salesData ?? [])
          .filter(s => s.product_id === o.product_id)
          .map(s => ({
            customer_name: s.customer_name ?? null,
            quantity:      s.quantity,
            total_price:   s.total_price,
            sold_at:       s.sold_at,
          })),
        scan_count: (scanData ?? []).filter(s => s.batch_id === o.id).length,
      }))

      const lineageEdges: LineageEdge[] = (edgesRaw ?? []).map(e => ({
        parent_batch_id:   e.parent_batch_id,
        child_batch_id:    e.child_batch_id,
        relationship_type: (e.relationship_type as string) ?? 'material_flow',
      }))

      setBatches(assembled)
      setEdges(lineageEdges)
    } finally {
      setSearching(false)
      setSearched(true)
    }
  }, [query, searchType, companyId])

  const [view, setView] = useState<'lookup' | 'registry'>('lookup')

  return (
    <div className="space-y-5">

      {/* ── View switcher ─────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 p-1 shadow-sm w-fit">
        {([
          { key: 'lookup'   as const, label: 'Impact Lookup'   },
          { key: 'registry' as const, label: 'Recall Registry'  },
        ]).map(v => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              view === v.key
                ? 'bg-[#3a6f8f] text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      {view === 'registry' && <RecallRegistry />}

      {view === 'lookup' && <>

      {/* ── Search panel ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm p-5">
        <div className="flex flex-wrap gap-2 mb-4">
          {(['lot', 'batch_id', 'sku'] as const).map(stype => (
            <button
              key={stype}
              onClick={() => { setSearchType(stype); setQuery('') }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                searchType === stype
                  ? 'bg-[#3a6f8f] text-white'
                  : 'bg-[#E6E4E0] dark:bg-[#262E36]/55 text-gray-600 dark:text-gray-300 hover:bg-[#D1CFC9] dark:hover:bg-[#262E36]/55'
              }`}
            >
              {stype === 'lot' ? t('recall.lot_number') : stype === 'batch_id' ? t('recall.batch_id_label') : t('recall.sku_label')}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder={
                searchType === 'lot'      ? t('recall.enter_lot') :
                searchType === 'batch_id' ? t('recall.enter_batch') :
                                            t('recall.enter_sku')
              }
              className="w-full rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#D1CFC9]/50 dark:bg-[#262E36]/55 pl-9 pr-9 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-[#4a7fa5] focus:outline-none focus:ring-1 focus:ring-[#4a7fa5]"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setBatches(null); setSearched(false) }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={handleSearch}
            disabled={!query.trim() || searching}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-[#3a6f8f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2d5a74] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {searching
              ? <Loader2 size={15} className="animate-spin" />
              : <Search size={15} />}
            {searching ? t('recall.searching') : t('recall.search')}
          </button>
        </div>
      </div>

      {/* ── Recall alert ──────────────────────────────────────────────────── */}
      {highRiskBatches.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          <div>
            <p className="text-sm font-bold text-red-700 dark:text-red-400">{t('recall.recall_alert')}</p>
            <p className="mt-0.5 text-xs text-red-600 dark:text-red-500">
              {t(highRiskBatches.length !== 1 ? 'recall.recall_alert_sub_plural' : 'recall.recall_alert_sub', { n: fmtNum(highRiskBatches.length, lang) })}
            </p>
          </div>
        </div>
      )}

      {/* ── Risk summary ──────────────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: t('recall.affected_batches'),
              value: fmtNum(summary.totalBatches, lang),
              icon: <ClipboardList size={16} />,
              color: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
            },
            {
              label: t('recall.affected_products'),
              value: fmtNum(summary.uniqueProducts, lang),
              icon: <Package size={16} />,
              color: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
            },
            {
              label: t('recall.failed_qc'),
              value: fmtNum(summary.failedQc, lang),
              icon: <XCircle size={16} />,
              color: summary.failedQc > 0
                ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                : 'bg-[#D1CFC9]/50 dark:bg-[#262E36]/55 text-gray-400 dark:text-gray-500',
            },
            {
              label: t('recall.sale_records'),
              value: fmtNum(summary.totalSales, lang),
              icon: <ShoppingCart size={16} />,
              color: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
            },
          ].map(({ label, value, icon, color }) => (
            <div
              key={label}
              className="rounded-2xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm p-4"
            >
              <div className={`inline-flex items-center justify-center rounded-lg p-2 ${color}`}>
                {icon}
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── No results ────────────────────────────────────────────────────── */}
      {searched && batches?.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 py-16 text-center shadow-sm">
          <AlertCircle size={36} className="mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('recall.no_batches')}</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {t('recall.no_batches_sub', { query })}
          </p>
        </div>
      )}

      {/* ── Lineage graph ─────────────────────────────────────────────────── */}
      {batches && batches.length > 0 && (
        <LineageGraph batches={batches} edges={edges} t={t} lang={lang} />
      )}

      {/* ── Affected batches list ─────────────────────────────────────────── */}
      {batches && batches.length > 0 && (
        <div className="rounded-2xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] px-5 py-3.5">
            <div className="flex items-center gap-2">
              <ClipboardList size={15} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('recall.affected_batches')}</h2>
              <span className="rounded-full bg-[#E6E4E0] dark:bg-[#262E36]/55 px-2 py-0.5 text-xs text-gray-500 dark:text-gray-400">
                {batches.length}
              </span>
            </div>
            <button
              onClick={() => exportToCSV(batches)}
              className="flex items-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 transition-colors"
            >
              <Download size={13} />
              {t('recall.export_csv')}
            </button>
          </div>

          <div className="divide-y divide-gray-50 dark:divide-[#B3B7BA]/[0.07]">
            {batches.map(batch => {
              const latestQc  = batch.qc_results[0]
              const isExpanded = expandedId === batch.id
              const hasRisk   = batch.qc_results.some(q => q.status === 'fail') && batch.sales.length > 0

              return (
                <div key={batch.id}>
                  {/* ── Row ──────────────────────────────────────────── */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : batch.id)}
                    className={`w-full flex items-start gap-3 px-5 py-4 text-start transition-colors hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/22 ${
                      hasRisk ? 'border-s-2 border-red-500' : ''
                    }`}
                  >
                    <span className="mt-0.5 shrink-0">
                      {isExpanded
                        ? <ChevronDown size={15} className="text-gray-400" />
                        : <ChevronRight size={15} className="text-gray-400" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {batch.product_name}
                        </span>
                        <span className="font-mono text-xs text-gray-400">{batch.sku}</span>
                        <Badge
                          label={batch.status}
                          className={statusColors[batch.status] ?? 'bg-gray-100 text-gray-600'}
                        />
                        {latestQc && (
                          <Badge label={latestQc.status} className={qcColors[latestQc.status]} />
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-400">
                        <span className="font-mono">{batch.id.slice(0, 13)}…</span>
                        <span>{t('recall.qty_row', { n: fmtNum(batch.quantity, lang) })}</span>
                        <span>{t('recall.created_row', { date: fmt(batch.created_at, locale) })}</span>
                        {batch.completed_at && <span>{t('recall.done_row', { date: fmt(batch.completed_at, locale) })}</span>}
                        <span>{t(batch.scan_count !== 1 ? 'recall.scans_plural' : 'recall.scans', { n: fmtNum(batch.scan_count, lang) })}</span>
                      </div>
                    </div>
                  </button>

                  {/* ── Expanded detail ───────────────────────────────── */}
                  {isExpanded && (
                    <div className="bg-gray-50/60 dark:bg-[#262E36]/12 px-5 pb-5 pt-3 space-y-5">

                      {/* Materials */}
                      <div>
                        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                          <Layers size={12} /> {t('recall.raw_materials_section')} ({fmtNum(batch.materials.length, lang)})
                        </h3>
                        {batch.materials.length === 0
                          ? <p className="text-xs italic text-gray-400">{t('recall.no_materials')}</p>
                          : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] text-gray-400">
                                  <th className="pb-1.5 text-start font-medium">{t('materials.mat_col')}</th>
                                  <th className="pb-1.5 text-start font-medium">{t('materials.lot_col')}</th>
                                  <th className="pb-1.5 text-end font-medium">{t('materials.qty_col')}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-[#B3B7BA]/[0.07]">
                                {batch.materials.map((m, i) => (
                                  <tr key={i}>
                                    <td className="py-1.5 font-medium text-gray-900 dark:text-white">{m.material_name}</td>
                                    <td className="py-1.5 font-mono text-gray-400">{m.lot_number ?? '—'}</td>
                                    <td className="py-1.5 text-end text-gray-700 dark:text-gray-300">{m.quantity} {m.unit}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )
                        }
                      </div>

                      {/* QC inspections */}
                      <div>
                        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                          <FlaskConical size={12} /> {t('recall.qc_section')} ({fmtNum(batch.qc_results.length, lang)})
                        </h3>
                        {batch.qc_results.length === 0
                          ? <p className="text-xs italic text-gray-400">{t('recall.no_qc')}</p>
                          : (
                            <div className="space-y-1.5">
                              {batch.qc_results.map((q, i) => (
                                <div
                                  key={i}
                                  className="flex items-start gap-2.5 rounded-lg border border-gray-100 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-3 py-2"
                                >
                                  <Badge label={q.status} className={`mt-0.5 shrink-0 ${qcColors[q.status]}`} />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-medium text-gray-900 dark:text-white">{q.inspector_name}</span>
                                      <span className="shrink-0 text-[10px] text-gray-400">{fmt(q.inspected_at, locale)}</span>
                                    </div>
                                    {q.notes && (
                                      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{q.notes}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        }
                      </div>

                      {/* Distribution */}
                      <div>
                        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                          <ShoppingCart size={12} /> {t('recall.distribution_section')} ({fmtNum(batch.sales.length, lang)})
                        </h3>
                        {batch.sales.length === 0
                          ? <p className="text-xs italic text-gray-400">{t('recall.no_distribution')}</p>
                          : (
                            <div className="space-y-1">
                              {batch.sales.slice(0, 8).map((s, i) => (
                                <div key={i} className="flex items-center justify-between gap-3 text-xs">
                                  <span className="font-medium text-gray-900 dark:text-white">
                                    {s.customer_name ?? t('common.customer')}
                                  </span>
                                  <span className="text-gray-400">{fmt(s.sold_at, locale)}</span>
                                  <span className="font-medium text-gray-700 dark:text-gray-300">
                                    {fmtNum(s.quantity, lang)} {t('recall.units')}
                                  </span>
                                </div>
                              ))}
                              {batch.sales.length > 8 && (
                                <p className="text-[10px] text-gray-400">
                                  {t('recall.more_records', { n: fmtNum(batch.sales.length - 8, lang) })}
                                </p>
                              )}
                            </div>
                          )
                        }
                      </div>

                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      </>}
    </div>
  )
}
