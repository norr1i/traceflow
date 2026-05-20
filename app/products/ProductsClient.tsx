'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Product } from '../types/traceflow'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import CsvImportModal, { type CsvFieldDef, type ImportResult } from '../components/CsvImportModal'
import { Plus, Pencil, Trash2, X, Check, AlertTriangle, Package, Upload } from 'lucide-react'

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
  const toast   = useToast()
  const confirm = useConfirm()

  const [products, setProducts]     = useState<Product[]>([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editing, setEditing]       = useState<Product | null>(null)
  const [form, setForm]             = useState(empty)
  const [saving, setSaving]         = useState(false)
  const [formError, setFormError]   = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setProducts(data ?? []); setLoading(false) })
  }, [])

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
        .select()
        .single()

      if (err) {
        setFormError(err.message)
        toast.error('Failed to update product')
        setSaving(false)
        return
      }
      setProducts((prev) => prev.map((p) => (p.id === editing.id ? data : p)))
      toast.success('Product updated')
    } else {
      const { data, error: err } = await supabase
        .from('products')
        .insert([{ name: form.name, sku: form.sku, description: form.description }])
        .select()
        .single()

      if (err) {
        setFormError(err.message)
        toast.error('Failed to create product')
        setSaving(false)
        return
      }
      setProducts((prev) => [data, ...prev])
      toast.success('Product created')
    }

    setSaving(false)
    setShowForm(false)
    setForm(empty)
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Delete product?',
      message: 'Any linked production orders will also be deleted. This cannot be undone.',
      confirmLabel: 'Delete',
    })
    if (!ok) return

    const { error: err } = await supabase.from('products').delete().eq('id', id)
    if (err) {
      toast.error(err.message)
      return
    }
    setProducts((prev) => prev.filter((p) => p.id !== id))
    toast.success('Product deleted')
  }

  async function handleProductImport(rows: Record<string, string>[]): Promise<ImportResult> {
    const { data: existing } = await supabase.from('products').select('sku')
    const existingSkus = new Set((existing ?? []).map((r) => r.sku.toLowerCase()))

    const toInsert = rows.filter((r) => !existingSkus.has(r.sku.toLowerCase()))
    const skipped  = rows.length - toInsert.length

    if (toInsert.length === 0) return { inserted: 0, skipped, errors: [] }

    const payload = toInsert.map((r) => ({
      name:        r.name,
      sku:         r.sku,
      description: r.description || null,
    }))

    const { data, error: err } = await supabase.from('products').insert(payload).select()
    if (err) return { inserted: 0, skipped, errors: [err.message] }

    const inserted = data?.length ?? 0
    setProducts((prev) => [...(data ?? []), ...prev])
    if (inserted > 0) toast.success(`Imported ${inserted} product${inserted !== 1 ? 's' : ''}`)
    return { inserted, skipped, errors: [] }
  }

  return (
    <>
      {/* Import modal */}
      {showImport && (
        <CsvImportModal
          title="Import Products"
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
          {products.length} product{products.length !== 1 ? 's' : ''}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/55 transition-colors"
          >
            <Upload size={15} /> Import CSV
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] transition-colors"
          >
            <Plus size={16} /> Add Product
          </button>
        </div>
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] dark:backdrop-blur-xl p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editing ? 'Edit Product' : 'New Product'}
              </h2>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Name</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  placeholder="e.g. Steel Bolt M8"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">SKU</label>
                <input
                  required
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  placeholder="e.g. BOLT-M8-001"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  placeholder="Optional description…"
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
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] disabled:opacity-60"
                >
                  <Check size={15} />
                  {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
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
            <p className="text-sm font-medium">No products yet</p>
            <p className="mt-1 text-xs">Add your first product to get started.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#D1CFC9]/50 dark:bg-[#262E36]/55/50 text-xs text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">SKU</th>
                <th className="px-4 py-3 text-left font-medium hidden md:table-cell">Description</th>
                <th className="px-4 py-3 text-left font-medium hidden sm:table-cell">Created</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
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
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">
                    {p.description ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 dark:text-gray-500 hidden sm:table-cell">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
