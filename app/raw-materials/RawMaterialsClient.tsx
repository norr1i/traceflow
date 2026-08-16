'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { RawMaterial } from '../types/traceflow'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import CsvImportModal, { type CsvFieldDef, type ImportResult } from '../components/CsvImportModal'
import {
  Plus, Pencil, Trash2, X, Check, AlertTriangle, FlaskConical, Upload,
  MoreHorizontal, ChevronsUpDown, ChevronUp, ChevronDown, ChevronRight, Search,
} from 'lucide-react'
import PaginationBar from '../components/PaginationBar'
import { useAuth, useRole } from '../lib/auth-context'
import { canEdit } from '../lib/permissions'
import { logActivity, actorName } from '../lib/activity'
import { useT, fmtNum } from '../lib/i18n'

const PAGE_SIZE = 50

type MaterialWithSupplier = RawMaterial & {
  suppliers: { name: string } | null
}

type SortCol = 'name' | 'quantity_in_stock' | 'status'
type StockFilter = 'all' | 'low_stock' | 'healthy'

const TIER_ORDER = { out: 0, low: 1, healthy: 2 } as const

const DISCRETE_UNITS = new Set([
  'pc', 'pcs', 'piece', 'pieces', 'cylinder', 'cylinders',
  'sheet', 'sheets', 'drum', 'drums', 'box', 'boxes',
  'pallet', 'pallets', 'roll', 'rolls', 'unit', 'units',
  'each', 'ea', 'item', 'items', 'bag', 'bags', 'bottle', 'bottles',
])

function fmtQty(value: number, unit: string, locStr: string): string {
  const isDiscrete = DISCRETE_UNITS.has(unit.toLowerCase().trim())
  const n = isDiscrete ? Math.round(value) : value
  return n.toLocaleString(locStr, { maximumFractionDigits: isDiscrete ? 0 : 2 }) + ' ' + unit
}

function stockTier(m: { quantity_in_stock: number; reorder_level: number }): 'out' | 'low' | 'healthy' {
  if (m.quantity_in_stock <= 0) return 'out'
  if (m.quantity_in_stock <= m.reorder_level) return 'low'
  return 'healthy'
}

function SortIcon({ col, sortCol, sortAsc }: { col: SortCol; sortCol: SortCol; sortAsc: boolean }) {
  if (sortCol !== col) return <ChevronsUpDown size={12} className="ms-1 opacity-40" />
  return sortAsc ? <ChevronUp size={12} className="ms-1" /> : <ChevronDown size={12} className="ms-1" />
}

function StockStatusCell({ m }: { m: { quantity_in_stock: number; reorder_level: number } }) {
  const { t } = useT()
  const tier = stockTier(m)
  if (tier === 'out') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-400">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600 dark:bg-red-400" />
      {t('materials.out_of_stock')}
    </span>
  )
  if (tier === 'low') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
      {t('materials.low_stock')}
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-500">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-400" />
      {t('materials.ok_stock')}
    </span>
  )
}

function RowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useT()

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
        onClick={() => setOpen(o => !o)}
        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-[#262E36]/55 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="absolute end-0 z-10 mt-1 w-36 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-white dark:bg-[#141e28] shadow-lg overflow-hidden">
          <button
            onClick={() => { onEdit(); setOpen(false) }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#262E36]/55 transition-colors"
          >
            <Pencil size={13} /> {t('common.edit')}
          </button>
          <button
            onClick={() => { onDelete(); setOpen(false) }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 size={13} /> {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

const empty = { name: '', unit: '', quantity_in_stock: 0, reorder_level: 0 }

const MATERIAL_FIELDS: CsvFieldDef[] = [
  { key: 'name',       label: 'Name',              required: true,  type: 'string' },
  { key: 'unit',       label: 'Unit',              required: true,  type: 'string' },
  { key: 'in_stock',   label: 'Quantity in Stock', required: false, type: 'number' },
  { key: 'reorder_at', label: 'Reorder Level',     required: false, type: 'number' },
]

const MATERIAL_SAMPLE_ROWS = [
  { name: 'Steel Rod',   unit: 'kg',  in_stock: '500', reorder_at: '50' },
  { name: 'Copper Wire', unit: 'pcs', in_stock: '200', reorder_at: '20' },
]

export default function RawMaterialsClient() {
  const toast     = useToast()
  const confirm   = useConfirm()
  const role      = useRole()
  const { user, companyId } = useAuth()
  const canWrite  = canEdit(role, 'raw-materials')
  const { t, lang } = useT()

  const [materials,  setMaterials]  = useState<MaterialWithSupplier[]>([])
  const [loading,    setLoading]    = useState(true)
  const [page,       setPage]       = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [totalAll,   setTotalAll]   = useState(0)
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const [showForm,   setShowForm]   = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editing,    setEditing]    = useState<RawMaterial | null>(null)
  const [form,       setForm]       = useState(empty)
  const [saving,     setSaving]     = useState(false)
  const [formError,  setFormError]  = useState<string | null>(null)

  const [searchInput, setSearchInput] = useState('')
  // Default: sort by status (exceptions first) so low-stock rows are immediately visible
  const [sortCol,     setSortCol]     = useState<SortCol>('status')
  const [sortAsc,     setSortAsc]     = useState(true)
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')

  const locale   = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'
  const tableRef = useRef<HTMLDivElement>(null)

  const loadPage = (
    pageNum: number,
    s      = searchInput,
    col    = sortCol,
    asc    = sortAsc,
    filter = stockFilter,
  ) => {
    if (!companyId) return
    setPage(pageNum)
    setLoading(true)

    const offset   = (pageNum - 1) * PAGE_SIZE
    const safe     = s.replace(/[^\w\s\-.]/g, '').trim()
    // Status sort is computed client-side; use name as the DB ordering within each tier
    const dbCol    = col === 'status' ? 'name' : col
    const dbAsc    = col === 'status' ? true : asc
    // Status sort and stock filters both require the full result set for client-side processing
    const needsAll = col === 'status' || filter !== 'all'

    const q  = supabase.from('raw_materials').select('*, suppliers(name)', { count: 'exact' }).eq('company_id', companyId).order(dbCol, { ascending: dbAsc })
    const sq = safe ? q.ilike('name', `%${safe}%`) : q
    const pq = needsAll ? sq : sq.range(offset, offset + PAGE_SIZE - 1)

    pq.then(({ data, count }) => {
      let all = (data ?? []) as MaterialWithSupplier[]

      if (col === 'status') {
        all = [...all].sort((a, b) => {
          const diff = TIER_ORDER[stockTier(a)] - TIER_ORDER[stockTier(b)]
          if (diff !== 0) return asc ? diff : -diff
          return a.name.localeCompare(b.name)
        })
      }

      if (filter === 'low_stock') {
        const f = all.filter(m => m.quantity_in_stock <= m.reorder_level)
        setMaterials(f.slice(offset, offset + PAGE_SIZE))
        setTotalCount(f.length)
      } else if (filter === 'healthy') {
        const f = all.filter(m => m.quantity_in_stock > m.reorder_level)
        setMaterials(f.slice(offset, offset + PAGE_SIZE))
        setTotalCount(f.length)
      } else if (needsAll) {
        setMaterials(all.slice(offset, offset + PAGE_SIZE))
        setTotalCount(all.length)
      } else {
        setMaterials(all)
        setTotalCount(count ?? 0)
      }
      setLoading(false)
    })
  }

  useEffect(() => { loadPage(1) }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!companyId) return
    supabase
      .from('raw_materials')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .then(({ count }) => setTotalAll(count ?? 0))
  }, [companyId])

  useEffect(() => {
    const id = setTimeout(() => {
      loadPage(1, searchInput, sortCol, sortAsc, stockFilter)
    }, 300)
    return () => clearTimeout(id)
  }, [searchInput]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSort(col: SortCol) {
    const newAsc = sortCol === col ? !sortAsc : true
    setSortCol(col)
    setSortAsc(newAsc)
    loadPage(1, searchInput, col, newAsc, stockFilter)
  }

  function applyFilter(f: StockFilter) {
    setStockFilter(f)
    loadPage(1, searchInput, sortCol, sortAsc, f)
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
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
        .from('raw_materials').update(payload).eq('id', editing.id).eq('company_id', companyId ?? '').select().single()
      if (err) {
        setFormError(err.message); toast.error(t('materials.error_update')); setSaving(false); return
      }
      setMaterials((prev) => prev.map((m) => m.id === editing.id ? { ...data, suppliers: m.suppliers } : m))
      toast.success(t('materials.updated_toast'))
    } else {
      const { data, error: err } = await supabase
        .from('raw_materials').insert([{ ...payload, company_id: companyId }]).select().single()
      if (err) {
        setFormError(err.message); toast.error(t('materials.error_create')); setSaving(false); return
      }
      setMaterials((prev) => [{ ...data, suppliers: null }, ...prev])
      setTotalAll((prev) => prev + 1)
      toast.success(t('materials.created_toast'))
      if (companyId) logActivity({
        companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'raw_material.created', entityType: 'raw_material', entityId: data.id,
        message: `${actorName(user?.email)} added raw material ${data.name}`,
      }).catch(err => console.error('[logActivity] raw_material.created failed:', err))
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

    const { error: err } = await supabase.from('raw_materials').delete().eq('id', id).eq('company_id', companyId ?? '')
    if (err) {
      toast.error(err.message.includes('foreign key') ? t('materials.error_fk') : err.message)
      return
    }
    setMaterials((prev) => prev.filter((m) => m.id !== id))
    setTotalAll((prev) => prev - 1)
    toast.success(t('materials.deleted_toast'))
    if (companyId) logActivity({
      companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType: 'raw_material.deleted', entityType: 'raw_material', entityId: id,
      message: `${actorName(user?.email)} deleted a raw material`,
    }).catch(err => console.error('[logActivity] raw_material.deleted failed:', err))
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
      const { data, error: err } = await supabase.from('raw_materials').insert([{ ...row, company_id: companyId }]).select().single()
      if (err) {
        errors.push(`Row ${i + 2}: ${err.message}`)
      } else if (data) {
        inserted_rows.push(data)
      }
    }

    const inserted = inserted_rows.length
    if (inserted > 0) {
      setMaterials((prev) => [...inserted_rows.map(r => ({ ...r, suppliers: null })), ...prev])
      setTotalAll((prev) => prev + inserted)
      toast.success(t(inserted !== 1 ? 'materials.count_plural' : 'materials.count', { n: fmtNum(inserted, lang) }))
      if (companyId) logActivity({
        companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'raw_material.imported', entityType: 'raw_material',
        message: `${actorName(user?.email)} imported ${inserted} raw material${inserted !== 1 ? 's' : ''}`,
        metadata: { count: inserted },
      }).catch(err => console.error('[logActivity] raw_material.imported failed:', err))
    }
    return { inserted, skipped: 0, errors }
  }

  const lowStock   = materials.filter((m) => m.quantity_in_stock <= m.reorder_level)
  const isFiltered = stockFilter !== 'all' || searchInput.trim() !== ''

  const formFields = [
    { label: t('common.name'),                 key: 'name',              type: 'text',   placeholder: t('materials.name_placeholder') },
    { label: t('common.unit'),                 key: 'unit',              type: 'text',   placeholder: t('materials.unit_placeholder') },
    { label: t('materials.quantity_in_stock'), key: 'quantity_in_stock', type: 'number', placeholder: '0' },
    { label: t('materials.reorder_level'),     key: 'reorder_level',     type: 'number', placeholder: '0' },
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

      {/* Form modal */}
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

      {/* Low stock banner — click activates filter and scrolls to table */}
      {lowStock.length > 0 && stockFilter === 'all' && (
        <button
          onClick={() => applyFilter('low_stock')}
          className="mb-4 flex w-full items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors text-start"
        >
          <AlertTriangle size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            {t(lowStock.length > 1 ? 'materials.low_stock_banner_plural' : 'materials.low_stock_banner', { n: fmtNum(lowStock.length, lang) })}
          </span>
          <ChevronRight size={14} className="ms-auto shrink-0 text-amber-500 dark:text-amber-400" />
        </button>
      )}

      {/* Toolbar */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <p className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
            {isFiltered
              ? t('materials.count_filtered', { n: fmtNum(totalCount, lang), total: fmtNum(totalAll, lang) })
              : t(totalAll !== 1 ? 'materials.count_plural' : 'materials.count', { n: fmtNum(totalAll, lang) })
            }
          </p>
          <div className="relative min-w-0 max-w-xs flex-1">
            <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('materials.search_placeholder')}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1.5 ps-8 pe-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-[#3a6f8f] focus:ring-2 focus:ring-[#3a6f8f]/40 transition-all"
            />
          </div>
        </div>
        {canWrite && (
          <div className="flex shrink-0 gap-2">
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

      {/* Stock filter pills */}
      <div className="mb-3 flex items-center gap-1.5">
        {(['all', 'low_stock', 'healthy'] as StockFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => applyFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              stockFilter === f
                ? 'bg-[#3a6f8f] text-white'
                : 'bg-gray-100 dark:bg-[#262E36]/55 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#262E36]/80'
            }`}
          >
            {f === 'all' ? t('common.all') : f === 'low_stock' ? t('materials.low_stock') : t('materials.ok_stock')}
          </button>
        ))}
      </div>

      {/* Table */}
      <div ref={tableRef} className="rounded-xl border border-gray-200/60 dark:border-gray-700/40 overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-200 dark:bg-[#262E36]/55" />
            ))}
          </div>
        ) : materials.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <FlaskConical size={40} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">{t('materials.empty')}</p>
            <p className="mt-1 text-xs">{t('materials.empty_sub')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-300 dark:border-gray-500 bg-gray-100 dark:bg-[#2e3c52] text-xs tracking-wide">
                <th className="px-3 py-2 group cursor-pointer select-none text-left text-gray-700 dark:text-gray-100 font-bold hover:text-gray-900 dark:hover:text-white transition-colors duration-150">
                  <button onClick={() => toggleSort('name')} className="inline-flex items-center">
                    {t('common.name')}
                    <SortIcon col="name" sortCol={sortCol} sortAsc={sortAsc} />
                  </button>
                </th>
                <th className="px-3 py-2 group cursor-pointer select-none text-left text-gray-700 dark:text-gray-100 font-bold hover:text-gray-900 dark:hover:text-white transition-colors duration-150">
                  <button onClick={() => toggleSort('quantity_in_stock')} className="inline-flex items-center">
                    {t('common.in_stock')}
                    <SortIcon col="quantity_in_stock" sortCol={sortCol} sortAsc={sortAsc} />
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('common.reorder_at')}</th>
                <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('common.supplier')}</th>
                <th className="px-3 py-2 group cursor-pointer select-none text-left text-gray-700 dark:text-gray-100 font-bold hover:text-gray-900 dark:hover:text-white transition-colors duration-150">
                  <button onClick={() => toggleSort('status')} className="inline-flex items-center">
                    {t('common.status')}
                    <SortIcon col="status" sortCol={sortCol} sortAsc={sortAsc} />
                  </button>
                </th>
                <th className="px-3 py-2 text-end text-gray-700 dark:text-gray-100 font-bold">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/40 bg-white dark:bg-gray-800">
              {materials.map((m) => (
                <tr key={m.id} className="hover:bg-[rgba(58,111,143,0.07)] dark:hover:bg-[rgba(58,111,143,0.13)] transition-colors duration-150">
                  <td className="py-1.5 pl-3 pr-3 font-medium text-gray-900 dark:text-white">{m.name}</td>
                  <td className="px-3 py-1.5 font-semibold text-gray-800 dark:text-gray-200">
                    {fmtQty(m.quantity_in_stock, m.unit, locale)}
                  </td>
                  <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">
                    {fmtQty(m.reorder_level, m.unit, locale)}
                  </td>
                  <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">
                    {m.suppliers ? (
                      <span className="block max-w-[160px] truncate" title={m.suppliers.name}>
                        {m.suppliers.name}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500">{t('materials.no_supplier')}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <StockStatusCell m={m} />
                  </td>
                  <td className="px-3 py-1.5 text-end">
                    {canWrite && (
                      <RowMenu
                        onEdit={() => openEdit(m)}
                        onDelete={() => handleDelete(m.id)}
                      />
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
          onPage={(p) => loadPage(p)}
        />
      </div>
    </>
  )
}
