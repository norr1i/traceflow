'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { useAuth, useRole } from '../lib/auth-context'
import { canEdit } from '../lib/permissions'
import { useToast } from '../components/Toast'
import {
  Search, AlertTriangle, Package, Layers, Truck,
  FileDown, Plus, X, ChevronDown, ChevronUp,
  Building2, Hash, Calendar, ShieldAlert, ShieldCheck,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type AffectedProduct = {
  product_name:      string
  sku:               string
  produced_units:    number
  distributed_units: number
  batch_count:       number
}

type AffectedBatch = {
  batch_id:     string
  product_name: string
  sku:          string
  quantity:     number
  status:       string
  created_at:   string
  completed_at: string | null
}

type AffectedDistributor = {
  batch_id:       string
  recipient_name: string
  recipient_type: string | null
  quantity:       number
  shipped_at:     string
  notes:          string | null
}

type ImpactResult = {
  affected_products:     AffectedProduct[]
  affected_batches:      AffectedBatch[]
  affected_distributors: AffectedDistributor[]
  total_affected_units:  number
  total_batches:         number
  total_products:        number
  total_distributors:    number
  total_shipments:       number
  risk_level:            'none' | 'low' | 'medium' | 'high' | 'critical'
  has_open_recall:       boolean
}

type SearchType = 'lot' | 'material' | 'batch'

// ── Constants ─────────────────────────────────────────────────────────────────

const RISK_CONFIG: Record<ImpactResult['risk_level'], {
  label: string; bg: string; border: string; text: string; badge: string; cardText: string
}> = {
  none: {
    label:    'No Risk',
    bg:       'bg-gray-50 dark:bg-gray-800',
    border:   'border-gray-200 dark:border-gray-700',
    text:     'text-gray-600 dark:text-gray-400',
    badge:    'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
    cardText: 'text-gray-500 dark:text-gray-400',
  },
  low: {
    label:    'Low Risk',
    bg:       'bg-blue-50 dark:bg-blue-950/20',
    border:   'border-blue-200 dark:border-blue-800',
    text:     'text-blue-700 dark:text-blue-400',
    badge:    'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    cardText: 'text-blue-600 dark:text-blue-400',
  },
  medium: {
    label:    'Medium Risk',
    bg:       'bg-amber-50 dark:bg-amber-950/20',
    border:   'border-amber-200 dark:border-amber-800',
    text:     'text-amber-700 dark:text-amber-400',
    badge:    'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    cardText: 'text-amber-600 dark:text-amber-400',
  },
  high: {
    label:    'High Risk',
    bg:       'bg-orange-50 dark:bg-orange-950/20',
    border:   'border-orange-200 dark:border-orange-800',
    text:     'text-orange-700 dark:text-orange-400',
    badge:    'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
    cardText: 'text-orange-600 dark:text-orange-400',
  },
  critical: {
    label:    'Critical Risk',
    bg:       'bg-red-50 dark:bg-red-950/20',
    border:   'border-red-200 dark:border-red-800',
    text:     'text-red-700 dark:text-red-400',
    badge:    'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
    cardText: 'text-red-600 dark:text-red-400',
  },
}

const STATUS_BADGE: Record<string, string> = {
  completed:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pending:     'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  cancelled:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const SEARCH_OPTIONS: { key: SearchType; label: string; placeholder: string }[] = [
  { key: 'lot',      label: 'Lot Number',    placeholder: 'e.g. LOT-2025-SS316-0891' },
  { key: 'material', label: 'Material Name', placeholder: 'e.g. Stainless Steel'     },
  { key: 'batch',    label: 'Batch ID',      placeholder: 'Enter production batch ID' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function exportCSV(result: ImpactResult, query: string, searchType: SearchType) {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  const rows: string[][] = []

  rows.push([`Recall Impact Analysis — ${searchType.toUpperCase()}: ${query}`])
  rows.push([`Generated: ${new Date().toLocaleString()}`])
  rows.push([])
  rows.push(['AFFECTED PRODUCTS'])
  rows.push(['Product Name', 'SKU', 'Produced Units', 'Distributed (In Field)', 'Batch Count'])
  result.affected_products.forEach(p =>
    rows.push([p.product_name, p.sku, String(p.produced_units), String(p.distributed_units), String(p.batch_count)])
  )
  rows.push([])
  rows.push(['AFFECTED BATCHES'])
  rows.push(['Batch ID', 'Product', 'SKU', 'Quantity', 'Status', 'Created', 'Completed'])
  result.affected_batches.forEach(b =>
    rows.push([
      b.batch_id, b.product_name, b.sku, String(b.quantity),
      b.status, fmt(b.created_at), b.completed_at ? fmt(b.completed_at) : '',
    ])
  )
  rows.push([])
  rows.push(['DISTRIBUTION'])
  rows.push(['Distributor / Location', 'Type', 'Units', 'Shipped'])
  result.affected_distributors.forEach(d =>
    rows.push([d.recipient_name, d.recipient_type ?? '', String(d.quantity), fmt(d.shipped_at)])
  )
  rows.push([])
  rows.push(['SUMMARY'])
  rows.push(['Total Products',          String(result.total_products)])
  rows.push(['Total Batches',           String(result.total_batches)])
  rows.push(['Total Distributed Units', String(result.total_affected_units)])
  rows.push(['Total Recipients',        String(result.total_distributors)])
  rows.push(['Total Shipment Records',  String(result.total_shipments)])
  rows.push(['Risk Level',              result.risk_level.toUpperCase()])
  rows.push(['Active Recall',           result.has_open_recall ? 'YES' : 'No'])

  const csv  = rows.map(r => r.map(c => q(c)).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `recall-impact-${new Date().toISOString().slice(0, 10)}.csv`,
  })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function exportJSON(result: ImpactResult, query: string, searchType: SearchType) {
  const payload = {
    meta: {
      query,
      search_type: searchType,
      generated_at: new Date().toISOString(),
      risk_level: result.risk_level,
      has_open_recall: result.has_open_recall,
    },
    summary: {
      total_products:        result.total_products,
      total_batches:         result.total_batches,
      total_affected_units:  result.total_affected_units,
      total_distributors:    result.total_distributors,
      total_shipments:       result.total_shipments,
    },
    affected_products:     result.affected_products,
    affected_batches:      result.affected_batches,
    affected_distributors: result.affected_distributors,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `recall-impact-${new Date().toISOString().slice(0, 10)}.json`,
  })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Skeleton atoms ────────────────────────────────────────────────────────────

function SkeletonCards() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-4 shadow-sm space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-[#262E36]/55" />
          <div className="h-7 w-16 animate-pulse rounded bg-gray-200 dark:bg-[#262E36]/55" />
        </div>
      ))}
    </div>
  )
}

function SkeletonTable({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-700 px-5 py-3.5">
        <div className="h-3.5 w-3.5 animate-pulse rounded bg-gray-200 dark:bg-[#262E36]/55" />
        <div className="h-3.5 w-32 animate-pulse rounded bg-gray-200 dark:bg-[#262E36]/55" />
      </div>
      <div className="px-5 py-4 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-11 animate-pulse rounded-xl bg-gray-100 dark:bg-[#262E36]/55" />
        ))}
      </div>
    </div>
  )
}

// ── Shared UI atoms ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon: Icon, valueClass }: {
  label: string; value: string | number; icon: React.ElementType; valueClass?: string
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 px-5 py-4 shadow-sm">
      <div className="flex items-center gap-1.5">
        <Icon size={12} className="shrink-0 text-gray-400 dark:text-gray-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {label}
        </span>
      </div>
      <p className={`text-2xl font-bold leading-tight ${valueClass ?? 'text-gray-900 dark:text-white'}`}>
        {value}
      </p>
    </div>
  )
}

function TableSection({ title, icon: Icon, count, children }: {
  title: string; icon: React.ElementType; count: number; children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2.5 border-b border-[#B3B7BA]/30 dark:border-[#B3B7BA]/[0.10] px-5 py-3.5 text-left hover:bg-[#D1CFC9]/20 dark:hover:bg-[#262E36]/25 transition-colors"
      >
        <Icon size={15} className="shrink-0 text-gray-400 dark:text-gray-500" />
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</span>
        {count > 0 && (
          <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
            {count}
          </span>
        )}
        <span className="ml-auto text-gray-300 dark:text-gray-600">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-400 dark:text-gray-500 italic">{text}</p>
}

// ── Create Recall Modal ───────────────────────────────────────────────────────

function RecallModal({
  result, companyId, onClose,
}: {
  result: ImpactResult; companyId: string; onClose: () => void
}) {
  const toast        = useToast()
  const firstBatch   = result.affected_batches[0]
  const firstProduct = result.affected_products[0]

  const [form, setForm] = useState({
    title:          firstProduct ? `Product Recall — ${firstProduct.product_name}` : 'Product Recall',
    reason:         '',
    severity:       'high' as 'low' | 'medium' | 'high' | 'critical',
    affected_units: result.total_affected_units,
  })
  const [saving, setSaving] = useState(false)

  const field = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [k]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.reason.trim()) { toast.error('Reason is required'); return }
    setSaving(true)
    const { error } = await supabase.from('recalls').insert({
      company_id:     companyId,
      batch_id:       firstBatch?.batch_id ?? null,
      title:          form.title.trim(),
      reason:         form.reason.trim(),
      severity:       form.severity,
      affected_units: Number(form.affected_units),
      status:         'open',
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Recall created')
    onClose()
  }

  const inputCls = 'w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl">

        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 px-5 py-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-red-500" />
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Create Recall</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-xs text-red-700 dark:text-red-400 space-y-0.5">
            <p className="font-semibold mb-1">Pre-filled from impact analysis</p>
            {firstBatch   && <p>Batch: ···{firstBatch.batch_id.slice(-12)}</p>}
            {firstProduct && <p>Product: {firstProduct.product_name} ({firstProduct.sku})</p>}
            <p>Distributors: {result.total_distributors} · Units: {result.total_affected_units.toLocaleString()}</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Title</label>
            <input required value={form.title} onChange={field('title')} className={inputCls} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Reason</label>
            <textarea required rows={2} value={form.reason} onChange={field('reason')}
              placeholder="Describe the reason for this recall…" className={inputCls} />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Severity</label>
              <select value={form.severity} onChange={field('severity')} className={inputCls}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Affected Units</label>
              <input type="number" min="0" value={form.affected_units} onChange={field('affected_units')} className={inputCls} />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition-colors">
              {saving ? 'Creating…' : 'Create Recall'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RecallImpactClient() {
  const { companyId } = useAuth()
  const role          = useRole()
  const toast         = useToast()
  const canCreate     = canEdit(role, 'recall')
  const urlParams     = useSearchParams()

  const [searchType, setSearchType] = useState<SearchType>('lot')
  const [query,      setQuery]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const [result,     setResult]     = useState<ImpactResult | null>(null)
  const [searched,   setSearched]   = useState(false)
  const [showModal,  setShowModal]  = useState(false)

  async function runSearch(type: SearchType, q: string) {
    if (!q.trim()) return
    setLoading(true)
    setResult(null)
    setSearched(false)

    const params: Record<string, unknown> = {}
    if (type === 'lot')      params.p_lot_number    = q.trim()
    if (type === 'material') params.p_material_name = q.trim()
    if (type === 'batch')    params.p_batch_id      = q.trim()

    const { data, error } = await supabase.rpc('get_recall_impact', params)
    setLoading(false)
    setSearched(true)
    if (error) { toast.error('Search failed'); return }
    setResult(data as ImpactResult)
  }

  useEffect(() => {
    const type  = (urlParams.get('type') ?? '') as SearchType
    const q     = urlParams.get('q') ?? ''
    const valid: SearchType[] = ['lot', 'material', 'batch']
    if (q && valid.includes(type)) {
      setSearchType(type)
      setQuery(q)
      runSearch(type, q)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    runSearch(searchType, query)
  }

  const activeOption = SEARCH_OPTIONS.find(o => o.key === searchType)!
  const risk         = result ? RISK_CONFIG[result.risk_level] : null
  const hasResults   = result && result.total_batches > 0

  return (
    <div className="space-y-5">

      {/* ── Search card ── */}
      <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm p-5">
        <div className="mb-4 flex w-fit gap-1 rounded-xl bg-gray-100 dark:bg-gray-900/50 p-1">
          {SEARCH_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => { setSearchType(opt.key); setQuery('') }}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                searchType === opt.key
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={activeOption.placeholder}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 pl-9 pr-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 dark:focus:border-red-500 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 px-5 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            <Search size={14} />
            {loading ? 'Analyzing…' : 'Analyze Impact'}
          </button>
        </form>
      </div>

      {/* ── Skeleton loading state ── */}
      {loading && (
        <div className="space-y-5">
          <div className="h-16 animate-pulse rounded-2xl bg-gray-100 dark:bg-[#262E36]/55" />
          <SkeletonCards />
          <SkeletonTable rows={4} />
          <SkeletonTable rows={3} />
          <SkeletonTable rows={3} />
        </div>
      )}

      {/* ── Empty state ── */}
      {searched && !loading && !hasResults && (
        <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm px-5 py-14 text-center">
          <ShieldCheck size={36} className="mx-auto mb-3 text-gray-200 dark:text-gray-700" />
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">No affected products found</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            No production batches matched your{' '}
            {searchType === 'lot'      ? 'lot number'     :
             searchType === 'material' ? 'material name'  : 'batch ID'}.
            Verify the input and try again.
          </p>
        </div>
      )}

      {/* ── Results ── */}
      {!loading && hasResults && result && (
        <>
          {/* Risk banner */}
          <div className={`flex items-center gap-3 rounded-2xl border ${risk!.border} ${risk!.bg} px-5 py-4`}>
            <AlertTriangle size={18} className={`shrink-0 ${risk!.text}`} />
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-bold ${risk!.text}`}>{risk!.label}</p>
              <p className={`mt-0.5 text-xs ${risk!.text} opacity-80`}>
                {result.total_batches} batch{result.total_batches !== 1 ? 'es' : ''} affected
                {result.total_affected_units > 0 && ` · ${result.total_affected_units.toLocaleString()} units distributed`}
                {result.total_distributors   > 0 && ` · ${result.total_distributors} recipient${result.total_distributors !== 1 ? 's' : ''} · ${result.total_shipments} shipment${result.total_shipments !== 1 ? 's' : ''}`}
                {result.has_open_recall && ' · ACTIVE RECALL IN PROGRESS'}
              </p>
            </div>
            <span className={`shrink-0 rounded-lg px-3 py-1 text-xs font-bold uppercase tracking-wider ${risk!.badge}`}>
              {result.risk_level}
            </span>
          </div>

          {/* Impact Assessment executive summary */}
          {(() => {
            const scope = `${result.total_batches} production batch${result.total_batches !== 1 ? 'es' : ''}`
            const distLine = result.total_distributors > 0
              ? `${result.total_affected_units.toLocaleString()} units distributed to ${result.total_distributors} recipient${result.total_distributors !== 1 ? 's' : ''}.`
              : 'No distribution records are linked to affected batches.'
            const actionLine = result.has_open_recall
              ? 'Active recall in progress. Notify all affected distributors and initiate field recovery immediately.'
              : result.risk_level === 'critical' || result.risk_level === 'high'
              ? 'Risk level warrants immediate review. Assess need for recall notification and SFDA regulatory reporting.'
              : result.risk_level === 'medium'
              ? 'Review all affected batches and verify quality disposition before further distribution.'
              : 'No immediate action required. Monitor affected batches for quality indicators.'
            const needsRegulatory = result.has_open_recall || result.risk_level === 'critical' || result.risk_level === 'high'
            return (
              <div className="rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#F1EFEC]/60 dark:bg-[#262E36]/30 px-5 py-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Impact Assessment</p>
                  {needsRegulatory && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400 px-2.5 py-0.5 text-[10px] font-bold whitespace-nowrap">
                      <ShieldAlert size={9} />SFDA Notification Required
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                  Analysis identified {scope} and {result.total_products} affected product{result.total_products !== 1 ? 's' : ''}. {distLine}
                </p>
                <p className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-300 leading-relaxed">{actionLine}</p>
              </div>
            )
          })()}

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard
              label="Affected Products"
              value={result.total_products}
              icon={Package}
            />
            <SummaryCard
              label="Affected Batches"
              value={result.total_batches}
              icon={Hash}
            />
            <SummaryCard
              label="Units Distributed"
              value={result.total_affected_units.toLocaleString()}
              icon={Truck}
              valueClass={result.total_affected_units > 0 ? 'text-red-600 dark:text-red-400' : undefined}
            />
            <SummaryCard
              label="Risk Level"
              value={risk!.label}
              icon={ShieldAlert}
              valueClass={`text-base font-bold ${risk!.cardText}`}
            />
          </div>

          {/* Action row */}
          <div className="flex flex-wrap gap-2 print:hidden">
            {canCreate && (
              result.affected_batches.length > 1 ? (
                <div className="flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle size={13} className="shrink-0" />
                  <span>
                    <strong>{result.affected_batches.length} batches affected.</strong>{' '}
                    Search by individual Batch ID to create a targeted recall.
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => setShowModal(true)}
                  className="flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 px-4 py-2 text-sm font-semibold text-white transition-colors"
                >
                  <Plus size={14} /> Create Recall
                </button>
              )
            )}
            <button
              onClick={() => exportCSV(result, query, searchType)}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <FileDown size={14} /> Export CSV
            </button>
            <button
              onClick={() => exportJSON(result, query, searchType)}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <FileDown size={14} /> Export JSON
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <FileDown size={14} /> Export PDF
            </button>
          </div>

          {/* Affected Products table */}
          <TableSection title="Affected Products" icon={Package} count={result.affected_products.length}>
            {result.affected_products.length === 0
              ? <Empty text="No affected products found." />
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#B3B7BA]/30 dark:border-[#B3B7BA]/[0.10] text-xs text-gray-400">
                        <th className="pb-2 text-left font-medium">Product Name</th>
                        <th className="pb-2 text-left font-medium">SKU</th>
                        <th className="pb-2 text-right font-medium">Batch Count</th>
                        <th className="pb-2 text-right font-medium">Produced</th>
                        <th className="pb-2 text-right font-medium">In Field</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                      {result.affected_products.map((p, i) => (
                        <tr key={i}>
                          <td className="py-2.5 font-medium text-gray-900 dark:text-white">{p.product_name}</td>
                          <td className="py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">{p.sku}</td>
                          <td className="py-2.5 text-right text-gray-700 dark:text-gray-300">{p.batch_count}</td>
                          <td className="py-2.5 text-right text-gray-500 dark:text-gray-400">{p.produced_units.toLocaleString()}</td>
                          <td className="py-2.5 text-right font-semibold text-gray-900 dark:text-white">{p.distributed_units.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </TableSection>

          {/* Affected Batches table */}
          <TableSection title="Affected Batches" icon={Layers} count={result.affected_batches.length}>
            {result.affected_batches.length === 0
              ? <Empty text="No affected batches found." />
              : (
                <div className="space-y-2">
                  {result.affected_batches.map((b, i) => (
                    <a
                      key={i}
                      href={`/product-journey/${b.batch_id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[#B3B7BA]/40 dark:border-[#B3B7BA]/[0.08] bg-[#F1EFEC] dark:bg-[#262E36]/55 px-4 py-3 transition-colors hover:bg-[#D1CFC9]/40 dark:hover:bg-[#262E36]/70 group"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-white group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                          {b.product_name}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-mono text-[10px] text-gray-400">···{b.batch_id.slice(-12)}</span>
                          <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                            <Calendar size={9} /> {fmt(b.created_at)}
                          </span>
                          <span className="text-[10px] text-gray-400">{b.quantity.toLocaleString()} units</span>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[b.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {b.status.replace('_', ' ')}
                      </span>
                    </a>
                  ))}
                </div>
              )
            }
          </TableSection>

          {/* Affected Distributors table */}
          <TableSection title="Affected Distributors" icon={Truck} count={result.affected_distributors.length}>
            {result.affected_distributors.length === 0
              ? <Empty text="No distribution records linked to affected batches." />
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#B3B7BA]/30 dark:border-[#B3B7BA]/[0.10] text-xs text-gray-400">
                        <th className="pb-2 text-left font-medium">Recipient Name</th>
                        <th className="pb-2 text-left font-medium">Recipient Type</th>
                        <th className="pb-2 text-right font-medium">Quantity</th>
                        <th className="pb-2 text-right font-medium">Shipped At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                      {result.affected_distributors.map((d, i) => (
                        <tr key={i}>
                          <td className="py-2.5">
                            <p className="font-medium text-gray-900 dark:text-white">{d.recipient_name}</p>
                            {d.notes && (
                              <p className="mt-0.5 max-w-sm truncate text-[11px] text-gray-400 dark:text-gray-500">
                                {d.notes}
                              </p>
                            )}
                          </td>
                          <td className="py-2.5">
                            <span className="rounded-md bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                              {d.recipient_type ?? 'distributor'}
                            </span>
                          </td>
                          <td className="py-2.5 text-right font-semibold text-gray-900 dark:text-white">
                            {d.quantity.toLocaleString()}
                          </td>
                          <td className="py-2.5 text-right text-xs text-gray-500 dark:text-gray-400">
                            {fmt(d.shipped_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </TableSection>
        </>
      )}

      {/* Create Recall modal */}
      {showModal && result && companyId && (
        <RecallModal
          result={result}
          companyId={companyId}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
