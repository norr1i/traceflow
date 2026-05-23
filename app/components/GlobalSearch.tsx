'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Package, Boxes, ClipboardList,
  ShoppingCart, X, CornerDownLeft,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'

// ── Types ──────────────────────────────────────────────────────────────────

type ResultCategory = 'products' | 'materials' | 'production' | 'sales'

type SearchResult = {
  id:       string
  category: ResultCategory
  title:    string
  subtitle: string
  route:    string
  score:    number
}

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORY_ORDER: ResultCategory[] = ['products', 'materials', 'production', 'sales']

const CATEGORY_ICON: Record<ResultCategory, React.ElementType> = {
  products:   Package,
  materials:  Boxes,
  production: ClipboardList,
  sales:      ShoppingCart,
}

const MAX_PER_CATEGORY = 4
const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS      = 200

// ── Relevance scoring ──────────────────────────────────────────────────────
// Prioritises: exact > starts-with > word-boundary start > contains
// Subtitle matches carry less weight so titles dominate the sort order.

function score(title: string, subtitle: string, q: string): number {
  const t = title.toLowerCase()
  const s = subtitle.toLowerCase()

  if (t === q)                  return 100
  if (t.startsWith(q))          return 80
  if (t.includes(` ${q}`))      return 60   // word-boundary inside title
  if (t.includes(q))            return 40

  if (s.startsWith(q))          return 25
  if (s.includes(q))            return 10

  return 0
}

// ── DB search ─────────────────────────────────────────────────────────────
// Fetch more than we need so client-side ranking can promote the best matches.

async function runSearch(q: string): Promise<SearchResult[]> {
  const [
    { data: products },
    { data: materials },
    { data: orders },
    { data: sales },
  ] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, sku')
      .or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
      .limit(12),
    supabase
      .from('raw_materials')
      .select('id, name, unit')
      .ilike('name', `%${q}%`)
      .limit(12),
    supabase
      .from('production_orders')
      .select('id, status, products(name, sku)')
      .ilike('id', `%${q}%`)
      .limit(8),
    supabase
      .from('sales')
      .select('id, customer_name, product_name, status')
      .or(`customer_name.ilike.%${q}%,product_name.ilike.%${q}%`)
      .limit(12),
  ])

  const results: SearchResult[] = []

  for (const p of products ?? []) {
    const title    = p.name
    const subtitle = p.sku ? `SKU ${p.sku}` : ''
    const s        = score(title, subtitle, q)
    if (s > 0) results.push({ id: `product-${p.id}`, category: 'products', title, subtitle, route: '/products', score: s })
  }

  for (const m of materials ?? []) {
    const title    = m.name
    const subtitle = m.unit ?? ''
    const s        = score(title, subtitle, q)
    if (s > 0) results.push({ id: `material-${m.id}`, category: 'materials', title, subtitle, route: '/raw-materials', score: s })
  }

  for (const o of orders ?? []) {
    const prod     = o.products as unknown as { name: string; sku: string } | null
    const title    = prod?.name ?? `Batch ${String(o.id).slice(0, 8)}`
    const subtitle = o.status.replace(/_/g, ' ')
    const s        = score(title, subtitle, q)
    if (s > 0) results.push({ id: `order-${o.id}`, category: 'production', title, subtitle, route: '/production', score: s })
  }

  for (const sv of sales ?? []) {
    const title    = sv.product_name ?? 'Sale'
    const subtitle = sv.customer_name ?? sv.status ?? ''
    const s        = score(title, subtitle, q)
    if (s > 0) results.push({ id: `sale-${sv.id}`, category: 'sales', title, subtitle, route: '/sales', score: s })
  }

  return results
}

// ── Ranked + grouped output ────────────────────────────────────────────────

function buildGroups(raw: SearchResult[]): Map<ResultCategory, SearchResult[]> {
  const grouped = new Map<ResultCategory, SearchResult[]>()
  for (const cat of CATEGORY_ORDER) grouped.set(cat, [])

  for (const r of raw) grouped.get(r.category)!.push(r)

  for (const [cat, items] of grouped) {
    grouped.set(cat, items.sort((a, b) => b.score - a.score).slice(0, MAX_PER_CATEGORY))
  }

  // Remove empty categories
  for (const [cat, items] of grouped) {
    if (items.length === 0) grouped.delete(cat)
  }

  return grouped
}

// ── Highlight ──────────────────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-[#4a8fb9] font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

type Props = { open: boolean; onClose: () => void }

export default function GlobalSearch({ open, onClose }: Props) {
  const router = useRouter()
  const { t }  = useT()

  const inputRef    = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [query,    setQuery]    = useState('')
  const [groups,   setGroups]   = useState<Map<ResultCategory, SearchResult[]>>(new Map())
  const [allFlat,  setAllFlat]  = useState<SearchResult[]>([])
  const [loading,  setLoading]  = useState(false)
  const [selected, setSelected] = useState(0)

  // Reset & focus on open
  useEffect(() => {
    if (open) {
      setQuery(''); setGroups(new Map()); setAllFlat([]); setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [open])

  // Scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < MIN_QUERY_LENGTH) {
      setGroups(new Map()); setAllFlat([]); setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const raw    = await runSearch(q.toLowerCase().trim())
        const grps   = buildGroups(raw)
        const flat: SearchResult[] = []
        for (const cat of CATEGORY_ORDER) {
          const items = grps.get(cat)
          if (items) flat.push(...items)
        }
        setGroups(grps)
        setAllFlat(flat)
        setSelected(0)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
  }, [])

  function handleChange(val: string) {
    setQuery(val)
    search(val)
  }

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    function handler(e: KeyboardEvent) {
      switch (e.key) {
        case 'Escape':    onClose(); break
        case 'ArrowDown': e.preventDefault(); setSelected(s => Math.min(s + 1, allFlat.length - 1)); break
        case 'ArrowUp':   e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); break
        case 'Enter':
          if (allFlat[selected]) { router.push(allFlat[selected].route); onClose() }
          break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, allFlat, selected, router, onClose])

  if (!open) return null

  const totalResults = allFlat.length
  const showEmpty    = query.length >= MIN_QUERY_LENGTH && !loading && totalResults === 0
  const showResults  = totalResults > 0

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Command palette */}
      <div className="fixed inset-x-4 top-[11vh] z-50 mx-auto max-w-xl">
        <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200/70 dark:border-white/[0.08] bg-white dark:bg-[#0C1018] shadow-2xl shadow-black/[0.22] dark:shadow-black/75">

          {/* ── Input row ── */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            {loading
              ? <span className="h-[15px] w-[15px] shrink-0 animate-spin rounded-full border-[1.5px] border-gray-300 dark:border-white/[0.14] border-t-[#4a8fb9]" />
              : <Search size={15} strokeWidth={1.75} className="shrink-0 text-gray-400 dark:text-[#4A5568]" />
            }
            <input
              ref={inputRef}
              value={query}
              onChange={e => handleChange(e.target.value)}
              placeholder={t('search.placeholder')}
              className="flex-1 bg-transparent text-[14px] text-gray-900 dark:text-[#E2E8F0] placeholder-gray-400 dark:placeholder-[#3D4758] outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex items-center gap-1.5 shrink-0">
              {query && (
                <button
                  onClick={() => handleChange('')}
                  className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-[#A8B3C0] transition-colors"
                >
                  <X size={11} />
                </button>
              )}
              <kbd className="rounded border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:text-[#3D4758] leading-none">
                esc
              </kbd>
            </div>
          </div>

          {/* ── Divider ── */}
          <div className="h-px bg-gray-100 dark:bg-white/[0.05]" />

          {/* ── Body ── */}
          <div className="max-h-[54vh] overflow-y-auto overscroll-contain">

            {/* No results */}
            {showEmpty && (
              <div className="flex flex-col items-center gap-1.5 py-12 text-center">
                <p className="text-[13px] font-medium text-gray-600 dark:text-[#8B9BAA]">{t('search.no_results')}</p>
                <p className="text-[12px] text-gray-400 dark:text-[#4A5568]">{t('search.no_results_sub')}</p>
              </div>
            )}

            {/* Results grouped by category */}
            {showResults && (
              <div className="py-2">
                {CATEGORY_ORDER.map(cat => {
                  const items = groups.get(cat)
                  if (!items?.length) return null
                  const Icon = CATEGORY_ICON[cat]
                  return (
                    <div key={cat} className="mb-1.5">
                      {/* Category header */}
                      <div className="flex items-center gap-2.5 px-4 py-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.10em] text-gray-400 dark:text-[#3D4758] whitespace-nowrap">
                          {t(`search.categories.${cat}`)}
                        </p>
                        <div className="h-px flex-1 bg-gray-100 dark:bg-white/[0.04]" />
                      </div>

                      {/* Result rows */}
                      {items.map(r => {
                        const idx        = allFlat.indexOf(r)
                        const isSelected = idx === selected
                        return (
                          <div
                            key={r.id}
                            ref={isSelected ? selectedRef : null}
                            onMouseEnter={() => setSelected(idx)}
                            onClick={() => { router.push(r.route); onClose() }}
                            className={`group flex cursor-pointer items-center gap-3 mx-2 px-3 py-2 rounded-lg transition-colors duration-75 ${
                              isSelected
                                ? 'bg-gray-100 dark:bg-white/[0.07]'
                                : 'hover:bg-gray-50 dark:hover:bg-white/[0.03]'
                            }`}
                          >
                            {/* Category icon */}
                            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                              isSelected
                                ? 'bg-white dark:bg-white/[0.09] text-gray-500 dark:text-[#8B9BAA]'
                                : 'bg-gray-100 dark:bg-white/[0.05] text-gray-400 dark:text-[#4A5568]'
                            }`}>
                              <Icon size={13} strokeWidth={1.75} />
                            </span>

                            {/* Title + subtitle */}
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0] truncate leading-[1.3]">
                                <Highlight text={r.title} query={query} />
                              </p>
                              {r.subtitle && (
                                <p className="text-[11px] text-gray-400 dark:text-[#4A5568] truncate leading-[1.3] mt-[1px]">
                                  <Highlight text={r.subtitle} query={query} />
                                </p>
                              )}
                            </div>

                            {/* Enter indicator — only when selected */}
                            {isSelected && (
                              <span className="shrink-0 flex items-center justify-center rounded-md border border-gray-200 dark:border-white/[0.09] bg-white dark:bg-white/[0.04] h-5 w-5 text-gray-400 dark:text-[#525563]">
                                <CornerDownLeft size={10} />
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="flex items-center justify-between border-t border-gray-100 dark:border-white/[0.05] px-4 py-2">
            <p className="text-[10.5px] text-gray-400 dark:text-[#3D4758]">
              {showResults
                ? `${totalResults} ${t('search.results')}`
                : t('search.hint')
              }
            </p>
            <div className="flex items-center gap-2 text-[10.5px] text-gray-300 dark:text-[#2D3748]">
              <span>↑↓</span>
              <span className="text-gray-200 dark:text-[#232B38]">·</span>
              <span>↵</span>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
