'use client'

import { useState, useRef, useEffect } from 'react'
import {
  FileWarning, Plus, RefreshCw, Search, AlertTriangle,
  X, ArrowRight, MoreHorizontal, Eye, Pencil, Trash2,
} from 'lucide-react'
import { useCapas, NEXT_STATUS, ADVANCE_LABEL, type CapaStatus, type CapaFormData, type Capa } from '../hooks/useCapas'
import { useAuth, useRole } from '../lib/auth-context'
import { canEdit } from '../lib/permissions'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { logActivity, actorName } from '../lib/activity'
import PaginationBar from '../components/PaginationBar'
import { PAGE_SIZE } from '../hooks/useCapas'

// ── Status config ────────────────────────────────────────────────────────────

const STATUS_META: Record<CapaStatus, { label: string; badgeCls: string }> = {
  open:              { label: 'Open',             badgeCls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  investigation:     { label: 'Investigation',    badgeCls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  corrective_action: { label: 'Corrective Action',badgeCls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  verification:      { label: 'Verification',     badgeCls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  closed:            { label: 'Closed',           badgeCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
}

// ── Priority (from severity) ──────────────────────────────────────────────────

const PRIORITY_META = {
  critical: { label: 'Critical', cls: 'bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400'    },
  major:    { label: 'High',     cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  minor:    { label: 'Medium',   cls: 'bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-400'  },
} as const

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CapaStatus }) {
  const meta = STATUS_META[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.badgeCls}`}>
      {meta.label}
    </span>
  )
}

function PriorityBadge({ severity }: { severity: 'minor' | 'major' | 'critical' }) {
  const m = PRIORITY_META[severity]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>
      {m.label}
    </span>
  )
}

function KpiCard({ label, value, color }: {
  label: string; value: number | string; color: string
}) {
  return (
    <div className="rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-4 py-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums leading-none ${color}`}>{value}</p>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
      <FileWarning size={40} className="mb-3 opacity-40" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  )
}

// ── Three-dot row menu ────────────────────────────────────────────────────────

function RowMenu({ onView, onEdit, onDelete, editable }: {
  onView:    () => void
  onEdit:    () => void
  onDelete:  () => void
  editable:  boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const item = 'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="rounded-md p-1.5 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-[#262E36]/55 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        aria-label="Row actions"
      >
        <MoreHorizontal size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.15] bg-white dark:bg-[#1a2530] py-1 shadow-xl">
          <button onClick={() => { onView(); setOpen(false) }}
            className={`${item} text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#262E36]/55`}>
            <Eye size={13} className="shrink-0 text-gray-400" />View
          </button>

          {editable && (
            <button onClick={() => { onEdit(); setOpen(false) }}
              className={`${item} text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#262E36]/55`}>
              <Pencil size={13} className="shrink-0 text-gray-400" />Edit
            </button>
          )}

          {editable && (
            <>
              <div className="my-1 border-t border-gray-100 dark:border-[#B3B7BA]/[0.10]" />
              <button onClick={() => { onDelete(); setOpen(false) }}
                className={`${item} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20`}>
                <Trash2 size={13} className="shrink-0" />Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── CAPA detail modal (read-only) ─────────────────────────────────────────────

function CapaDetailModal({ capa, onClose }: { capa: Capa; onClose: () => void }) {
  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const fmtDt = (d: string | null) =>
    d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null

  const sectionLabel = 'mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500'
  const sectionText  = 'text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line leading-relaxed'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 font-mono text-xs font-semibold text-[#3a6f8f] dark:text-[#7ab3d0]">
              {capa.capa_number ?? `#${capa.id.slice(0, 8)}`}
            </p>
            <h2 className="text-base font-semibold leading-snug text-gray-900 dark:text-white">
              {capa.title}
            </h2>
          </div>
          <button onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        {/* Status pills */}
        <div className="mb-5 flex flex-wrap gap-2">
          <StatusBadge status={capa.status} />
          <PriorityBadge severity={capa.severity} />
          {capa.owner_name && (
            <span className="inline-flex items-center rounded-full border border-[#B3B7BA]/40 px-2.5 py-0.5 text-xs text-gray-600 dark:text-gray-300">
              {capa.owner_name}
            </span>
          )}
          {capa.due_date && (
            <span className="inline-flex items-center rounded-full border border-[#B3B7BA]/40 px-2.5 py-0.5 text-xs text-gray-500 dark:text-gray-400">
              Due {fmt(capa.due_date)}
            </span>
          )}
        </div>

        {/* Detail sections */}
        <div className="space-y-4">
          {capa.root_cause && (
            <div>
              <p className={sectionLabel}>Root Cause</p>
              <p className={sectionText}>{capa.root_cause}</p>
            </div>
          )}
          {capa.corrective_action && (
            <div>
              <p className={sectionLabel}>Corrective Action</p>
              <p className={sectionText}>{capa.corrective_action}</p>
            </div>
          )}
          {capa.preventive_action && (
            <div>
              <p className={sectionLabel}>Preventive Action</p>
              <p className={sectionText}>{capa.preventive_action}</p>
            </div>
          )}
        </div>

        {/* Timestamps */}
        <div className="mt-5 border-t border-gray-100 dark:border-[#B3B7BA]/[0.10] pt-4 grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs text-gray-400 dark:text-gray-500">
          {fmtDt(capa.created_at)         && <span>Opened: {fmtDt(capa.created_at)}</span>}
          {fmtDt(capa.investigation_at)   && <span>Investigation: {fmtDt(capa.investigation_at)}</span>}
          {fmtDt(capa.corrective_action_at) && <span>Corrective Action: {fmtDt(capa.corrective_action_at)}</span>}
          {fmtDt(capa.verification_at)    && <span>Verification: {fmtDt(capa.verification_at)}</span>}
          {fmtDt(capa.closed_at)          && <span>Closed: {fmtDt(capa.closed_at)}</span>}
          {fmtDt(capa.updated_at)         && <span>Last Updated: {fmtDt(capa.updated_at)}</span>}
        </div>

        <div className="mt-5 flex justify-end">
          <button onClick={onClose}
            className="rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shared form fields (create & edit) ────────────────────────────────────────

const fieldCls = 'w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]'
const labelCls = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300'

// ── Create CAPA modal ─────────────────────────────────────────────────────────

const EMPTY_FORM: CapaFormData = {
  title: '', severity: 'major', root_cause: '', corrective_action: '',
  preventive_action: '', owner_name: '', due_date: '', status: 'open',
  recall_id: null, inspection_id: null, batch_id: null,
}

function CreateModal({ onClose, onSave, saving }: {
  onClose: () => void
  onSave:  (data: CapaFormData) => Promise<void>
  saving:  boolean
}) {
  const [form, setForm] = useState<CapaFormData>(EMPTY_FORM)
  const f = (k: keyof CapaFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [k]: e.target.value || null }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">New CAPA</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={async e => { e.preventDefault(); await onSave(form) }} className="space-y-4">
          <div>
            <label className={labelCls}>Title *</label>
            <input required value={form.title ?? ''} onChange={f('title')} className={fieldCls}
              placeholder="Describe the finding or issue" />
          </div>

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
              <input required type="date" value={form.due_date ?? ''} onChange={f('due_date')} className={fieldCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Root Cause</label>
            <textarea rows={2} value={form.root_cause ?? ''} onChange={f('root_cause')}
              className={fieldCls} placeholder="Identify the root cause" />
          </div>

          <div>
            <label className={labelCls}>Corrective Action</label>
            <textarea rows={2} value={form.corrective_action ?? ''} onChange={f('corrective_action')}
              className={fieldCls} placeholder="Immediate actions to correct the issue" />
          </div>

          <div>
            <label className={labelCls}>Preventive Action</label>
            <textarea rows={2} value={form.preventive_action ?? ''} onChange={f('preventive_action')}
              className={fieldCls} placeholder="Actions to prevent recurrence" />
          </div>

          <div>
            <label className={labelCls}>
              Linked Batch ID <span className="text-gray-400 font-normal">(optional UUID)</span>
            </label>
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

// ── Edit CAPA modal ───────────────────────────────────────────────────────────

function EditModal({ capa, onClose, onSave, saving }: {
  capa:    Capa
  onClose: () => void
  onSave:  (data: CapaFormData) => Promise<void>
  saving:  boolean
}) {
  const [form, setForm] = useState<CapaFormData>({
    title:             capa.title,
    severity:          capa.severity,
    root_cause:        capa.root_cause        ?? '',
    corrective_action: capa.corrective_action ?? '',
    preventive_action: capa.preventive_action ?? '',
    owner_name:        capa.owner_name        ?? '',
    due_date:          capa.due_date          ?? '',
    status:            capa.status,
    recall_id:         capa.recall_id,
    inspection_id:     capa.inspection_id,
    batch_id:          capa.batch_id,
  })

  const f = (k: keyof CapaFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [k]: e.target.value || null }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#F1EFEC] dark:bg-[#141e28] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Edit CAPA</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X size={20} />
          </button>
        </div>
        <p className="mb-4 font-mono text-xs text-[#3a6f8f] dark:text-[#7ab3d0]">
          {capa.capa_number ?? `#${capa.id.slice(0, 8)}`}
        </p>

        <form onSubmit={async e => { e.preventDefault(); await onSave(form) }} className="space-y-4">
          <div>
            <label className={labelCls}>Title *</label>
            <input required value={form.title ?? ''} onChange={f('title')} className={fieldCls} />
          </div>

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
              <input required value={form.owner_name ?? ''} onChange={f('owner_name')} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Due Date *</label>
              <input required type="date" value={form.due_date ?? ''} onChange={f('due_date')} className={fieldCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Root Cause</label>
            <textarea rows={2} value={form.root_cause ?? ''} onChange={f('root_cause')} className={fieldCls} />
          </div>

          <div>
            <label className={labelCls}>Corrective Action</label>
            <textarea rows={2} value={form.corrective_action ?? ''} onChange={f('corrective_action')} className={fieldCls} />
          </div>

          <div>
            <label className={labelCls}>Preventive Action</label>
            <textarea rows={2} value={form.preventive_action ?? ''} onChange={f('preventive_action')} className={fieldCls} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/45">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="rounded-lg bg-[#3a6f8f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5a74] disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Changes'}
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
    createCapa, advanceStatus, updateCapa, deleteCapa,
  } = useCapas()

  const [search,     setSearch]     = useState('')
  const [filterTab,  setFilterTab]  = useState<FilterTab>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [viewCapa,   setViewCapa]   = useState<Capa | null>(null)
  const [editCapa,   setEditCapa]   = useState<Capa | null>(null)
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

    const overdue    = c.status !== 'closed' && !!c.due_date && c.due_date < today
    const inProgress = ['investigation', 'corrective_action', 'verification'].includes(c.status)

    const matchFilter =
      filterTab === 'all'          ? true
      : filterTab === 'open'       ? c.status === 'open'
      : filterTab === 'in_progress'? inProgress
      : filterTab === 'overdue'    ? overdue
      : filterTab === 'closed'     ? c.status === 'closed'
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

  async function handleEdit(data: CapaFormData) {
    if (!editCapa) return
    setSaving(true)
    const ok = await updateCapa(editCapa.id, data)
    setSaving(false)
    if (!ok) { toast.error('Failed to update CAPA'); return }
    setEditCapa(null)
    toast.success('CAPA updated')
  }

  async function handleAdvance(id: string, current: CapaStatus) {
    const next = NEXT_STATUS[current]
    if (!next) return

    const confirmed = next === 'closed'
      ? await confirm({
          title:        'Close this CAPA?',
          message:      'This action will mark the CAPA as completed.',
          confirmLabel: 'Close CAPA',
          danger:       false,
        })
      : await confirm({
          title:        'Advance Stage',
          message:      `Current Stage: ${STATUS_META[current].label} → Next Stage: ${STATUS_META[next].label}`,
          confirmLabel: 'Confirm',
          danger:       false,
        })

    if (!confirmed) return

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

  // ── Derived KPI values ────────────────────────────────────────────────────

  const inProgressCount = !loading
    ? (stats?.investigation ?? 0) + (stats?.corrective_action ?? 0) + (stats?.verification ?? 0)
    : null
  const openIsZero = !loading && (stats?.open ?? 0) === 0

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)] p-6">

      {/* Modals */}
      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onSave={handleCreate} saving={saving} />
      )}
      {viewCapa && (
        <CapaDetailModal capa={viewCapa} onClose={() => setViewCapa(null)} />
      )}
      {editCapa && (
        <EditModal capa={editCapa} onClose={() => setEditCapa(null)} onSave={handleEdit} saving={saving} />
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

      {/* KPI cards — 5 cards */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Total"
          value={loading ? '—' : totalCount}
          color="text-gray-800 dark:text-gray-100"
        />
        <KpiCard
          label="Open"
          value={loading ? '—' : (stats?.open ?? 0)}
          color={openIsZero ? 'text-gray-300 dark:text-gray-600' : 'text-blue-600 dark:text-blue-400'}
        />
        <KpiCard
          label="In Progress"
          value={loading ? '—' : (inProgressCount ?? '—')}
          color="text-amber-600 dark:text-amber-400"
        />
        <KpiCard
          label="Closed"
          value={loading ? '—' : (stats?.closed ?? 0)}
          color="text-emerald-600 dark:text-emerald-400"
        />
        <KpiCard
          label="Overdue"
          value={loading ? '—' : (stats?.overdue ?? 0)}
          color={(stats?.overdue ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}
        />
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 p-1 shadow-sm w-fit">
        {([
          { key: 'all'         as FilterTab, label: 'All' },
          { key: 'open'        as FilterTab, label: 'Open' },
          { key: 'in_progress' as FilterTab, label: 'In Progress' },
          { key: 'overdue'     as FilterTab, label: 'Overdue' },
          { key: 'closed'      as FilterTab, label: 'Closed' },
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
                <tr className="border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] bg-[#D1CFC9]/50 dark:bg-[#262E36]/38 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                  <th className="px-4 py-3.5 text-start whitespace-nowrap">CAPA #</th>
                  <th className="px-4 py-3.5 text-start">Title</th>
                  <th className="px-4 py-3.5 text-start whitespace-nowrap">Priority</th>
                  <th className="px-4 py-3.5 text-start whitespace-nowrap">Owner</th>
                  <th className="px-4 py-3.5 text-start whitespace-nowrap">Due Date</th>
                  <th className="px-4 py-3.5 text-start whitespace-nowrap">Status</th>
                  <th className="px-4 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#B3B7BA]/[0.08]">
                {filtered.map(capa => {
                  const nextStatus   = NEXT_STATUS[capa.status]
                  const advanceLabel = ADVANCE_LABEL[capa.status]
                  return (
                    <tr key={capa.id}
                      className="hover:bg-[#3a6f8f]/[0.07] dark:hover:bg-[#3a6f8f]/[0.13] transition-colors">

                      {/* CAPA # — clickable, prominent */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <button
                          onClick={() => setViewCapa(capa)}
                          className="font-mono text-xs font-semibold text-[#3a6f8f] dark:text-[#7ab3d0] hover:underline underline-offset-2"
                        >
                          {capa.capa_number ?? `#${capa.id.slice(0, 8)}`}
                        </button>
                      </td>

                      {/* Title */}
                      <td className="px-4 py-4 max-w-[260px]">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-tight truncate">
                          {capa.title}
                        </p>
                      </td>

                      {/* Priority */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <PriorityBadge severity={capa.severity} />
                      </td>

                      {/* Owner */}
                      <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
                        {capa.owner_name ?? '—'}
                      </td>

                      {/* Due Date */}
                      <td className="px-4 py-4 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                        {capa.due_date
                          ? new Date(capa.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <StatusBadge status={capa.status} />
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-2">

                          {/* Advance button — visible text */}
                          {canEditCapa && nextStatus && advanceLabel && (
                            <button
                              disabled={advancing === capa.id}
                              onClick={() => handleAdvance(capa.id, capa.status)}
                              title={advanceLabel}
                              className="flex items-center gap-1 rounded-md border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.15] bg-white/60 dark:bg-[#262E36]/30 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:border-[#3a6f8f]/50 hover:bg-[#3a6f8f]/10 hover:text-[#3a6f8f] dark:hover:text-[#7ab3d0] disabled:opacity-40 transition whitespace-nowrap"
                            >
                              {advancing === capa.id
                                ? <><RefreshCw size={11} className="animate-spin" /><span>…</span></>
                                : <><ArrowRight size={11} /><span>Advance</span></>}
                            </button>
                          )}

                          {/* Three-dot menu */}
                          <RowMenu
                            editable={canEditCapa}
                            onView={()   => setViewCapa(capa)}
                            onEdit={()   => setEditCapa(capa)}
                            onDelete={()  => handleDelete(capa.id, capa.capa_number)}
                          />
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
