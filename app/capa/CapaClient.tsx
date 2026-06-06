'use client'

import { useState } from 'react'
import {
  FileWarning, Plus, RefreshCw, Search, AlertTriangle,
  CheckCircle2, Clock, ChevronRight, Trash2, X,
  ShieldAlert, Activity, ArrowRight,
} from 'lucide-react'
import { useCapas, NEXT_STATUS, ADVANCE_LABEL, type CapaStatus, type CapaFormData } from '../hooks/useCapas'
import { useAuth, useRole } from '../lib/auth-context'
import { canEdit } from '../lib/permissions'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { logActivity, actorName } from '../lib/activity'
import PaginationBar from '../components/PaginationBar'
import { PAGE_SIZE } from '../hooks/useCapas'

// ── Status config ────────────────────────────────────────────────────────────

type StatusMeta = { label: string; badgeCls: string; stepCls: string }

const STATUS_META: Record<CapaStatus, StatusMeta> = {
  open: {
    label:    'Open',
    badgeCls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    stepCls:  'bg-blue-500',
  },
  investigation: {
    label:    'Investigation',
    badgeCls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    stepCls:  'bg-amber-500',
  },
  corrective_action: {
    label:    'Corrective Action',
    badgeCls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    stepCls:  'bg-orange-500',
  },
  verification: {
    label:    'Verification',
    badgeCls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    stepCls:  'bg-violet-500',
  },
  closed: {
    label:    'Closed',
    badgeCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    stepCls:  'bg-emerald-500',
  },
}

const LIFECYCLE: CapaStatus[] = [
  'open', 'investigation', 'corrective_action', 'verification', 'closed',
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function isOverdue(capa: { status: CapaStatus; due_date: string | null }): boolean {
  if (capa.status === 'closed' || !capa.due_date) return false
  return capa.due_date < new Date().toISOString().slice(0, 10)
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status, overdue }: { status: CapaStatus; overdue?: boolean }) {
  if (overdue) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
        <AlertTriangle size={10} />Overdue
      </span>
    )
  }
  const meta = STATUS_META[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.badgeCls}`}>
      {meta.label}
    </span>
  )
}

function LifecycleStep({ active, completed, status }: {
  active: boolean; completed: boolean; status: CapaStatus
}) {
  const meta = STATUS_META[status]
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`h-2.5 w-2.5 rounded-full border-2 border-white dark:border-gray-900 ${
        completed ? meta.stepCls
        : active  ? `${meta.stepCls} ring-2 ring-offset-1 ring-offset-white dark:ring-offset-gray-900 ${meta.stepCls.replace('bg-', 'ring-')}`
        : 'bg-gray-200 dark:bg-gray-700'
      }`} />
      <span className={`text-[9px] font-medium uppercase tracking-wide hidden sm:block ${
        active || completed ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-600'
      }`}>
        {status === 'corrective_action' ? 'Corrective' : STATUS_META[status].label}
      </span>
    </div>
  )
}

function LifecycleTrack({ status }: { status: CapaStatus }) {
  const idx = LIFECYCLE.indexOf(status)
  return (
    <div className="flex items-start gap-0">
      {LIFECYCLE.map((s, i) => (
        <div key={s} className="flex items-center">
          <LifecycleStep
            status={s}
            active={i === idx}
            completed={i < idx}
          />
          {i < LIFECYCLE.length - 1 && (
            <div className={`h-0.5 w-5 sm:w-8 mx-0.5 mt-[-10px] ${
              i < idx ? STATUS_META[LIFECYCLE[i + 1]].stepCls : 'bg-gray-200 dark:bg-gray-700'
            }`} />
          )}
        </div>
      ))}
    </div>
  )
}

function KpiCard({ label, value, sub, color }: {
  label: string; value: number | string; sub?: string; color: string
}) {
  return (
    <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
      <FileWarning size={40} className="mb-3 opacity-40" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  )
}

// ── Create CAPA modal ─────────────────────────────────────────────────────────

const EMPTY_FORM: CapaFormData = {
  title: '', severity: 'major', root_cause: '', corrective_action: '',
  preventive_action: '', owner_name: '', due_date: '', status: 'open',
  recall_id: null, inspection_id: null, batch_id: null,
}

function CreateModal({
  onClose,
  onSave,
  saving,
}: {
  onClose: () => void
  onSave:  (data: CapaFormData) => Promise<void>
  saving:  boolean
}) {
  const [form, setForm] = useState<CapaFormData>(EMPTY_FORM)
  const f = (k: keyof CapaFormData) => (
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [k]: e.target.value || null }))
  )

  const fieldCls = 'w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]'
  const labelCls = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">New CAPA</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={async e => { e.preventDefault(); await onSave(form) }}
          className="space-y-4"
        >
          {/* Title */}
          <div>
            <label className={labelCls}>Title *</label>
            <input required value={form.title ?? ''} onChange={f('title')} className={fieldCls}
              placeholder="Describe the finding or issue" />
          </div>

          {/* Severity + Owner + Due date */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Severity</label>
              <select value={form.severity} onChange={f('severity')} className={fieldCls}>
                <option value="minor">Minor</option>
                <option value="major">Major</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Owner *</label>
              <input required value={form.owner_name ?? ''} onChange={f('owner_name')}
                className={fieldCls} placeholder="Assigned to" />
            </div>
            <div>
              <label className={labelCls}>Due Date *</label>
              <input required type="date" value={form.due_date ?? ''} onChange={f('due_date')}
                className={fieldCls} />
            </div>
          </div>

          {/* Root Cause */}
          <div>
            <label className={labelCls}>Root Cause</label>
            <textarea rows={2} value={form.root_cause ?? ''} onChange={f('root_cause')}
              className={fieldCls} placeholder="Identify the root cause" />
          </div>

          {/* Corrective Action */}
          <div>
            <label className={labelCls}>Corrective Action</label>
            <textarea rows={2} value={form.corrective_action ?? ''} onChange={f('corrective_action')}
              className={fieldCls} placeholder="Immediate actions to correct the issue" />
          </div>

          {/* Preventive Action */}
          <div>
            <label className={labelCls}>Preventive Action</label>
            <textarea rows={2} value={form.preventive_action ?? ''} onChange={f('preventive_action')}
              className={fieldCls} placeholder="Actions to prevent recurrence" />
          </div>

          {/* Linked Batch (optional) */}
          <div>
            <label className={labelCls}>Linked Batch ID <span className="text-gray-400 font-normal">(optional UUID)</span></label>
            <input value={form.batch_id ?? ''} onChange={f('batch_id')} className={fieldCls}
              placeholder="e.g. 6db4527d-cbe8-…" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] disabled:opacity-60">
              {saving ? 'Creating…' : 'Create CAPA'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'open' | 'in_progress' | 'overdue' | 'closed'

export default function CapaClient() {
  const toast   = useToast()
  const confirm = useConfirm()
  const role    = useRole()
  const { user, companyId } = useAuth()
  const canEditCapa = canEdit(role, 'capa')

  const {
    capas, stats, loading, error, refresh,
    page, totalCount, totalPages, goToPage,
    createCapa, advanceStatus, deleteCapa,
  } = useCapas()

  const [search,     setSearch]     = useState('')
  const [filterTab,  setFilterTab]  = useState<FilterTab>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [advancing,  setAdvancing]  = useState<string | null>(null)

  // ── Filter ────────────────────────────────────────────────────────────────

  const today = new Date().toISOString().slice(0, 10)

  const filtered = capas.filter(c => {
    const matchSearch =
      search === '' ||
      c.title?.toLowerCase().includes(search.toLowerCase()) ||
      c.capa_number?.toLowerCase().includes(search.toLowerCase()) ||
      c.owner_name?.toLowerCase().includes(search.toLowerCase())

    const overdue = c.status !== 'closed' && !!c.due_date && c.due_date < today
    const inProgress = ['investigation', 'corrective_action', 'verification'].includes(c.status)

    const matchFilter =
      filterTab === 'all'         ? true
      : filterTab === 'open'      ? c.status === 'open'
      : filterTab === 'in_progress'? inProgress
      : filterTab === 'overdue'   ? overdue
      : filterTab === 'closed'    ? c.status === 'closed'
      : true

    return matchSearch && matchFilter
  })

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleCreate(data: CapaFormData) {
    setSaving(true)
    const result = await createCapa(data)
    setSaving(false)
    if (!result) { toast.error('Failed to create CAPA'); return }
    setShowCreate(false)
    toast.success(`CAPA ${result.capa_number ?? ''} created`)
    if (companyId) {
      void logActivity({
        companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: 'capa.opened', entityType: 'capa', entityId: result.id,
        message: `${actorName(user?.email)} opened CAPA: ${data.title}`,
        metadata: { capa_number: result.capa_number, owner: data.owner_name },
      })
    }
  }

  async function handleAdvance(id: string, current: CapaStatus) {
    const next = NEXT_STATUS[current]
    if (!next) return
    setAdvancing(id)
    const ok = await advanceStatus(id, current)
    setAdvancing(null)
    if (!ok) { toast.error('Failed to advance status'); return }
    const label = next === 'closed' ? 'CAPA closed' : `Status advanced to ${STATUS_META[next].label}`
    toast.success(label)
    const actionType = next === 'closed' ? 'capa.closed'
      : next === 'verification' ? 'capa.verified'
      : 'capa.updated'
    if (companyId) {
      void logActivity({
        companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType, entityType: 'capa', entityId: id,
        message: `${actorName(user?.email)} advanced CAPA to ${STATUS_META[next].label}`,
      })
    }
  }

  async function handleDelete(id: string, capaNumber: string | null) {
    const ok = await confirm({
      title:        'Delete CAPA',
      message:      `Delete ${capaNumber ?? 'this CAPA'}? This cannot be undone.`,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    const deleted = await deleteCapa(id)
    if (deleted) toast.success('CAPA deleted')
    else         toast.error('Failed to delete CAPA')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)] p-6">
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onSave={handleCreate}
          saving={saving}
        />
      )}

      {/* Page header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">CAPA Management</h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Corrective and Preventive Actions — track root causes to closure
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh}
            className="flex items-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 shadow-sm hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 transition">
            <RefreshCw size={15} />Refresh
          </button>
          {canEditCapa && (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#2d5a74] transition">
              <Plus size={15} />New CAPA
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle size={16} />{error}
        </div>
      )}

      {/* KPI cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Open"             value={loading ? '—' : (stats?.open ?? 0)}             color="text-blue-600 dark:text-blue-400" />
        <KpiCard label="Investigation"    value={loading ? '—' : (stats?.investigation ?? 0)}    color="text-amber-600 dark:text-amber-400" />
        <KpiCard label="Corrective Action"value={loading ? '—' : (stats?.corrective_action ?? 0)}color="text-orange-600 dark:text-orange-400" />
        <KpiCard label="Verification"     value={loading ? '—' : (stats?.verification ?? 0)}     color="text-violet-600 dark:text-violet-400" />
        <KpiCard
          label="Overdue"
          value={loading ? '—' : (stats?.overdue ?? 0)}
          color={(stats?.overdue ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}
          sub={(stats?.closed ?? 0) > 0 ? `${stats?.closed} closed` : undefined}
        />
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 p-1 shadow-sm w-fit">
        {([
          { key: 'all' as FilterTab,        label: 'All' },
          { key: 'open' as FilterTab,       label: 'Open' },
          { key: 'in_progress' as FilterTab,label: 'In Progress' },
          { key: 'overdue' as FilterTab,    label: 'Overdue' },
          { key: 'closed' as FilterTab,     label: 'Closed' },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setFilterTab(tab.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              filterTab === tab.key
                ? 'bg-[#3a6f8f] text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table card */}
      <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm">

        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] px-5 py-4">
          <div className="relative w-full sm:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search by title, CAPA #, or owner…"
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#D1CFC9]/50 dark:bg-[#262E36]/55 py-2 pl-9 pr-3 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:border-[#4a7fa5] focus:outline-none focus:ring-1 focus:ring-[#4a7fa5]/30" />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-[#262E36]/55" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState message={search ? 'No CAPAs match your search.' : 'No CAPAs recorded yet.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] bg-[#D1CFC9]/50 dark:bg-[#262E36]/38 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-5 py-3 text-start">CAPA #</th>
                  <th className="px-5 py-3 text-start">Title</th>
                  <th className="px-5 py-3 text-start">Lifecycle</th>
                  <th className="px-5 py-3 text-start">Owner</th>
                  <th className="px-5 py-3 text-start">Due Date</th>
                  <th className="px-5 py-3 text-start">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-[#B3B7BA]/[0.07]">
                {filtered.map(capa => {
                  const overdue = isOverdue(capa)
                  const nextStatus = NEXT_STATUS[capa.status]
                  const advanceLabel = ADVANCE_LABEL[capa.status]
                  return (
                    <tr key={capa.id} className="hover:bg-blue-50/40 dark:hover:bg-blue-900/10 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {capa.capa_number ?? `#${capa.id.slice(0, 8)}`}
                      </td>
                      <td className="px-5 py-3.5 max-w-xs">
                        <p className="font-medium text-gray-900 dark:text-white leading-snug">{capa.title}</p>
                        {capa.root_cause && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{capa.root_cause}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <LifecycleTrack status={capa.status} />
                      </td>
                      <td className="px-5 py-3.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {capa.owner_name ?? '—'}
                      </td>
                      <td className={`px-5 py-3.5 whitespace-nowrap text-sm font-medium ${
                        overdue ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'
                      }`}>
                        {capa.due_date ? fmt(capa.due_date) : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={capa.status} overdue={overdue} />
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-2">
                          {canEditCapa && nextStatus && advanceLabel && (
                            <button
                              disabled={advancing === capa.id}
                              onClick={() => handleAdvance(capa.id, capa.status)}
                              title={advanceLabel}
                              className="flex items-center gap-1 rounded-md border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45 disabled:opacity-50 transition whitespace-nowrap">
                              <ArrowRight size={11} />
                              {advancing === capa.id ? '…' : advanceLabel}
                            </button>
                          )}
                          {canEditCapa && (
                            <button
                              onClick={() => handleDelete(capa.id, capa.capa_number)}
                              className="rounded p-1 text-gray-300 dark:text-gray-600 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && (
          <PaginationBar
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={PAGE_SIZE}
            onPage={goToPage}
          />
        )}

        {/* Footer */}
        {!loading && (
          <div className="border-t border-gray-100 dark:border-[#B3B7BA]/[0.10] px-5 py-3 text-xs text-gray-400 dark:text-gray-500">
            Showing {filtered.length} of {totalCount} CAPA{totalCount !== 1 ? 's' : ''}
            {(stats?.closed ?? 0) > 0 && ` · ${stats?.closed} closed`}
          </div>
        )}
      </div>
    </div>
  )
}
