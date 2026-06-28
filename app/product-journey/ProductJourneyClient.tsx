'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { Search, Package, Loader2, X, GitBranch } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type BatchResult = {
  id:           string
  product_name: string
  sku:          string
  status:       string
  quantity:     number
  created_at:   string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const ORDER_BADGE: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  completed:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelled:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}
const ORDER_LABEL: Record<string, string> = {
  pending: 'Pending', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled',
}

// ── Search bar ────────────────────────────────────────────────────────────────

function BatchSearchBar({
  batches, query, onQueryChange, onSelect, loading,
}: {
  batches:       BatchResult[]
  query:         string
  onQueryChange: (q: string) => void
  onSelect:      (b: BatchResult) => void
  loading:       boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = batches.filter(b => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      b.product_name.toLowerCase().includes(q) ||
      b.sku.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q)
    )
  }).slice(0, 8)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3.5 shadow-sm focus-within:border-[#3a6f8f] focus-within:ring-2 focus-within:ring-[#3a6f8f]/20 transition-all">
        {loading ? (
          <Loader2 size={16} className="shrink-0 animate-spin text-gray-400" />
        ) : (
          <Search size={16} className="shrink-0 text-gray-400" />
        )}
        <input
          type="text"
          placeholder="Search by product name, SKU, or batch ID…"
          value={query}
          onChange={e => { onQueryChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none"
        />
        {query && (
          <button type="button" onClick={() => { onQueryChange(''); setOpen(false) }}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden">
          {filtered.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => { onSelect(b); setOpen(false) }}
              className={`w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors ${i < filtered.length - 1 ? 'border-b border-gray-100 dark:border-gray-700/60' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{b.product_name}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate">
                  {b.sku} · ···{b.id.slice(-8)}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <span className="text-[10px] text-gray-400">{fmtDate(b.created_at)}</span>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${ORDER_BADGE[b.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {ORDER_LABEL[b.status] ?? b.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProductJourneyClient() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { companyId } = useAuth()

  const [batches,      setBatches]      = useState<BatchResult[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [query,        setQuery]        = useState(searchParams.get('q') ?? '')

  const loadBatches = useCallback(async () => {
    if (!companyId) return
    setBatchLoading(true)
    const { data } = await supabase
      .from('production_orders')
      .select('id, quantity, status, created_at, products(name, sku)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (data) {
      type Row = {
        id: string; quantity: number; status: string; created_at: string
        products: { name: string; sku: string } | { name: string; sku: string }[] | null
      }
      setBatches(
        (data as unknown as Row[]).map(r => {
          const prod = Array.isArray(r.products) ? r.products[0] : r.products
          return {
            id:           r.id,
            product_name: prod?.name ?? 'Unknown Product',
            sku:          prod?.sku  ?? '—',
            status:       r.status,
            quantity:     r.quantity,
            created_at:   r.created_at,
          }
        })
      )
    }
    setBatchLoading(false)
  }, [companyId])

  useEffect(() => { loadBatches() }, [loadBatches])

  function handleSelect(b: BatchResult) {
    router.push(`/product-journey/${b.id}`)
  }

  // Demo-first ordering: pin the three main story SKUs to the top, then
  // in-progress/pending supporting batches, then everything else by date.
  const DEMO_PRIORITY_SKUS = [
    'VBC-2IN-316',  // Ball Valve — completed, QC passed, distributed
    'HPC-50-200',   // Hydraulic Cylinder — completed, CAPA example
    'VSR-05-010',   // Safety Relief Valve — completed, recall story
    'ELV-7K5-VFD',  // VFD — in progress, QC pending
    'ELM-3P-250A',  // MCCB — pending (newest batch)
    'VGV-DN50-16',  // Gate Valve — in progress, QC hold
  ]
  const recent = [...batches]
    .sort((a, b) => {
      const ai = DEMO_PRIORITY_SKUS.indexOf(a.sku)
      const bi = DEMO_PRIORITY_SKUS.indexOf(b.sku)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return 0
    })
    .slice(0, 6)

  return (
    <div className="px-6 py-4">
      {/* Page header */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <GitBranch size={20} className="text-[#3a6f8f]" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Traceability Search</h1>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Search any batch, lot number, SKU, or product — then open the full Product Journey.
        </p>
      </div>

      {/* Search */}
      <div className="max-w-2xl mb-5">
        <BatchSearchBar
          batches={batches}
          query={query}
          onQueryChange={setQuery}
          onSelect={handleSelect}
          loading={batchLoading}
        />
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          You can also open Product Journey directly from Production, Quality Control, CAPA, and Recall pages.
        </p>
      </div>

      {/* Recent batches */}
      {recent.length > 0 && (
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Recent Batches
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map(b => (
              <button
                key={b.id}
                type="button"
                onClick={() => handleSelect(b)}
                className="text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3.5 shadow-sm hover:border-[#3a6f8f]/50 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight group-hover:text-[#3a6f8f] transition-colors">
                    {b.product_name}
                  </p>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${ORDER_BADGE[b.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {ORDER_LABEL[b.status] ?? b.status}
                  </span>
                </div>
                <p className="font-mono text-[11px] text-gray-400 dark:text-gray-500">{b.sku} · {b.quantity.toLocaleString()} units</p>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-[#3a6f8f] dark:text-[#7ab3d0] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  <GitBranch size={10} />View Journey →
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {!batchLoading && recent.length === 0 && (
        <div className="flex flex-col items-center py-12 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
            <Package size={28} className="text-gray-300 dark:text-gray-600" />
          </div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">No production batches yet</h3>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 max-w-xs">
            Create a production order to start tracking product journeys end-to-end.
          </p>
        </div>
      )}
    </div>
  )
}
