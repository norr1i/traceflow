'use client'

import { useState, useEffect, useRef } from 'react'
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react'
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
  QrCode, Copy, Download, ExternalLink, Layers, FlaskConical,
} from 'lucide-react'
import PaginationBar from '../components/PaginationBar'

const PAGE_SIZE = 50

type OrderWithProduct = ProductionOrder & { products?: { name: string } | null }
type SimpleProduct    = { id: string; name: string }

const emptyOrder = { product_id: '', quantity: 1, status: 'pending' as ProductionOrder['status'] }
const statuses: ProductionOrder['status'][] = ['pending', 'in_progress', 'completed', 'cancelled']
const emptyBom = { material_name: '', lot_number: '', quantity: '', unit: '' }

type QcStatus = 'pass' | 'fail' | 'hold'
const qcStatusConfig: Record<QcStatus, string> = {
  pass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  fail: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  hold: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
}

function QcBadge({ status, label }: { status: QcStatus; label: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${qcStatusConfig[status]}`}>
      {label}
    </span>
  )
}

export default function ProductionClient() {
  const toast   = useToast()
  const confirm = useConfirm()
  const role       = useRole()
  const { user, companyId } = useAuth()
  const canWrite   = canEdit(role, 'production')
  const canWriteQc = canEdit(role, 'quality-control')
  const { t, lang } = useT()

  const [orders,      setOrders]      = useState<OrderWithProduct[]>([])
  const [products,    setProducts]    = useState<SimpleProduct[]>([])
  const [loading,     setLoading]     = useState(true)
  const [page,        setPage]        = useState(1)
  const [totalCount,  setTotalCount]  = useState(0)
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState<OrderWithProduct | null>(null)
  const [form, setForm]           = useState(emptyOrder)
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [qrOrder, setQrOrder] = useState<OrderWithProduct | null>(null)
  const qrDlRef               = useRef<HTMLDivElement>(null)

  const [materialsOrder, setMaterialsOrder] = useState<OrderWithProduct | null>(null)
  const [bomEntries, setBomEntries]         = useState<BomEntry[]>([])
  const [bomLoading, setBomLoading]         = useState(false)
  const [bomSaving, setBomSaving]           = useState(false)
  const [bomForm, setBomForm]               = useState(emptyBom)

  const [qcOrder,   setQcOrder]   = useState<OrderWithProduct | null>(null)
  const [qcEntries, setQcEntries] = useState<BatchQcResult[]>([])
  const [qcLoading, setQcLoading] = useState(false)
  const [qcSaving,  setQcSaving]  = useState(false)
  const [qcForm,    setQcForm]    = useState<{ status: QcStatus; inspector_name: string; notes: string; inspected_at: string }>({
    status: 'pass', inspector_name: '', notes: '', inspected_at: '',
  })

  const loadPage = (pageNum: number) => {
    if (!companyId) return
    setLoading(true)
    const offset = (pageNum - 1) * PAGE_SIZE
    Promise.all([
      supabase
        .from('production_orders')
        .select('*, products(name)', { count: 'exact' })
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1),
      supabase
        .from('products')
        .select('id, name')
        .eq('company_id', companyId)
        .limit(200),
    ]).then(([{ data: orderData, count }, { data: productData }]) => {
      setOrders(orderData ?? [])
      setTotalCount(count ?? 0)
      setProducts(productData ?? [])
      setLoading(false)
    })
  }

  useEffect(() => { loadPage(1) }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!qcOrder) return
    supabase
      .from('batch_qc_results')
      .select('*')
      .eq('batch_id', qcOrder.id)
      .order('inspected_at', { ascending: false })
      .then(({ data }) => { setQcEntries(data ?? []); setQcLoading(false) })
  }, [qcOrder])

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-200 dark:bg-[#262E36]/55" />
        ))}
      </div>
    )
  }

  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyOrder, product_id: products[0]?.id ?? '' })
    setFormError(null); setShowForm(true)
  }

  function openEdit(o: OrderWithProduct) {
    setEditing(o)
    setForm({ product_id: o.product_id, quantity: o.quantity, status: o.status })
    setFormError(null); setShowForm(true)
  }

  function closeForm() { setShowForm(false); setFormError(null) }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setFormError(null)
    const payload = { product_id: form.product_id, quantity: Number(form.quantity), status: form.status }
    if (editing) {
      const { data, error: err } = await supabase
        .from('production_orders').update(payload).eq('id', editing.id).eq('company_id', companyId ?? '')
        .select('*, products(name)').single()
      if (err) { setFormError(err.message); toast.error(t('production.error_update')); setSaving(false); return }
      setOrders((prev) => prev.map((o) => (o.id === editing.id ? data : o)))
      toast.success(t('production.updated_toast'))
      if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'production_order.updated', entityType: 'production_order', entityId: editing.id,
        message: `${actorName(user?.email)} updated production order status to ${form.status}`,
      }).catch(err => console.error('[logActivity] production_order.updated failed:', err))
    } else {
      const { data, error: err } = await supabase
        .from('production_orders').insert([{ ...payload, company_id: companyId }])
        .select('*, products(name)').single()
      if (err) { setFormError(err.message); toast.error(t('production.error_create')); setSaving(false); return }
      setOrders((prev) => [data, ...prev])
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
    setOrders((prev) => prev.filter((o) => o.id !== id))
    toast.success(t('production.deleted_toast'))
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType: 'production_order.deleted', entityType: 'production_order', entityId: id,
      message: `${actorName(user?.email)} deleted a production order`,
    }).catch(err => console.error('[logActivity] production_order.deleted failed:', err))
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
    if (!materialsOrder) return
    setBomSaving(true)
    const { data, error: err } = await supabase
      .from('bill_of_materials')
      .insert([{
        production_order_id: materialsOrder.id,
        material_name: bomForm.material_name.trim(),
        lot_number: bomForm.lot_number.trim() || null,
        quantity: Number(bomForm.quantity),
        unit: bomForm.unit.trim(),
      }])
      .select('*').single()
    setBomSaving(false)
    if (err) { toast.error(err.message); return }
    setBomEntries((prev) => [...prev, data as BomEntry])
    setBomForm(emptyBom)
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

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t(totalCount !== 1 ? 'production.count_plural' : 'production.count', { n: fmtNum(totalCount, lang) })}
        </p>
        {canWrite && (
          <button onClick={openCreate}
            className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] transition-colors">
            <Plus size={16} /> {t('production.new_order')}
          </button>
        )}
      </div>

      {/* Order create / edit modal */}
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

      {/* QR modal */}
      {qrOrder && (() => {
        const traceUrl = `${window.location.origin}/trace/${qrOrder.id}`
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] dark:backdrop-blur-xl p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('production.batch_qr')}</h2>
                <button onClick={() => setQrOrder(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X size={20} /></button>
              </div>
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-xl bg-white p-4 shadow-inner ring-1 ring-gray-100">
                  <QRCodeSVG value={traceUrl} size={192} level="H" marginSize={1} />
                </div>
                <div className="w-full text-center">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{qrOrder.products?.name ?? '—'}</p>
                  <p className="mt-0.5 font-mono text-xs text-gray-400">{qrOrder.id}</p>
                </div>
                <div className="flex w-full gap-2">
                  <button onClick={handleCopyLink}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 transition-colors">
                    <Copy size={13} /> {t('production.copy_link')}
                  </button>
                  <button onClick={handleDownloadQR}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 transition-colors">
                    <Download size={13} /> {t('production.download')}
                  </button>
                  <a href={`/trace/${qrOrder.id}`} target="_blank" rel="noopener noreferrer"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#3a6f8f] px-3 py-2 text-xs font-medium text-white hover:bg-[#2d5a74] transition-colors">
                    <ExternalLink size={13} /> {t('production.open')}
                  </a>
                </div>
              </div>
              <div ref={qrDlRef} className="hidden">
                <QRCodeCanvas value={traceUrl} size={512} level="H" marginSize={4} />
              </div>
            </div>
          </div>
        )
      })()}

      {/* BOM modal */}
      {materialsOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex w-full max-w-lg flex-col rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] dark:backdrop-blur-xl shadow-2xl" style={{ maxHeight: '90vh' }}>
            <div className="flex items-start justify-between border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('production.bom_title')}</h2>
                <p className="mt-0.5 text-xs text-gray-400">{materialsOrder.products?.name} · {materialsOrder.id.slice(0, 8)}</p>
              </div>
              <button onClick={() => { setMaterialsOrder(null); setBomEntries([]) }} className="ml-4 mt-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
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
                          <button onClick={() => deleteMaterial(entry.id)}
                            className="rounded p-1 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                            <Trash2 size={13} />
                          </button>
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
                <input required placeholder={t('production.material_name')} value={bomForm.material_name}
                  onChange={(e) => setBomForm({ ...bomForm, material_name: e.target.value })}
                  className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]" />
                <div className="flex gap-2">
                  <input placeholder={t('production.lot_optional')} value={bomForm.lot_number}
                    onChange={(e) => setBomForm({ ...bomForm, lot_number: e.target.value })}
                    className="flex-1 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]" />
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
                  <button type="submit" disabled={bomSaving}
                    className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] disabled:opacity-60 transition-colors">
                    <Plus size={14} /> {bomSaving ? t('production.adding') : t('production.add_material')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* QC Inspection modal */}
      {qcOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex w-full max-w-lg flex-col rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] dark:backdrop-blur-xl shadow-2xl" style={{ maxHeight: '90vh' }}>
            <div className="flex items-start justify-between border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('production.qc_title')}</h2>
                <p className="mt-0.5 text-xs text-gray-400">{qcOrder.products?.name} · {qcOrder.id.slice(0, 8)}</p>
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

      {/* Orders table */}
      <div className="overflow-hidden rounded-2xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <ClipboardList size={40} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">{t('production.empty')}</p>
            <p className="mt-1 text-xs">{t('production.empty_sub')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#D1CFC9]/50 dark:bg-[#262E36]/38 text-xs text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t('production.product_col')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('production.quantity_col')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('production.status_col')}</th>
                <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t('production.created_col')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('production.actions_col')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-[#B3B7BA]/[0.07]">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/22 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{o.products?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{fmtNum(o.quantity, lang)}</td>
                  <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-3 text-gray-400 dark:text-gray-500 hidden sm:table-cell">
                    {new Date(o.created_at).toLocaleDateString(locale)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <div className="flex items-center justify-end gap-2">
                      {canWrite && (
                        <button onClick={() => { setBomLoading(true); setMaterialsOrder(o) }}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                          title={t('production.bom_title')}>
                          <Layers size={15} />
                        </button>
                      )}
                      <button onClick={() => openQc(o)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                        title={t('production.qc_title')}>
                        <FlaskConical size={15} />
                      </button>
                      <button onClick={() => setQrOrder(o)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-purple-50 dark:hover:bg-purple-900/30 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                        title={t('production.batch_qr')}>
                        <QrCode size={15} />
                      </button>
                      {canWrite && (
                        <>
                          <button onClick={() => openEdit(o)}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => handleDelete(o.id)}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-colors">
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
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
