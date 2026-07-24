'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Product } from '../types/traceflow'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import CsvImportModal, { type CsvFieldDef, type ImportResult } from '../components/CsvImportModal'
import {
  Plus, Pencil, Trash2, X, Check, AlertTriangle, Package,
  Upload, GitBranch, Search, ChevronUp, ChevronDown, ChevronsUpDown, MoreHorizontal,
} from 'lucide-react'
import PaginationBar from '../components/PaginationBar'

const PAGE_SIZE = 50
import { useAuth, useRole } from '../lib/auth-context'
import { canEdit } from '../lib/permissions'
import { logActivity, actorName } from '../lib/activity'
import { useT, fmtNum, type Lang } from '../lib/i18n'

// ── Types ─────────────────────────────────────────────────────────────────────

type SortCol = 'name' | 'sku' | 'created_at'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCreated(iso: string, lang: Lang): string {
  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB'
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

// Strip PostgREST filter metacharacters from user input before interpolation.
function sanitizeSearch(s: string): string {
  return s.trim().replace(/[^\w\s\-.]/g, '')
}

// ── Sort indicator ─────────────────────────────────────────────────────────────

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return <ChevronsUpDown size={11} className="ml-0.5 shrink-0 opacity-30" />
  return asc
    ? <ChevronUp   size={11} className="ml-0.5 shrink-0 text-[#3a6f8f]" />
    : <ChevronDown size={11} className="ml-0.5 shrink-0 text-[#3a6f8f]" />
}

// ── Status indicator ──────────────────────────────────────────────────────────

function StatusDot({ status }: { status: 'recall' | 'qc' | 'healthy' | undefined }) {
  if (!status) return <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
  if (status === 'recall') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500 dark:bg-red-400" />
      Recall
    </span>
  )
  if (status === 'qc') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
      QC Issue
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-500">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-400" />
      Healthy
    </span>
  )
}

// ── Constants ─────────────────────────────────────────────────────────────────

const empty = { name: '', sku: '', description: '' }

const PRODUCT_FIELDS: CsvFieldDef[] = [
  { key: 'name',        label: 'Name',        required: true  },
  { key: 'sku',         label: 'SKU',         required: true  },
  { key: 'description', label: 'Description', required: false },
]

const PRODUCT_SAMPLE_ROWS = [
  { name: 'Steel Bolt M8',    sku: 'BOLT-M8-001',  description: 'High-strength steel bolt' },
  { name: 'Aluminum Bracket', sku: 'BRKT-AL-002',  description: 'Mounting bracket' },
]

// ── Row overflow menu ─────────────────────────────────────────────────────────

function ProductRowMenu({
  canWrite,
  onEdit,
  onDelete,
}: {
  canWrite: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-[#262E36]/55 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="absolute end-0 z-10 mt-1 w-44 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-white dark:bg-[#141e28] shadow-lg overflow-hidden">
          {canWrite && (
            <>
              <button
                onClick={() => { onEdit(); setOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#262E36]/55 transition-colors"
              >
                <Pencil size={13} /> Edit Product
              </button>
              <button
                onClick={() => { onDelete(); setOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 size={13} /> Delete Product
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProductsClient() {
  const toast     = useToast()
  const confirm   = useConfirm()
  const role      = useRole()
  const { user, companyId } = useAuth()
  const canWrite  = canEdit(role, 'products')
  const { t, lang } = useT()

  // Data
  const [products,      setProducts]      = useState<Product[]>([])
  const [loading,       setLoading]       = useState(true)
  const [page,          setPage]          = useState(1)
  const [totalCount,    setTotalCount]    = useState(0)
  const [orderMap,      setOrderMap]      = useState<Record<string, string>>({})
  const [batchCountMap,    setBatchCountMap]    = useState<Record<string, number>>({})
  const [productStatusMap, setProductStatusMap] = useState<Record<string, 'recall' | 'qc' | 'healthy'>>({})

  // Search + sort
  const [searchInput, setSearchInput] = useState('')
  const [search,      setSearch]      = useState('')
  const [sortCol,     setSortCol]     = useState<SortCol>('created_at')
  const [sortAsc,     setSortAsc]     = useState(false)

  // Form / modals
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const [showForm,   setShowForm]   = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editing,    setEditing]    = useState<Product | null>(null)
  const [form,       setForm]       = useState(empty)
  const [saving,     setSaving]     = useState(false)
  const [formError,  setFormError]  = useState<string | null>(null)

  // ── Data loading ───────────────────────────────────────────────────────────

  // setPage is included so callers don't need to call it separately.
  const loadPage = (pageNum: number, s = search, col = sortCol, asc = sortAsc) => {
    if (!companyId) return
    setPage(pageNum)
    setLoading(true)
    const offset = (pageNum - 1) * PAGE_SIZE
    const safe = sanitizeSearch(s)

    const base = supabase
      .from('products')
      .select('*', { count: 'exact' })
      .eq('company_id', companyId)
      .order(col, { ascending: asc })
      .range(offset, offset + PAGE_SIZE - 1)

    ;(safe ? base.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`) : base)
      .then(({ data, count }) => {
        setProducts(data ?? [])
        setTotalCount(count ?? 0)
        setLoading(false)
      })
  }

  // ── Debounce search input ──────────────────────────────────────────────────

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Re-fetch page 1 whenever debounced search term changes
  useEffect(() => { loadPage(1, search, sortCol, sortAsc) }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadPage(1) }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build orderMap, batchCountMap, and productStatusMap in one async effect.
  // Queries: production_orders → active recalls → failed qc_results (parallel).
  useEffect(() => {
    if (!companyId) return
    const run = async () => {
      const { data: orders } = await supabase
        .from('production_orders')
        .select('id, product_id')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })

      const map: Record<string, string>          = {}
      const counts: Record<string, number>       = {}
      const orderToProduct: Record<string, string> = {}

      for (const row of (orders ?? []) as { id: string; product_id: string }[]) {
        if (!row.product_id) continue
        if (!map[row.product_id]) map[row.product_id] = row.id
        counts[row.product_id] = (counts[row.product_id] ?? 0) + 1
        orderToProduct[row.id] = row.product_id
      }

      setOrderMap(map)
      setBatchCountMap(counts)

      const allOrderIds = Object.keys(orderToProduct)

      const [recallRes, qcRes] = await Promise.all([
        supabase
          .from('recalls')
          .select('product_id')
          .eq('company_id', companyId)
          .neq('status', 'closed')
          .not('product_id', 'is', null),
        allOrderIds.length > 0
          ? supabase
              .from('qc_results')
              .select('production_order_id')
              .in('production_order_id', allOrderIds)
              .eq('passed', false)
          : Promise.resolve({ data: [] as { production_order_id: string }[] }),
      ])

      const recallIds = new Set(
        (recallRes.data ?? []).map((r: { product_id: string }) => r.product_id)
      )
      const qcFailedProductIds = new Set(
        (qcRes.data ?? [])
          .map((r: { production_order_id: string }) => orderToProduct[r.production_order_id])
          .filter(Boolean)
      )

      const statusMap: Record<string, 'recall' | 'qc' | 'healthy'> = {}
      for (const pid of Object.keys(counts)) {
        statusMap[pid] = recallIds.has(pid) ? 'recall'
          : qcFailedProductIds.has(pid) ? 'qc'
          : 'healthy'
      }
      setProductStatusMap(statusMap)
    }
    run()
  }, [companyId])

  // ── Sort ──────────────────────────────────────────────────────────────────

  function handleSortClick(col: SortCol) {
    const newAsc = col === sortCol ? !sortAsc : col !== 'created_at'
    setSortCol(col)
    setSortAsc(newAsc)
    loadPage(1, search, col, newAsc)
  }

  // ── Form handlers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null)
    setForm(empty)
    setFormError(null)
    setShowForm(true)
  }

  function openEdit(p: Product) {
    setEditing(p)
    setForm({ name: p.name, sku: p.sku, description: p.description ?? '' })
    setFormError(null)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setFormError(null)
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)

    if (editing) {
      const { data, error: err } = await supabase
        .from('products')
        .update({ name: form.name, sku: form.sku, description: form.description })
        .eq('id', editing.id)
        .eq('company_id', companyId ?? '')
        .select()
        .single()

      if (err) { setFormError(err.message); toast.error(t('products.error_update')); setSaving(false); return }
      setProducts((prev) => prev.map((p) => (p.id === editing.id ? data : p)))
      toast.success(t('products.updated_toast'))
    } else {
      const { data, error: err } = await supabase
        .from('products')
        .insert([{ name: form.name, sku: form.sku, description: form.description, company_id: companyId }])
        .select()
        .single()

      if (err) { setFormError(err.message); toast.error(t('products.error_create')); setSaving(false); return }
      setProducts((prev) => [data, ...prev])
      toast.success(t('products.created_toast'))
      if (companyId) logActivity({
        companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'product.created', entityType: 'product', entityId: data.id,
        message: `${actorName(user?.email)} added product ${data.name}`,
      }).catch(err => console.error('[logActivity] product.created failed:', err))
    }

    setSaving(false)
    setShowForm(false)
    setForm(empty)
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: t('products.delete_title'),
      message: t('products.delete_message'),
      confirmLabel: t('common.delete'),
    })
    if (!ok) return

    const { error: err } = await supabase.from('products').delete().eq('id', id).eq('company_id', companyId ?? '')
    if (err) { toast.error(err.message); return }
    setProducts((prev) => prev.filter((p) => p.id !== id))
    toast.success(t('products.deleted_toast'))
    if (companyId) logActivity({
      companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType: 'product.deleted', entityType: 'product', entityId: id,
      message: `${actorName(user?.email)} deleted a product`,
    }).catch(err => console.error('[logActivity] product.deleted failed:', err))
  }

  async function handleProductImport(rows: Record<string, string>[]): Promise<ImportResult> {
    const { data: existing } = await supabase.from('products').select('sku').eq('company_id', companyId ?? '')
    const existingSkus = new Set((existing ?? []).map((r) => r.sku.toLowerCase()))
    const toInsert = rows.filter((r) => !existingSkus.has(r.sku.toLowerCase()))
    const skipped  = rows.length - toInsert.length

    if (toInsert.length === 0) return { inserted: 0, skipped, errors: [] }

    const payload = toInsert.map((r) => ({
      name: r.name, sku: r.sku, description: r.description || null, company_id: companyId,
    }))

    const { data, error: err } = await supabase.from('products').insert(payload).select()
    if (err) return { inserted: 0, skipped, errors: [err.message] }

    const inserted = data?.length ?? 0
    setProducts((prev) => [...(data ?? []), ...prev])
    if (inserted > 0) {
      toast.success(t(inserted !== 1 ? 'products.count_plural' : 'products.count', { n: fmtNum(inserted, lang) }))
      if (companyId) logActivity({
        companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'product.imported', entityType: 'product',
        message: `${actorName(user?.email)} imported ${inserted} product${inserted !== 1 ? 's' : ''}`,
        metadata: { count: inserted, skipped },
      }).catch(err => console.error('[logActivity] product.imported failed:', err))
    }
    return { inserted, skipped, errors: [] }
  }

  // Destination for Journey button and clickable product name
  const journeyHref = (p: Product) =>
    orderMap[p.id]
      ? `/product-journey/${orderMap[p.id]}`
      : `/product-journey?q=${encodeURIComponent(p.sku)}`

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Import modal */}
      {showImport && (
        <CsvImportModal
          title={t('products.import_title')}
          fields={PRODUCT_FIELDS}
          sampleFilename="products_template.csv"
          sampleRows={PRODUCT_SAMPLE_ROWS}
          onClose={() => setShowImport(false)}
          onImport={handleProductImport}
        />
      )}

      {/* Edit / Create modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] dark:backdrop-blur-xl p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editing ? t('products.edit') : t('products.new')}
              </h2>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('common.name')}</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  placeholder={t('products.name_placeholder')}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('common.sku')}</label>
                <input
                  required
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  placeholder={t('products.sku_placeholder')}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('common.description')}</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  placeholder={t('products.desc_placeholder')}
                />
              </div>

              {formError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                  <AlertTriangle size={14} className="shrink-0" />
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-gray-700"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] disabled:opacity-60"
                >
                  <Check size={15} />
                  {saving ? t('common.saving') : editing ? t('common.update') : t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center gap-3">
        {/* Left zone: count label anchored to search */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <p className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
            {t(totalCount !== 1 ? 'products.count_plural' : 'products.count', { n: fmtNum(totalCount, lang) })}
          </p>

          <div className="relative min-w-[180px] flex-1 max-w-xs">
            <Search
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('products.search_placeholder')}
              className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-white dark:bg-[#262E36]/55 py-2 pl-8 pr-7 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/30 focus:border-[#4a7fa5]/50 transition-colors"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                aria-label={t('products.clear_search')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Right zone: Import CSV + Add Product */}
        {canWrite && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-transparent px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/55 transition-colors"
            >
              <Upload size={14} />
              {t('common.import_csv')}
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] transition-colors"
            >
              <Plus size={15} />
              {t('products.add')}
            </button>
          </div>
        )}
      </div>

      {/* ── Table card ─────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm">

        {/* Initial skeleton — only when loading with no existing data */}
        {loading && products.length === 0 ? (
          <div className="divide-y divide-gray-100 dark:divide-[#B3B7BA]/[0.07]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="h-3.5 w-44 animate-pulse rounded bg-gray-200 dark:bg-[#262E36]/55" />
                <div className="h-3.5 w-28 animate-pulse rounded bg-gray-200 dark:bg-[#262E36]/55" />
                <div className="ms-auto h-3.5 w-20 animate-pulse rounded bg-gray-200 dark:bg-[#262E36]/55" />
              </div>
            ))}
          </div>

        ) : products.length === 0 ? (
          /* Empty or no-results */
          searchInput.trim() ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Search size={32} className="mb-3 text-gray-300 dark:text-gray-600" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('products.no_results')}
              </p>
              <button
                onClick={() => setSearchInput('')}
                className="mt-2 text-xs text-[#3a6f8f] dark:text-[#7ab3d0] hover:underline"
              >
                {t('products.clear_search')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
              <Package size={40} className="mb-3 opacity-40" />
              <p className="text-sm font-medium">{t('products.empty')}</p>
              <p className="mt-1 text-xs">{t('products.empty_sub')}</p>
            </div>
          )

        ) : (
          /* Table — dim during background reloads */
          <div className={`overflow-x-auto transition-opacity duration-150 ${loading ? 'opacity-60' : 'opacity-100'}`}>
            <table className="w-full min-w-[720px] text-sm">

              <thead className="border-b border-[#B3B7BA]/30 dark:border-[#B3B7BA]/[0.08] bg-[#D1CFC9]/50 dark:bg-[#1e2730]/60 text-xs text-gray-500 dark:text-gray-400">
                <tr>
                  {/* Name — sortable */}
                  <th
                    className="cursor-pointer select-none pl-6 pr-4 py-2 text-start font-medium hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    onClick={() => handleSortClick('name')}
                  >
                    <span className="inline-flex items-center">
                      {t('common.name')}
                      <SortIcon active={sortCol === 'name'} asc={sortAsc} />
                    </span>
                  </th>

                  {/* SKU — sortable */}
                  <th
                    className="w-36 cursor-pointer select-none px-4 py-2 text-start font-medium hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    onClick={() => handleSortClick('sku')}
                  >
                    <span className="inline-flex items-center">
                      SKU
                      <SortIcon active={sortCol === 'sku'} asc={sortAsc} />
                    </span>
                  </th>

                  {/* Batches */}
                  <th className="w-20 px-4 py-2 text-center font-medium">
                    {t('products.batches')}
                  </th>

                  {/* Status */}
                  <th className="w-24 px-4 py-2 text-start font-medium">
                    {t('common.status')}
                  </th>

                  {/* Created — sortable */}
                  <th
                    className="hidden w-32 cursor-pointer select-none px-4 py-2 text-start font-medium hover:text-gray-700 dark:hover:text-gray-200 transition-colors sm:table-cell"
                    onClick={() => handleSortClick('created_at')}
                  >
                    <span className="inline-flex items-center">
                      {t('common.created')}
                      <SortIcon active={sortCol === 'created_at'} asc={sortAsc} />
                    </span>
                  </th>

                  {/* Actions */}
                  <th className="w-px whitespace-nowrap px-4 py-2 text-start font-medium">{t('common.actions')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100 dark:divide-[#B3B7BA]/[0.07]">
                {products.map((p) => {
                  const dest    = journeyHref(p)
                  const batches = batchCountMap[p.id] ?? 0
                  return (
                    <tr
                      key={p.id}
                      className="align-middle transition-colors hover:bg-[#D1CFC9]/40 dark:hover:bg-white/[0.04]"
                    >
                      {/* Name — plain text; Journey button is the single navigation action */}
                      <td className="max-w-[200px] pl-6 pr-4 py-1.5 font-medium text-gray-900 dark:text-white">
                        <span title={p.name} className="block truncate">
                          {p.name}
                        </span>
                      </td>

                      {/* SKU — monospace, no-wrap */}
                      <td className="w-36 px-4 py-1.5">
                        <span className="inline-block whitespace-nowrap rounded-md bg-gray-100 dark:bg-[#262E36]/55 px-2 py-0.5 font-mono text-xs text-gray-600 dark:text-gray-400">
                          {p.sku}
                        </span>
                      </td>

                      {/* Batch count */}
                      <td className="w-20 px-4 py-1.5 text-center">
                        <span className={`text-sm font-medium tabular-nums ${
                          batches > 0
                            ? 'text-gray-700 dark:text-gray-300'
                            : 'text-gray-300 dark:text-gray-600'
                        }`}>
                          {batches}
                        </span>
                      </td>

                      {/* Status — health indicator from recall + QC data */}
                      <td className="w-24 px-4 py-1.5">
                        <StatusDot status={productStatusMap[p.id]} />
                      </td>

                      {/* Created — unambiguous format */}
                      <td className="hidden w-32 whitespace-nowrap px-4 py-1.5 text-xs text-gray-400 dark:text-gray-500 sm:table-cell">
                        {fmtCreated(p.created_at, lang)}
                      </td>

                      {/* Actions */}
                      <td className="w-px whitespace-nowrap px-4 py-1.5">
                        <div className="flex items-center gap-1">
                          <a
                            href={dest}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#262E36]/55 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                          >
                            <GitBranch size={13} />
                            {t('products.open_journey')}
                          </a>
                          {canWrite && (
                            <ProductRowMenu
                              canWrite={canWrite}
                              onEdit={() => openEdit(p)}
                              onDelete={() => handleDelete(p.id)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPage={(p) => loadPage(p)}
        />
      </div>
    </>
  )
}
