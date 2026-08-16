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
  CheckCircle2, XCircle, Clock, ChevronDown, Search, Plus,
  TrendingUp, Trash2, X, Lock, Unlock,
} from 'lucide-react'
import PaginationBar from '../components/PaginationBar'
import { QC_PAGE_SIZE } from '../hooks/useQualityInspections'

// ── KPI card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, bgCls, iconCls, sub,
}: {
  label: string; value: string | number; icon: React.ElementType
  bgCls: string; iconCls: string; sub?: string
}) {
  return (
    <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${bgCls}`}>
          <Icon size={17} className={iconCls} />
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
    inspections, defects, metrics, batchLabelMap,
    loading, error,
    createInspection, deleteInspection,
    page, totalCount, totalPages, goToPage,
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
    if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
      actionType, entityType: 'qc_inspection', entityId: result.id,
      message: `${actorName(user?.email)} recorded ${form.inspection_type} inspection: ${form.status}`,
      metadata: { status: form.status, score: form.overall_score },
    }).catch(err => console.error('[logActivity]', actionType, 'failed:', err))
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
      if (companyId) logActivity({ companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'qc_inspection.deleted', entityType: 'qc_inspection', entityId: id,
        message: `${actorName(user?.email)} deleted a QC inspection`,
      }).catch(err => console.error('[logActivity] qc_inspection.deleted failed:', err))
    } else {
      toast.error(t('quality.error_delete'))
    }
  }

  const total    = metrics?.total_inspections ?? 0
  const passed   = metrics?.passed_count      ?? 0
  const failed   = total - passed
  const passRate = Math.round(metrics?.pass_rate ?? 0)

  const filtered = inspections.filter((i) => {
    const matchSearch =
      search === '' ||
      i.id?.toString().includes(search) ||
      i.batch_id?.toLowerCase().includes(search.toLowerCase()) ||
      (batchLabelMap[i.batch_id]?.toLowerCase().includes(search.toLowerCase())) ||
      i.notes?.toLowerCase().includes(search.toLowerCase())
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'passed' && i.status === 'passed') ||
      (statusFilter === 'failed' && i.status === 'failed')
    return matchSearch && matchStatus
  })

  // Render score: null → "—"; 0+pending → "—" (unscored default); otherwise "X / 100"
  function renderScore(score: number | null | undefined, status: string): string {
    if (score == null) return '—'
    if (score === 0 && status === 'pending') return '—'
    return `${fmtNum(score, lang)} / 100`
  }

  return (
    <>
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('quality.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('quality.subtitle')}</p>
      </div>

      {/* ── New inspection modal ────────────────────────────────────────────── */}
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

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* ── KPI cards ────────────────────────────────────────────────────────── */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('quality.total_inspections')} value={loading ? '—' : total}
          icon={ClipboardList}
          bgCls="bg-gray-100/70 dark:bg-white/[0.05]"
          iconCls="text-gray-400 dark:text-gray-500"
          sub={t('quality.all_time')} />
        <StatCard label={t('quality.passed')} value={loading ? '—' : passed}
          icon={ShieldCheck}
          bgCls="bg-gray-100/70 dark:bg-white/[0.05]"
          iconCls="text-emerald-400 dark:text-emerald-500"
          sub={t('quality.meets_standard')} />
        <StatCard label={t('quality.failed')} value={loading ? '—' : failed}
          icon={ShieldX}
          bgCls="bg-gray-100/70 dark:bg-white/[0.05]"
          iconCls="text-red-400 dark:text-red-400"
          sub={t('quality.requires_action')} />
        <StatCard label={t('quality.pass_rate')} value={loading ? '—' : `${fmtNum(passRate, lang)}%`}
          icon={TrendingUp}
          bgCls="bg-gray-100/70 dark:bg-white/[0.05]"
          iconCls="text-gray-400 dark:text-gray-500"
          sub={metrics ? t('quality.avg_score', { score: metrics.average_score ?? '—' }) : undefined} />
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-nowrap items-center gap-3">
        {/* Left zone: count + search — identical structure to Products */}
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-3">
          <p className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
            {loading ? '—' : activeTab === 'inspections'
              ? t(totalCount !== 1 ? 'quality.count_plural' : 'quality.count', { n: fmtNum(totalCount, lang) })
              : t(defects.length !== 1 ? 'quality.defects_count_plural' : 'quality.defects_count', { n: fmtNum(defects.length, lang) })}
          </p>
          <div className="relative min-w-[180px] flex-1 max-w-xs">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder={activeTab === 'inspections' ? t('quality.search_inspections') : t('quality.search_defects')}
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

        {/* Status filter — peer of left zone, not nested inside it */}
        {activeTab === 'inspections' && (
          <div className="relative shrink-0">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="appearance-none rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-white dark:bg-[#262E36]/55 py-2 pl-3 pr-8 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/30 transition-colors"
            >
              <option value="all">{t('quality.all_status')}</option>
              <option value="passed">{t('quality.passed')}</option>
              <option value="failed">{t('quality.failed')}</option>
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>
        )}

        {/* Right zone — only rendered when there is an action for this user */}
        {(effectiveCanEdit || hasOverride) && (
          <div className="flex shrink-0 items-center gap-2">
            {hasOverride && (
              <button
                onClick={() => setQcEditEnabled((v) => !v)}
                title={qcEditEnabled ? t('quality.editing_on') : t('quality.enable_editing')}
                className={`rounded-lg p-2 transition-colors ${
                  qcEditEnabled
                    ? 'text-amber-400 hover:bg-amber-500/10'
                    : 'text-gray-400 dark:text-gray-500 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 hover:text-gray-600 dark:hover:text-gray-300'
                }`}
              >
                {qcEditEnabled ? <Unlock size={15} /> : <Lock size={15} />}
              </button>
            )}
            {effectiveCanEdit && (
              <button
                onClick={openNew}
                className="flex items-center gap-1.5 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] transition-colors"
              >
                <Plus size={15} />
                {t('quality.new_inspection')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Tabs — directly above the table ─────────────────────────────────── */}
      <div className="mb-3 flex gap-1 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 p-1 shadow-sm w-fit">
        {(['inspections', 'defects'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              activeTab === tab
                ? 'bg-[#3a6f8f] text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}>
            {tab === 'inspections'
              ? `${t('quality.tab_inspections')} (${fmtNum(totalCount, lang)})`
              : `${t('quality.tab_defects')} (${fmtNum(defects.length, lang)})`}
          </button>
        ))}
      </div>

      {/* ── Table card ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/40 overflow-hidden">

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
                    <tr className="border-b-2 border-gray-300 dark:border-gray-500 bg-gray-100 dark:bg-[#2e3c52] text-xs tracking-wide">
                      <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('quality.batch_col')}</th>
                      <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('quality.date_col')}</th>
                      <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('quality.result_col')}</th>
                      <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('quality.score_col')}</th>
                      <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('quality.notes_col')}</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/40 bg-white dark:bg-gray-800">
                    {filtered.map((item) => (
                      <tr key={item.id} className="hover:bg-[rgba(58,111,143,0.07)] dark:hover:bg-[rgba(58,111,143,0.13)] transition-colors duration-150">

                        {/* Batch — two-line: product name (primary) + lot/ref (secondary) */}
                        <td className="px-3 py-1.5">
                          {item.batch_id ? (() => {
                            const raw = batchLabelMap[item.batch_id] || item.batch_id
                            const dot = raw.indexOf(' · ')
                            const primary   = dot >= 0 ? raw.slice(0, dot) : raw
                            const secondary = dot >= 0 ? raw.slice(dot + 3) : null
                            return (
                              <a
                                href={`/product-journey/${item.batch_id}`}
                                title={item.batch_id}
                                className="block max-w-[220px] hover:underline"
                              >
                                <span className="block truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                                  {primary}
                                </span>
                                {secondary && (
                                  <span className="block truncate text-xs text-gray-400 dark:text-gray-500">
                                    {secondary}
                                  </span>
                                )}
                              </a>
                            )
                          })() : (
                            <span className="font-mono text-xs text-gray-400 dark:text-gray-500">—</span>
                          )}
                        </td>

                        {/* Date */}
                        <td className="whitespace-nowrap px-3 py-1.5 text-gray-700 dark:text-gray-300">
                          {item.inspection_date
                            ? new Date(item.inspection_date).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
                            : '—'}
                        </td>

                        {/* Result badge */}
                        <td className="px-3 py-1.5">
                          {item.status === 'passed' ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-800">
                              <CheckCircle2 size={12} />{t('quality.passed_label')}
                            </span>
                          ) : item.status === 'pending' ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-800">
                              <Clock size={12} />{t('quality.pending')}
                            </span>
                          ) : item.status === 'conditional' ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 dark:bg-violet-900/20 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:text-violet-400 ring-1 ring-violet-200 dark:ring-violet-800">
                              <AlertTriangle size={12} />{t('quality.conditional')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-900/20 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800">
                              <XCircle size={12} />{t('quality.failed_label')}
                            </span>
                          )}
                        </td>

                        {/* Score */}
                        <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-gray-700 dark:text-gray-300">
                          {renderScore(item.overall_score, item.status)}
                        </td>

                        {/* Notes — full text in tooltip */}
                        <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">
                          {item.notes ? (
                            <span className="block max-w-[380px] truncate text-xs" title={item.notes}>
                              {item.notes}
                            </span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </td>

                        {/* Delete */}
                        <td className="w-px px-3 py-1.5 text-end">
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
                    <tr className="border-b-2 border-gray-300 dark:border-gray-500 bg-gray-100 dark:bg-[#2e3c52] text-xs tracking-wide">
                      <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('quality.defect_type')}</th>
                      <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('quality.severity_col')}</th>
                      <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('quality.description_col')}</th>
                      <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t('quality.reported_col')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/40 bg-white dark:bg-gray-800">
                    {defects
                      .filter((d) =>
                        search === '' ||
                        d.defect_type?.toLowerCase().includes(search.toLowerCase()) ||
                        d.description?.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((defect) => (
                        <tr key={defect.id} className="hover:bg-[rgba(58,111,143,0.07)] dark:hover:bg-[rgba(58,111,143,0.13)] transition-colors duration-150">
                          <td className="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-200">
                            {defect.defect_type || '—'}
                          </td>
                          <td className="px-3 py-1.5">
                            <SeverityBadge severity={defect.severity} />
                          </td>
                          <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">
                            {defect.description ? (
                              <span className="block max-w-[260px] truncate" title={defect.description}>
                                {defect.description}
                              </span>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-gray-500 dark:text-gray-400">
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

        {/* Pagination — inspections tab only */}
        {!loading && activeTab === 'inspections' && (
          <PaginationBar
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={QC_PAGE_SIZE}
            onPage={goToPage}
          />
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
    </>
  )
}
