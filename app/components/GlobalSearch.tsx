'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Package, Boxes, ClipboardList, ShieldCheck, ShoppingCart, X, CornerDownLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'

type ResultCategory = 'products' | 'materials' | 'production' | 'quality' | 'sales'

type SearchResult = {
  id: string
  category: ResultCategory
  title: string
  subtitle: string
  route: string
}

const CATEGORY_ICON: Record<ResultCategory, React.ElementType> = {
  products:   Package,
  materials:  Boxes,
  production: ClipboardList,
  quality:    ShieldCheck,
  sales:      ShoppingCart,
}

async function runSearch(q: string): Promise<SearchResult[]> {
  const term = q.trim()
  if (!term) return []

  const [
    { data: products },
    { data: materials },
    { data: orders },
    { data: sales },
  ] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, sku')
      .or(`name.ilike.%${term}%,sku.ilike.%${term}%`)
      .limit(5),
    supabase
      .from('raw_materials')
      .select('id, name, unit')
      .ilike('name', `%${term}%`)
      .limit(5),
    supabase
      .from('production_orders')
      .select('id, status, products(name, sku)')
      .ilike('id', `%${term}%`)
      .limit(4),
    supabase
      .from('sales')
      .select('id, customer_name, product_name, status')
      .or(`customer_name.ilike.%${term}%,product_name.ilike.%${term}%`)
      .limit(4),
  ])

  const results: SearchResult[] = []

  for (const p of products ?? []) {
    results.push({
      id:       `product-${p.id}`,
      category: 'products',
      title:    p.name,
      subtitle: `SKU: ${p.sku}`,
      route:    '/products',
    })
  }

  for (const m of materials ?? []) {
    results.push({
      id:       `material-${m.id}`,
      category: 'materials',
      title:    m.name,
      subtitle: m.unit,
      route:    '/raw-materials',
    })
  }

  for (const o of orders ?? []) {
    const prod = o.products as unknown as { name: string; sku: string } | null
    results.push({
      id:       `order-${o.id}`,
      category: 'production',
      title:    prod?.name ?? `Batch ${String(o.id).slice(0, 8)}`,
      subtitle: `${o.status} · ${String(o.id).slice(0, 12)}…`,
      route:    '/production',
    })
  }

  for (const s of sales ?? []) {
    results.push({
      id:       `sale-${s.id}`,
      category: 'sales',
      title:    s.product_name ?? 'Sale',
      subtitle: s.customer_name ?? s.status,
      route:    '/sales',
    })
  }

  return results
}

type Props = { open: boolean; onClose: () => void }

export default function GlobalSearch({ open, onClose }: Props) {
  const router = useRouter()
  const { t }  = useT()

  const inputRef    = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState<SearchResult[]>([])
  const [loading,  setLoading]  = useState(false)
  const [selected, setSelected] = useState(0)

  // Reset + focus on open
  useEffect(() => {
    if (open) {
      setQuery(''); setResults([]); setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [open])

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setResults([]); setLoading(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await runSearch(q)
        setResults(res)
        setSelected(0)
      } finally {
        setLoading(false)
      }
    }, 180)
  }, [])

  function handleChange(q: string) {
    setQuery(q)
    search(q)
  }

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape')    { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
      if (e.key === 'Enter' && results[selected]) {
        router.push(results[selected].route)
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, results, selected, router, onClose])

  if (!open) return null

  // Group by category preserving order
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    ;(acc[r.category] ??= []).push(r)
    return acc
  }, {})

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[3px]"
        onClick={onClose}
      />

      {/* Palette */}
      <div className="fixed inset-x-4 top-[12vh] z-50 mx-auto max-w-2xl">
        <div className="overflow-hidden rounded-2xl border border-gray-200/80 dark:border-white/[0.09] bg-white dark:bg-[#0D1219] shadow-2xl shadow-black/[0.18] dark:shadow-black/70">

          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-gray-100 dark:border-white/[0.06] px-4 py-3.5">
            <Search size={15} className="shrink-0 text-gray-400 dark:text-[#525563]" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => handleChange(e.target.value)}
              placeholder={t('search.placeholder')}
              className="flex-1 bg-transparent text-[14px] text-gray-900 dark:text-[#E2E8F0] placeholder-gray-400 dark:placeholder-[#525563] outline-none"
            />
            {loading && (
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-gray-200 dark:border-white/[0.12] border-t-transparent dark:border-t-transparent" />
            )}
            <button
              onClick={onClose}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-gray-200 dark:border-white/[0.08] text-gray-400 hover:text-gray-600 dark:hover:text-[#A8B3C0] transition-colors"
            >
              <X size={11} />
            </button>
          </div>

          {/* Results area */}
          <div className="max-h-[56vh] overflow-y-auto overscroll-contain">
            {!query ? (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-1">
                <Search size={18} className="text-gray-300 dark:text-[#2D3340] mb-1" strokeWidth={1.5} />
                <p className="text-[12px] text-gray-400 dark:text-[#525563]">{t('search.hint')}</p>
              </div>
            ) : !loading && results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-1">
                <p className="text-[13px] font-medium text-gray-600 dark:text-[#8B9BAA]">{t('search.no_results')}</p>
                <p className="text-[11.5px] text-gray-400 dark:text-[#525563]">{t('search.no_results_sub')}</p>
              </div>
            ) : (
              <div className="py-1.5">
                {Object.entries(grouped).map(([cat, items]) => (
                  <div key={cat}>
                    <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.10em] text-gray-400 dark:text-[#3D4451]">
                      {t(`search.categories.${cat}`)}
                    </p>
                    {items.map(r => {
                      const globalIdx = results.indexOf(r)
                      const isSelected = globalIdx === selected
                      const Icon = CATEGORY_ICON[r.category]
                      return (
                        <div
                          key={r.id}
                          onMouseEnter={() => setSelected(globalIdx)}
                          onClick={() => { router.push(r.route); onClose() }}
                          className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors duration-75 ${
                            isSelected
                              ? 'bg-gray-50 dark:bg-white/[0.05]'
                              : 'hover:bg-gray-50/70 dark:hover:bg-white/[0.025]'
                          }`}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-[#525563]">
                            <Icon size={13} strokeWidth={1.75} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-gray-900 dark:text-[#E2E8F0] truncate">{r.title}</p>
                            <p className="text-[11px] text-gray-400 dark:text-[#525563] truncate">{r.subtitle}</p>
                          </div>
                          {isSelected && (
                            <span className="shrink-0 flex items-center gap-0.5 rounded border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-gray-400 dark:text-[#525563]">
                              <CornerDownLeft size={9} /> open
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 dark:border-white/[0.05] px-4 py-2">
            <p className="text-[10.5px] text-gray-400 dark:text-[#3D4451]">{t('search.hint')}</p>
          </div>

        </div>
      </div>
    </>
  )
}
