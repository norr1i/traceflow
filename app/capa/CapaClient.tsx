'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  FileWarning, Plus, RefreshCw, Search, AlertTriangle,
  X, ArrowRight, MoreHorizontal, Eye, Pencil, Trash2,
  FileDown, TrendingUp, ChevronDown, ChevronUp,
} from 'lucide-react'
import {
  useCapas, useCapaAnalytics,
  NEXT_STATUS, ADVANCE_LABEL, SOURCE_LABELS,
  type CapaStatus, type CapaFormData, type Capa, type CapaSourceType,
  PAGE_SIZE,
} from '../hooks/useCapas'
import { useAuth, useRole } from '../lib/auth-context'
import { canEdit } from '../lib/permissions'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { logActivity, actorName } from '../lib/activity'
import PaginationBar from '../components/PaginationBar'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_META: Record<CapaStatus, { label: string; badgeCls: string }> = {
  open:              { label: 'Open',              badgeCls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  investigation:     { label: 'Investigation',     badgeCls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  corrective_action: { label: 'Corrective Action', badgeCls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  verification:      { label: 'Verification',      badgeCls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  closed:            { label: 'Closed',            badgeCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
}

const PRIORITY_META = {
  critical: { label: 'Critical', cls: 'bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400'    },
  major:    { label: 'High',     cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  minor:    { label: 'Medium',   cls: 'bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-400'  },
} as const

const SOURCE_BADGE: Record<string, string> = {
  quality_issue: 'bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400',
  recall:        'bg-red-100    text-red-700    dark:bg-red-900/20    dark:text-red-400',
  audit:         'bg-blue-100   text-blue-700   dark:bg-blue-900/20   dark:text-blue-400',
  complaint:     'bg-amber-100  text-amber-700  dark:bg-amber-900/20  dark:text-amber-400',
  supplier:      'bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400',
  other:         'bg-gray-100   text-gray-600   dark:bg-gray-700      dark:text-gray-400',
}

const SOURCE_OPTIONS: { value: CapaSourceType | ''; label: string }[] = [
  { value: '',               label: 'All Sources'    },
  { value: 'quality_issue',  label: 'Quality Issue'  },
  { value: 'recall',         label: 'Recall'         },
  { value: 'audit',          label: 'Audit'          },
  { value: 'complaint',      label: 'Complaint'      },
  { value: 'supplier',       label: 'Supplier'       },
  { value: 'other',          label: 'Other'          },
]

const PRIORITY_OPTIONS = [
  { value: '' as const,        label: 'All Priorities' },
  { value: 'critical' as const, label: 'Critical'      },
  { value: 'major' as const,    label: 'High'          },
  { value: 'minor' as const,    label: 'Medium'        },
]

// ── Atom components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CapaStatus }) {
  const { label, badgeCls } = STATUS_META[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeCls}`}>
      {label}
    </span>
  )
}

function PriorityBadge({ severity }: { severity: 'minor' | 'major' | 'critical' }) {
  const { label, cls } = PRIORITY_META[severity]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
}

function SourceBadge({ sourceType }: { sourceType: CapaSourceType | null }) {
  if (!sourceType) return <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${SOURCE_BADGE[sourceType] ?? SOURCE_BADGE.other}`}>
      {SOURCE_LABELS[sourceType]}
    </span>
  )
}

function KpiCard({ label, value, color, sub }: { label: string; value: number | string; color: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-4 py-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums leading-none ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">{sub}</p>}
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
  onView:   () => void
  onEdit:   () => void
  onDelete: () => void
  editable: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
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

// ── Analytics panel ───────────────────────────────────────────────────────────

function AnalyticsPanel() {
  const { data, loading } = useCapaAnalytics()
  const [open, setOpen]   = useState(false)

  if (loading && !open) return null

  const maxPri = Math.max(...(data?.by_priority.map(x => x.count) ?? [1]), 1)
  const maxSrc = Math.max(...(data?.by_source.map(x => x.count) ?? [1]), 1)
  const maxMon = Math.max(...(data?.monthly_trend.flatMap(x => [x.opened, x.closed]) ?? [1]), 1)

  const SEVER_CLS: Record<string, string> = {
    critical: 'bg-red-500',
    major:    'bg-orange-400',
    minor:    'bg-amber-400',
  }

  return (
    <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 border-b border-[#B3B7BA]/30 dark:border-[#B3B7BA]/[0.10] px-5 py-3.5 text-left hover:bg-[#D1CFC9]/20 dark:hover:bg-[#262E36]/25 transition-colors"
      >
        <TrendingUp size={15} className="shrink-0 text-gray-400 dark:text-gray-500" />
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Analytics</span>
        <span className="ml-auto text-gray-400 dark:text-gray-600">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {open && (
        <div className="px-5 py-4">
          {loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-200 dark:bg-[#262E36]/55" />
              ))}
            </div>
          ) : !data ? (
            <p className="text-sm italic text-gray-400 dark:text-gray-500">Analytics summary not yet available.</p>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">

              {/* Avg closure time */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">
                  Avg Closure Time
                </p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">
                  {data.avg_closure_days}
                  <span className="ml-1 text-sm font-normal text-gray-400 dark:text-gray-500">days</span>
                </p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">for closed CAPAs</p>
              </div>

              {/* By priority */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">
                  Open by Priority
                </p>
                <div className="space-y-1.5">
                  {data.by_priority.map(p => (
                    <div key={p.severity}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-gray-600 dark:text-gray-400">
                          {PRIORITY_META[p.severity as keyof typeof PRIORITY_META]?.label ?? p.severity}
                        </span>
                        <span className="font-semibold tabular-nums text-gray-800 dark:text-gray-200">{p.count}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                          className={`h-1.5 rounded-full ${SEVER_CLS[p.severity] ?? 'bg-gray-400'}`}
                          style={{ width: `${Math.round((p.count / maxPri) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {data.by_priority.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">No data</p>
                  )}
                </div>
              </div>

              {/* By source */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">
                  CAPAs by Source
                </p>
                <div className="space-y-1.5">
                  {data.by_source.map(s => (
                    <div key={s.source_type}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-gray-600 dark:text-gray-400">
                          {SOURCE_LABELS[s.source_type as CapaSourceType | 'unspecified'] ?? s.source_type}
                        </span>
                        <span className="font-semibold tabular-nums text-gray-800 dark:text-gray-200">{s.count}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                          className="h-1.5 rounded-full bg-[#3a6f8f]"
                          style={{ width: `${Math.round((s.count / maxSrc) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {data.by_source.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">No data</p>
                  )}
                </div>
              </div>

              {/* Monthly trend */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">
                  Monthly Trend
                </p>
                <div className="flex items-end gap-1 h-14">
                  {data.monthly_trend.map(m => (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className="flex flex-col w-full gap-px">
                        <div
                          className="w-full rounded-sm bg-[#3a6f8f]/70"
                          style={{ height: `${Math.max(2, Math.round((m.opened / maxMon) * 40))}px` }}
                          title={`Opened: ${m.opened}`}
                        />
                        <div
                          className="w-full rounded-sm bg-emerald-500/70"
                          style={{ height: `${Math.max(2, Math.round((m.closed / maxMon) * 40))}px` }}
                          title={`Closed: ${m.closed}`}
                        />
                      </div>
                      <p className="text-[8px] text-gray-400 dark:text-gray-500 tabular-nums leading-none">
                        {m.month.split(' ')[0]}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-3 text-[9px] text-gray-400">
                  <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 rounded-sm bg-[#3a6f8f]/70" />Opened</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 rounded-sm bg-emerald-500/70" />Closed</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Shared form fields ────────────────────────────────────────────────────────

const fieldCls = 'w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]'
const labelCls = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300'

const EMPTY_FORM: CapaFormData = {
  title: '', severity: 'major', source_type: null,
  root_cause: '', corrective_action: '', preventive_action: '',
  owner_name: '', due_date: '', status: 'open',
  recall_id: null, inspection_id: null, batch_id: null,
}

// ── Create modal ──────────────────────────────────────────────────────────────

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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Priority</label>
              <select value={form.severity} onChange={f('severity')} className={fieldCls}>
                <option value="minor">Medium</option>
                <option value="major">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Source Type</label>
              <select value={form.source_type ?? ''} onChange={f('source_type')} className={fieldCls}>
                <option value="">Select source…</option>
                {SOURCE_OPTIONS.slice(1).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Owner *</label>
              <input required value={form.owner_name ?? ''} onChange={f('owner_name')}
                className={fieldCls} placeholder="Responsible person" />
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
            <label className={labelCls}>Linked Batch ID <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={form.batch_id ?? ''} onChange={f('batch_id')} className={fieldCls}
              placeholder="Production order UUID" />
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

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditModal({ capa, onClose, onSave, saving }: {
  capa:    Capa
  onClose: () => void
  onSave:  (data: CapaFormData) => Promise<void>
  saving:  boolean
}) {
  const [form, setForm] = useState<CapaFormData>({
    title:             capa.title,
    severity:          capa.severity,
    source_type:       capa.source_type,
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Priority</label>
              <select value={form.severity} onChange={f('severity')} className={fieldCls}>
                <option value="minor">Medium</option>
                <option value="major">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Source Type</label>
              <select value={form.source_type ?? ''} onChange={f('source_type')} className={fieldCls}>
                <option value="">Unspecified</option>
                {SOURCE_OPTIONS.slice(1).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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

// ── Export helpers ────────────────────────────────────────────────────────────

function exportCSV(rows: Capa[]) {
  const q   = (s: string) => `"${String(s).replace(/"/g, '""')}"`
  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB') : ''
  const header = ['CAPA #', 'Title', 'Priority', 'Source', 'Owner', 'Due Date', 'Status', 'Created', 'Closed']
  const lines  = [
    header.map(q).join(','),
    ...rows.map(c => [
      q(c.capa_number ?? c.id.slice(0, 8)),
      q(c.title),
      q(PRIORITY_META[c.severity]?.label ?? c.severity),
      q(c.source_type ? SOURCE_LABELS[c.source_type] : ''),
      q(c.owner_name ?? ''),
      q(fmt(c.due_date)),
      q(STATUS_META[c.status].label),
      q(fmt(c.created_at)),
      q(fmt(c.closed_at)),
    ].join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `capas-${new Date().toISOString().slice(0, 10)}.csv`,
  })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function exportJSON(rows: Capa[]) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `capas-${new Date().toISOString().slice(0, 10)}.json`,
  })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Main component ────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'open' | 'in_progress' | 'overdue' | 'closed'

export default function CapaClient() {
  const router  = useRouter()
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
  const [filterPri,  setFilterPri]  = useState<'critical' | 'major' | 'minor' | ''>('')
  const [filterSrc,  setFilterSrc]  = useState<CapaSourceType | ''>('')
  const [showCreate, setShowCreate] = useState(false)
  const [editCapa,   setEditCapa]   = useState<Capa | null>(null)
  const [saving,     setSaving]     = useState(false)
  const [advancing,  setAdvancing]  = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  const filtered = capas.filter(c => {
    const matchSearch =
      search === '' ||
      c.title?.toLowerCase().includes(search.toLowerCase()) ||
      c.capa_number?.toLowerCase().includes(search.toLowerCase()) ||
      c.owner_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.batch_id?.includes(search)

    const overdue    = c.status !== 'closed' && !!c.due_date && c.due_date < today
    const inProgress = ['investigation', 'corrective_action', 'verification'].includes(c.status)

    const matchTab =
      filterTab === 'all'          ? true
      : filterTab === 'open'       ? c.status === 'open'
      : filterTab === 'in_progress'? inProgress
      : filterTab === 'overdue'    ? overdue
      : filterTab === 'closed'     ? c.status === 'closed'
      : true

    const matchPri = filterPri === '' || c.severity === filterPri
    const matchSrc = filterSrc === '' || c.source_type === filterSrc

    return matchSearch && matchTab && matchPri && matchSrc
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

    const confirmed = await confirm({
      title:        next === 'closed' ? 'Close this CAPA?' : 'Advance Stage',
      message:      `${STATUS_META[current].label} → ${STATUS_META[next].label}`,
      confirmLabel: next === 'closed' ? 'Close CAPA' : 'Confirm',
      danger:       false,
    })
    if (!confirmed) return

    setAdvancing(id)
    const ok = await advanceStatus(id, current, user?.email)
    setAdvancing(null)
    if (!ok) { toast.error('Failed to advance status'); return }
    toast.success(next === 'closed' ? 'CAPA closed' : `Advanced to ${STATUS_META[next].label}`)
    if (companyId) {
      void logActivity({
        companyId, actorUserId: user?.id, actorEmail: user?.email,
        actionType: next === 'closed' ? 'capa.closed' : 'capa.updated',
        entityType: 'capa', entityId: id,
        message: `${actorName(user?.email)} advanced CAPA to ${STATUS_META[next].label}`,
      })
    }
  }

  async function handleDelete(id: string, capaNumber: string | null) {
    const ok2 = await confirm({
      title:        'Delete CAPA',
      message:      `Delete ${capaNumber ?? 'this CAPA'}? This cannot be undone.`,
      confirmLabel: 'Delete',
    })
    if (!ok2) return
    const deleted = await deleteCapa(id)
    if (deleted) toast.success('CAPA deleted')
    else         toast.error('Failed to delete CAPA')
  }

  const inProgressCount = !loading
    ? (stats?.investigation ?? 0) + (stats?.corrective_action ?? 0) + (stats?.verification ?? 0)
    : null
  const openIsZero = !loading && (stats?.open ?? 0) === 0

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)] p-6">

      {/* Modals */}
      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onSave={handleCreate} saving={saving} />
      )}
      {editCapa && (
        <EditModal capa={editCapa} onClose={() => setEditCapa(null)} onSave={handleEdit} saving={saving} />
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">CAPA Center</h1>
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

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle size={16} />{error}
        </div>
      )}

      {/* KPI cards */}
      <div className={`mb-5 grid gap-3 ${!loading && openIsZero ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3 xl:grid-cols-5'}`}>
        <KpiCard label="Total"       value={loading ? '—' : totalCount}        color="text-gray-800 dark:text-gray-100" sub="all time" />
        {(!loading && !openIsZero) && (
          <KpiCard label="Open"      value={stats?.open ?? 0}                  color="text-blue-600 dark:text-blue-400" sub="needs action" />
        )}
        <KpiCard label="In Progress" value={loading ? '—' : (inProgressCount ?? '—')} color="text-amber-600 dark:text-amber-400" sub="investigation · CA · verify" />
        <KpiCard label="Closed"      value={loading ? '—' : (stats?.closed ?? 0)}     color="text-emerald-600 dark:text-emerald-400" sub="resolved" />
        <KpiCard
          label="Overdue"
          value={loading ? '—' : (stats?.overdue ?? 0)}
          color={(stats?.overdue ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}
          sub={loading ? '' : (stats?.overdue ?? 0) > 0 ? 'past due date' : 'none overdue'}
        />
      </div>

      {/* Analytics panel */}
      <div className="mb-5">
        <AnalyticsPanel />
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 p-1 shadow-sm">
          {([
            { key: 'all'          as FilterTab, label: 'All'         },
            { key: 'open'         as FilterTab, label: 'Open'        },
            { key: 'in_progress'  as FilterTab, label: 'In Progress' },
            { key: 'overdue'      as FilterTab, label: 'Overdue'     },
            { key: 'closed'       as FilterTab, label: 'Closed'      },
          ]).map(tab => (
            <button key={tab.key} onClick={() => setFilterTab(tab.key)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
                filterTab === tab.key
                  ? 'bg-[#3a6f8f] text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Priority filter */}
        <select
          value={filterPri}
          onChange={e => setFilterPri(e.target.value as typeof filterPri)}
          className="rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#4a7fa5]"
        >
          {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Source filter */}
        <select
          value={filterSrc}
          onChange={e => setFilterSrc(e.target.value as typeof filterSrc)}
          className="rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#4a7fa5]"
        >
          {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Table card */}
      <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm">

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 dark:border-[#B3B7BA]/[0.10] px-5 py-4">
          <div className="relative w-full sm:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search by title, CAPA #, owner, batch…"
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#D1CFC9]/50 dark:bg-[#262E36]/55 py-2 pl-9 pr-3 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:border-[#4a7fa5] focus:outline-none focus:ring-1 focus:ring-[#4a7fa5]/30" />
          </div>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => exportCSV(filtered)}
              className="flex items-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-white/50 dark:bg-[#262E36]/25 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#262E36]/45 transition"
            >
              <FileDown size={14} />CSV
            </button>
            <button
              onClick={() => exportJSON(filtered)}
              className="flex items-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-white/50 dark:bg-[#262E36]/25 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#262E36]/45 transition"
            >
              <FileDown size={14} />JSON
            </button>
          </div>
        </div>

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
                  <th className="px-4 py-3.5 text-start whitespace-nowrap">Source</th>
                  <th className="px-4 py-3.5 text-start whitespace-nowrap">Priority</th>
                  <th className="px-4 py-3.5 text-start whitespace-nowrap">Owner</th>
                  <th className="px-4 py-3.5 text-start whitespace-nowrap">Due Date</th>
                  <th className="px-4 py-3.5 text-start whitespace-nowrap">Status</th>
                  <th className="px-4 py-3.5 text-start whitespace-nowrap">Created</th>
                  <th className="px-4 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#B3B7BA]/[0.08]">
                {filtered.map(capa => {
                  const nextStatus   = NEXT_STATUS[capa.status]
                  const advanceLabel = ADVANCE_LABEL[capa.status]
                  const overdue      = capa.status !== 'closed' && !!capa.due_date && capa.due_date < today
                  return (
                    <tr key={capa.id}
                      className="hover:bg-[#3a6f8f]/[0.07] dark:hover:bg-[#3a6f8f]/[0.13] transition-colors">

                      <td className="px-4 py-4 whitespace-nowrap">
                        <button
                          onClick={() => router.push(`/capa/${capa.id}`)}
                          className="font-mono text-xs font-semibold text-[#3a6f8f] dark:text-[#7ab3d0] hover:underline underline-offset-2"
                        >
                          {capa.capa_number ?? `#${capa.id.slice(0, 8)}`}
                        </button>
                      </td>

                      <td className="px-4 py-4 max-w-[220px]">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-tight truncate">
                          {capa.title}
                        </p>
                      </td>

                      <td className="px-4 py-4 whitespace-nowrap">
                        <SourceBadge sourceType={capa.source_type} />
                      </td>

                      <td className="px-4 py-4 whitespace-nowrap">
                        <PriorityBadge severity={capa.severity} />
                      </td>

                      <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
                        {capa.owner_name ?? '—'}
                      </td>

                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className={`text-xs ${overdue ? 'font-semibold text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                          {capa.due_date
                            ? new Date(capa.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                            : '—'}
                        </span>
                      </td>

                      <td className="px-4 py-4 whitespace-nowrap">
                        <StatusBadge status={capa.status} />
                      </td>

                      <td className="px-4 py-4 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                        {new Date(capa.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {canEditCapa && nextStatus && advanceLabel && (
                            <button
                              disabled={advancing === capa.id}
                              onClick={() => handleAdvance(capa.id, capa.status)}
                              className="flex items-center gap-1 rounded-md border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.15] bg-white/60 dark:bg-[#262E36]/30 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:border-[#3a6f8f]/50 hover:bg-[#3a6f8f]/10 hover:text-[#3a6f8f] dark:hover:text-[#7ab3d0] disabled:opacity-40 transition whitespace-nowrap"
                            >
                              {advancing === capa.id
                                ? <><RefreshCw size={11} className="animate-spin" /><span>…</span></>
                                : <><ArrowRight size={11} /><span>{advanceLabel}</span></>
                              }
                            </button>
                          )}
                          <RowMenu
                            editable={canEditCapa}
                            onView={()  => router.push(`/capa/${capa.id}`)}
                            onEdit={()  => setEditCapa(capa)}
                            onDelete={() => handleDelete(capa.id, capa.capa_number)}
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

        {!loading && (
          <PaginationBar
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={PAGE_SIZE}
            onPage={goToPage}
          />
        )}

        {!loading && (
          <div className="border-t border-gray-100 dark:border-[#B3B7BA]/[0.10] px-5 py-3.5 text-xs text-gray-400 dark:text-gray-500">
            Showing {filtered.length} of {totalCount} CAPA{totalCount !== 1 ? 's' : ''}
            {(stats?.closed ?? 0) > 0 && ` · ${stats?.closed} closed`}
            {(stats?.overdue ?? 0) > 0 && ` · ${stats?.overdue} overdue`}
          </div>
        )}
      </div>
    </div>
  )
}
