'use client'

import { useSales, SaleFormData } from '../hooks/useSales'
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import {
  ShoppingCart, TrendingUp, Package, AlertTriangle, Search,
  Plus, RefreshCw, ChevronDown, ArrowUpRight, ArrowDownRight,
  Trash2, X, Banknote, Upload,
} from 'lucide-react'
import CsvImportModal, { type CsvFieldDef, type ImportResult } from '../components/CsvImportModal'
import { useAuth, useRole } from '../lib/auth-context'
import { canEdit } from '../lib/permissions'
import { logActivity, actorName } from '../lib/activity'
import { useT, fmtNum } from '../lib/i18n'

function StatCard({
  label, value, icon: Icon, gradient, glow, sub, trend,
}: {
  label: string; value: string | number; icon: React.ElementType
  gradient: string; glow: string; sub?: string; trend?: 'up' | 'down'
}) {
  return (
    <div className="group relative rounded-2xl p-5 border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.09] bg-[#E6E4E0] dark:bg-[#262E36]/38 dark:backdrop-blur-xl shadow-sm dark:shadow-none transition-all duration-300 hover:-translate-y-0.5 dark:hover:border-white/[0.12] dark:hover:bg-[#262E36]/55">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{value}</p>
          {sub && (
            <p className="mt-1 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
              {trend === 'up' && <ArrowUpRight size={12} className="text-emerald-500" />}
              {trend === 'down' && <ArrowDownRight size={12} className="text-red-400" />}
              {sub}
            </p>
          )}
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} ${glow} transition-all duration-300 group-hover:scale-110`}>
          <Icon size={18} className="text-white" />
        </span>
      </div>
    </div>
  )
}

function SaleStatusBadge({ status, t }: { status?: string; t: (k: string) => string }) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    pending:   'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    cancelled: 'bg-red-500/10 text-red-400 border border-red-500/20',
    refunded:  'bg-gray-500/10 text-gray-400 border border-gray-500/20',
  }
  const key = (status ?? 'completed').toLowerCase()
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[key] ?? map['completed']}`}>
      {t(`status.${key}`)}
    </span>
  )
}

const emptyForm: SaleFormData = {
  product_name: '', customer_name: '', quantity: 1, unit_price: 0, total_price: 0, status: 'completed',
}

const inputClass = `
  w-full rounded-xl border border-white/[0.08] bg-white/[0.05]
  px-3 py-2 text-sm text-white placeholder-gray-500
  focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/30 focus:border-[#4a7fa5]/40
  transition-colors
`

const lightInputClass = `
  w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10]
  bg-[#F1EFEC] dark:bg-[#262E36]/50
  px-3 py-2 text-sm text-gray-900 dark:text-white
  placeholder-gray-400 dark:placeholder-gray-500
  focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/20 dark:focus:ring-[#4a7fa5]/30
  transition-colors
`

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

export default function SalesClient() {
  const toast    = useToast()
  const confirm  = useConfirm()
  const role     = useRole()
  const { user, companyId } = useAuth()
  const canWrite = canEdit(role, 'sales')
  const { sales, metrics, loading, error, refetch, createSale, deleteSale } = useSales()
  const { t, lang } = useT()

  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy]             = useState<'sold_at' | 'total_price'>('sold_at')
  const [showForm, setShowForm]         = useState(false)
  const [showImport, setShowImport]     = useState(false)
  const [form, setForm]                 = useState<SaleFormData>(emptyForm)
  const [saving, setSaving]             = useState(false)
  const [formError, setFormError]       = useState<string | null>(null)

  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'

  function fmt(n: number) {
    return lang === 'ar'
      ? `${fmtNum(n, lang, { maximumFractionDigits: 0 })} ر.س`
      : `${fmtNum(n, lang, { maximumFractionDigits: 0 })} SAR`
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
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
    console.log('[logActivity] pre-call sale.created | companyId:', companyId, '| user:', user?.email)
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType: 'sale.created', entityType: 'sale', entityId: result.id,
      message: `${actorName(user?.email)} recorded a sale for ${form.product_name}`,
      metadata: { quantity: form.quantity, total_price: form.total_price },
    }).catch(err => console.error('[logActivity] sale.created failed:', err))
    else console.warn('[logActivity] skipped sale.created — companyId is null')
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

    const { data, error: err } = await supabase.from('sales').insert(payload).select()
    if (err) return { inserted: 0, skipped: 0, errors: [err.message] }

    const inserted = data?.length ?? 0
    if (inserted > 0) {
      toast.success(t(inserted !== 1 ? 'sales.import_n_plural' : 'sales.import_n', { n: fmtNum(inserted, lang) }))
      console.log('[logActivity] pre-call sale.imported | companyId:', companyId, '| count:', inserted)
      if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'sale.imported', entityType: 'sale',
        message: `${actorName(user?.email)} imported ${inserted} sale${inserted !== 1 ? 's' : ''}`,
        metadata: { count: inserted },
      }).catch(err => console.error('[logActivity] sale.imported failed:', err))
      else console.warn('[logActivity] skipped sale.imported — companyId is null')
      refetch()
    }
    return { inserted, skipped: 0, errors: [] }
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

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)] p-6">
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

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="
            w-full max-w-md rounded-2xl p-6
            border border-white/[0.08] bg-[#141e28]
            backdrop-blur-xl shadow-[0_24px_64px_rgba(0,0,0,0.6)]
          ">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{t('sales.new_sale_title')}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-gray-300 transition-colors">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('sales.product_name')}</label>
                <input required value={form.product_name}
                  onChange={(e) => setForm({ ...form, product_name: e.target.value })}
                  className={inputClass} placeholder={t('sales.product_placeholder')} />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('sales.customer_name')}</label>
                <input value={form.customer_name}
                  onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                  className={inputClass} placeholder={t('sales.customer_placeholder')} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('sales.quantity')}</label>
                  <input required type="number" min={1} value={form.quantity}
                    onChange={(e) => handleQtyOrPrice({ quantity: Number(e.target.value) })}
                    className={inputClass} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('sales.unit_price')}</label>
                  <input required type="number" min={0} step="0.01" value={form.unit_price}
                    onChange={(e) => handleQtyOrPrice({ unit_price: Number(e.target.value) })}
                    className={inputClass} />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">
                  {t('sales.total_price')}
                  <span className="ml-1 text-xs font-normal text-gray-500">{t('sales.auto_calculated')}</span>
                </label>
                <input type="number" min={0} step="0.01" value={form.total_price}
                  onChange={(e) => setForm({ ...form, total_price: Number(e.target.value) })}
                  className={inputClass} />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">{t('common.status')}</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className={inputClass}>
                  <option value="completed">{t('status.completed')}</option>
                  <option value="pending">{t('status.pending')}</option>
                  <option value="cancelled">{t('status.cancelled')}</option>
                  <option value="refunded">{t('status.refunded')}</option>
                </select>
              </div>

              {formError && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                  <AlertTriangle size={14} className="shrink-0" />
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/[0.08] transition-colors">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={saving}
                  className="rounded-xl bg-[#3a6f8f] hover:bg-[#2d5a74] px-4 py-2 text-sm font-medium text-white disabled:opacity-60 transition-colors shadow-[0_0_16px_rgba(74,127,165,0.22)]">
                  {saving ? t('common.saving') : t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">{t('sales.title')}</h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{t('sales.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={refetch}
            className="flex items-center gap-1.5 rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/40 transition-colors">
            <RefreshCw size={15} />
            {t('sales.refresh')}
          </button>
          {canWrite && (
            <>
              <button onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/40 transition-colors">
                <Upload size={15} />
                {t('common.import_csv')}
              </button>
              <button onClick={openNew}
                className="flex items-center gap-1.5 rounded-xl bg-[#3a6f8f] hover:bg-[#2d5a74] px-4 py-2 text-sm font-medium text-white shadow-[0_0_16px_rgba(74,127,165,0.22)] transition-colors">
                <Plus size={15} />
                {t('sales.new_sale')}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('sales.total_revenue')}   value={loading ? '—' : fmt(metrics?.total_revenue ?? 0)}   icon={Banknote}     gradient="from-[#3a6f8f]/65 to-[#2d5a74]/75"    glow="shadow-[0_0_20px_rgba(74,127,165,0.22)]"   sub={t('sales.all_time')}        trend="up" />
        <StatCard label={t('sales.total_orders')}    value={loading ? '—' : (metrics?.total_orders ?? 0)}        icon={ShoppingCart} gradient="from-[#5a4690]/65 to-[#46386e]/75"    glow="shadow-[0_0_20px_rgba(90,70,144,0.22)]"   sub={t('sales.all_records')} />
        <StatCard label={t('sales.avg_order')}       value={loading ? '—' : fmt(metrics?.avg_order_value ?? 0)}  icon={TrendingUp}   gradient="from-[#2d7a5a]/65 to-[#245f46]/75"    glow="shadow-[0_0_20px_rgba(45,100,75,0.22)]"   sub={t('sales.per_transaction')} trend="up" />
        <StatCard label={t('sales.top_product')}     value={loading ? '—' : (metrics?.top_product ?? '—')}       icon={Package}      gradient="from-[#8a6030]/65 to-[#6e4c25]/75"    glow="shadow-[0_0_20px_rgba(138,96,48,0.22)]"   sub={t('sales.by_revenue')} />
      </div>

      {/* Table card */}
      <div className="rounded-2xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.09] bg-[#E6E4E0] dark:bg-[#262E36]/38 dark:backdrop-blur-xl shadow-sm dark:shadow-none overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-gray-100 dark:border-[#B3B7BA]/[0.08] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder={t('sales.search_placeholder')}
              value={search} onChange={(e) => setSearch(e.target.value)}
              className={`${lightInputClass} pl-9`} />
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="appearance-none rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#D1CFC9]/50 dark:bg-[#262E36]/50 py-2 pl-3 pr-8 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#4a7fa5]/30 transition-colors">
                <option value="all">{t('sales.all_status')}</option>
                <option value="completed">{t('status.completed')}</option>
                <option value="pending">{t('status.pending')}</option>
                <option value="cancelled">{t('status.cancelled')}</option>
                <option value="refunded">{t('status.refunded')}</option>
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
            <div className="relative">
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="appearance-none rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#D1CFC9]/50 dark:bg-[#262E36]/50 py-2 pl-3 pr-8 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#4a7fa5]/30 transition-colors">
                <option value="sold_at">{t('sales.sort_newest')}</option>
                <option value="total_price">{t('sales.sort_highest')}</option>
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-gray-100 dark:bg-[#262E36]/38" />
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
                <tr className="border-b border-gray-100 dark:border-[#B3B7BA]/[0.07] bg-[#D1CFC9]/50 dark:bg-[#262E36]/18 text-start text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  <th className="px-5 py-3">{t('sales.order_id')}</th>
                  <th className="px-5 py-3">{t('sales.customer')}</th>
                  <th className="px-5 py-3">{t('sales.product')}</th>
                  <th className="px-5 py-3">{t('sales.qty')}</th>
                  <th className="px-5 py-3">{t('sales.total')}</th>
                  <th className="px-5 py-3">{t('sales.status')}</th>
                  <th className="px-5 py-3">{t('sales.date')}</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-[#B3B7BA]/[0.05]">
                {filtered.map((sale) => (
                  <tr key={sale.id} className="hover:bg-blue-50/40 dark:hover:bg-blue-500/[0.05] transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-400 dark:text-gray-500">
                      #{sale.id.slice(0, 8)}
                    </td>
                    <td className="px-5 py-3.5 font-medium text-gray-800 dark:text-gray-200">
                      {sale.customer_name || <span className="italic text-gray-400">{t('sales.guest')}</span>}
                    </td>
                    <td className="px-5 py-3.5 text-gray-700 dark:text-gray-300">{sale.product_name || '—'}</td>
                    <td className="px-5 py-3.5 text-gray-700 dark:text-gray-300">{fmtNum(sale.quantity, lang)}</td>
                    <td className="px-5 py-3.5 font-semibold text-gray-900 dark:text-white">
                      {fmt(sale.total_price ?? 0)}
                    </td>
                    <td className="px-5 py-3.5">
                      <SaleStatusBadge status={sale.status} t={t} />
                    </td>
                    <td className="px-5 py-3.5 text-gray-500 dark:text-gray-400">{fmtDate(sale.sold_at)}</td>
                    <td className="px-5 py-3.5 text-end">
                      {canWrite && (
                        <button onClick={() => handleDelete(sale.id)}
                          className="rounded-lg p-1.5 text-gray-300 dark:text-gray-600 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                          title={t('common.delete')}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && (
          <div className="border-t border-gray-100 dark:border-[#B3B7BA]/[0.07] px-5 py-3 text-xs text-gray-400 dark:text-gray-500">
            {fmtNum(filtered.length, lang)} / {fmtNum(sales.length, lang)}
            {metrics && (
              <span className="ml-3 font-medium text-gray-600 dark:text-gray-300">
                {t('sales.showing', { revenue: fmt(filtered.reduce((s, r) => s + (r.total_price ?? 0), 0)) })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
