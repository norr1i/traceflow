'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Product } from '../types/traceflow'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import CsvImportModal, { type CsvFieldDef, type ImportResult } from '../components/CsvImportModal'
import { Plus, Pencil, Trash2, X, Check, AlertTriangle, Package, Upload } from 'lucide-react'
import PaginationBar from '../components/PaginationBar'

const PAGE_SIZE = 50
import { useAuth, useRole } from '../lib/auth-context'
import { canEdit } from '../lib/permissions'
import { logActivity, actorName } from '../lib/activity'
import { useT, fmtNum } from '../lib/i18n'

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

export default function ProductsClient() {
  const toast     = useToast()
  const confirm   = useConfirm()
  const role      = useRole()
  const { user, companyId } = useAuth()
  const canWrite  = canEdit(role, 'products')
  const { t, lang } = useT()

  const [products,   setProducts]   = useState<Product[]>([])
  const [loading,    setLoading]    = useState(true)
  const [page,       setPage]       = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const [showForm, setShowForm]     = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editing, setEditing]       = useState<Product | null>(null)
  const [form, setForm]             = useState(empty)
  const [saving, setSaving]         = useState(false)
  const [formError, setFormError]   = useState<string | null>(null)

  const loadPage = (pageNum: number) => {
    if (!companyId) return
    setLoading(true)
    const offset = (pageNum - 1) * PAGE_SIZE
    supabase
      .from('products')
      .select('*', { count: 'exact' })
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
      .then(({ data, count }) => {
        setProducts(data ?? [])
        setTotalCount(count ?? 0)
        setLoading(false)
      })
  }

  useEffect(() => { loadPage(1) }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-200 dark:bg-[#262E36]/55" />
        ))}
      </div>
    )
  }

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

      if (err) {
        setFormError(err.message)
        toast.error(t('products.error_update'))
        setSaving(false)
        return
      }
      setProducts((prev) => prev.map((p) => (p.id === editing.id ? data : p)))
      toast.success(t('products.updated_toast'))
    } else {
      const { data, error: err } = await supabase
        .from('products')
        .insert([{ name: form.name, sku: form.sku, description: form.description, company_id: companyId }])
        .select()
        .single()

      if (err) {
        setFormError(err.message)
        toast.error(t('products.error_create'))
        setSaving(false)
        return
      }
      setProducts((prev) => [data, ...prev])
      toast.success(t('products.created_toast'))
      if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
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
    if (err) {
      toast.error(err.message)
      return
    }
    setProducts((prev) => prev.filter((p) => p.id !== id))
    toast.success(t('products.deleted_toast'))
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
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
      name:        r.name,
      sku:         r.sku,
      description: r.description || null,
      company_id:  companyId,
    }))

    const { data, error: err } = await supabase.from('products').insert(payload).select()
    if (err) return { inserted: 0, skipped, errors: [err.message] }

    const inserted = data?.length ?? 0
    setProducts((prev) => [...(data ?? []), ...prev])
    if (inserted > 0) {
      toast.success(t(inserted !== 1 ? 'products.count_plural' : 'products.count', { n: fmtNum(inserted, lang) }))
      if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'product.imported', entityType: 'product',
        message: `${actorName(user?.email)} imported ${inserted} product${inserted !== 1 ? 's' : ''}`,
        metadata: { count: inserted, skipped },
      }).catch(err => console.error('[logActivity] product.imported failed:', err))
    }
    return { inserted, skipped, errors: [] }
  }

  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'

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

      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t(totalCount !== 1 ? 'products.count_plural' : 'products.count', { n: fmtNum(totalCount, lang) })}
        </p>
        {canWrite && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/55 transition-colors"
            >
              <Upload size={15} /> {t('common.import_csv')}
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] transition-colors"
            >
              <Plus size={16} /> {t('products.add')}
            </button>
          </div>
        )}
      </div>

      {/* Modal */}
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

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm">
        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <Package size={40} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">{t('products.empty')}</p>
            <p className="mt-1 text-xs">{t('products.empty_sub')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#D1CFC9]/50 dark:bg-[#262E36]/55/50 text-xs text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t('common.name')}</th>
                <th className="px-4 py-3 text-start font-medium w-24">SKU</th>
                <th className="px-4 py-3 text-start font-medium hidden md:table-cell w-1/3">{t('common.description')}</th>
                <th className="px-4 py-3 text-start font-medium hidden sm:table-cell w-28">{t('common.created')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-[#B3B7BA]/[0.07]">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/22 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{p.name}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-gray-100 dark:bg-[#262E36]/55 px-2 py-0.5 font-mono text-xs text-gray-600 dark:text-gray-400">
                      {p.sku}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell w-1/3 whitespace-normal break-words">
                    {p.description
                      ? <span>{p.description}</span>
                      : <span className="italic text-gray-400 dark:text-gray-600">{t('products.no_description')}</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-gray-400 dark:text-gray-500 hidden sm:table-cell">
                    {new Date(p.created_at).toLocaleDateString(locale)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {canWrite && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPage={(p) => { setPage(p); loadPage(p) }}
        />
      </div>
    </>
  )
}
