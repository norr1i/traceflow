'use client'

import { useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  AlertTriangle, Search, Download, ChevronDown, ChevronRight,
  Package, FlaskConical, Layers, ShoppingCart, Network,
  XCircle, AlertCircle, Loader2, X, ClipboardList,
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
  pending:     'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  cancelled:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const qcNodeColors: Record<string, { fill: string; stroke: string; text: string }> = {
  pass: { fill: '#d1fae5', stroke: '#10b981', text: '#065f46' },
  fail: { fill: '#fee2e2', stroke: '#ef4444', text: '#7f1d1d' },
  hold: { fill: '#fef3c7', stroke: '#f59e0b', text: '#78350f' },
  none: { fill: '#f9fafb', stroke: '#e5e7eb', text: '#374151' },
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
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

function LineageGraph({ batches, edges }: { batches: RecallBatch[]; edges: LineageEdge[] }) {
  const capped = batches.slice(0, 30)
  const { positions, svgW, svgH } = useMemo(
    () => computeLayout(capped, edges),
    [capped, edges],
  )

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-700 px-5 py-3">
        <Network size={15} className="text-gray-400" />
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Batch Lineage Graph</span>
        {batches.length > 30 && (
          <span className="ml-auto text-xs text-amber-600 dark:text-amber-400">
            Showing first 30 of {batches.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-gray-400">
          {(['pass', 'fail', 'hold', 'none'] as const).map(s => (
            <span key={s} className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm border"
                style={{ background: qcNodeColors[s].fill, borderColor: qcNodeColors[s].stroke }}
              />
              {s === 'none' ? 'No QC' : s.toUpperCase()}
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
                  {batch.sku}  ·  {latestQc ? latestQc.status.toUpperCase() : 'NO QC'}
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

// ── Main component ─────────────────────────────────────────────────────────

export default function RecallClient() {
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

    try {
      // ── Step 1: resolve batch IDs ───────────────────────────────────────

      let batchIds: string[] = []

      if (searchType === 'lot') {
        const { data } = await supabase
          .from('bill_of_materials')
          .select('production_order_id')
          .ilike('lot_number', `%${q}%`)
        batchIds = [...new Set((data ?? []).map(r => r.production_order_id as string))]

      } else if (searchType === 'batch_id') {
        batchIds = [q]

      } else {
        const { data: prods } = await supabase
          .from('products')
          .select('id')
          .ilike('sku', `%${q}%`)
        const productIds = (prods ?? []).map(p => p.id as string)
        if (productIds.length > 0) {
          const { data: ords } = await supabase
            .from('production_orders')
            .select('id')
            .in('product_id', productIds)
          batchIds = (ords ?? []).map(o => o.id as string)
        }
      }

      if (batchIds.length === 0) {
        setBatches([])
        setSearched(true)
        return
      }

      // ── Step 2: fetch order details ─────────────────────────────────────

      const { data: orders } = await supabase
        .from('production_orders')
        .select('*, products(name, sku)')
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
          .order('sold_at', { ascending: false }),
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
  }, [query, searchType])

  return (
    <div className="space-y-5">

      {/* ── Search panel ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-5">
        <div className="flex flex-wrap gap-2 mb-4">
          {(['lot', 'batch_id', 'sku'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setSearchType(t); setQuery('') }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                searchType === t
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {t === 'lot' ? 'Lot Number' : t === 'batch_id' ? 'Batch ID' : 'SKU'}
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
                searchType === 'lot'      ? 'Enter lot number, e.g. LOT-2024-001…' :
                searchType === 'batch_id' ? 'Enter batch UUID…' :
                                           'Enter product SKU…'
              }
              className="w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 pl-9 pr-9 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
            className="flex shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {searching
              ? <Loader2 size={15} className="animate-spin" />
              : <Search size={15} />}
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>

      {/* ── Recall alert ──────────────────────────────────────────────────── */}
      {highRiskBatches.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          <div>
            <p className="text-sm font-bold text-red-700 dark:text-red-400">Recall Alert</p>
            <p className="mt-0.5 text-xs text-red-600 dark:text-red-500">
              {highRiskBatches.length} batch{highRiskBatches.length !== 1 ? 'es' : ''} with failed QC
              {' '}{highRiskBatches.length !== 1 ? 'have' : 'has'} been distributed to customers.
              Immediate review recommended.
            </p>
          </div>
        </div>
      )}

      {/* ── Risk summary ──────────────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: 'Affected Batches',
              value: summary.totalBatches,
              icon: <ClipboardList size={16} />,
              color: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
            },
            {
              label: 'Affected Products',
              value: summary.uniqueProducts,
              icon: <Package size={16} />,
              color: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
            },
            {
              label: 'Failed QC',
              value: summary.failedQc,
              icon: <XCircle size={16} />,
              color: summary.failedQc > 0
                ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                : 'bg-gray-50 dark:bg-gray-700 text-gray-400 dark:text-gray-500',
            },
            {
              label: 'Sale Records',
              value: summary.totalSales,
              icon: <ShoppingCart size={16} />,
              color: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
            },
          ].map(({ label, value, icon, color }) => (
            <div
              key={label}
              className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-4"
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
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-16 text-center shadow-sm">
          <AlertCircle size={36} className="mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">No batches found</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            No production batches match &ldquo;{query}&rdquo;.
          </p>
        </div>
      )}

      {/* ── Lineage graph ─────────────────────────────────────────────────── */}
      {batches && batches.length > 0 && (
        <LineageGraph batches={batches} edges={edges} />
      )}

      {/* ── Affected batches list ─────────────────────────────────────────── */}
      {batches && batches.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <ClipboardList size={15} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Affected Batches</h2>
              <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs text-gray-500 dark:text-gray-400">
                {batches.length}
              </span>
            </div>
            <button
              onClick={() => exportToCSV(batches)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <Download size={13} />
              Export CSV
            </button>
          </div>

          <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {batches.map(batch => {
              const latestQc  = batch.qc_results[0]
              const isExpanded = expandedId === batch.id
              const hasRisk   = batch.qc_results.some(q => q.status === 'fail') && batch.sales.length > 0

              return (
                <div key={batch.id}>
                  {/* ── Row ──────────────────────────────────────────── */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : batch.id)}
                    className={`w-full flex items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30 ${
                      hasRisk ? 'border-l-2 border-red-500' : ''
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
                        <span>Qty {batch.quantity.toLocaleString()}</span>
                        <span>Created {fmt(batch.created_at)}</span>
                        {batch.completed_at && <span>Done {fmt(batch.completed_at)}</span>}
                        <span>{batch.scan_count} scan{batch.scan_count !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  </button>

                  {/* ── Expanded detail ───────────────────────────────── */}
                  {isExpanded && (
                    <div className="bg-gray-50/60 dark:bg-gray-700/10 px-5 pb-5 pt-3 space-y-5">

                      {/* Materials */}
                      <div>
                        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                          <Layers size={12} /> Raw Materials ({batch.materials.length})
                        </h3>
                        {batch.materials.length === 0
                          ? <p className="text-xs italic text-gray-400">No materials linked.</p>
                          : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-100 dark:border-gray-700 text-gray-400">
                                  <th className="pb-1.5 text-left font-medium">Material</th>
                                  <th className="pb-1.5 text-left font-medium">Lot #</th>
                                  <th className="pb-1.5 text-right font-medium">Qty</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                                {batch.materials.map((m, i) => (
                                  <tr key={i}>
                                    <td className="py-1.5 font-medium text-gray-900 dark:text-white">{m.material_name}</td>
                                    <td className="py-1.5 font-mono text-gray-400">{m.lot_number ?? '—'}</td>
                                    <td className="py-1.5 text-right text-gray-700 dark:text-gray-300">{m.quantity} {m.unit}</td>
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
                          <FlaskConical size={12} /> QC Inspections ({batch.qc_results.length})
                        </h3>
                        {batch.qc_results.length === 0
                          ? <p className="text-xs italic text-gray-400">No QC inspections recorded.</p>
                          : (
                            <div className="space-y-1.5">
                              {batch.qc_results.map((q, i) => (
                                <div
                                  key={i}
                                  className="flex items-start gap-2.5 rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2"
                                >
                                  <Badge label={q.status} className={`mt-0.5 shrink-0 ${qcColors[q.status]}`} />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-medium text-gray-900 dark:text-white">{q.inspector_name}</span>
                                      <span className="shrink-0 text-[10px] text-gray-400">{fmt(q.inspected_at)}</span>
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
                          <ShoppingCart size={12} /> Distribution ({batch.sales.length} records)
                        </h3>
                        {batch.sales.length === 0
                          ? <p className="text-xs italic text-gray-400">No distribution records.</p>
                          : (
                            <div className="space-y-1">
                              {batch.sales.slice(0, 8).map((s, i) => (
                                <div key={i} className="flex items-center justify-between gap-3 text-xs">
                                  <span className="font-medium text-gray-900 dark:text-white">
                                    {s.customer_name ?? 'Customer'}
                                  </span>
                                  <span className="text-gray-400">{fmt(s.sold_at)}</span>
                                  <span className="font-medium text-gray-700 dark:text-gray-300">
                                    {s.quantity.toLocaleString()} units
                                  </span>
                                </div>
                              ))}
                              {batch.sales.length > 8 && (
                                <p className="text-[10px] text-gray-400">
                                  +{batch.sales.length - 8} more records
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
    </div>
  )
}
