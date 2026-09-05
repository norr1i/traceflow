'use client'

import { useState, useEffect, useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { BatchLabel, type LabelSize } from '../components/BatchLabel'
import { supabase } from '../lib/supabase'
import type { ProductionOrder, BomEntry, BatchQcResult } from '../types/traceflow'
import StatusBadge from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { useAuth, useRole } from '../lib/auth-context'
import { canEdit } from '../lib/permissions'
import { logActivity, actorName } from '../lib/activity'
import { useT, fmtNum } from '../lib/i18n'
import {
  Plus, Pencil, Trash2, X, Check, AlertTriangle, ClipboardList,
  QrCode, Copy, Download, ExternalLink, Layers, FlaskConical, GitBranch, Printer,
  MoreHorizontal, XCircle, ChevronsUpDown, ChevronUp, ChevronDown, Search,
  Play, Package,
} from 'lucide-react'
import PaginationBar from '../components/PaginationBar'

const PAGE_SIZE = 50

type OrderWithProduct = ProductionOrder & { products?: { name: string; sku?: string | null } | null }
type SimpleProduct    = { id: string; name: string }
type SortColProd     = 'urgency' | 'order_number' | 'quantity' | 'due_date'
type StatusFilter    = 'all' | ProductionOrder['status']

type BomRawMat = { id: string; name: string; unit: string; suppliers: { name: string } | { name: string }[] | null }
type BomLot = {
  id: string
  lot_number: string
  status: string
  quantity: number | null
  unit: string | null
  received_at: string | null
  suppliers: { name: string } | { name: string }[] | null
}
type BomSupplier = { id: string; name: string }

const emptyOrder = { product_id: '', quantity: 1, status: 'pending' as ProductionOrder['status'], due_date: '' }
const statuses: ProductionOrder['status'][] = ['pending', 'in_progress', 'completed', 'cancelled']
const emptyBom = { quantity: '', unit: '' }
const emptyCreateLot = { lot_number: '', supplier_id: '', quantity: '', unit: '', received_at: '' }

type QcStatus = 'pass' | 'fail' | 'hold'
const qcStatusConfig: Record<QcStatus, string> = {
  pass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  fail: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  hold: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
}

function formatOrderNumber(id: string, createdAt: string): string {
  const year = new Date(createdAt).getFullYear()
  const hash = parseInt(id.replace(/-/g, '').slice(0, 8), 16) % 1000000
  return `PO-${year}-${String(hash).padStart(6, '0')}`
}

function urgencyTier(o: OrderWithProduct, today: string): number {
  if (o.status === 'completed') return 3
  if (o.status === 'cancelled') return 4
  if (o.due_date && o.due_date < today) return 0
  if (o.status === 'in_progress') return 1
  return 2
}

function isOverdue(o: OrderWithProduct, today: string): boolean {
  return !!(o.due_date && o.due_date < today && o.status !== 'completed' && o.status !== 'cancelled')
}

function fmtDueDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function QcBadge({ status, label }: { status: QcStatus; label: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${qcStatusConfig[status]}`}>
      {label}
    </span>
  )
}

function SortIcon({ col, sortCol, sortAsc }: { col: SortColProd; sortCol: SortColProd; sortAsc: boolean }) {
  if (sortCol !== col) return <ChevronsUpDown size={12} className="ms-1 opacity-40" />
  return sortAsc ? <ChevronUp size={12} className="ms-1" /> : <ChevronDown size={12} className="ms-1" />
}

function OrderRowMenu({
  order,
  canWrite,
  onBom,
  onQc,
  onEdit,
  onCancel,
  onStartProduction,
  onPrintLabel,
}: {
  order: OrderWithProduct
  canWrite: boolean
  onBom: () => void
  onQc: () => void
  onEdit: () => void
  onCancel: () => void
  onStartProduction: () => void
  onPrintLabel: () => void
}) {
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

  const status = order.status
  const itemCls = 'flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#262E36]/55 transition-colors'
  const divider  = <div className="mx-3 my-1 h-px bg-gray-100 dark:bg-[#B3B7BA]/[0.10]" />
  const viewBatchesItem = (
    <a href={`/trace/${order.id}`} onClick={() => setOpen(false)} className={itemCls}>
      <Package size={13} /> View batches
    </a>
  )

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-[#262E36]/55 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="absolute end-0 z-10 mt-1 w-48 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-white dark:bg-[#141e28] shadow-lg overflow-hidden">

          {status === 'pending' && canWrite && (<>
            <button onClick={() => { onEdit(); setOpen(false) }} className={itemCls}>
              <Pencil size={13} /> Edit order
            </button>
            <button onClick={() => { onStartProduction(); setOpen(false) }} className={itemCls}>
              <Play size={13} /> Start production
            </button>
            {divider}
            <button onClick={() => { onCancel(); setOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
              <XCircle size={13} /> {t('production.cancel_order')}
            </button>
          </>)}

          {status === 'in_progress' && (<>
            {canWrite && (
              <button onClick={() => { onBom(); setOpen(false) }} className={itemCls}>
                <Layers size={13} /> Record output
              </button>
            )}
            {viewBatchesItem}
            <button onClick={() => { onQc(); setOpen(false) }} className={itemCls}>
              <FlaskConical size={13} /> Quality records
            </button>
            {canWrite && (<>
              {divider}
              <button onClick={() => { onCancel(); setOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                <XCircle size={13} /> {t('production.cancel_order')}
              </button>
            </>)}
          </>)}

          {status === 'completed' && (<>
            {viewBatchesItem}
            <button onClick={() => { onQc(); setOpen(false) }} className={itemCls}>
              <FlaskConical size={13} /> Quality records
            </button>
            <button onClick={() => { onPrintLabel(); setOpen(false) }} className={itemCls}>
              <Printer size={13} /> Print batch record
            </button>
          </>)}

          {status === 'cancelled' && viewBatchesItem}

        </div>
      )}
    </div>
  )
}

export default function ProductionClient() {
  const toast   = useToast()
  const confirm = useConfirm()
  const role       = useRole()
  const { user, companyId, companyName } = useAuth()
  const canWrite   = canEdit(role, 'production')
  const canWriteQc = canEdit(role, 'quality-control')
  const { t, lang } = useT()

  const [allOrders,   setAllOrders]   = useState<OrderWithProduct[]>([])
  const [products,    setProducts]    = useState<SimpleProduct[]>([])
  const [loading,     setLoading]     = useState(true)
  const [page,        setPage]        = useState(1)

  const [searchInput,   setSearchInput]   = useState('')
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>('all')
  const [sortCol,       setSortCol]       = useState<SortColProd>('urgency')
  const [sortAsc,       setSortAsc]       = useState(true)

  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState<OrderWithProduct | null>(null)
  const [form, setForm]           = useState(emptyOrder)
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [qrOrder,    setQrOrder]    = useState<OrderWithProduct | null>(null)
  const [labelSize,  setLabelSize]  = useState<LabelSize>('standard')
  const qrDlRef                     = useRef<HTMLDivElement>(null)
  const currentSelectedRawMatIdRef  = useRef<string | null>(null)
  const currentMaterialsOrderIdRef  = useRef<string | null>(null)

  const [materialsOrder, setMaterialsOrder] = useState<OrderWithProduct | null>(null)
  const [bomEntries, setBomEntries]         = useState<BomEntry[]>([])
  const [bomLoading, setBomLoading]         = useState(false)
  const [bomSaving, setBomSaving]           = useState(false)
  const [bomForm, setBomForm]               = useState(emptyBom)
  const [rawMats,        setRawMats]        = useState<BomRawMat[]>([])
  const [rawMatsLoading, setRawMatsLoading] = useState(false)
  const [selectedRawMat, setSelectedRawMat] = useState<BomRawMat | null>(null)
  const [availableLots,  setAvailableLots]  = useState<BomLot[]>([])
  const [lotsLoading,    setLotsLoading]    = useState(false)
  const [selectedLot,    setSelectedLot]    = useState<BomLot | null>(null)

  const [showCreateLot,    setShowCreateLot]    = useState(false)
  const [createLotSaving,  setCreateLotSaving]  = useState(false)
  const [createLotForm,    setCreateLotForm]    = useState(emptyCreateLot)
  const [suppliers,        setSuppliers]        = useState<BomSupplier[]>([])
  const [suppliersLoading, setSuppliersLoading] = useState(false)
  const [createLotMatId,   setCreateLotMatId]   = useState<string | null>(null)

  const [qcOrder,   setQcOrder]   = useState<OrderWithProduct | null>(null)
  const [qcEntries, setQcEntries] = useState<BatchQcResult[]>([])
  const [qcLoading, setQcLoading] = useState(false)
  const [qcSaving,  setQcSaving]  = useState(false)
  const [qcForm,    setQcForm]    = useState<{ status: QcStatus; inspector_name: string; notes: string; inspected_at: string }>({
    status: 'pass', inspector_name: '', notes: '', inspected_at: '',
  })

  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'
  const today  = new Date().toISOString().slice(0, 10)

  function loadOrders() {
    if (!companyId) return
    setLoading(true)
    Promise.all([
      supabase
        .from('production_orders')
        .select('*, products(name, sku)')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false }),
      supabase
        .from('products')
        .select('id, name')
        .eq('company_id', companyId)
        .limit(200),
    ]).then(([{ data: orderData }, { data: productData }]) => {
      setAllOrders((orderData ?? []) as OrderWithProduct[])
      setProducts(productData ?? [])
      setLoading(false)
    })
  }

  useEffect(() => { loadOrders() }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!materialsOrder) return
    supabase
      .from('bill_of_materials')
      .select('*')
      .eq('production_order_id', materialsOrder.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => { setBomEntries(data ?? []); setBomLoading(false) })
  }, [materialsOrder])

  useEffect(() => {
    if (!materialsOrder || !companyId) { setRawMats([]); return }
    let cancelled = false
    setRawMatsLoading(true)
    supabase
      .from('raw_materials')
      .select('id, name, unit, supplier_id, suppliers(name)')
      .eq('company_id', companyId)
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        setRawMats((data ?? []) as BomRawMat[])
        setRawMatsLoading(false)
      })
    return () => { cancelled = true }
  }, [materialsOrder, companyId])

  useEffect(() => {
    setSelectedLot(null)
    setAvailableLots([])
    if (!selectedRawMat || !companyId) return
    let cancelled = false
    setLotsLoading(true)
    supabase
      .from('raw_material_lots')
      .select('id, lot_number, status, quantity, unit, received_at, suppliers(name)')
      .eq('company_id', companyId)
      .eq('raw_material_id', selectedRawMat.id)
      .eq('status', 'available')
      .order('received_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return
        setAvailableLots((data ?? []) as BomLot[])
        setLotsLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedRawMat, companyId])

  useEffect(() => {
    if (!showCreateLot || !companyId) { setSuppliers([]); setSuppliersLoading(false); return }
    let cancelled = false
    setSuppliersLoading(true)
    supabase
      .from('suppliers')
      .select('id, name')
      .eq('company_id', companyId)
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        setSuppliers((data ?? []) as BomSupplier[])
        setSuppliersLoading(false)
      })
    return () => { cancelled = true }
  }, [showCreateLot, companyId])

  useEffect(() => {
    if (!showCreateLot || !createLotMatId) return
    if ((selectedRawMat?.id ?? null) !== createLotMatId) {
      setShowCreateLot(false)
      setCreateLotForm(emptyCreateLot)
      setCreateLotMatId(null)
    }
  }, [showCreateLot, createLotMatId, selectedRawMat?.id])

  useEffect(() => { currentSelectedRawMatIdRef.current = selectedRawMat?.id ?? null }, [selectedRawMat])
  useEffect(() => { currentMaterialsOrderIdRef.current  = materialsOrder?.id  ?? null }, [materialsOrder])

  useEffect(() => {
    if (!qcOrder) return
    supabase
      .from('batch_qc_results')
      .select('*')
      .eq('batch_id', qcOrder.id)
      .order('inspected_at', { ascending: false })
      .then(({ data }) => { setQcEntries(data ?? []); setQcLoading(false) })
  }, [qcOrder])

  // ── Client-side derived state ────────────────────────────────────────────
  const searchLower = searchInput.trim().toLowerCase()

  let filteredOrders = allOrders
  if (statusFilter !== 'all') {
    filteredOrders = filteredOrders.filter((o) => o.status === statusFilter)
  }
  if (searchLower) {
    filteredOrders = filteredOrders.filter((o) =>
      formatOrderNumber(o.id, o.created_at).toLowerCase().includes(searchLower) ||
      (o.products?.name ?? '').toLowerCase().includes(searchLower)
    )
  }

  const statusCounts: Record<string, number> = {
    all:         allOrders.length,
    pending:     allOrders.filter((o) => o.status === 'pending').length,
    in_progress: allOrders.filter((o) => o.status === 'in_progress').length,
    completed:   allOrders.filter((o) => o.status === 'completed').length,
    cancelled:   allOrders.filter((o) => o.status === 'cancelled').length,
  }

  const sortedOrders = [...filteredOrders].sort((a, b) => {
    switch (sortCol) {
      case 'urgency': {
        const diff = urgencyTier(a, today) - urgencyTier(b, today)
        if (diff !== 0) return diff
        if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
        if (a.due_date) return -1
        if (b.due_date) return 1
        return b.created_at.localeCompare(a.created_at)
      }
      case 'order_number':
        return sortAsc
          ? a.created_at.localeCompare(b.created_at)
          : b.created_at.localeCompare(a.created_at)
      case 'quantity':
        return sortAsc ? a.quantity - b.quantity : b.quantity - a.quantity
      case 'due_date': {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return sortAsc ? a.due_date.localeCompare(b.due_date) : b.due_date.localeCompare(a.due_date)
      }
      default: return 0
    }
  })

  const totalCount    = sortedOrders.length
  const totalPages    = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const safePage      = Math.min(page, totalPages)
  const offset        = (safePage - 1) * PAGE_SIZE
  const displayOrders = sortedOrders.slice(offset, offset + PAGE_SIZE)
  const isFiltered    = statusFilter !== 'all' || searchLower !== ''

  function toggleSort(col: SortColProd) {
    if (col === sortCol) { setSortAsc((a) => !a) } else { setSortCol(col); setSortAsc(true) }
    setPage(1)
  }

  // ── Form handlers ────────────────────────────────────────────────────────
  function openCreate() {
    setEditing(null)
    setForm({ ...emptyOrder, product_id: products[0]?.id ?? '' })
    setFormError(null); setShowForm(true)
  }

  function openEdit(o: OrderWithProduct) {
    setEditing(o)
    setForm({ product_id: o.product_id, quantity: o.quantity, status: o.status, due_date: o.due_date ?? '' })
    setFormError(null); setShowForm(true)
  }

  function closeForm() { setShowForm(false); setFormError(null) }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setFormError(null)
    const payload: Record<string, unknown> = {
      product_id: form.product_id,
      quantity: Number(form.quantity),
      status: form.status,
    }
    if (form.due_date) {
      payload.due_date = form.due_date
    } else if (editing && editing.due_date) {
      payload.due_date = null
    }
    if (editing) {
      const { data, error: err } = await supabase
        .from('production_orders').update(payload).eq('id', editing.id).eq('company_id', companyId ?? '')
        .select('*, products(name, sku)').single()
      if (err) { setFormError(err.message); toast.error(t('production.error_update')); setSaving(false); return }
      setAllOrders((prev) => prev.map((o) => (o.id === editing.id ? data : o)))
      toast.success(t('production.updated_toast'))
      if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'production_order.updated', entityType: 'production_order', entityId: editing.id,
        message: `${actorName(user?.email)} updated production order status to ${form.status}`,
      }).catch(err => console.error('[logActivity] production_order.updated failed:', err))
    } else {
      const { data, error: err } = await supabase
        .from('production_orders').insert([{ ...payload, company_id: companyId }])
        .select('*, products(name, sku)').single()
      if (err) { setFormError(err.message); toast.error(t('production.error_create')); setSaving(false); return }
      setAllOrders((prev) => [data as OrderWithProduct, ...prev])
      toast.success(t('production.created_toast'))
      if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'production_order.created', entityType: 'production_order', entityId: data.id,
        message: `${actorName(user?.email)} created a production order`,
      }).catch(err => console.error('[logActivity] production_order.created failed:', err))
    }
    setSaving(false); setShowForm(false)
  }

  async function handleDelete(id: string) {
    const ok = await confirm({ title: t('production.delete_title'), message: t('production.delete_message'), confirmLabel: t('common.delete') })
    if (!ok) return
    const { error: err } = await supabase.from('production_orders').delete().eq('id', id).eq('company_id', companyId ?? '')
    if (err) { toast.error(err.message); return }
    setAllOrders((prev) => prev.filter((o) => o.id !== id))
    toast.success(t('production.deleted_toast'))
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType: 'production_order.deleted', entityType: 'production_order', entityId: id,
      message: `${actorName(user?.email)} deleted a production order`,
    }).catch(err => console.error('[logActivity] production_order.deleted failed:', err))
  }

  async function handleCancel(o: OrderWithProduct) {
    const ok = await confirm({ title: t('production.cancel_title'), message: t('production.cancel_message'), confirmLabel: t('production.cancel_order') })
    if (!ok) return
    const { error: err } = await supabase
      .from('production_orders').update({ status: 'cancelled' }).eq('id', o.id).eq('company_id', companyId ?? '')
    if (err) { toast.error(err.message); return }
    setAllOrders((prev) => prev.map((ord) => ord.id === o.id ? { ...ord, status: 'cancelled' as const } : ord))
    toast.success(t('production.cancelled_toast'))
  }

  async function handleStartProduction(o: OrderWithProduct) {
    const { error: err } = await supabase
      .from('production_orders').update({ status: 'in_progress' }).eq('id', o.id).eq('company_id', companyId ?? '')
    if (err) { toast.error(err.message); return }
    setAllOrders((prev) => prev.map((ord) => ord.id === o.id ? { ...ord, status: 'in_progress' as const } : ord))
    toast.success('Production started')
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType: 'production_order.updated', entityType: 'production_order', entityId: o.id,
      message: `${actorName(user?.email)} started production for order`,
    }).catch(err => console.error('[logActivity] production_order.started failed:', err))
  }

  function handleDownloadQR() {
    const canvas = qrDlRef.current?.querySelector('canvas')
    if (!canvas || !qrOrder) return
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url; a.download = `trace-${qrOrder.id.slice(0, 8)}.png`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  function handleCopyLink() {
    if (!qrOrder) return
    navigator.clipboard?.writeText(`${window.location.origin}/trace/${qrOrder.id}`)
    toast.success(t('production.link_copied'))
  }

  async function addMaterial(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!materialsOrder || !selectedRawMat || !selectedLot) return
    const qty = Number(bomForm.quantity)
    if (!qty || qty <= 0) { toast.error('Enter a valid quantity'); return }
    if (!bomForm.unit.trim()) { toast.error('Enter a unit'); return }
    setBomSaving(true)
    const { data, error: err } = await supabase
      .from('bill_of_materials')
      .insert([{
        production_order_id: materialsOrder.id,
        material_name:       selectedRawMat.name,
        lot_number:          selectedLot.lot_number,
        raw_material_lot_id: selectedLot.id,
        quantity:            Number(bomForm.quantity),
        unit:                bomForm.unit.trim(),
      }])
      .select('*').single()
    setBomSaving(false)
    if (err) { toast.error(err.message); return }
    setBomEntries((prev) => [...prev, data as BomEntry])
    setBomForm(emptyBom)
    setSelectedLot(null)
    toast.success(t('production.material_added'))
  }

  async function deleteMaterial(id: string) {
    const { error: err } = await supabase.from('bill_of_materials').delete().eq('id', id)
    if (err) { toast.error(err.message); return }
    setBomEntries((prev) => prev.filter((e) => e.id !== id))
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType: 'bill_of_materials.deleted', entityType: 'bill_of_materials', entityId: id,
      message: `${actorName(user?.email)} deleted a bill of materials entry`,
    }).catch(err => console.error('[logActivity] bill_of_materials.deleted failed:', err))
  }

  async function createLot() {
    if (!materialsOrder || !selectedRawMat || !companyId || !createLotMatId) return
    if (selectedRawMat.id !== createLotMatId) return
    if (!createLotForm.lot_number.trim())  { toast.error('Enter a lot number'); return }
    const qty = Number(createLotForm.quantity)
    if (!qty || qty <= 0)                  { toast.error('Enter a valid quantity'); return }
    if (!createLotForm.unit.trim())        { toast.error('Enter a unit'); return }
    if (!createLotForm.received_at)        { toast.error('Enter a date received'); return }
    const targetMaterialId = createLotMatId
    const targetOrderId    = materialsOrder.id
    const supId            = createLotForm.supplier_id
    setCreateLotSaving(true)
    try {
      const { data, error: err } = await supabase
        .from('raw_material_lots')
        .insert([{
          company_id:      companyId,
          raw_material_id: createLotMatId,
          lot_number:      createLotForm.lot_number.trim(),
          quantity:        qty,
          unit:            createLotForm.unit.trim(),
          supplier_id:     supId || null,
          received_at:     createLotForm.received_at,
          status:          'available',
        }])
        .select('*')
        .single()
      if (err) {
        if (err.code === '23505') {
          toast.error('A lot with this number already exists for this material')
        } else {
          toast.error(err.message)
        }
        return
      }
      if (
        currentSelectedRawMatIdRef.current === targetMaterialId &&
        currentMaterialsOrderIdRef.current  === targetOrderId
      ) {
        const supObj = suppliers.find((s) => s.id === supId)
        const syntheticLot: BomLot = {
          id:          data.id,
          lot_number:  data.lot_number,
          status:      data.status,
          quantity:    data.quantity,
          unit:        data.unit,
          received_at: data.received_at,
          suppliers:   supObj ? { name: supObj.name } : null,
        }
        setAvailableLots((prev) => [syntheticLot, ...prev])
        setSelectedLot(syntheticLot)
      }
      setShowCreateLot(false)
      setCreateLotForm(emptyCreateLot)
      setCreateLotMatId(null)
      toast.success('Lot created')
    } finally {
      setCreateLotSaving(false)
    }
  }

  function openQc(o: OrderWithProduct) {
    setQcLoading(true)
    setQcOrder(o)
    setQcForm({ status: 'pass', inspector_name: '', notes: '', inspected_at: new Date().toISOString().slice(0, 16) })
  }

  async function addQcResult(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!qcOrder) return
    setQcSaving(true)
    const { data, error: err } = await supabase
      .from('batch_qc_results')
      .insert([{
        batch_id: qcOrder.id,
        status: qcForm.status,
        inspector_name: qcForm.inspector_name.trim(),
        notes: qcForm.notes.trim() || null,
        inspected_at: new Date(qcForm.inspected_at).toISOString(),
      }])
      .select('*').single()
    setQcSaving(false)
    if (err) { toast.error(err.message); return }
    setQcEntries((prev) => [data as BatchQcResult, ...prev])
    setQcForm((f) => ({ ...f, inspector_name: '', notes: '', inspected_at: new Date().toISOString().slice(0, 16) }))
    toast.success(t('production.qc_recorded'))
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType: 'qc_result.added', entityType: 'production_order', entityId: qcOrder.id,
      message: `${actorName(user?.email)} recorded QC ${qcForm.status} for a production batch`,
      metadata: { status: qcForm.status, inspector: qcForm.inspector_name },
    }).catch(err => console.error('[logActivity] qc_result.added failed:', err))
  }

  async function deleteQcResult(id: string) {
    const { error: err } = await supabase.from('batch_qc_results').delete().eq('id', id)
    if (err) { toast.error(err.message); return }
    setQcEntries((prev) => prev.filter((e) => e.id !== id))
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType: 'qc_result.deleted', entityType: 'batch_qc_results', entityId: id,
      message: `${actorName(user?.email)} deleted a QC result`,
    }).catch(err => console.error('[logActivity] qc_result.deleted failed:', err))
  }

  // Suppress unused-var warning — handleDelete is kept but not exposed in UI per product decision
  void handleDelete

  const _rawMatNameCounts = new Map<string, number>()
  rawMats.forEach((m) => _rawMatNameCounts.set(m.name, (_rawMatNameCounts.get(m.name) ?? 0) + 1))
  const _rawMatBaseLabelCounts = new Map<string, number>()
  rawMats.forEach((m) => {
    if ((_rawMatNameCounts.get(m.name) ?? 0) > 1) {
      const sup = m.suppliers
      const sn = !sup ? '—' : Array.isArray(sup) ? (sup.length > 0 ? (sup as { name: string }[])[0].name : '—') : sup.name
      const base = `${m.name} · ${sn}`
      _rawMatBaseLabelCounts.set(base, (_rawMatBaseLabelCounts.get(base) ?? 0) + 1)
    }
  })
  const rawMatLabel = (m: BomRawMat): string => {
    if ((_rawMatNameCounts.get(m.name) ?? 0) <= 1) return m.name
    const sup = m.suppliers
    const sn = !sup ? '—' : Array.isArray(sup) ? (sup.length > 0 ? (sup as { name: string }[])[0].name : '—') : sup.name
    const base = `${m.name} · ${sn}`
    return (_rawMatBaseLabelCounts.get(base) ?? 0) > 1 ? `${base} · Ref ${m.id.slice(0, 8)}` : base
  }

  return (
    <>
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <p className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
            {isFiltered
              ? t('production.count_filtered', { n: fmtNum(totalCount, lang), total: fmtNum(allOrders.length, lang) })
              : t(allOrders.length !== 1 ? 'production.count_plural' : 'production.count', { n: fmtNum(allOrders.length, lang) })
            }
          </p>
          <div className="relative min-w-0 max-w-xs flex-1">
            <Search size={13} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setPage(1) }}
              placeholder={t('production.search_placeholder')}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1.5 ps-8 pe-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-[#3a6f8f] focus:ring-2 focus:ring-[#3a6f8f]/40 transition-all"
            />
          </div>
        </div>
        {canWrite && (
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={openCreate}
              className="flex items-center gap-1.5 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] transition-colors">
              <Plus size={15} /> {t('production.new_order')}
            </button>
          </div>
        )}
      </div>

      {/* Status filter pills */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {([
          ['all',         t('common.all')],
          ['pending',     t('status.pending')],
          ['in_progress', t('status.in_progress')],
          ['completed',   t('status.completed')],
          ['cancelled',   t('status.cancelled')],
        ] as [StatusFilter, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setStatusFilter(key); setPage(1) }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === key
                ? 'bg-[#3a6f8f] text-white'
                : 'bg-[#E6E4E0] dark:bg-[#262E36]/55 text-gray-600 dark:text-gray-400 hover:bg-[#D1CFC9]/80 dark:hover:bg-[#262E36]/75'
            }`}
          >
            {label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              statusFilter === key
                ? 'bg-white/20 text-white'
                : 'bg-gray-200/70 dark:bg-[#B3B7BA]/20 text-gray-500 dark:text-gray-400'
            }`}>
              {fmtNum(statusCounts[key] ?? 0, lang)}
            </span>
          </button>
        ))}
      </div>

      {/* ── Order create / edit modal ─────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] dark:backdrop-blur-xl p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editing ? t('production.edit_order') : t('production.new_order_title')}
              </h2>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('common.product')}</label>
                <select required value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}
                  className="w-full rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/30 transition-colors">
                  <option value="">{t('production.select_product')}</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('common.quantity')}</label>
                <input required type="number" min={1} value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                  className="w-full rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/30 transition-colors" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('common.status')}</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProductionOrder['status'] })}
                  className="w-full rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/30 transition-colors">
                  {statuses.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('production.due_date_col')} <span className="font-normal text-gray-400">({t('common.optional')})</span>
                </label>
                <input type="date" value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  className="w-full rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/30 transition-colors" />
              </div>
              {formError && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  <AlertTriangle size={14} className="shrink-0" />{formError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closeForm}
                  className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 transition-colors">{t('common.cancel')}</button>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 rounded-xl bg-[#3a6f8f] hover:bg-[#2d5a74] px-4 py-2 text-sm font-medium text-white disabled:opacity-60 transition-colors shadow-[0_0_16px_rgba(74,127,165,0.22)]">
                  <Check size={15} /> {saving ? t('common.saving') : editing ? t('common.update') : t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Batch Label Modal ──────────────────────────────────────────────── */}
      {qrOrder && (() => {
        const traceUrl = `${window.location.origin}/trace/${qrOrder.id}`
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-[440px] rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] dark:backdrop-blur-xl shadow-2xl overflow-hidden">

              {/* Header: title + size selector + close */}
              <div className="flex items-center gap-3 border-b border-gray-200/60 dark:border-white/[0.07] px-5 py-3.5">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white shrink-0">Batch Label</h2>
                <div className="flex rounded-lg border border-[#B3B7BA]/40 dark:border-white/[0.08] overflow-hidden">
                  {(['standard', 'large'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setLabelSize(s)}
                      className={`px-2.5 py-1 text-[10px] font-semibold transition-colors whitespace-nowrap ${
                        labelSize === s
                          ? 'bg-gray-900 dark:bg-white/90 text-white dark:text-gray-900'
                          : 'text-gray-500 dark:text-gray-400 hover:bg-[#D1CFC9]/40 dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      {s === 'standard' ? 'Standard 4″×2″' : 'Large 4″×4″'}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setQrOrder(null)}
                  className="ml-auto text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Label preview */}
              <div className="flex items-center justify-center px-5 py-5 bg-[#E2E1DE] dark:bg-[#0a0f18] overflow-auto">
                <BatchLabel
                  order={qrOrder}
                  companyName={companyName}
                  size={labelSize}
                  traceUrl={traceUrl}
                />
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-2 border-t border-gray-200/60 dark:border-white/[0.07] px-5 py-3.5">
                {/* Print Label — primary action */}
                <button
                  onClick={() => {
                    document.body.classList.add('printing-label')
                    window.addEventListener('afterprint', () => {
                      document.body.classList.remove('printing-label')
                    }, { once: true })
                    window.print()
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#3a6f8f] px-3 py-2 text-xs font-semibold text-white hover:bg-[#2d5a74] transition-colors"
                >
                  <Printer size={13} /> Print Label
                </button>
                {/* Copy link */}
                <button
                  onClick={handleCopyLink}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 transition-colors"
                >
                  <Copy size={13} /> Copy Link
                </button>
                {/* Download QR PNG */}
                <button
                  onClick={handleDownloadQR}
                  title="Download QR code as PNG"
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 transition-colors"
                >
                  <Download size={13} />
                </button>
                {/* Open passport */}
                <a
                  href={`/trace/${qrOrder.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open Digital Product Passport"
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 transition-colors"
                >
                  <ExternalLink size={13} />
                </a>
              </div>

              {/* Hidden high-res canvas for PNG download (QR only) */}
              <div ref={qrDlRef} className="hidden" aria-hidden="true">
                <QRCodeCanvas value={traceUrl} size={512} level="H" marginSize={4} />
              </div>

            </div>
          </div>
        )
      })()}

      {/* ── BOM modal ─────────────────────────────────────────────────────── */}
      {materialsOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex w-full max-w-lg flex-col rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] dark:backdrop-blur-xl shadow-2xl" style={{ maxHeight: '90vh' }}>
            <div className="flex items-start justify-between border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('production.bom_title')}</h2>
                <p className="mt-0.5 text-xs text-gray-400">{materialsOrder.products?.name} · {new Date(materialsOrder.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>
              <button onClick={() => { setMaterialsOrder(null); setBomEntries([]); setSelectedRawMat(null); setSelectedLot(null); setAvailableLots([]); setRawMats([]); setBomForm(emptyBom); setShowCreateLot(false); setCreateLotForm(emptyCreateLot); setCreateLotMatId(null); setSuppliers([]) }} className="ml-4 mt-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {bomLoading ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-gray-100 dark:bg-[#262E36]/55" />)}</div>
              ) : bomEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 dark:text-gray-500">
                  <Layers size={28} className="mb-2 opacity-40" />
                  <p className="text-sm">{t('production.bom_empty')}</p>
                  <p className="mt-0.5 text-xs">{t('production.bom_empty_sub')}</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] text-xs text-gray-400 dark:text-gray-500">
                      <th className="pb-2 text-start font-medium">{t('production.mat_col')}</th>
                      <th className="pb-2 text-start font-medium">{t('production.lot_col')}</th>
                      <th className="pb-2 text-end font-medium">{t('production.qty_col')}</th>
                      <th className="pb-2 text-end font-medium">{t('production.unit_col')}</th>
                      <th className="pb-2 text-end font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-[#B3B7BA]/[0.07]">
                    {bomEntries.map((entry) => (
                      <tr key={entry.id} className="group">
                        <td className="py-2.5 font-medium text-gray-900 dark:text-white">{entry.material_name}</td>
                        <td className="py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                          {entry.lot_number || <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                        <td className="py-2.5 text-end text-gray-700 dark:text-gray-300">{entry.quantity}</td>
                        <td className="py-2.5 text-end text-gray-500 dark:text-gray-400">{entry.unit}</td>
                        <td className="py-2.5 text-end">
                          {canWrite && (
                            <button onClick={() => deleteMaterial(entry.id)}
                              className="rounded p-1 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="border-t border-gray-100 dark:border-[#B3B7BA]/[0.10] px-6 py-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">{t('production.add_material')}</p>
              <form onSubmit={addMaterial} className="space-y-2">
                {rawMatsLoading ? (
                  <div className="h-9 animate-pulse rounded-lg bg-gray-100 dark:bg-[#262E36]/55" />
                ) : (
                  <select
                    required
                    value={selectedRawMat?.id ?? ''}
                    onChange={(e) => {
                      const mat = rawMats.find((m) => m.id === e.target.value) ?? null
                      setSelectedRawMat(mat)
                      setBomForm((f) => ({ ...f, unit: mat?.unit ?? '' }))
                    }}
                    className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  >
                    <option value="">Select raw material…</option>
                    {rawMats.map((m) => <option key={m.id} value={m.id}>{rawMatLabel(m)}</option>)}
                  </select>
                )}
                {lotsLoading ? (
                  <div className="h-9 animate-pulse rounded-lg bg-gray-100 dark:bg-[#262E36]/55" />
                ) : (
                  <select
                    required
                    disabled={!selectedRawMat}
                    value={selectedLot?.id ?? ''}
                    onChange={(e) => {
                      setSelectedLot(availableLots.find((l) => l.id === e.target.value) ?? null)
                    }}
                    className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {!selectedRawMat ? (
                      <option value="">Select a material first</option>
                    ) : availableLots.length === 0 ? (
                      <option value="">No available lots for this material</option>
                    ) : (
                      <>
                        <option value="">Select a lot…</option>
                        {availableLots.map((lot) => {
                          const sup = lot.suppliers
                          const supplierName = !sup ? '—'
                            : Array.isArray(sup) ? (sup.length > 0 ? (sup as { name: string }[])[0].name : '—')
                            : sup.name
                          const received = lot.received_at
                            ? new Date(lot.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                            : null
                          return (
                            <option key={lot.id} value={lot.id}>
                              {lot.lot_number} · {supplierName} · {lot.status}{received ? ` · received ${received}` : ''}
                            </option>
                          )
                        })}
                      </>
                    )}
                  </select>
                )}
                {selectedRawMat && canWrite && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const d = new Date()
                        const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                        setCreateLotMatId(selectedRawMat.id)
                        setCreateLotForm({
                          lot_number:  '',
                          supplier_id: '',
                          quantity:    '',
                          unit:        selectedRawMat.unit,
                          received_at: localDate,
                        })
                        setShowCreateLot(true)
                      }}
                      className="text-xs text-[#4a7fa5] hover:text-[#3a6f8f] dark:text-[#6a9fc5] dark:hover:text-[#5a8fb5] transition-colors"
                    >
                      + Create lot
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <input required type="number" min="0.001" step="any" placeholder={t('production.qty_placeholder')} value={bomForm.quantity}
                    onChange={(e) => setBomForm({ ...bomForm, quantity: e.target.value })}
                    className="w-24 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]" />
                  <input required list="bom-units" placeholder={t('production.unit_placeholder')} value={bomForm.unit}
                    onChange={(e) => setBomForm({ ...bomForm, unit: e.target.value })}
                    className="w-24 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]" />
                  <datalist id="bom-units">
                    {['kg', 'g', 'mg', 'L', 'mL', 'pcs', 'units', 'm', 'cm', 'mm'].map((u) => <option key={u} value={u} />)}
                  </datalist>
                </div>
                <div className="flex justify-end">
                  <button type="submit" disabled={bomSaving || !selectedRawMat || !selectedLot}
                    className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] disabled:opacity-60 transition-colors">
                    <Plus size={14} /> {bomSaving ? t('production.adding') : t('production.add_material')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Lot modal ─────────────────────────────────────────────── */}
      {showCreateLot && materialsOrder && selectedRawMat && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] shadow-2xl">
            <div className="flex items-start justify-between border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Create lot</h2>
                <p className="mt-0.5 max-w-[220px] truncate text-xs text-gray-400" title={selectedRawMat.name}>{selectedRawMat.name}</p>
              </div>
              <button
                type="button"
                onClick={() => { setShowCreateLot(false); setCreateLotForm(emptyCreateLot); setCreateLotMatId(null) }}
                className="ml-4 mt-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Lot number *</label>
                <input
                  type="text"
                  placeholder="e.g. LOT-2026-SS316-0001"
                  value={createLotForm.lot_number}
                  onChange={(e) => setCreateLotForm((f) => ({ ...f, lot_number: e.target.value }))}
                  className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Supplier</label>
                {suppliersLoading ? (
                  <div className="h-9 animate-pulse rounded-lg bg-gray-100 dark:bg-[#262E36]/55" />
                ) : (
                  <select
                    value={createLotForm.supplier_id}
                    onChange={(e) => setCreateLotForm((f) => ({ ...f, supplier_id: e.target.value }))}
                    className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  >
                    <option value="">— No supplier</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Quantity received *</label>
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    placeholder="0"
                    value={createLotForm.quantity}
                    onChange={(e) => setCreateLotForm((f) => ({ ...f, quantity: e.target.value }))}
                    className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  />
                </div>
                <div className="w-24">
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Unit *</label>
                  <input
                    list="create-lot-units"
                    placeholder="kg"
                    value={createLotForm.unit}
                    onChange={(e) => setCreateLotForm((f) => ({ ...f, unit: e.target.value }))}
                    className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  />
                  <datalist id="create-lot-units">
                    {['kg', 'g', 'mg', 'L', 'mL', 'pcs', 'units', 'm', 'cm', 'mm'].map((u) => <option key={u} value={u} />)}
                  </datalist>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Date received *</label>
                <input
                  type="date"
                  value={createLotForm.received_at}
                  onChange={(e) => setCreateLotForm((f) => ({ ...f, received_at: e.target.value }))}
                  className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 dark:border-[#B3B7BA]/[0.10] px-6 py-4">
              <button
                type="button"
                onClick={() => { setShowCreateLot(false); setCreateLotForm(emptyCreateLot); setCreateLotMatId(null) }}
                className="rounded-lg px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createLot}
                disabled={createLotSaving || !createLotForm.lot_number.trim() || !createLotForm.quantity || !createLotForm.unit.trim() || !createLotForm.received_at}
                className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] disabled:opacity-60 transition-colors"
              >
                <Plus size={14} /> {createLotSaving ? 'Creating…' : 'Create lot'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QC Inspection modal ───────────────────────────────────────────── */}
      {qcOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex w-full max-w-lg flex-col rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] dark:backdrop-blur-xl shadow-2xl" style={{ maxHeight: '90vh' }}>
            <div className="flex items-start justify-between border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('production.qc_title')}</h2>
                <p className="mt-0.5 text-xs text-gray-400">{qcOrder.products?.name} · {new Date(qcOrder.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>
              <button onClick={() => { setQcOrder(null); setQcEntries([]) }} className="ml-4 mt-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {qcLoading ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100 dark:bg-[#262E36]/55" />)}</div>
              ) : qcEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 dark:text-gray-500">
                  <FlaskConical size={28} className="mb-2 opacity-40" />
                  <p className="text-sm">{t('production.qc_empty')}</p>
                  <p className="mt-0.5 text-xs">{t('production.qc_empty_sub')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {qcEntries.map((entry) => (
                    <div key={entry.id} className="group flex items-start gap-3 rounded-xl border border-gray-100 dark:border-[#B3B7BA]/[0.10] bg-gray-50/50 dark:bg-[#262E36]/18 px-4 py-3">
                      <QcBadge status={entry.status} label={t(`status.${entry.status}`)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{entry.inspector_name}</span>
                          <span className="shrink-0 text-xs text-gray-400">
                            {new Date(entry.inspected_at).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {entry.notes && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{entry.notes}</p>}
                      </div>
                      {canWriteQc && (
                        <button onClick={() => deleteQcResult(entry.id)}
                          className="mt-0.5 shrink-0 rounded p-1 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {canWriteQc && (
            <div className="border-t border-gray-100 dark:border-[#B3B7BA]/[0.10] px-6 py-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">{t('production.record_inspection')}</p>
              <form onSubmit={addQcResult} className="space-y-3">
                <div className="flex gap-2">
                  {(['pass', 'fail', 'hold'] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setQcForm({ ...qcForm, status: s })}
                      className={`flex-1 rounded-lg py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                        qcForm.status === s
                          ? s === 'pass' ? 'bg-emerald-600 text-white shadow-sm'
                          : s === 'fail' ? 'bg-red-600 text-white shadow-sm'
                          : 'bg-amber-500 text-white shadow-sm'
                          : 'border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] text-gray-500 dark:text-gray-400 hover:bg-[#D1CFC9]/30 dark:hover:bg-gray-700'
                      }`}>
                      {t(`status.${s}`)}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input required placeholder={t('production.inspector_name')} value={qcForm.inspector_name}
                    onChange={(e) => setQcForm({ ...qcForm, inspector_name: e.target.value })}
                    className="flex-1 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]" />
                  <input required type="datetime-local" value={qcForm.inspected_at}
                    onChange={(e) => setQcForm({ ...qcForm, inspected_at: e.target.value })}
                    className="rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]" />
                </div>
                <textarea placeholder={t('production.notes_optional')} rows={2} value={qcForm.notes}
                  onChange={(e) => setQcForm({ ...qcForm, notes: e.target.value })}
                  className="w-full resize-none rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]" />
                <div className="flex justify-end">
                  <button type="submit" disabled={qcSaving}
                    className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] disabled:opacity-60 transition-colors">
                    <Plus size={14} /> {qcSaving ? t('common.saving') : t('production.record_result')}
                  </button>
                </div>
              </form>
            </div>
            )}
          </div>
        </div>
      )}

      {/* ── Orders table ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/40 overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-200 dark:bg-[#262E36]/55" />
            ))}
          </div>
        ) : displayOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <ClipboardList size={40} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">{t('production.empty')}</p>
            <p className="mt-1 text-xs">{t('production.empty_sub')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b-2 border-gray-300 dark:border-gray-500 bg-gray-100 dark:bg-[#2e3c52] text-xs tracking-wide">
              <tr>
                <th className="px-3 py-2 group cursor-pointer select-none text-left text-gray-700 dark:text-gray-100 font-bold hover:text-gray-900 dark:hover:text-white transition-colors duration-150">
                  <button onClick={() => toggleSort('order_number')} className="inline-flex items-center">
                    {t('production.order_number_col')}
                    <SortIcon col="order_number" sortCol={sortCol} sortAsc={sortAsc} />
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('production.product_col')}</th>
                <th className="px-3 py-2 group cursor-pointer select-none text-left text-gray-700 dark:text-gray-100 font-bold hover:text-gray-900 dark:hover:text-white transition-colors duration-150">
                  <button onClick={() => toggleSort('quantity')} className="inline-flex items-center">
                    {t('production.quantity_col')}
                    <SortIcon col="quantity" sortCol={sortCol} sortAsc={sortAsc} />
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('production.status_col')}</th>
                <th className="px-3 py-2 group cursor-pointer select-none text-left text-gray-700 dark:text-gray-100 font-bold hover:text-gray-900 dark:hover:text-white transition-colors duration-150 hidden sm:table-cell">
                  <button onClick={() => toggleSort('due_date')} className="inline-flex items-center">
                    {t('production.due_date_col')}
                    <SortIcon col="due_date" sortCol={sortCol} sortAsc={sortAsc} />
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('production.actions_col')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/40 bg-white dark:bg-gray-800">
              {displayOrders.map((o) => {
                const late = isOverdue(o, today)
                return (
                  <tr key={o.id} className="hover:bg-[rgba(58,111,143,0.07)] dark:hover:bg-[rgba(58,111,143,0.13)] transition-colors duration-150">
                    <td className="px-3 py-1.5 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {formatOrderNumber(o.id, o.created_at)}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{o.products?.name ?? '—'}</td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{fmtNum(o.quantity, lang)}</td>
                    <td className="px-3 py-1.5"><StatusBadge status={o.status} /></td>
                    <td className="px-3 py-1.5 hidden sm:table-cell">
                      {o.due_date ? (
                        <span className={late ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-400'}>
                          {fmtDueDate(o.due_date)}
                          {late && (
                            <span className="ms-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                              {t('production.late')}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        {(() => {
                          const qrEnabled = o.status === 'in_progress' || o.status === 'completed'
                          const qrTooltip = o.status === 'pending'   ? 'No batches produced yet'
                                          : o.status === 'cancelled' ? 'Order cancelled'
                                          : 'Print batch QR labels'
                          return (
                            <button
                              onClick={qrEnabled ? () => setQrOrder(o) : undefined}
                              disabled={!qrEnabled}
                              title={qrTooltip}
                              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                                qrEnabled
                                  ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#262E36]/55 hover:text-gray-700 dark:hover:text-gray-200'
                                  : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                              }`}
                            >
                              <QrCode size={13} />QR
                            </button>
                          )
                        })()}
                        <a
                          href={`/product-journey/${o.id}`}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#262E36]/55 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                          title="View Product Journey"
                        >
                          <GitBranch size={13} />Journey
                        </a>
                        <OrderRowMenu
                          order={o}
                          canWrite={canWrite}
                          onBom={() => { setBomLoading(true); setMaterialsOrder(o) }}
                          onQc={() => openQc(o)}
                          onEdit={() => openEdit(o)}
                          onCancel={() => handleCancel(o)}
                          onStartProduction={() => handleStartProduction(o)}
                          onPrintLabel={() => setQrOrder(o)}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <PaginationBar
          page={safePage}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPage={setPage}
        />
      </div>
    </>
  )
}
