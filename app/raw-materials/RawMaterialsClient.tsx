'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { RawMaterial } from '../types/traceflow'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import CsvImportModal, { type CsvFieldDef, type ImportResult } from '../components/CsvImportModal'
import { Plus, Pencil, Trash2, X, Check, AlertTriangle, FlaskConical, Upload } from 'lucide-react'
import { useAuth, useRole } from '../lib/auth-context'
import { canEdit } from '../lib/permissions'
import { logActivity, actorName } from '../lib/activity'
import { useT, fmtNum } from '../lib/i18n'

const empty = { name: '', unit: '', quantity_in_stock: 0, reorder_level: 0 }

const MATERIAL_FIELDS: CsvFieldDef[] = [
  { key: 'name',       label: 'Name',             required: true,  type: 'string' },
  { key: 'unit',       label: 'Unit',             required: true,  type: 'string' },
  { key: 'in_stock',   label: 'Quantity in Stock', required: false, type: 'number' },
  { key: 'reorder_at', label: 'Reorder Level',    required: false, type: 'number' },
]

const MATERIAL_SAMPLE_ROWS = [
  { name: 'Steel Rod',    unit: 'kg',  in_stock: '500', reorder_at: '50' },
  { name: 'Copper Wire',  unit: 'pcs', in_stock: '200', reorder_at: '20' },
]

export default function RawMaterialsClient() {
  const toast     = useToast()
  const confirm   = useConfirm()
  const role      = useRole()
  const { user, companyId } = useAuth()
  const canWrite  = canEdit(role, 'raw-materials')
  const { t, lang } = useT()

  const [materials, setMaterials]   = useState<RawMaterial[]>([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editing, setEditing]       = useState<RawMaterial | null>(null)
  const [form, setForm]             = useState(empty)
  const [saving, setSaving]         = useState(false)
  const [formError, setFormError]   = useState<string | null>(null)

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
          <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-200 dark:bg-[#262E36]/55" />
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
        toast.error(t('materials.error_update'))
        setSaving(false)
        return
      }
      setMaterials((prev) => prev.map((m) => (m.id === editing.id ? data : m)))
      toast.success(t('materials.updated_toast'))
    } else {
      const { data, error: err } = await supabase
        .from('raw_materials').insert([payload]).select().single()
      if (err) {
        setFormError(err.message)
        toast.error(t('materials.error_create'))
        setSaving(false)
        return
      }
      setMaterials((prev) => [data, ...prev])
      toast.success(t('materials.created_toast'))
      console.log('[logActivity] pre-call raw_material.created | companyId:', companyId, '| user:', user?.email)
      if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'raw_material.created', entityType: 'raw_material', entityId: data.id,
        message: `${actorName(user?.email)} added raw material ${data.name}`,
      }).catch(err => console.error('[logActivity] raw_material.created failed:', err))
      else console.warn('[logActivity] skipped raw_material.created — companyId is null')
    }

    setSaving(false); setShowForm(false); setForm(empty)
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: t('materials.delete_title'),
      message: t('materials.delete_message'),
      confirmLabel: t('common.delete'),
    })
    if (!ok) return

    const { error: err } = await supabase.from('raw_materials').delete().eq('id', id)
    if (err) {
      const msg = err.message.includes('foreign key')
        ? t('materials.error_fk')
        : err.message
      toast.error(msg)
      return
    }
    setMaterials((prev) => prev.filter((m) => m.id !== id))
    toast.success(t('materials.deleted_toast'))
  }

  async function handleMaterialImport(rows: Record<string, string>[]): Promise<ImportResult> {
    const payload = rows.map((r) => ({
      name:              r.name,
      unit:              r.unit,
      quantity_in_stock: r.in_stock   ? Number(r.in_stock)   : 0,
      reorder_level:     r.reorder_at ? Number(r.reorder_at) : 0,
    }))

    const errors: string[] = []
    const inserted_rows: RawMaterial[] = []

    for (const [i, row] of payload.entries()) {
      const { data, error: err } = await supabase.from('raw_materials').insert([row]).select().single()
      if (err) {
        errors.push(`Row ${i + 2}: ${err.message}`)
      } else if (data) {
        inserted_rows.push(data)
      }
    }

    const inserted = inserted_rows.length
    if (inserted > 0) {
      setMaterials((prev) => [...inserted_rows, ...prev])
      toast.success(t(inserted !== 1 ? 'materials.count_plural' : 'materials.count', { n: fmtNum(inserted, lang) }))
      console.log('[logActivity] pre-call raw_material.imported | companyId:', companyId, '| count:', inserted)
      if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'raw_material.imported', entityType: 'raw_material',
        message: `${actorName(user?.email)} imported ${inserted} raw material${inserted !== 1 ? 's' : ''}`,
        metadata: { count: inserted },
      }).catch(err => console.error('[logActivity] raw_material.imported failed:', err))
      else console.warn('[logActivity] skipped raw_material.imported — companyId is null')
    }
    return { inserted, skipped: 0, errors }
  }

  const lowStock = materials.filter((m) => m.quantity_in_stock <= m.reorder_level)
  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'

  const formFields = [
    { label: t('common.name'),              key: 'name',              type: 'text',   placeholder: t('materials.name_placeholder') },
    { label: t('common.unit'),              key: 'unit',              type: 'text',   placeholder: t('materials.unit_placeholder') },
    { label: t('materials.quantity_in_stock'), key: 'quantity_in_stock', type: 'number', placeholder: '0' },
    { label: t('materials.reorder_level'),  key: 'reorder_level',     type: 'number', placeholder: '0' },
  ] as const

  return (
    <>
      {/* Import modal */}
      {showImport && (
        <CsvImportModal
          title={t('materials.import_title')}
          fields={MATERIAL_FIELDS}
          sampleFilename="raw_materials_template.csv"
          sampleRows={MATERIAL_SAMPLE_ROWS}
          onClose={() => setShowImport(false)}
          onImport={handleMaterialImport}
        />
      )}

      {/* Low stock banner */}
      {lowStock.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span dangerouslySetInnerHTML={{ __html:
            t(lowStock.length > 1 ? 'materials.low_stock_banner_plural' : 'materials.low_stock_banner', { n: fmtNum(lowStock.length, lang) })
          }} />
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t(materials.length !== 1 ? 'materials.count_plural' : 'materials.count', { n: fmtNum(materials.length, lang) })}
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
              <Plus size={16} /> {t('materials.add')}
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
                {editing ? t('materials.edit') : t('materials.new')}
              </h2>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {formFields.map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
                  <input
                    required
                    type={type}
                    min={type === 'number' ? 0 : undefined}
                    value={(form as Record<string, unknown>)[key] as string | number}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
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
                  className="rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-gray-700"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] disabled:opacity-60"
                >
                  <Check size={15} /> {saving ? t('common.saving') : editing ? t('common.update') : t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm">
        {materials.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <FlaskConical size={40} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">{t('materials.empty')}</p>
            <p className="mt-1 text-xs">{t('materials.empty_sub')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#D1CFC9]/50 dark:bg-[#262E36]/55/50 text-xs text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t('common.name')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('common.unit')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('common.in_stock')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('common.reorder_at')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('common.status')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-[#B3B7BA]/[0.07]">
              {materials.map((m) => {
                const isLow = m.quantity_in_stock <= m.reorder_level
                return (
                  <tr key={m.id} className="hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/22 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{m.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{m.unit}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800 dark:text-gray-200">
                      {m.quantity_in_stock.toLocaleString(locale)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                      {m.reorder_level.toLocaleString(locale)}
                    </td>
                    <td className="px-4 py-3">
                      {isLow
                        ? <span className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400"><AlertTriangle size={12} /> {t('materials.low_stock')}</span>
                        : <span className="text-xs font-medium text-green-600 dark:text-green-400">{t('materials.ok_stock')}</span>}
                    </td>
                    <td className="px-4 py-3 text-end">
                      {canWrite && (
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
                      )}
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
