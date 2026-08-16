'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Search, X, Loader2, GitBranch,
  ChevronUp, ChevronDown, ChevronsUpDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth-context'

// ── Types ─────────────────────────────────────────────────────────────────────

type BatchRow = {
  id:           string
  product_name: string
  sku:          string
  status:       string
  quantity:     number
  created_at:   string
}

type SortKey = 'date' | 'product_name' | 'sku' | 'quantity' | 'status'
type SortDir = 'asc' | 'desc'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_DOT: Record<string, string> = {
  pending:     'bg-amber-500',
  in_progress: 'bg-blue-500',
  completed:   'bg-emerald-500',
  cancelled:   'bg-red-500',
}
const STATUS_TEXT: Record<string, string> = {
  pending:     'text-amber-500 dark:text-amber-400',
  in_progress: 'text-blue-500 dark:text-blue-400',
  completed:   'text-emerald-500 dark:text-emerald-400',
  cancelled:   'text-red-500 dark:text-red-400',
}
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled',
}
const STATUS_ORDER: Record<string, number> = {
  in_progress: 0, pending: 1, completed: 2, cancelled: 3,
}

const PAGE_SIZE = 25

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium">
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[status] ?? 'bg-amber-500'}`} />
      <span className={STATUS_TEXT[status] ?? 'text-amber-500 dark:text-amber-400'}>
        {STATUS_LABEL[status] ?? status}
      </span>
    </span>
  )
}

function SortIcon({ col, activeKey, dir }: { col: SortKey; activeKey: SortKey; dir: SortDir }) {
  if (col !== activeKey) {
    return (
      <ChevronsUpDown
        size={12}
        className="ml-1 shrink-0 opacity-40 group-hover:opacity-65 transition-opacity duration-150"
      />
    )
  }
  return dir === 'asc'
    ? <ChevronUp   size={12} className="ml-1 shrink-0 text-[#3a6f8f]" />
    : <ChevronDown size={12} className="ml-1 shrink-0 text-[#3a6f8f]" />
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AllBatchesClient() {
  const router = useRouter()
  const { companyId } = useAuth()

  const [batches, setBatches] = useState<BatchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query,   setQuery]   = useState('')
  const [status,  setStatus]  = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page,    setPage]    = useState(1)

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const { data } = await supabase
      .from('production_orders')
      .select('id, quantity, status, created_at, products(name, sku)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(500)

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
    setLoading(false)
  }, [companyId])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [query, status, sortKey, sortDir])

  function toggleSort(col: SortKey) {
    if (sortKey === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(col)
      setSortDir(col === 'quantity' || col === 'date' ? 'desc' : 'asc')
    }
  }

  type Preset = 'date_desc' | 'date_asc' | 'product_name_asc' | 'quantity_desc'
  const preset: Preset | '' =
    sortKey === 'date'         && sortDir === 'desc' ? 'date_desc' :
    sortKey === 'date'         && sortDir === 'asc'  ? 'date_asc' :
    sortKey === 'product_name' && sortDir === 'asc'  ? 'product_name_asc' :
    sortKey === 'quantity'     && sortDir === 'desc'  ? 'quantity_desc' :
    ''

  function applyPreset(v: string) {
    if      (v === 'date_desc')        { setSortKey('date');         setSortDir('desc') }
    else if (v === 'date_asc')         { setSortKey('date');         setSortDir('asc')  }
    else if (v === 'product_name_asc') { setSortKey('product_name'); setSortDir('asc')  }
    else if (v === 'quantity_desc')    { setSortKey('quantity');     setSortDir('desc') }
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const searchMatches = batches.filter(b => {
    const q = query.toLowerCase()
    return !q ||
      b.product_name.toLowerCase().includes(q) ||
      b.sku.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q)
  })
  const chipCounts: Record<string, number> = { all: searchMatches.length }
  for (const b of searchMatches) chipCounts[b.status] = (chipCounts[b.status] ?? 0) + 1

  const filtered = searchMatches
    .filter(b => status === 'all' || b.status === status)
    .sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'date':         cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); break
        case 'product_name': cmp = a.product_name.localeCompare(b.product_name); break
        case 'sku':          cmp = a.sku.localeCompare(b.sku); break
        case 'quantity':     cmp = a.quantity - b.quantity; break
        case 'status':       cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged      = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const rangeStart = (page - 1) * PAGE_SIZE + 1
  const rangeEnd   = Math.min(page * PAGE_SIZE, filtered.length)

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
  const pageItems = pageNums.reduce<(number | '…')[]>((acc, n, i, arr) => {
    if (i > 0 && n - arr[i - 1] > 1) acc.push('…')
    acc.push(n)
    return acc
  }, [])

  // Sortable th — 'group' lets SortIcon react to parent hover
  const thClass =
    'px-3 py-2 group cursor-pointer select-none ' +
    'text-gray-700 dark:text-gray-100 font-bold ' +
    'hover:text-gray-900 dark:hover:text-white ' +
    'transition-colors duration-150'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-3">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="mb-2.5">
        <button
          onClick={() => router.push('/product-journey')}
          className="mb-1.5 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          <ArrowLeft size={11} />
          Traceability Search
        </button>
        <div className="flex items-center gap-2.5">
          <GitBranch size={17} className="text-[#3a6f8f] shrink-0" />
          <div>
            <h1 className="text-lg font-bold leading-none text-gray-900 dark:text-white">All Batches</h1>
          </div>
        </div>
      </div>

      {/* ── Unified toolbar ───────────────────────────────────────────────── */}
      {/*
        All controls share the same text-xs font-medium baseline.
        Search anchors left; chips + sort form a right-of-divider group.
        gap-1.5 keeps the group tight; the divider gives it visual structure.
      */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">

        {/* Search — defines the height baseline for the toolbar */}
        <div className="relative min-w-[180px] flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search batches…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-7 pr-7 py-1.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-300 outline-none focus:border-[#3a6f8f] focus:ring-2 focus:ring-[#3a6f8f]/40 transition-all"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Vertical divider */}
        <div className="hidden sm:block h-4 w-px bg-gray-200 dark:bg-gray-700 shrink-0 mx-0.5" />

        {/* Status chips */}
        <div className="flex items-center gap-0.5">
          {(['all', 'in_progress', 'completed', 'pending', 'cancelled'] as const).map(key => {
            const count = chipCounts[key] ?? 0
            if (key !== 'all' && !count) return null
            const label = key === 'all' ? 'All' : STATUS_LABEL[key]
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStatus(key)}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  status === key
                    ? 'bg-[#3a6f8f] text-white font-semibold'
                    : 'font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {label} <span className="opacity-75 tabular-nums">({count})</span>
              </button>
            )
          })}
        </div>

        {/* Sort — appearance-none removes browser chrome; custom icon + border match search field */}
        <div className="relative ml-auto shrink-0">
          <select
            value={preset}
            onChange={e => applyPreset(e.target.value)}
            className="appearance-none rounded-md border border-gray-200/70 dark:border-gray-700/50 bg-transparent pl-2 pr-7 py-1 text-xs font-medium text-gray-400 dark:text-gray-500 outline-none focus:border-[#3a6f8f]/60 transition-colors cursor-pointer"
          >
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="product_name_asc">Product A→Z</option>
            <option value="quantity_desc">Qty (high → low)</option>
            {preset === '' && <option value="" disabled>Custom sort</option>}
          </select>
          <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
        </div>

      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/40 overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          {/*
            table-fixed: explicit column widths on th are enforced.
            Qty column gets a fixed width so tabular numbers align on the right edge.
          */}
          <table className="w-full text-sm table-fixed">
            <thead className="sticky top-0 z-10">
              {/*
                Header: bg-gray-100 / dark:#2e3c52 — noticeably lighter than body rows.
                border-b-2 at higher contrast anchors the grid visually.
                No 'uppercase' — labels display in natural case for readability.
              */}
              <tr className="border-b-2 border-gray-300 dark:border-gray-500 bg-gray-100 dark:bg-[#2e3c52] text-xs tracking-wide">

                {/*
                  Product — 24% keeps it from absorbing unused space.
                  Long names truncate; full value is in the title tooltip.
                */}
                <th className={`${thClass} w-[24%] pr-2 text-left`} onClick={() => toggleSort('product_name')}>
                  <span className="inline-flex items-center">
                    Product <SortIcon col="product_name" activeKey={sortKey} dir={sortDir} />
                  </span>
                </th>

                {/*
                  Batch ID — 17%; pl-2 closes the gap from Product, pr-2 keeps
                  the gutter to SKU symmetric so all three ID columns read as one group.
                */}
                <th className="w-[17%] pl-2 pr-2 py-2 text-left font-bold text-gray-700 dark:text-gray-100 font-mono">
                  Batch ID
                </th>

                {/* SKU — pl-2 matches Batch ID's right-gutter; pr-3 separates from data columns */}
                <th className={`${thClass} w-[15%] pl-2 pr-3 text-left`} onClick={() => toggleSort('sku')}>
                  <span className="inline-flex items-center">
                    SKU <SortIcon col="sku" activeKey={sortKey} dir={sortDir} />
                  </span>
                </th>

                {/* Status — 15%; stable width prevents label cramping */}
                <th className={`${thClass} w-[15%] text-left`} onClick={() => toggleSort('status')}>
                  <span className="inline-flex items-center">
                    Status <SortIcon col="status" activeKey={sortKey} dir={sortDir} />
                  </span>
                </th>

                {/* Qty — 11%; pr-5 gives numbers breathing room away from the Date column */}
                <th className={`${thClass} w-[11%] pl-3 pr-5 text-left`} onClick={() => toggleSort('quantity')}>
                  <span className="inline-flex items-center">
                    Qty (units) <SortIcon col="quantity" activeKey={sortKey} dir={sortDir} />
                  </span>
                </th>

                {/* Date — 14%; wide enough for full "Aug 4, 2026" at any size */}
                <th className={`${thClass} w-[14%] text-left`} onClick={() => toggleSort('date')}>
                  <span className="inline-flex items-center">
                    Date <SortIcon col="date" activeKey={sortKey} dir={sortDir} />
                  </span>
                </th>

                {/* Chevron — 4%; icon-only action affordance */}
                <th className="w-[4%] px-2 py-2" />

              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/40 bg-white dark:bg-gray-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400">
                    <Loader2 size={16} className="inline-block animate-spin mr-2 align-middle" />
                    Loading…
                  </td>
                </tr>
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
                    {query ? `No batches match "${query}"` : 'No batches found.'}
                  </td>
                </tr>
              ) : paged.map(b => (
                <tr
                  key={b.id}
                  tabIndex={0}
                  onClick={() => router.push(`/product-journey/${b.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); router.push(`/product-journey/${b.id}`) } }}
                  className="group cursor-pointer hover:bg-[rgba(58,111,143,0.07)] dark:hover:bg-[rgba(58,111,143,0.13)] hover:shadow-[inset_3px_0_0_rgba(58,111,143,0.4)] focus-visible:bg-[rgba(58,111,143,0.07)] dark:focus-visible:bg-[rgba(58,111,143,0.13)] focus-visible:outline-none transition-colors duration-150"
                >
                  {/* Product: primary scan target; tight right-pad to close gap to Batch ID */}
                  <td className="pl-3 pr-2 py-1.5">
                    <span
                      className="block truncate text-sm font-semibold text-gray-900 dark:text-white"
                      title={b.product_name}
                    >
                      {b.product_name}
                    </span>
                  </td>

                  {/* Batch ID: pl-2 pr-2 mirrors header — symmetric 16px gutter on each side of the ID group */}
                  <td className="pl-2 pr-2 py-1.5 font-mono text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap">
                    #{b.id.slice(-8)}
                  </td>

                  {/* SKU: pl-2 matches Batch ID right-gutter; pr-3 separates from data columns */}
                  <td className="pl-2 pr-3 py-1.5 font-mono text-xs text-gray-500 dark:text-gray-300 whitespace-nowrap">
                    {b.sku}
                  </td>

                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <StatusBadge status={b.status} />
                  </td>

                  {/* QTY: right-aligned; pr-5 mirrors header, keeps numbers off the Date column edge */}
                  <td className="pl-3 pr-5 py-1.5 text-left tabular-nums font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">
                    {b.quantity.toLocaleString()}
                  </td>

                  {/* Date: mid-contrast temporal context */}
                  <td className="px-3 py-1.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-300">
                    {fmtDate(b.created_at)}
                  </td>

                  {/* Row-open affordance — visible at rest (opacity-30) so rows feel clickable; full opacity on hover */}
                  <td className="px-2 py-1.5 text-right">
                    <ChevronRight
                      size={14}
                      className="inline-block opacity-30 group-hover:opacity-100 text-[#3a6f8f] dark:text-[#7ab3d0] transition-opacity duration-150"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ────────────────────────────────────────────────────── */}
      {!loading && totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="shrink-0 text-xs text-gray-400 dark:text-gray-500 tabular-nums">
            {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {filtered.length.toLocaleString()}
          </p>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="flex items-center gap-0.5 rounded-md border border-gray-200 dark:border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
            >
              <ChevronLeft size={13} /> Prev
            </button>

            {pageItems.map((n, i) =>
              n === '…' ? (
                <span key={`ell-${i}`} className="px-1 text-xs text-gray-300 dark:text-gray-600 select-none">…</span>
              ) : (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPage(n as number)}
                  className={`min-w-[28px] rounded-md border px-2 py-1 text-xs font-medium transition-colors duration-150 ${
                    page === n
                      ? 'border-[#3a6f8f]/30 bg-[#3a6f8f]/10 text-[#3a6f8f] dark:bg-[#3a6f8f]/20 dark:text-[#7ab3d0]'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}
                >
                  {n}
                </button>
              )
            )}

            <button
              type="button"
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="flex items-center gap-0.5 rounded-md border border-gray-200 dark:border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
