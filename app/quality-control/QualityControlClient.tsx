'use client'

import { useQualityInspections } from '../hooks/useQualityInspections'
import { InspectionFormData } from '../types/quality'
import { useState } from 'react'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { useAuth, useRole } from '../lib/auth-context'
import { canEdit, hasPermission } from '../lib/permissions'
import { logActivity, actorName } from '../lib/activity'
import { useT, fmtNum } from '../lib/i18n'
import {
  ShieldCheck, ShieldX, ClipboardList, AlertTriangle,
  CheckCircle2, XCircle, ChevronDown, Search, Plus,
  RefreshCw, TrendingUp, Trash2, X, Lock, Unlock,
} from 'lucide-react'

function StatCard({
  label, value, icon: Icon, color, sub,
}: {
  label: string; value: string | number; icon: React.ElementType; color: string; sub?: string
}) {
  return (
    <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
          <Icon size={20} className="text-white" />
        </span>
      </div>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
      <ClipboardList size={40} className="mb-3 opacity-40" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  )
}

function SeverityBadge({ severity }: { severity?: string }) {
  const { t } = useT()
  const map: Record<string, string> = {
    minor:    'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 ring-yellow-200 dark:ring-yellow-800',
    major:    'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 ring-orange-200 dark:ring-orange-800',
    critical: 'bg-red-100 dark:bg-red-900/20 text-red-900 dark:text-red-400 ring-red-300 dark:ring-red-800',
  }
  const key = (severity ?? 'minor').toLowerCase()
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${map[key] ?? map['minor']}`}>
      {t(`quality.severity_${key}`)}
    </span>
  )
}

const today = new Date().toISOString().slice(0, 10)

const emptyForm: InspectionFormData = {
  batch_id: '',
  inspector_id: '',
  inspection_date: today,
  inspection_type: 'final',
  status: 'pending',
  overall_score: 0,
  notes: null,
}

export default function QualityControlClient() {
  const toast   = useToast()
  const confirm = useConfirm()
  const role    = useRole()
  const { user, companyId } = useAuth()
  const { t, lang } = useT()
  const canEditQc   = canEdit(role, 'quality-control')
  const hasOverride = hasPermission(role, 'override:qc')
  const [qcEditEnabled, setQcEditEnabled] = useState(false)
  const effectiveCanEdit = canEditQc || (hasOverride && qcEditEnabled)
  const {
    inspections, defects, metrics, loading, error, refresh, createInspection, deleteInspection,
  } = useQualityInspections()

  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'failed'>('all')
  const [activeTab, setActiveTab]       = useState<'inspections' | 'defects'>('inspections')
  const [showForm, setShowForm]         = useState(false)
  const [form, setForm]                 = useState<InspectionFormData>(emptyForm)
  const [saving, setSaving]             = useState(false)
  const [formError, setFormError]       = useState<string | null>(null)

  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'

  function openNew() {
    setForm({ ...emptyForm, inspection_date: new Date().toISOString().slice(0, 10) })
    setFormError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true); setFormError(null)
    const result = await createInspection(form)
    setSaving(false)
    if (!result) {
      setFormError(t('quality.error_save'))
      toast.error(t('quality.error_create'))
      return
    }
    setShowForm(false)
    toast.success(t('quality.created_toast'))
    const actionType = form.status === 'passed' ? 'qc_inspection.passed'
      : form.status === 'failed' ? 'qc_inspection.failed'
      : 'qc_inspection.created'
    console.log('[logActivity] pre-call', actionType, '| companyId:', companyId, '| user:', user?.email)
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType, entityType: 'qc_inspection', entityId: result.id,
      message: `${actorName(user?.email)} recorded ${form.inspection_type} inspection: ${form.status}`,
      metadata: { status: form.status, score: form.overall_score },
    }).catch(err => console.error('[logActivity]', actionType, 'failed:', err))
    else console.warn('[logActivity] skipped', actionType, '— companyId is null')
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: t('quality.delete_title'),
      message: t('quality.delete_message'),
      confirmLabel: t('common.delete'),
    })
    if (!ok) return
    const result = await deleteInspection(id)
    if (result) {
      toast.success(t('quality.deleted_toast'))
    } else {
      toast.error(t('quality.error_delete'))
    }
  }

  const total    = inspections.length
  const passed   = inspections.filter((i) => i.status === 'passed').length
  const failed   = total - passed
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0

  const filtered = inspections.filter((i) => {
    const matchSearch =
      search === '' ||
      i.id?.toString().includes(search) ||
      i.batch_id?.toLowerCase().includes(search.toLowerCase()) ||
      i.notes?.toLowerCase().includes(search.toLowerCase())
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'passed' && i.status === 'passed') ||
      (statusFilter === 'failed' && i.status === 'failed')
    return matchSearch && matchStatus
  })

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)] p-6">
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] dark:backdrop-blur-xl p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('quality.new_inspection_title')}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('quality.batch_id')}</label>
                  <input required value={form.batch_id}
                    onChange={(e) => setForm({ ...form, batch_id: e.target.value })}
                    className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                    placeholder={t('quality.batch_id_placeholder')} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('quality.inspector_id')}</label>
                  <input required value={form.inspector_id}
                    onChange={(e) => setForm({ ...form, inspector_id: e.target.value })}
                    className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                    placeholder={t('quality.inspector_id_placeholder')} />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('quality.inspection_date')}</label>
                <input required type="date" value={form.inspection_date}
                  onChange={(e) => setForm({ ...form, inspection_date: e.target.value })}
                  className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('quality.type')}</label>
                  <select value={form.inspection_type}
                    onChange={(e) => setForm({ ...form, inspection_type: e.target.value as InspectionFormData['inspection_type'] })}
                    className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]">
                    <option value="incoming">{t('quality.incoming')}</option>
                    <option value="in_process">{t('quality.in_process')}</option>
                    <option value="final">{t('quality.final')}</option>
                    <option value="random">{t('quality.random')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('common.status')}</label>
                  <select value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as InspectionFormData['status'] })}
                    className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]">
                    <option value="pending">{t('quality.pending')}</option>
                    <option value="passed">{t('quality.passed_label')}</option>
                    <option value="failed">{t('quality.failed_label')}</option>
                    <option value="conditional">{t('quality.conditional')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('quality.overall_score')} <span className="text-gray-400">{t('quality.score_range')}</span>
                </label>
                <input type="number" min={0} max={100} value={form.overall_score}
                  onChange={(e) => setForm({ ...form, overall_score: Number(e.target.value) })}
                  className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('quality.notes_col')}</label>
                <textarea rows={2} value={form.notes ?? ''}
                  onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
                  className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  placeholder={t('quality.notes_placeholder')} />
              </div>

              {formError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                  <AlertTriangle size={14} className="shrink-0" />
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={saving}
                  className="rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] disabled:opacity-60">
                  {saving ? t('quality.saving') : t('quality.create_inspection')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('quality.title')}</h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{t('quality.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh}
            className="flex items-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 shadow-sm hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 transition">
            <RefreshCw size={15} />
            {t('quality.refresh')}
          </button>
          {hasOverride && (
            <button onClick={() => setQcEditEnabled((v) => !v)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition ${
                qcEditEnabled
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                  : 'border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 text-gray-600 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45'
              }`}>
              {qcEditEnabled ? <Unlock size={15} /> : <Lock size={15} />}
              {qcEditEnabled ? t('quality.editing_on') : t('quality.enable_editing')}
            </button>
          )}
          {effectiveCanEdit && (
            <button onClick={openNew}
              className="flex items-center gap-1.5 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#2d5a74] transition">
              <Plus size={15} />
              {t('quality.new_inspection')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('quality.total_inspections')} value={loading ? '—' : total}           icon={ClipboardList} color="bg-[#3a6f8f]"    sub={t('quality.all_time')} />
        <StatCard label={t('quality.passed')}            value={loading ? '—' : passed}          icon={ShieldCheck}   color="bg-emerald-500" sub={t('quality.meets_standard')} />
        <StatCard label={t('quality.failed')}            value={loading ? '—' : failed}          icon={ShieldX}       color="bg-red-500"     sub={t('quality.requires_action')} />
        <StatCard label={t('quality.pass_rate')}         value={loading ? '—' : `${fmtNum(passRate, lang)}%`} icon={TrendingUp} color="bg-violet-500"
          sub={metrics ? t('quality.avg_score', { score: metrics.average_score ?? '—' }) : undefined} />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 p-1 shadow-sm w-fit">
        {(['inspections', 'defects'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              activeTab === tab
                ? 'bg-[#3a6f8f] text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}>
            {tab === 'inspections' ? t('quality.tab_inspections') : t('quality.tab_defects')}
          </button>
        ))}
      </div>

      {/* Table card */}
      <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text"
              placeholder={activeTab === 'inspections' ? t('quality.search_inspections') : t('quality.search_defects')}
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#D1CFC9]/50 dark:bg-[#262E36]/55 py-2 pl-9 pr-3 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:border-[#4a7fa5] focus:outline-none focus:ring-1 focus:ring-[#4a7fa5]/30" />
          </div>
          {activeTab === 'inspections' && (
            <div className="relative">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="appearance-none rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#D1CFC9]/50 dark:bg-[#262E36]/55 py-2 pl-3 pr-8 text-sm text-gray-700 dark:text-gray-300 focus:border-[#4a7fa5] focus:outline-none focus:ring-1 focus:ring-[#4a7fa5]/30">
                <option value="all">{t('quality.all_status')}</option>
                <option value="passed">{t('quality.passed')}</option>
                <option value="failed">{t('quality.failed')}</option>
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
          )}
        </div>

        {/* Inspections table */}
        {activeTab === 'inspections' && (
          <>
            {loading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-[#262E36]/55" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState message={t('quality.no_inspections')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] bg-[#D1CFC9]/50 dark:bg-[#262E36]/38 text-start text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <th className="px-5 py-3">{t('quality.id_col')}</th>
                      <th className="px-5 py-3">{t('quality.batch_col')}</th>
                      <th className="px-5 py-3">{t('quality.date_col')}</th>
                      <th className="px-5 py-3">{t('quality.result_col')}</th>
                      <th className="px-5 py-3">{t('quality.score_col')}</th>
                      <th className="px-5 py-3">{t('quality.notes_col')}</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-[#B3B7BA]/[0.07]">
                    {filtered.map((item) => (
                      <tr key={item.id} className="hover:bg-blue-50/40 dark:hover:bg-blue-900/10 transition-colors">
                        <td className="px-5 py-3.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                          #{String(item.id).slice(0, 8)}
                        </td>
                        <td className="px-5 py-3.5 font-medium text-gray-800 dark:text-gray-200">{item.batch_id}</td>
                        <td className="px-5 py-3.5 text-gray-700 dark:text-gray-300">
                          {item.inspection_date
                            ? new Date(item.inspection_date).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
                            : '—'}
                        </td>
                        <td className="px-5 py-3.5">
                          {item.status === 'passed' ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-800">
                              <CheckCircle2 size={12} />
                              {t('quality.passed_label')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-900/20 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800">
                              <XCircle size={12} />
                              {item.status === 'pending' ? t('quality.pending') : item.status === 'conditional' ? t('quality.conditional') : t('quality.failed_label')}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-gray-700 dark:text-gray-300">
                          {item.overall_score != null ? fmtNum(item.overall_score, lang) : '—'}
                        </td>
                        <td className="max-w-xs px-5 py-3.5 text-gray-600 dark:text-gray-400">
                          <span className="line-clamp-1">{item.notes || '—'}</span>
                        </td>
                        <td className="px-5 py-3.5 text-end">
                          {effectiveCanEdit && (
                            <button onClick={() => handleDelete(item.id)}
                              className="rounded p-1 text-gray-300 dark:text-gray-600 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                              <Trash2 size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Defects table */}
        {activeTab === 'defects' && (
          <>
            {loading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-[#262E36]/55" />
                ))}
              </div>
            ) : defects.length === 0 ? (
              <EmptyState message={t('quality.no_defects')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] bg-[#D1CFC9]/50 dark:bg-[#262E36]/38 text-start text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <th className="px-5 py-3">{t('quality.defect_id')}</th>
                      <th className="px-5 py-3">{t('quality.defect_type')}</th>
                      <th className="px-5 py-3">{t('quality.severity_col')}</th>
                      <th className="px-5 py-3">{t('quality.description_col')}</th>
                      <th className="px-5 py-3">{t('quality.reported_col')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-[#B3B7BA]/[0.07]">
                    {defects
                      .filter((d) =>
                        search === '' ||
                        d.defect_type?.toLowerCase().includes(search.toLowerCase()) ||
                        d.description?.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((defect) => (
                        <tr key={defect.id} className="hover:bg-red-50/30 dark:hover:bg-red-900/10 transition-colors">
                          <td className="px-5 py-3.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                            #{String(defect.id).slice(0, 8)}
                          </td>
                          <td className="px-5 py-3.5 font-medium text-gray-800 dark:text-gray-200">
                            {defect.defect_type || '—'}
                          </td>
                          <td className="px-5 py-3.5">
                            <SeverityBadge severity={defect.severity} />
                          </td>
                          <td className="max-w-xs px-5 py-3.5 text-gray-600 dark:text-gray-400">
                            <span className="line-clamp-1">{defect.description || '—'}</span>
                          </td>
                          <td className="px-5 py-3.5 text-gray-500 dark:text-gray-400">
                            {defect.created_at
                              ? new Date(defect.created_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
                              : '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        {!loading && (
          <div className="border-t border-gray-100 dark:border-[#B3B7BA]/[0.10] px-5 py-3 text-xs text-gray-400 dark:text-gray-500">
            {activeTab === 'inspections'
              ? t(total !== 1 ? 'quality.footer_inspections_plural' : 'quality.footer_inspections', { n: fmtNum(filtered.length, lang), total: fmtNum(total, lang) })
              : t(defects.length !== 1 ? 'quality.footer_defects_plural' : 'quality.footer_defects', { n: fmtNum(defects.length, lang) })}
          </div>
        )}
      </div>
    </div>
  )
}
