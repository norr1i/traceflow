'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, FileWarning, ArrowRight, CheckCircle2,
  Plus, Trash2, Upload, FileText, Image as ImageIcon,
  ExternalLink, AlertTriangle, RefreshCw, GitBranch,
  Clock, ChevronDown, ChevronUp, X,
} from 'lucide-react'
import {
  useCapaDetail, NEXT_STATUS, ADVANCE_LABEL, SOURCE_LABELS,
  type CapaStatus, type CapaFormData, type CapaAction, type CapaEvidence,
} from '../../hooks/useCapas'
import { useRole } from '../../lib/auth-context'
import { canEdit } from '../../lib/permissions'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'

// ── Design tokens (matches CapaClient) ───────────────────────────────────────

const card   = 'rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm'
const field  = 'w-full rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]'
const label  = 'mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500'
const btnPri = 'flex items-center gap-1.5 rounded-lg bg-[#3a6f8f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#2d5a74] disabled:opacity-50 transition-colors'
const btnSec = 'flex items-center gap-1.5 rounded-lg border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-[#D1CFC9]/30 dark:hover:bg-[#262E36]/55 transition-colors'

// ── Status / priority helpers ─────────────────────────────────────────────────

const STATUS_META: Record<CapaStatus, { label: string; badge: string }> = {
  open:              { label: 'Open',              badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  investigation:     { label: 'Investigation',     badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  corrective_action: { label: 'Corrective Action', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  verification:      { label: 'Verification',      badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  closed:            { label: 'Closed',            badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
}

const PRIORITY_META = {
  critical: { label: 'Critical', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  major:    { label: 'High',     cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  minor:    { label: 'Medium',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
}

const ACTION_BADGE: Record<CapaAction['status'], string> = {
  open:        'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  completed:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
}

function fmt(iso: string | null, opts?: Intl.DateTimeFormatOptions) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', opts ?? {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function fmtTs(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function fileIcon(type: string | null) {
  if (!type) return <FileText size={14} />
  if (type.startsWith('image/')) return <ImageIcon size={14} />
  return <FileText size={14} />
}

function bytes(n: number | null) {
  if (!n) return ''
  if (n < 1024)        return `${n} B`
  if (n < 1048576)     return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

// ── Collapsible section wrapper ───────────────────────────────────────────────

function Section({ title, icon: Icon, count, defaultOpen = true, children }: {
  title: string; icon: React.ElementType; count?: number
  defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={card}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 border-b border-[#B3B7BA]/30 dark:border-[#B3B7BA]/[0.10] px-5 py-3.5 text-left hover:bg-[#D1CFC9]/20 dark:hover:bg-[#262E36]/25 transition-colors"
      >
        <Icon size={15} className="shrink-0 text-gray-400 dark:text-gray-500" />
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-[#3a6f8f]/15 dark:bg-[#3a6f8f]/25 px-2 py-0.5 text-xs font-semibold text-[#3a6f8f] dark:text-[#7ab3d0]">
            {count}
          </span>
        )}
        <span className="ml-auto text-gray-400 dark:text-gray-600">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  )
}

// ── Inline edit panel ─────────────────────────────────────────────────────────

function EditPanel({ initial, onSave, onClose, saving }: {
  initial: Pick<CapaFormData, 'title' | 'root_cause' | 'corrective_action' | 'preventive_action' | 'owner_name' | 'due_date'>
  onSave: (d: typeof initial) => void
  onClose: () => void
  saving: boolean
}) {
  const [form, setForm] = useState(initial)
  const f = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div>
        <p className={label}>Title</p>
        <input required value={form.title} onChange={f('title')} className={field} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className={label}>Owner</p>
          <input value={form.owner_name ?? ''} onChange={f('owner_name')} className={field} />
        </div>
        <div>
          <p className={label}>Due Date</p>
          <input type="date" value={form.due_date ?? ''} onChange={f('due_date')} className={field} />
        </div>
      </div>
      <div>
        <p className={label}>Root Cause</p>
        <textarea rows={3} value={form.root_cause ?? ''} onChange={f('root_cause')} className={field} />
      </div>
      <div>
        <p className={label}>Corrective Action</p>
        <textarea rows={3} value={form.corrective_action ?? ''} onChange={f('corrective_action')} className={field} />
      </div>
      <div>
        <p className={label}>Preventive Action</p>
        <textarea rows={3} value={form.preventive_action ?? ''} onChange={f('preventive_action')} className={field} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className={btnSec}>Cancel</button>
        <button type="submit" disabled={saving} className={btnPri}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}

// ── Add Action form ───────────────────────────────────────────────────────────

function AddActionForm({ onAdd, onClose }: {
  onAdd: (desc: string, assignedTo: string, dueDate: string) => void
  onClose: () => void
}) {
  const [desc,    setDesc]    = useState('')
  const [to,      setTo]      = useState('')
  const [due,     setDue]     = useState('')
  const [submitting, setSub]  = useState(false)

  async function handle(e: React.FormEvent) {
    e.preventDefault()
    setSub(true)
    await onAdd(desc, to, due)
    setSub(false)
    onClose()
  }

  return (
    <form onSubmit={handle} className="mt-3 rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC]/60 dark:bg-[#1a2530]/50 p-4 space-y-3">
      <div>
        <p className={label}>Action Description *</p>
        <input required value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="Describe the action to take" className={field} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className={label}>Assigned To</p>
          <input value={to} onChange={e => setTo(e.target.value)}
            placeholder="Name or team" className={field} />
        </div>
        <div>
          <p className={label}>Due Date</p>
          <input type="date" value={due} onChange={e => setDue(e.target.value)} className={field} />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className={btnSec}>Cancel</button>
        <button type="submit" disabled={submitting} className={btnPri}>
          {submitting ? 'Adding…' : 'Add Action'}
        </button>
      </div>
    </form>
  )
}

// ── Upload Evidence panel ─────────────────────────────────────────────────────

function UploadPanel({ onUpload, uploading, onClose }: {
  onUpload: (file: File, notes: string) => void
  uploading: boolean
  onClose: () => void
}) {
  const ref  = useRef<HTMLInputElement>(null)
  const [file,  setFile]  = useState<File | null>(null)
  const [notes, setNotes] = useState('')

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setFile(e.dataTransfer.files?.[0] ?? null)
  }

  return (
    <div className="mt-3 rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC]/60 dark:bg-[#1a2530]/50 p-4 space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => ref.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#B3B7BA]/60 dark:border-[#B3B7BA]/[0.20] bg-white/30 dark:bg-[#0d1520]/30 px-4 py-6 text-center transition-colors hover:border-[#3a6f8f]/60 hover:bg-[#3a6f8f]/5"
      >
        <Upload size={20} className="mb-2 text-gray-400" />
        {file
          ? <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{file.name} ({bytes(file.size)})</p>
          : <>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Click or drag to upload</p>
              <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">PDF, Word, Excel, images up to 50 MB</p>
            </>
        }
        <input ref={ref} type="file" className="hidden" onChange={handleFile}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.webp" />
      </div>

      <div>
        <p className={label}>Notes (optional)</p>
        <input value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Describe this attachment" className={field} />
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className={btnSec}>Cancel</button>
        <button
          disabled={!file || uploading}
          onClick={() => file && onUpload(file, notes)}
          className={btnPri}
        >
          {uploading ? <><RefreshCw size={13} className="animate-spin" />Uploading…</> : <><Upload size={13} />Upload</>}
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CapaDetailClient({ id }: { id: string }) {
  const toast   = useToast()
  const confirm = useConfirm()
  const role    = useRole()
  const canEditCapa = canEdit(role, 'capa')

  const {
    capa, actions, evidence, history,
    loading, error, saving, uploading,
    advanceStatus, updateCapa,
    addAction, completeAction, deleteAction,
    uploadEvidence, deleteEvidence,
    refresh,
  } = useCapaDetail(id)

  const [editing,       setEditing]       = useState(false)
  const [showAddAction, setShowAddAction] = useState(false)
  const [showUpload,    setShowUpload]    = useState(false)
  const [advancing,     setAdvancing]     = useState(false)

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleAdvance() {
    if (!capa) return
    const next = NEXT_STATUS[capa.status]
    if (!next) return

    const confirmed = await confirm({
      title:        next === 'closed' ? 'Close this CAPA?' : 'Advance Stage',
      message:      `${STATUS_META[capa.status].label} → ${STATUS_META[next].label}`,
      confirmLabel: next === 'closed' ? 'Close CAPA' : 'Confirm',
      danger:       false,
    })
    if (!confirmed) return

    setAdvancing(true)
    const ok = await advanceStatus(capa.status)
    setAdvancing(false)
    if (ok) toast.success(next === 'closed' ? 'CAPA closed' : `Advanced to ${STATUS_META[next].label}`)
    else    toast.error('Failed to advance status')
  }

  async function handleSaveEdit(data: Partial<CapaFormData>) {
    const ok = await updateCapa(data)
    if (ok) { setEditing(false); toast.success('CAPA updated') }
    else    toast.error('Failed to update CAPA')
  }

  async function handleAddAction(desc: string, to: string, due: string) {
    const ok = await addAction(desc, to, due)
    if (ok) { setShowAddAction(false); toast.success('Action added') }
    else    toast.error('Failed to add action')
  }

  async function handleCompleteAction(actionId: string) {
    const ok = await completeAction(actionId)
    if (!ok) toast.error('Failed to complete action')
    else toast.success('Action marked complete')
  }

  async function handleDeleteAction(actionId: string) {
    const ok2 = await confirm({ title: 'Delete Action', message: 'Remove this action item?', confirmLabel: 'Delete' })
    if (!ok2) return
    const ok = await deleteAction(actionId)
    if (!ok) toast.error('Failed to delete action')
  }

  async function handleUpload(file: File, notes: string) {
    const ok = await uploadEvidence(file, notes)
    if (ok) { setShowUpload(false); toast.success('Evidence uploaded') }
    else    toast.error('Upload failed — ensure the "capa-evidence" storage bucket exists in Supabase')
  }

  async function handleDeleteEvidence(ev: CapaEvidence) {
    const ok2 = await confirm({ title: 'Delete Evidence', message: `Remove "${ev.file_name}"?`, confirmLabel: 'Delete' })
    if (!ok2) return
    const ok = await deleteEvidence(ev.id, ev.file_url)
    if (!ok) toast.error('Failed to delete evidence')
    else toast.success('Evidence deleted')
  }

  // ── Loading / error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--bg)] p-6">
        <div className="mb-6 h-8 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-[#262E36]/55" />
        <div className="space-y-4">
          {[0, 1, 2].map(i => (
            <div key={i} className={`${card} h-32 animate-pulse`} />
          ))}
        </div>
      </div>
    )
  }

  if (error || !capa) {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--bg)] p-6">
        <div className={`${card} flex items-center gap-3 px-5 py-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20`}>
          <AlertTriangle size={16} className="text-red-500" />
          <p className="text-sm text-red-700 dark:text-red-400">{error ?? 'CAPA not found'}</p>
        </div>
        <Link href="/capa" className={`mt-4 ${btnSec}`} style={{ width: 'fit-content' }}>
          <ArrowLeft size={14} /> Back to CAPAs
        </Link>
      </div>
    )
  }

  const sm   = STATUS_META[capa.status]
  const pm   = PRIORITY_META[capa.severity]
  const next = NEXT_STATUS[capa.status]
  const today = new Date().toISOString().slice(0, 10)
  const isOverdue = capa.status !== 'closed' && !!capa.due_date && capa.due_date < today

  // Build merged timeline from both status_history table AND capas timestamp columns
  type TLEntry = { label: string; ts: string; by?: string | null }
  const timeline: TLEntry[] = []
  // Created (always first)
  timeline.push({ label: 'Opened', ts: capa.created_at })
  // Status history entries (if the table exists and has rows)
  if (history.length > 0) {
    history.forEach(h => {
      timeline.push({
        label: STATUS_META[h.to_status as CapaStatus]?.label
          ? `Advanced to ${STATUS_META[h.to_status as CapaStatus].label}`
          : `Status → ${h.to_status}`,
        ts: h.created_at,
        by: h.changed_by,
      })
    })
  } else {
    // Fall back to capas timestamp columns for older records
    if (capa.investigation_at)    timeline.push({ label: 'Investigation Started',    ts: capa.investigation_at })
    if (capa.corrective_action_at) timeline.push({ label: 'Corrective Action Started', ts: capa.corrective_action_at })
    if (capa.verification_at)     timeline.push({ label: 'Verification Started',     ts: capa.verification_at })
    if (capa.closed_at)           timeline.push({ label: 'Closed',                   ts: capa.closed_at })
  }
  timeline.sort((a, b) => a.ts.localeCompare(b.ts))

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)] p-6">

      {/* Breadcrumb */}
      <div className="mb-5 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Link href="/capa" className="hover:text-[#3a6f8f] dark:hover:text-[#7ab3d0] transition-colors">
          CAPA Center
        </Link>
        <span>/</span>
        <span className="font-mono text-[#3a6f8f] dark:text-[#7ab3d0]">
          {capa.capa_number ?? `#${capa.id.slice(0, 8)}`}
        </span>
      </div>

      {/* Header card */}
      <div className={`${card} mb-5 p-5`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="mb-1 font-mono text-xs font-semibold text-[#3a6f8f] dark:text-[#7ab3d0]">
              {capa.capa_number ?? `#${capa.id.slice(0, 8)}`}
            </p>
            <h1 className="text-xl font-bold leading-snug text-gray-900 dark:text-white">
              {capa.title}
            </h1>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${sm.badge}`}>{sm.label}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pm.cls}`}>{pm.label}</span>
              {capa.source_type && (
                <span className="rounded-full border border-[#B3B7BA]/40 px-2.5 py-0.5 text-xs text-gray-600 dark:text-gray-400">
                  {SOURCE_LABELS[capa.source_type]}
                </span>
              )}
              {isOverdue && (
                <span className="rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2.5 py-0.5 text-xs font-semibold">
                  Overdue
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {canEditCapa && !editing && (
              <button onClick={() => setEditing(true)} className={btnSec}>
                Edit
              </button>
            )}
            {canEditCapa && next && (
              <button onClick={handleAdvance} disabled={advancing || saving} className={btnPri}>
                {advancing
                  ? <><RefreshCw size={13} className="animate-spin" />Advancing…</>
                  : <><ArrowRight size={13} />{ADVANCE_LABEL[capa.status]}</>
                }
              </button>
            )}
            <button onClick={refresh} className={btnSec} title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Info grid */}
        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-[#B3B7BA]/30 dark:border-[#B3B7BA]/[0.10] pt-4 sm:grid-cols-4">
          <div>
            <p className={label}>Owner</p>
            <p className="text-sm text-gray-800 dark:text-gray-200">{capa.owner_name ?? '—'}</p>
          </div>
          <div>
            <p className={label}>Due Date</p>
            <p className={`text-sm ${isOverdue ? 'font-semibold text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-200'}`}>
              {fmt(capa.due_date)}
            </p>
          </div>
          <div>
            <p className={label}>Opened</p>
            <p className="text-sm text-gray-800 dark:text-gray-200">{fmt(capa.created_at)}</p>
          </div>
          <div>
            <p className={label}>Closed</p>
            <p className="text-sm text-gray-800 dark:text-gray-200">{fmt(capa.closed_at)}</p>
          </div>
          {capa.batch_id && (
            <div>
              <p className={label}>Linked Batch</p>
              <a
                href={`/product-journey/${capa.batch_id}`}
                className="flex items-center gap-1 text-sm text-[#3a6f8f] dark:text-[#7ab3d0] hover:underline"
              >
                <GitBranch size={12} />···{capa.batch_id.slice(-10)}
              </a>
            </div>
          )}
          {capa.recall_id && (
            <div>
              <p className={label}>Linked Recall</p>
              <a
                href={`/recall`}
                className="flex items-center gap-1 text-sm text-[#3a6f8f] dark:text-[#7ab3d0] hover:underline"
              >
                <ExternalLink size={12} />View Recall
              </a>
            </div>
          )}
        </div>

        {/* Inline edit form */}
        {editing && (
          <div className="mt-5 border-t border-[#B3B7BA]/30 dark:border-[#B3B7BA]/[0.10] pt-4">
            <EditPanel
              initial={{
                title:             capa.title,
                root_cause:        capa.root_cause        ?? '',
                corrective_action: capa.corrective_action ?? '',
                preventive_action: capa.preventive_action ?? '',
                owner_name:        capa.owner_name        ?? '',
                due_date:          capa.due_date          ?? '',
              }}
              onSave={handleSaveEdit}
              onClose={() => setEditing(false)}
              saving={saving}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">

        {/* Left column — details + actions + evidence */}
        <div className="space-y-5 xl:col-span-2">

          {/* Details */}
          <Section title="Root Cause Analysis" icon={FileWarning}>
            {capa.root_cause ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {capa.root_cause}
              </p>
            ) : (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">No root cause recorded yet.</p>
            )}
          </Section>

          <Section title="Actions Taken" icon={CheckCircle2} count={actions.length}>
            {actions.length === 0 && !showAddAction && (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">No action items recorded.</p>
            )}

            {actions.length > 0 && (
              <div className="mb-3 space-y-2">
                {actions.map(a => (
                  <div
                    key={a.id}
                    className="flex items-start gap-3 rounded-lg border border-[#B3B7BA]/40 dark:border-[#B3B7BA]/[0.12] bg-white/50 dark:bg-[#1a2530]/50 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${a.status === 'completed' ? 'line-through text-gray-400 dark:text-gray-600' : 'text-gray-800 dark:text-gray-200'}`}>
                        {a.description}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400">
                        {a.assigned_to && <span>{a.assigned_to}</span>}
                        {a.due_date    && <span className="flex items-center gap-0.5"><Clock size={10} />{fmt(a.due_date)}</span>}
                        {a.completed_at && <span>Completed {fmt(a.completed_at)}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${ACTION_BADGE[a.status]}`}>
                        {a.status.replace('_', ' ')}
                      </span>
                      {canEditCapa && a.status !== 'completed' && (
                        <button
                          onClick={() => handleCompleteAction(a.id)}
                          className="text-emerald-600 dark:text-emerald-400 hover:opacity-70 transition-opacity"
                          title="Mark complete"
                        >
                          <CheckCircle2 size={15} />
                        </button>
                      )}
                      {canEditCapa && (
                        <button
                          onClick={() => handleDeleteAction(a.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showAddAction
              ? <AddActionForm onAdd={handleAddAction} onClose={() => setShowAddAction(false)} />
              : canEditCapa && (
                  <button onClick={() => setShowAddAction(true)} className={btnSec}>
                    <Plus size={13} />Add Action
                  </button>
                )
            }
          </Section>

          {/* Verification notes */}
          {(capa.corrective_action || capa.preventive_action) && (
            <Section title="Verification Notes" icon={CheckCircle2}>
              {capa.corrective_action && (
                <div className="mb-4">
                  <p className={label}>Corrective Action</p>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                    {capa.corrective_action}
                  </p>
                </div>
              )}
              {capa.preventive_action && (
                <div>
                  <p className={label}>Preventive Action</p>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                    {capa.preventive_action}
                  </p>
                </div>
              )}
            </Section>
          )}

          {/* Evidence */}
          <Section title="Evidence Files" icon={Upload} count={evidence.length}>
            {evidence.length === 0 && !showUpload && (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">No evidence files attached.</p>
            )}

            {evidence.length > 0 && (
              <div className="mb-3 space-y-2">
                {evidence.map(ev => (
                  <div
                    key={ev.id}
                    className="flex items-center gap-3 rounded-lg border border-[#B3B7BA]/40 dark:border-[#B3B7BA]/[0.12] bg-white/50 dark:bg-[#1a2530]/50 px-4 py-3"
                  >
                    <span className="shrink-0 text-gray-400 dark:text-gray-500">
                      {fileIcon(ev.file_type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <a
                        href={ev.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-sm font-medium text-[#3a6f8f] dark:text-[#7ab3d0] hover:underline flex items-center gap-1"
                      >
                        {ev.file_name}
                        <ExternalLink size={11} />
                      </a>
                      <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                        {bytes(ev.file_size)}{ev.uploaded_by ? ` · ${ev.uploaded_by}` : ''}
                        {ev.notes ? ` · ${ev.notes}` : ''}
                        {' · '}{fmt(ev.created_at)}
                      </p>
                    </div>
                    {canEditCapa && (
                      <button
                        onClick={() => handleDeleteEvidence(ev)}
                        className="shrink-0 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {showUpload
              ? <UploadPanel onUpload={handleUpload} uploading={uploading} onClose={() => setShowUpload(false)} />
              : canEditCapa && (
                  <button onClick={() => setShowUpload(true)} className={btnSec}>
                    <Upload size={13} />Attach File
                  </button>
                )
            }
          </Section>
        </div>

        {/* Right column — timeline */}
        <div className="space-y-5">
          <Section title="Status History" icon={Clock} defaultOpen>
            {timeline.length === 0 ? (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">No history yet.</p>
            ) : (
              <ol className="space-y-0">
                {timeline.map((entry, idx) => {
                  const isLast = idx === timeline.length - 1
                  return (
                    <li key={`${entry.label}-${entry.ts}`} className="flex gap-3">
                      <div className="flex flex-col items-center pt-0.5">
                        <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${isLast ? 'bg-[#3a6f8f] dark:bg-[#7ab3d0]' : 'bg-gray-300 dark:bg-gray-600'}`} />
                        {!isLast && <div className="mt-1 w-px flex-1 bg-gray-200 dark:bg-[#B3B7BA]/[0.15]" style={{ minHeight: '1.5rem' }} />}
                      </div>
                      <div className={isLast ? 'pb-0' : 'pb-4'}>
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{entry.label}</p>
                        <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500 tabular-nums">{fmtTs(entry.ts)}</p>
                        {entry.by && (
                          <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-600">{entry.by}</p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </Section>

          {/* Back link */}
          <Link href="/capa" className={btnSec} style={{ width: 'fit-content' }}>
            <ArrowLeft size={14} /> All CAPAs
          </Link>
        </div>
      </div>
    </div>
  )
}
