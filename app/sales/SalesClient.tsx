'use client'

import { useSales, SaleFormData } from '../hooks/useSales'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import {
  ShoppingCart, TrendingUp, Package, AlertTriangle, Search,
  Plus, ChevronDown, Banknote, Upload, X, Trash2, MoreHorizontal, Eye, Ban,
} from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import CsvImportModal, { type CsvFieldDef, type ImportResult } from '../components/CsvImportModal'
import PaginationBar from '../components/PaginationBar'
import { SALES_PAGE_SIZE } from '../hooks/useSales'
import { useAuth, useRole } from '../lib/auth-context'
import { canEdit } from '../lib/permissions'
import { logActivity, actorName } from '../lib/activity'
import { useT, fmtNum } from '../lib/i18n'
import { Tooltip } from '../components/Tooltip'

// ── KPI card — neutral design matching the app's standard language ────────────

function StatCard({
  label, value, icon: Icon, bgCls, iconCls, sub, tooltip,
}: {
  label: string; value: string | number; icon: React.ElementType
  bgCls: string; iconCls: string; sub?: string; tooltip?: string
}) {
  return (
    <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
          <Tooltip content={tooltip}>
            <p
              className="mt-1 truncate text-xl font-bold leading-none tabular-nums tracking-tight text-gray-900 dark:text-white"
              tabIndex={tooltip ? 0 : undefined}
            >
              {value}
            </p>
          </Tooltip>
          {sub && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
        </div>
        <span className={`ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${bgCls}`}>
          <Icon size={17} className={iconCls} />
        </span>
      </div>
    </div>
  )
}

// ── Constants ─────────────────────────────────────────────────────────────────

const emptyForm: SaleFormData = {
  product_name: '', customer_name: '', quantity: 1, unit_price: 0, total_price: 0, status: 'completed',
}

// Light/dark compatible form field — matches QC modal pattern
const formFieldClass =
  'w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] ' +
  'bg-[#F1EFEC] dark:bg-[#262E36]/55 ' +
  'px-3 py-2 text-sm text-gray-900 dark:text-white ' +
  'placeholder-gray-400 dark:placeholder-gray-500 ' +
  'focus:outline-none focus:ring-2 focus:ring-[#4a7fa5] transition-colors'

const SALE_FIELDS: CsvFieldDef[] = [
  { key: 'product_name',  label: 'Product Name',  required: true,  type: 'string' },
  { key: 'customer_name', label: 'Customer Name',  required: false, type: 'string' },
  { key: 'quantity',      label: 'Quantity',       required: true,  type: 'number' },
  { key: 'unit_price',    label: 'Unit Price',     required: true,  type: 'number' },
  { key: 'total_price',   label: 'Total Price',    required: false, type: 'number' },
  { key: 'status',        label: 'Status',         required: false, type: 'string' },
  { key: 'sold_at',       label: 'Sale Date',      required: false, type: 'string' },
]

const SALE_SAMPLE_ROWS = [
  { product_name: 'Steel Bolt M8', customer_name: 'Acme Corp', quantity: '100', unit_price: '5.50', total_price: '550', status: 'completed', sold_at: '2026-01-15' },
  { product_name: 'Aluminum Bracket', customer_name: '', quantity: '50', unit_price: '12', total_price: '600', status: 'pending', sold_at: '2026-01-20' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSaleNumber(id: string, soldAt: string): string {
  const year = new Date(soldAt).getFullYear()
  const hash = parseInt(id.replace(/-/g, '').slice(0, 8), 16) % 1_000_000
  return `SO-${year}-${String(hash).padStart(6, '0')}`
}

// ── Row overflow menu ─────────────────────────────────────────────────────────

function SaleRowMenu({
  saleId, canWrite, onVoid, onDelete, t,
}: {
  saleId: string; canWrite: boolean; onVoid: () => void; onDelete: () => void; t: (k: string) => string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const itemCls = 'flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#262E36]/55 transition-colors'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className="rounded-lg p-1.5 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-[#262E36]/55 transition-colors"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="absolute end-0 z-10 mt-1 w-44 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-white dark:bg-[#141e28] shadow-lg overflow-hidden">
          <button
            className={itemCls}
            onClick={(e) => { e.stopPropagation(); setOpen(false); router.push(`/sales/${saleId}`) }}
          >
            <Eye size={14} />
            {t('common.view')}
          </button>
          {canWrite && (
            <>
              <div className="mx-3 my-1 h-px bg-gray-100 dark:bg-[#B3B7BA]/[0.10]" />
              <button
                className={itemCls}
                onClick={(e) => { e.stopPropagation(); setOpen(false); onVoid() }}
              >
                <Ban size={14} />
                {t('sales.void_sale')}
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete() }}
              >
                <Trash2 size={14} />
                {t('common.delete')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SalesClient() {
  const toast    = useToast()
  const confirm  = useConfirm()
  const role     = useRole()
  const { user, companyId } = useAuth()
  const canWrite = canEdit(role, 'sales')
  const {
    sales, metrics, loading, error, refetch, createSale, deleteSale,
    page, totalCount, totalPages, goToPage,
  } = useSales()
  const { t, lang } = useT()

  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy]             = useState<'sold_at' | 'total_price'>('sold_at')
  const [showForm, setShowForm]         = useState(false)
  const [showImport, setShowImport]     = useState(false)
  const [form, setForm]                 = useState<SaleFormData>(emptyForm)
  const [saving, setSaving]             = useState(false)
  const [formError, setFormError]       = useState<string | null>(null)

  const router = useRouter()

  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'

  function fmt(n: number) {
    return lang === 'ar'
      ? `${fmtNum(n, lang, { maximumFractionDigits: 0 })} ر.س`
      : `${fmtNum(n, lang, { maximumFractionDigits: 0 })} SAR`
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function fmtCell(n: number) {
    return fmtNum(n, lang, { maximumFractionDigits: 0 })
  }

  function openNew() { setForm(emptyForm); setFormError(null); setShowForm(true) }

  function handleQtyOrPrice(next: Partial<SaleFormData>) {
    setForm((prev) => {
      const merged = { ...prev, ...next }
      return { ...merged, total_price: merged.quantity * merged.unit_price }
    })
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true); setFormError(null)
    const result = await createSale(form)
    setSaving(false)
    if (!result) {
      setFormError(t('sales.error_save'))
      toast.error(t('sales.error_create'))
      return
    }
    setShowForm(false)
    toast.success(t('sales.created_toast'))
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType: 'sale.created', entityType: 'sale', entityId: result.id,
      message: `${actorName(user?.email)} recorded a sale for ${form.product_name}`,
      metadata: { quantity: form.quantity, total_price: form.total_price },
    }).catch(err => console.error('[logActivity] sale.created failed:', err))
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: t('sales.delete_title'),
      message: t('sales.delete_message'),
      confirmLabel: t('common.delete'),
    })
    if (!ok) return
    const result = await deleteSale(id)
    if (result) {
      toast.success(t('sales.deleted_toast'))
      if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'sale.deleted', entityType: 'sale', entityId: id,
        message: `${actorName(user?.email)} deleted a sale record`,
      }).catch(err => console.error('[logActivity] sale.deleted failed:', err))
    } else {
      toast.error(t('sales.error_delete'))
    }
  }

  async function handleSaleImport(rows: Record<string, string>[]): Promise<ImportResult> {
    const payload = rows.map((r) => ({
      product_name:  r.product_name,
      customer_name: r.customer_name || null,
      quantity:      Number(r.quantity),
      unit_price:    Number(r.unit_price),
      total_price:   r.total_price ? Number(r.total_price) : Number(r.quantity) * Number(r.unit_price),
      status:        r.status || 'completed',
      sold_at:       r.sold_at || new Date().toISOString(),
    }))

    const scopedPayload = payload.map(r => ({ ...r, company_id: companyId }))
    const { data, error: err } = await supabase.from('sales').insert(scopedPayload).select()
    if (err) return { inserted: 0, skipped: 0, errors: [err.message] }

    const inserted = data?.length ?? 0
    if (inserted > 0) {
      toast.success(t(inserted !== 1 ? 'sales.import_n_plural' : 'sales.import_n', { n: fmtNum(inserted, lang) }))
      if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'sale.imported', entityType: 'sale',
        message: `${actorName(user?.email)} imported ${inserted} sale${inserted !== 1 ? 's' : ''}`,
        metadata: { count: inserted },
      }).catch(err => console.error('[logActivity] sale.imported failed:', err))
      refetch()
    }
    return { inserted, skipped: 0, errors: [] }
  }

  async function handleVoid(id: string) {
    const ok = await confirm({
      title: t('sales.void_title'),
      message: t('sales.void_message'),
      confirmLabel: t('sales.void_confirm'),
    })
    if (!ok) return
    const { error: err } = await supabase
      .from('sales')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('company_id', companyId)
    if (err) {
      toast.error(t('sales.error_void'))
    } else {
      toast.success(t('sales.voided_toast'))
      refetch()
    }
  }

  const filtered = sales
    .filter((s) => {
      const matchSearch =
        search === '' ||
        s.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
        s.product_name?.toLowerCase().includes(search.toLowerCase()) ||
        s.id?.toLowerCase().includes(search.toLowerCase())
      const matchStatus = statusFilter === 'all' || s.status?.toLowerCase() === statusFilter
      return matchSearch && matchStatus
    })
    .sort((a, b) => {
      if (sortBy === 'total_price') return (b.total_price ?? 0) - (a.total_price ?? 0)
      return new Date(b.sold_at).getTime() - new Date(a.sold_at).getTime()
    })

  const filterActive = search !== '' || statusFilter !== 'all'

  return (
    <>
      {/* ── CSV import modal ──────────────────────────────────────────────── */}
      {showImport && (
        <CsvImportModal
          title={t('sales.import_title')}
          fields={SALE_FIELDS}
          sampleFilename="sales_template.csv"
          sampleRows={SALE_SAMPLE_ROWS}
          onClose={() => setShowImport(false)}
          onImport={handleSaleImport}
        />
      )}

      {/* ── Add Sale modal — light/dark compatible ─────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] dark:backdrop-blur-xl p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('sales.new_sale_title')}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sales.product_name')}</label>
                <input required value={form.product_name}
                  onChange={(e) => setForm({ ...form, product_name: e.target.value })}
                  className={formFieldClass} placeholder={t('sales.product_placeholder')} />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sales.customer_name')}</label>
                <input value={form.customer_name}
                  onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                  className={formFieldClass} placeholder={t('sales.customer_placeholder')} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sales.quantity')}</label>
                  <input required type="number" min={1} value={form.quantity}
                    onChange={(e) => handleQtyOrPrice({ quantity: Number(e.target.value) })}
                    className={formFieldClass} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sales.unit_price')}</label>
                  <input required type="number" min={0} step="0.01" value={form.unit_price}
                    onChange={(e) => handleQtyOrPrice({ unit_price: Number(e.target.value) })}
                    className={formFieldClass} />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('sales.total_price')}
                  <span className="ms-1 text-xs font-normal text-gray-400 dark:text-gray-500">{t('sales.auto_calculated')}</span>
                </label>
                <input type="number" min={0} step="0.01" value={form.total_price}
                  onChange={(e) => setForm({ ...form, total_price: Number(e.target.value) })}
                  className={formFieldClass} />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('common.status')}</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className={formFieldClass}>
                  <option value="completed">{t('status.completed')}</option>
                  <option value="pending">{t('status.pending')}</option>
                  <option value="cancelled">{t('status.cancelled')}</option>
                  <option value="refunded">{t('status.refunded')}</option>
                </select>
              </div>

              {formError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-sm text-red-700 dark:text-red-400">
                  <AlertTriangle size={14} className="shrink-0" />
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 transition-colors">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={saving}
                  className="rounded-lg bg-[#3a6f8f] hover:bg-[#2d5a74] px-4 py-2 text-sm font-medium text-white disabled:opacity-60 transition-colors">
                  {saving ? t('common.saving') : t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{t('sales.title')}</h1>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{t('sales.subtitle')}</p>
      </div>

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('sales.total_revenue')}
          value={loading ? '—' : fmt(metrics?.total_revenue ?? 0)}
          icon={Banknote}
          bgCls="bg-gray-100/70 dark:bg-white/[0.05]"
          iconCls="text-[#3a6f8f]"
          sub={t('sales.all_time')}
        />
        <StatCard
          label={t('sales.total_orders')}
          value={loading ? '—' : fmtNum(metrics?.total_orders ?? 0, lang)}
          icon={ShoppingCart}
          bgCls="bg-gray-100/70 dark:bg-white/[0.05]"
          iconCls="text-gray-400 dark:text-gray-500"
          sub={t('sales.all_records')}
        />
        <StatCard
          label={t('sales.avg_order')}
          value={loading ? '—' : fmt(metrics?.avg_order_value ?? 0)}
          icon={TrendingUp}
          bgCls="bg-gray-100/70 dark:bg-white/[0.05]"
          iconCls="text-emerald-400 dark:text-emerald-500"
          sub={t('sales.per_transaction')}
        />
        <StatCard
          label={t('sales.top_product')}
          value={loading ? '—' : (metrics?.top_product ?? '—')}
          tooltip={(!loading && metrics?.top_product) ? metrics.top_product : undefined}
          icon={Package}
          bgCls="bg-gray-100/70 dark:bg-white/[0.05]"
          iconCls="text-amber-400 dark:text-amber-500"
          sub={t('sales.by_revenue')}
        />
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center gap-3">
        {/* Left zone: count + search */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <p className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
            {loading ? '—' : t(totalCount !== 1 ? 'sales.count_plural' : 'sales.count', { n: fmtNum(totalCount, lang) })}
          </p>
          <div className="relative min-w-[180px] flex-1 max-w-xs">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder={t('sales.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1.5 pl-8 pr-7 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-[#3a6f8f] focus:ring-2 focus:ring-[#3a6f8f]/40 transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Right zone: status filter, sort, actions */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="appearance-none rounded-md border border-gray-200/70 dark:border-gray-700/50 bg-transparent pl-2 pr-7 py-1 text-xs font-medium text-gray-400 dark:text-gray-500 outline-none focus:border-[#3a6f8f]/60 transition-colors cursor-pointer"
            >
              <option value="all">{t('sales.all_status')}</option>
              <option value="completed">{t('status.completed')}</option>
              <option value="pending">{t('status.pending')}</option>
              <option value="cancelled">{t('status.cancelled')}</option>
              <option value="refunded">{t('status.refunded')}</option>
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="appearance-none rounded-md border border-gray-200/70 dark:border-gray-700/50 bg-transparent pl-2 pr-7 py-1 text-xs font-medium text-gray-400 dark:text-gray-500 outline-none focus:border-[#3a6f8f]/60 transition-colors cursor-pointer"
            >
              <option value="sold_at">{t('sales.sort_newest')}</option>
              <option value="total_price">{t('sales.sort_highest')}</option>
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>
          {canWrite && (
            <>
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-transparent px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/55 transition-colors"
              >
                <Upload size={14} />
                {t('common.import_csv')}
              </button>
              <button
                onClick={openNew}
                className="flex items-center gap-1.5 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] transition-colors"
              >
                <Plus size={15} />
                {t('sales.new_sale')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Table card ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/40 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-[#B3B7BA]/[0.05]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                <div className="h-4 w-20 skeleton" />
                <div className="h-4 w-28 skeleton" />
                <div className="h-4 flex-1 skeleton" />
                <div className="h-4 w-10 skeleton" />
                <div className="h-4 w-16 skeleton" />
                <div className="h-5 w-20 skeleton" />
                <div className="h-4 w-24 skeleton" />
                <div className="ms-auto h-6 w-6 skeleton" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <ShoppingCart size={40} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">{t('sales.empty')}</p>
            <p className="mt-1 text-xs">{t('sales.empty_sub')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-300 dark:border-gray-500 bg-gray-100 dark:bg-[#2e3c52] text-xs tracking-wide">
                  <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('sales.order_id')}</th>
                  <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('sales.customer')}</th>
                  <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('sales.product')}</th>
                  <th className="px-3 py-2 text-right text-gray-700 dark:text-gray-100 font-bold">{t('sales.qty')}</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right text-gray-700 dark:text-gray-100 font-bold">{t('sales.unit_price')} (SAR)</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right text-gray-700 dark:text-gray-100 font-bold">{t('sales.total')} (SAR)</th>
                  <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('sales.status')}</th>
                  <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('sales.date')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/40 bg-white dark:bg-gray-800">
                {filtered.map((sale) => (
                  <tr
                    key={sale.id}
                    onClick={() => router.push(`/sales/${sale.id}`)}
                    className="group cursor-pointer hover:bg-[rgba(58,111,143,0.07)] dark:hover:bg-[rgba(58,111,143,0.13)] hover:shadow-[inset_3px_0_0_rgba(58,111,143,0.4)] focus-visible:bg-[rgba(58,111,143,0.07)] focus-visible:outline-none transition-colors duration-150"
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-400 dark:text-gray-500">
                      {formatSaleNumber(sale.id, sale.sold_at)}
                    </td>
                    <td className="max-w-[120px] truncate px-3 py-1.5 font-medium text-gray-800 dark:text-gray-200" title={sale.customer_name ?? ''}>
                      {sale.customer_name || <span className="italic text-gray-400">{t('sales.guest')}</span>}
                    </td>
                    <td className="max-w-[250px] truncate px-3 py-1.5 text-gray-700 dark:text-gray-300" title={sale.product_name ?? ''}>
                      {sale.product_name || '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {fmtNum(sale.quantity, lang)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {sale.unit_price != null ? fmtCell(sale.unit_price) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-semibold text-gray-900 dark:text-white">
                      {fmtCell(sale.total_price ?? 0)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <StatusBadge status={sale.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-500 dark:text-gray-400">
                      {fmtDate(sale.sold_at)}
                    </td>
                    <td className="px-3 py-1.5 text-end" onClick={(e) => e.stopPropagation()}>
                      <SaleRowMenu
                        saleId={sale.id}
                        canWrite={canWrite}
                        onVoid={() => handleVoid(sale.id)}
                        onDelete={() => handleDelete(sale.id)}
                        t={t}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Summary row — before pagination */}
        {!loading && totalCount > 0 && (
          <div className="border-t border-gray-100 dark:border-[#B3B7BA]/[0.07] px-5 py-3 text-xs text-gray-400 dark:text-gray-500">
            {filterActive
              ? `${fmtNum(filtered.length, lang)} / ${fmtNum(totalCount, lang)}`
              : fmtNum(totalCount, lang)}
            {metrics && (
              <span className="ms-3 font-medium text-gray-600 dark:text-gray-300">
                {t('sales.showing', { revenue: fmt(filtered.reduce((s, r) => s + (r.total_price ?? 0), 0)) })}
              </span>
            )}
          </div>
        )}

        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={SALES_PAGE_SIZE}
          onPage={goToPage}
        />
      </div>
    </>
  )
}
