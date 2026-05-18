'use client'

import { useQualityInspections } from '../hooks/useQualityInspections'
import { InspectionFormData } from '../types/quality'
import { useState } from 'react'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import {
  ShieldCheck,
  ShieldX,
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Search,
  Plus,
  RefreshCw,
  TrendingUp,
  Trash2,
  X,
} from 'lucide-react'

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
}: {
  label: string
  value: string | number
  icon: React.ElementType
  color: string
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] p-5 shadow-sm">
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
  const map: Record<string, string> = {
    minor:    'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 ring-yellow-200 dark:ring-yellow-800',
    major:    'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 ring-orange-200 dark:ring-orange-800',
    critical: 'bg-red-100 dark:bg-red-900/20 text-red-900 dark:text-red-400 ring-red-300 dark:ring-red-800',
  }
  const key = (severity ?? 'minor').toLowerCase()
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 capitalize ${
        map[key] ?? map['minor']
      }`}
    >
      {severity ?? 'Minor'}
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
  const {
    inspections,
    defects,
    metrics,
    loading,
    error,
    refresh,
    createInspection,
    deleteInspection,
  } = useQualityInspections()

  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'failed'>('all')
  const [activeTab, setActiveTab]     = useState<'inspections' | 'defects'>('inspections')

  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState<InspectionFormData>(emptyForm)
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function openNew() {
    setForm({ ...emptyForm, inspection_date: new Date().toISOString().slice(0, 10) })
    setFormError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    const result = await createInspection(form)
    setSaving(false)
    if (!result) {
      setFormError('Failed to save. Check your connection and try again.')
      toast.error('Failed to create inspection')
      return
    }
    setShowForm(false)
    toast.success('Inspection created')
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Delete inspection?',
      message: 'This will permanently remove the inspection record.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    const result = await deleteInspection(id)
    if (result) {
      toast.success('Inspection deleted')
    } else {
      toast.error('Failed to delete inspection')
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
      {/* New Inspection modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white dark:bg-[#0d1829] dark:backdrop-blur-xl p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">New Inspection</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Batch ID</label>
                  <input
                    required
                    value={form.batch_id}
                    onChange={(e) => setForm({ ...form, batch_id: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.06] px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. BATCH-001"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Inspector ID</label>
                  <input
                    required
                    value={form.inspector_id}
                    onChange={(e) => setForm({ ...form, inspector_id: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.06] px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. inspector-1"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Inspection Date</label>
                <input
                  required
                  type="date"
                  value={form.inspection_date}
                  onChange={(e) => setForm({ ...form, inspection_date: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.06] px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Type</label>
                  <select
                    value={form.inspection_type}
                    onChange={(e) =>
                      setForm({ ...form, inspection_type: e.target.value as InspectionFormData['inspection_type'] })
                    }
                    className="w-full rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.06] px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="incoming">Incoming</option>
                    <option value="in_process">In Process</option>
                    <option value="final">Final</option>
                    <option value="random">Random</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value as InspectionFormData['status'] })
                    }
                    className="w-full rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.06] px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="pending">Pending</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                    <option value="conditional">Conditional</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Overall Score <span className="text-gray-400">(0–100)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.overall_score}
                  onChange={(e) => setForm({ ...form, overall_score: Number(e.target.value) })}
                  className="w-full rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.06] px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Notes</label>
                <textarea
                  rows={2}
                  value={form.notes ?? ''}
                  onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
                  className="w-full rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.06] px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional notes…"
                />
              </div>

              {formError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                  <AlertTriangle size={14} className="shrink-0" />
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-lg border border-gray-200 dark:border-white/[0.08] px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.08]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Create Inspection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Quality Control</h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Manage inspections, track defects, and monitor pass rates.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 shadow-sm hover:bg-gray-50 dark:hover:bg-white/[0.08] transition"
          >
            <RefreshCw size={15} />
            Refresh
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition"
          >
            <Plus size={15} />
            New Inspection
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Inspections" value={loading ? '—' : total}           icon={ClipboardList} color="bg-blue-500"    sub="All time" />
        <StatCard label="Passed"            value={loading ? '—' : passed}          icon={ShieldCheck}   color="bg-emerald-500" sub="Meets standard" />
        <StatCard label="Failed"            value={loading ? '—' : failed}          icon={ShieldX}       color="bg-red-500"     sub="Requires action" />
        <StatCard label="Pass Rate"         value={loading ? '—' : `${passRate}%`}  icon={TrendingUp}    color="bg-violet-500"  sub={metrics ? `Avg score: ${metrics.average_score ?? '—'}` : undefined} />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] p-1 shadow-sm w-fit">
        {(['inspections', 'defects'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition ${
              activeTab === tab
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Table card */}
      <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-gray-100 dark:border-white/[0.08] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={activeTab === 'inspections' ? 'Search batch, notes…' : 'Search defects…'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.06] py-2 pl-9 pr-3 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
            />
          </div>
          {activeTab === 'inspections' && (
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="appearance-none rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.06] py-2 pl-3 pr-8 text-sm text-gray-700 dark:text-gray-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
              >
                <option value="all">All Status</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
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
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-white/[0.06]" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState message="No inspections match your filters." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.06]/50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <th className="px-5 py-3">ID</th>
                      <th className="px-5 py-3">Batch</th>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Result</th>
                      <th className="px-5 py-3">Score</th>
                      <th className="px-5 py-3">Notes</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-white/[0.05]">
                    {filtered.map((item) => (
                      <tr key={item.id} className="hover:bg-blue-50/40 dark:hover:bg-blue-900/10 transition-colors">
                        <td className="px-5 py-3.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                          #{String(item.id).slice(0, 8)}
                        </td>
                        <td className="px-5 py-3.5 font-medium text-gray-800 dark:text-gray-200">{item.batch_id}</td>
                        <td className="px-5 py-3.5 text-gray-700 dark:text-gray-300">
                          {item.inspection_date
                            ? new Date(item.inspection_date).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })
                            : '—'}
                        </td>
                        <td className="px-5 py-3.5">
                          {item.status === 'passed' ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-800">
                              <CheckCircle2 size={12} />
                              Passed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-900/20 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800">
                              <XCircle size={12} />
                              {item.status === 'pending' ? 'Pending' : item.status === 'conditional' ? 'Conditional' : 'Failed'}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-gray-700 dark:text-gray-300">{item.overall_score ?? '—'}</td>
                        <td className="max-w-xs px-5 py-3.5 text-gray-600 dark:text-gray-400">
                          <span className="line-clamp-1">{item.notes || '—'}</span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="rounded p-1 text-gray-300 dark:text-gray-600 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
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
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-white/[0.06]" />
                ))}
              </div>
            ) : defects.length === 0 ? (
              <EmptyState message="No defects recorded." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.06]/50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <th className="px-5 py-3">Defect ID</th>
                      <th className="px-5 py-3">Type</th>
                      <th className="px-5 py-3">Severity</th>
                      <th className="px-5 py-3">Description</th>
                      <th className="px-5 py-3">Reported</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-white/[0.05]">
                    {defects
                      .filter(
                        (d) =>
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
                              ? new Date(defect.created_at).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })
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
          <div className="border-t border-gray-100 dark:border-white/[0.08] px-5 py-3 text-xs text-gray-400 dark:text-gray-500">
            {activeTab === 'inspections'
              ? `${filtered.length} of ${total} inspection${total !== 1 ? 's' : ''}`
              : `${defects.length} defect${defects.length !== 1 ? 's' : ''} total`}
          </div>
        )}
      </div>
    </div>
  )
}
