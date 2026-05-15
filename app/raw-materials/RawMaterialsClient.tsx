'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { RawMaterial } from '../types/traceflow'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { Plus, Pencil, Trash2, X, Check, AlertTriangle, FlaskConical } from 'lucide-react'

const empty = { name: '', unit: '', quantity_in_stock: 0, reorder_level: 0 }

export default function RawMaterialsClient() {
  const toast   = useToast()
  const confirm = useConfirm()

  const [materials, setMaterials] = useState<RawMaterial[]>([])
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState<RawMaterial | null>(null)
  const [form, setForm]           = useState(empty)
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('raw_materials')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setMaterials(data ?? []); setLoading(false) })
  }, [])

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
        ))}
      </div>
    )
  }

  function openCreate() {
    setEditing(null); setForm(empty); setFormError(null); setShowForm(true)
  }

  function openEdit(m: RawMaterial) {
    setEditing(m)
    setForm({
      name: m.name,
      unit: m.unit,
      quantity_in_stock: m.quantity_in_stock,
      reorder_level: m.reorder_level,
    })
    setFormError(null); setShowForm(true)
  }

  function closeForm() {
    setShowForm(false); setFormError(null)
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setFormError(null)
    const payload = {
      name: form.name,
      unit: form.unit,
      quantity_in_stock: Number(form.quantity_in_stock),
      reorder_level: Number(form.reorder_level),
    }

    if (editing) {
      const { data, error: err } = await supabase
        .from('raw_materials').update(payload).eq('id', editing.id).select().single()
      if (err) {
        setFormError(err.message)
        toast.error('Failed to update material')
        setSaving(false)
        return
      }
      setMaterials((prev) => prev.map((m) => (m.id === editing.id ? data : m)))
      toast.success('Material updated')
    } else {
      const { data, error: err } = await supabase
        .from('raw_materials').insert([payload]).select().single()
      if (err) {
        setFormError(err.message)
        toast.error('Failed to create material')
        setSaving(false)
        return
      }
      setMaterials((prev) => [data, ...prev])
      toast.success('Material created')
    }

    setSaving(false); setShowForm(false); setForm(empty)
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Delete material?',
      message: 'This cannot be undone. Materials referenced by production records cannot be deleted.',
      confirmLabel: 'Delete',
    })
    if (!ok) return

    const { error: err } = await supabase.from('raw_materials').delete().eq('id', id)
    if (err) {
      const msg = err.message.includes('foreign key')
        ? 'Cannot delete: this material is referenced by existing production records.'
        : err.message
      toast.error(msg)
      return
    }
    setMaterials((prev) => prev.filter((m) => m.id !== id))
    toast.success('Material deleted')
  }

  const lowStock = materials.filter((m) => m.quantity_in_stock <= m.reorder_level)

  return (
    <>
      {/* Low stock banner */}
      {lowStock.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            <strong>{lowStock.length}</strong> material{lowStock.length > 1 ? 's' : ''} at or below reorder level.
          </span>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {materials.length} material{materials.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} /> Add Material
        </button>
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editing ? 'Edit Material' : 'New Material'}
              </h2>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {(
                [
                  { label: 'Name',              key: 'name',              type: 'text',   placeholder: 'e.g. Steel Rod' },
                  { label: 'Unit',              key: 'unit',              type: 'text',   placeholder: 'e.g. kg, pcs, liters' },
                  { label: 'Quantity in Stock', key: 'quantity_in_stock', type: 'number', placeholder: '0' },
                  { label: 'Reorder Level',     key: 'reorder_level',     type: 'number', placeholder: '0' },
                ] as const
              ).map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
                  <input
                    required
                    type={type}
                    min={type === 'number' ? 0 : undefined}
                    value={(form as Record<string, unknown>)[key] as string | number}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={placeholder}
                  />
                </div>
              ))}

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
                  className="rounded-lg border border-gray-200 dark:border-gray-600 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  <Check size={15} /> {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
        {materials.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <FlaskConical size={40} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">No materials yet</p>
            <p className="mt-1 text-xs">Add raw materials to track inventory.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Unit</th>
                <th className="px-4 py-3 text-left font-medium">In Stock</th>
                <th className="px-4 py-3 text-left font-medium">Reorder At</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {materials.map((m) => {
                const isLow = m.quantity_in_stock <= m.reorder_level
                return (
                  <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{m.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{m.unit}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800 dark:text-gray-200">{m.quantity_in_stock}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{m.reorder_level}</td>
                    <td className="px-4 py-3">
                      {isLow
                        ? <span className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400"><AlertTriangle size={12} /> Low Stock</span>
                        : <span className="text-xs font-medium text-green-600 dark:text-green-400">OK</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(m)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(m.id)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
