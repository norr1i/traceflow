'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  const hrs  = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins} min ago`
  if (hrs  < 24)  return `${hrs}h ago`
  if (days === 1) return 'Yesterday'
  if (days < 7)   return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_BADGE: Record<string, string> = {
  pending:     'text-amber-600 dark:text-amber-400',
  in_progress: 'text-blue-600 dark:text-blue-400',
  completed:   'text-emerald-600 dark:text-emerald-400',
  cancelled:   'text-red-500 dark:text-red-400',
}
const STATUS_DOT: Record<string, string> = {
  pending:     'bg-amber-500 dark:bg-amber-400',
  in_progress: 'bg-blue-400',
  completed:   'bg-emerald-400',
  cancelled:   'bg-red-400',
}
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="shrink-0 flex items-center gap-0.5">
      <span className={`h-1 w-1 rounded-full shrink-0 ${STATUS_DOT[status] ?? STATUS_DOT.pending}`} />
      <span className={`text-[9px] font-normal opacity-90 ${STATUS_BADGE[status] ?? STATUS_BADGE.pending}`}>
        {STATUS_LABEL[status] ?? status}
      </span>
    </span>
  )
}

// ── Search bar with grouped autocomplete ─────────────────────────────────────

function BatchSearchBar({
  batches, query, onQueryChange, onSelect, loading,
}: {
  batches:       BatchResult[]
  query:         string
  onQueryChange: (q: string) => void
  onSelect:      (b: BatchResult) => void
  loading:       boolean
}) {
  const [open, setOpen] = useState(query.trim().length > 0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const q = query.toLowerCase().trim()

  const groups = q ? (() => {
    const byId    = batches.filter(b => b.id.toLowerCase().includes(q)).slice(0, 3)
    const usedSet = new Set(byId.map(b => b.id))
    const byProd  = batches.filter(b => !usedSet.has(b.id) && b.product_name.toLowerCase().includes(q)).slice(0, 4)
    byProd.forEach(b => usedSet.add(b.id))
    const bySku   = batches.filter(b => !usedSet.has(b.id) && b.sku.toLowerCase().includes(q)).slice(0, 3)
    return [
      { label: 'Batch IDs', items: byId },
      { label: 'Products',  items: byProd },
      { label: 'SKUs',      items: bySku },
    ].filter(g => g.items.length > 0)
  })() : []

  const hasResults = groups.some(g => g.items.length > 0)

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3.5 shadow-sm focus-within:border-[#3a6f8f] focus-within:ring-2 focus-within:ring-[#3a6f8f]/30 transition-all">
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
          className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 outline-none"
        />
        {query && (
          <button type="button" onClick={() => { onQueryChange(''); setOpen(false) }}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {open && q && hasResults && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden">
          {groups.map((group, gi) => (
            <div key={group.label}>
              {gi > 0 && <div className="border-t border-gray-100 dark:border-gray-700/60" />}
              <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {group.label}
              </p>
              {group.items.map((b, i) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => { onSelect(b); setOpen(false) }}
                  className={`w-full flex items-center justify-between gap-4 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors ${i < group.items.length - 1 ? 'border-b border-gray-50 dark:border-gray-700/30' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{b.product_name}</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate">
                      {b.sku} · ···{b.id.slice(-8)}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2.5">
                    <span className="text-[11px] text-gray-400 tabular-nums whitespace-nowrap">{relativeTime(b.created_at)}</span>
                    <StatusBadge status={b.status} />
                  </div>
                </button>
              ))}
            </div>
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
  const [totalCount,   setTotalCount]   = useState(0)
  const [query,        setQuery]        = useState(searchParams.get('q') ?? '')

  const loadBatches = useCallback(async () => {
    if (!companyId) return
    setBatchLoading(true)
    const [{ data }, { count }] = await Promise.all([
      supabase
        .from('production_orders')
        .select('id, quantity, status, created_at, products(name, sku)')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('production_orders')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId),
    ])

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
    if (count !== null) setTotalCount(count)
    setBatchLoading(false)
  }, [companyId])

  useEffect(() => { loadBatches() }, [loadBatches])

  function handleSelect(b: BatchResult) {
    router.push(`/product-journey/${b.id}`)
  }

  // Demo-first ordering: pin the three main story SKUs to the top, then
  // in-progress/pending supporting batches, then everything else by date.
  const DEMO_PRIORITY_SKUS = [
    'VBC-2IN-316',
    'HPC-50-200',
    'VSR-05-010',
    'ELV-7K5-VFD',
    'ELM-3P-250A',
    'VGV-DN50-16',
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
    .slice(0, 12)

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
      </div>

      {/* Recent batches */}
      {recent.length > 0 && (
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Recent Batches
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {recent.map(b => (
              <button
                key={b.id}
                type="button"
                onClick={() => handleSelect(b)}
                className="text-left rounded-xl border border-gray-200/60 dark:border-gray-700/40 bg-white dark:bg-gray-800 py-1.5 px-2 cursor-pointer hover:border-[#3a6f8f]/70 dark:hover:border-[#3a6f8f]/50 hover:shadow-[0_8px_20px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.40)] hover:-translate-y-0.5 transition-all duration-200 group"
              >
                {/* Primary: product name + quiet status */}
                <div className="flex items-start justify-between gap-2 mb-0.5">
                  <p className="text-[13px] font-bold text-gray-900 dark:text-white leading-normal line-clamp-2 group-hover:text-[#3a6f8f] transition-colors duration-200">
                    {b.product_name}
                  </p>
                  <StatusBadge status={b.status} />
                </div>
                {/* Secondary: Batch ID — legible so same-product cards are immediately distinguishable */}
                <div className="mb-0.5">
                  <span className="font-mono text-[10px] font-semibold text-gray-700 dark:text-gray-200">#{b.id.slice(-8)}</span>
                </div>
                {/* Tertiary: SKU (muted, below Batch ID) · units · date + hover CTA */}
                <div className="flex items-center justify-between">
                  <span className="text-[9px]">
                    <span className="rounded bg-gray-100 dark:bg-gray-700/50 px-1 py-px font-mono text-[9px] text-gray-400 dark:text-gray-500">{b.sku}</span>
                    <span className="mx-1 text-gray-300 dark:text-gray-600">·</span>
                    <span className="text-gray-400 dark:text-gray-500">{b.quantity.toLocaleString()} units</span>
                    <span className="mx-1 text-gray-300 dark:text-gray-600">·</span>
                    <span className="text-gray-400 dark:text-gray-500">{relativeTime(b.created_at)}</span>
                  </span>
                  <span className="text-[9px] text-[#3a6f8f] dark:text-[#7ab3d0] font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    View Journey →
                  </span>
                </div>
              </button>
            ))}
          </div>

          {totalCount > 12 && (
            <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700/40 flex items-center justify-between">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Showing {recent.length} of {totalCount.toLocaleString()} batches
              </span>
              <Link
                href="/product-journey/all"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#3a6f8f]/40 dark:border-[#3a6f8f]/50 bg-[#3a6f8f]/5 dark:bg-[#3a6f8f]/10 px-3 py-1.5 text-sm font-medium text-[#3a6f8f] dark:text-[#7ab3d0] hover:bg-[#3a6f8f]/10 dark:hover:bg-[#3a6f8f]/20 hover:border-[#3a6f8f]/60 dark:hover:border-[#3a6f8f]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3a6f8f]/40 focus-visible:ring-offset-1 transition-all duration-150"
              >
                Open All Batches <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
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
