'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import {
  ShieldCheck, Package, Layers, ShoppingCart,
  AlertCircle, AlertTriangle, Loader2, Activity,
  Factory,
} from 'lucide-react'
import { LogoIcon } from '../../components/Logo'
import { JourneyMetrics } from './JourneyMetrics'
import { EnhancedTimeline } from './EnhancedTimeline'
import { deriveBatchRef } from '../../lib/batch'

// ── Types — strict contract matching get_public_batch_trace RPC ─────────────

type PublicQc = {
  overall_result:    'pass' | 'fail' | 'hold' | 'pending'
  inspection_count:  number
  last_inspected_at: string | null
}

type PublicMaterial = {
  material_name: string
}

type PublicTimelineEvent = {
  event_type:      string
  event_timestamp: string
  title:           string
}

type PublicRecall = {
  recall_number:  string
  title:          string
  severity:       string
  status:         string
  affected_units: number
  initiated_at:   string
  closed_at:      string | null
}

type RecallAlert = {
  has_active_recall: boolean
  recalls:           PublicRecall[]
}

type PublicTraceData = {
  product: {
    name:         string
    sku:          string
    status:       string
    completed_at: string | null
  }
  qc:           PublicQc
  materials:    PublicMaterial[]
  timeline:     PublicTimelineEvent[]
  recall_alert: RecallAlert | null
  risk_level:   'none' | 'low' | 'medium' | 'high' | 'critical'
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function deriveLine(sku: string): string {
  const p = sku.slice(0, 3).toUpperCase()
  const MAP: Record<string, string> = {
    VSR: 'Valve Assembly Line 2',
    VBC: 'Valve / Manifold Line',
    VGV: 'Gate Valve Assembly',
    HPC: 'Hydraulic Cylinder Bay',
    ELV: 'Electrical Assembly Line A',
    ELM: 'Electrical Assembly Line A',
  }
  return MAP[p] ?? 'General Manufacturing Line'
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const NAV_ITEMS = [
  { label: 'Overview',     id: 'sec-overview'     },
  { label: 'Journey',      id: 'sec-journey'       },
  { label: 'Quality',      id: 'sec-quality'       },
  { label: 'Distribution', id: 'sec-distribution' },
  { label: 'Materials',    id: 'sec-materials'     },
  { label: 'Production',   id: 'sec-production'   },
]

// ── Badge / status class maps ──────────────────────────────────────────────

type QcStatus = 'pass' | 'fail' | 'hold' | 'pending'
const qcBadgeClass: Record<QcStatus, string> = {
  pass:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  fail:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  hold:    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  pending: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}

const orderStatusClass: Record<string, string> = {
  completed:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pending:     'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  cancelled:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

// ── Shared UI primitives ───────────────────────────────────────────────────

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${className}`}>
      {label}
    </span>
  )
}

function Section({ icon, title, count, children, id }: {
  icon: React.ReactNode; title: string; count?: number; children: React.ReactNode; id?: string
}) {
  return (
    <div
      id={id}
      className="scroll-mt-28 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden transition-shadow duration-200 hover:shadow-md"
    >
      <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-700 px-4 py-3.5">
        <span className="text-gray-400 dark:text-gray-500">{icon}</span>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="ml-auto rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
            {count}
          </span>
        )}
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right font-medium text-gray-900 dark:text-white">{value ?? '—'}</span>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-400 dark:text-gray-500 italic">{text}</p>
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase().replace(/[\s-]+/g, '')
  const cls =
    ['pass', 'qcpassed', 'labpassed', 'compliant'].includes(s)
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
    ['fail', 'qcfailed', 'labfailed', 'noncompliant'].includes(s)
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
    ['hold', 'onhold'].includes(s)
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
      'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  )
}

// ── Section: Quality & Compliance ─────────────────────────────────────────
// Shows aggregate QC summary only — no inspector identity, no free-text notes.

function QualitySection({ qc }: { qc: PublicQc }) {
  const qcLabel =
    qc.overall_result === 'pass'    ? 'QC Passed'
    : qc.overall_result === 'fail'  ? 'QC Failed'
    : qc.overall_result === 'hold'  ? 'On Hold'
    :                                 'Pending'

  const labLabel =
    qc.overall_result === 'pass'    ? 'Lab Passed'
    : qc.overall_result === 'fail'  ? 'Lab Failed'
    : qc.overall_result === 'hold'  ? 'On Hold'
    :                                 'Pending'

  const complianceLabel =
    qc.overall_result === 'pass'    ? 'Compliant'
    : qc.overall_result === 'fail'  ? 'Non-Compliant'
    : qc.overall_result === 'hold'  ? 'On Hold'
    :                                 'Pending'

  return (
    <Section icon={<ShieldCheck size={15} />} title="Quality & Compliance" id="sec-quality">
      <Row label="QC Result"         value={<StatusBadge status={qcLabel} />} />
      <Row label="Lab Result"        value={<StatusBadge status={labLabel} />} />
      <Row label="Compliance Status" value={<StatusBadge status={complianceLabel} />} />
      <Row label="Inspections"       value={`${qc.inspection_count} inspection${qc.inspection_count !== 1 ? 's' : ''}`} />
      {qc.last_inspected_at && (
        <Row label="Last Inspected"  value={fmt(qc.last_inspected_at)} />
      )}
    </Section>
  )
}

// ── Section: Production Information ───────────────────────────────────────
// Operator/Responsible row removed — no actor data in public contract.

function ProductionInfoSection({
  product,
  sectionId,
}: {
  product:   PublicTraceData['product']
  sectionId?: string
}) {
  return (
    <Section icon={<Factory size={15} />} title="Production Information" id={sectionId}>
      {product.completed_at && (
        <Row label="Completed"      value={fmtDateTime(product.completed_at)} />
      )}
      <Row label="Factory / Branch" value="Main Manufacturing Facility — Plant A" />
      <Row label="Production Line"  value={deriveLine(product.sku)} />
    </Section>
  )
}

// ── Scan event logging ─────────────────────────────────────────────────────
// Uses the log_scan_event SECURITY DEFINER RPC instead of a direct insert.
// company_id is derived server-side from the batch — never caller-supplied.

function logScanEvent(batchId: string) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua)
  const browser =
    /Edg\//i.test(ua)     ? 'Edge'    :
    /OPR\//i.test(ua)     ? 'Opera'   :
    /Chrome\//i.test(ua)  ? 'Chrome'  :
    /Safari\//i.test(ua)  ? 'Safari'  :
    /Firefox\//i.test(ua) ? 'Firefox' : 'Other'

  void supabase
    .rpc('log_scan_event', {
      p_batch_id:    batchId,
      p_device_type: isMobile ? 'mobile' : 'desktop',
      p_browser:     browser,
      p_user_agent:  ua.slice(0, 300),
    })
    .then(({ error }) => {
      if (error) console.error('[logScanEvent] rpc failed:', error)
    })
}

// ── UUID detection ─────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Resolve a URL param to a production-order UUID.
// If the param is already a UUID, return it as-is.
// If it looks like a SKU, find the most recent completed batch for that product.
async function resolveToUUID(param: string): Promise<string | null> {
  if (UUID_RE.test(param)) return param

  const { data: product } = await supabase
    .from('products')
    .select('id, sku, company_id')
    .ilike('sku', param)
    .maybeSingle()

  if (!product?.id) return null

  const { data: order } = await supabase
    .from('production_orders')
    .select('id')
    .eq('product_id', product.id)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return order?.id ?? null
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function PublicTracePage() {
  const { id } = useParams<{ id: string }>()

  const [traceData,     setTraceData]     = useState<PublicTraceData | null>(null)
  const [resolvedId,    setResolvedId]    = useState<string>('')
  const [loading,       setLoading]       = useState(true)
  const [notFound,      setNotFound]      = useState(false)
  const [activeSection, setActiveSection] = useState<string>('sec-overview')
  const [visible,       setVisible]       = useState(false)

  useEffect(() => {
    if (!id) return

    async function load() {
      const batchId = await resolveToUUID(id)

      if (!batchId) {
        setNotFound(true)
        setLoading(false)
        return
      }

      logScanEvent(batchId)

      const { data: rpcData, error } = await supabase
        .rpc('get_public_batch_trace', { p_batch_id: batchId })

      if (error || rpcData === null || rpcData === undefined) {
        setNotFound(true)
        setLoading(false)
        return
      }

      setResolvedId(batchId)
      setTraceData(rpcData as PublicTraceData)
      setLoading(false)
    }

    load()
  }, [id])

  // Track active section based on scroll position
  useEffect(() => {
    if (!traceData) return
    let raf = 0
    const getActive = () => {
      const threshold = window.scrollY + window.innerHeight * 0.3
      let active = 'sec-overview'
      for (const { id: sid } of NAV_ITEMS) {
        const el = document.getElementById(sid)
        if (el && el.offsetTop <= threshold) active = sid
      }
      setActiveSection(active)
    }
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(getActive) }
    window.addEventListener('scroll', onScroll, { passive: true })
    raf = requestAnimationFrame(getActive)
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [traceData])

  // Fade the page in after data arrives
  useEffect(() => {
    if (traceData) requestAnimationFrame(() => setVisible(true))
  }, [traceData])

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 size={28} className="animate-spin text-blue-600" />
      </div>
    )
  }

  // ── Not found / error ────────────────────────────────────────────────────

  if (notFound || !traceData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 px-6 text-center">
        <AlertCircle size={44} className="mb-3 text-gray-300 dark:text-gray-600" />
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Batch not found</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">This QR code may be invalid or the batch has been removed.</p>
        <div className="mt-6 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-600">
          <ShieldCheck size={13} />
          <span>Verified by TraceFlow®</span>
        </div>
      </div>
    )
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const { product, qc, materials, timeline, recall_alert, risk_level } = traceData

  const activeRecalls   = recall_alert?.recalls.filter(r => r.status !== 'closed') ?? []
  const showRecallAlert = (recall_alert?.has_active_recall ?? false) && activeRecalls.length > 0
  const showRiskAlert   = !showRecallAlert && (risk_level === 'high' || risk_level === 'critical')

  const distributionCount = timeline.filter(e => e.event_type.startsWith('distribution.')).length

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={`min-h-screen bg-gray-50 dark:bg-gray-900 transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}>

      {/* Sticky header + mini section nav */}
      <div className="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm">
        {/* Primary row */}
        <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <LogoIcon size="sm" />
            <div>
              <p className="text-xs font-bold text-gray-900 dark:text-white leading-tight">{product.name}</p>
              <p className="font-mono text-[11px] text-gray-400 leading-tight">{product.sku}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge
              label={product.status.replace('_', ' ')}
              className={orderStatusClass[product.status] ?? 'bg-gray-100 text-gray-600'}
            />
            <Badge
              label={qc.overall_result}
              className={qcBadgeClass[qc.overall_result] ?? 'bg-gray-100 text-gray-600'}
            />
          </div>
        </div>
        {/* Section mini nav */}
        <div className="border-t border-gray-100 dark:border-gray-700/50 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="flex items-center gap-0.5 px-3 py-1.5 mx-auto max-w-md min-w-max">
            {NAV_ITEMS.map(({ label, id: navId }) => (
              <button
                key={navId}
                type="button"
                onClick={() => scrollToSection(navId)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition-all duration-200 ${
                  activeSection === navId
                    ? 'bg-gray-900 dark:bg-white/90 text-white dark:text-gray-900'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/60'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-md px-4 py-5 space-y-5">

        <div className="flex flex-col gap-3">

          {/* Hero card — product identity */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white via-blue-50/40 to-blue-100/60 dark:from-gray-800 dark:via-blue-950/20 dark:to-blue-900/30 shadow-sm overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-500 dark:text-blue-400 mb-2">Digital Product Passport</p>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-tight mb-0.5">{product.name}</h1>
              <p className="font-mono text-[11px] text-gray-400 dark:text-gray-500">{product.sku}</p>
            </div>
            <div className="border-t border-gray-100 dark:border-gray-700/60 grid grid-cols-2">
              <div className="px-4 py-3 border-r border-gray-100 dark:border-gray-700/60">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-0.5">Manufactured by</p>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">Verified Manufacturer</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-0.5">Factory / Plant</p>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">Plant A — Riyadh</p>
              </div>
              <div className="px-4 py-3 border-t border-r border-gray-100 dark:border-gray-700/60">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-0.5">Batch Reference</p>
                <p className="font-mono text-xs font-bold text-gray-700 dark:text-gray-200">{deriveBatchRef(resolvedId, product.completed_at ?? '')}</p>
              </div>
              <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/60 bg-emerald-50/50 dark:bg-emerald-900/10">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">Verified by</p>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-emerald-500 shrink-0" />
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">TraceFlow®</p>
                </div>
              </div>
            </div>
          </div>

          {/* Active recall alert */}
          {showRecallAlert && (
            <div className="flex gap-3 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-red-700 dark:text-red-400">Active Recall</p>
                {activeRecalls.map((r, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                    {r.recall_number}: {r.title}
                    {r.affected_units ? ` — ${r.affected_units.toLocaleString()} units affected` : ''}
                  </p>
                ))}
                <p className="text-xs text-red-500 dark:text-red-500 mt-1.5 font-medium">
                  Stop use immediately and contact the manufacturer.
                </p>
              </div>
            </div>
          )}

          {/* High / critical risk alert (no active recall) */}
          {showRiskAlert && (
            <div className="flex gap-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-bold text-amber-700 dark:text-amber-400">Quality Alert</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  This batch has been flagged with a {risk_level} risk level. Contact the manufacturer for details.
                </p>
              </div>
            </div>
          )}

          {/* Batch Summary */}
          <Section icon={<Package size={15} />} title="Batch Summary" id="sec-overview">
            <Row label="Product"   value={product.name} />
            <Row label="SKU"       value={<span className="font-mono text-xs">{product.sku}</span>} />
            <Row label="Status"    value={
              <Badge
                label={product.status.replace('_', ' ')}
                className={orderStatusClass[product.status] ?? 'bg-gray-100 text-gray-600'}
              />
            } />
            {product.completed_at && <Row label="Completed" value={fmt(product.completed_at)} />}
          </Section>

        </div>

        {/* Product Journey */}
        <Section
          icon={<Activity size={15} />}
          title="Product Journey"
          count={timeline.length}
          id="sec-journey"
        >
          <EnhancedTimeline events={timeline} isLoading={false} productStatus={product.status} />
        </Section>

        {/* Quality & Compliance */}
        <QualitySection qc={qc} />

        {/* Journey Metrics */}
        <JourneyMetrics
          completedAt={product.completed_at}
          qc={qc}
          materials={materials}
          distributionCount={distributionCount}
          timeline={timeline}
        />

        {/* Recall details — shown only when recalls exist */}
        {(recall_alert?.recalls.length ?? 0) > 0 && (
          <Section
            icon={<AlertTriangle size={15} />}
            title="Recall Information"
            count={recall_alert!.recalls.length}
          >
            <div className="space-y-3">
              {recall_alert!.recalls.map((r, i) => (
                <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/20 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-mono text-xs font-bold text-gray-700 dark:text-gray-200">{r.recall_number}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{r.title}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400 dark:text-gray-500">
                    <span>Severity: <span className="font-medium text-gray-600 dark:text-gray-300">{r.severity}</span></span>
                    {r.affected_units > 0 && (
                      <span>{r.affected_units.toLocaleString()} units affected</span>
                    )}
                    <span>Initiated: {fmt(r.initiated_at)}</span>
                    {r.closed_at && <span>Closed: {fmt(r.closed_at)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Distribution */}
        <Section icon={<ShoppingCart size={15} />} title="Distribution" id="sec-distribution">
          {distributionCount === 0 ? (
            <Empty text="No distribution records for this batch." />
          ) : (
            <div className="py-1">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Distributed through authorized partners
                {distributionCount > 0 && (
                  <span className="text-gray-400 dark:text-gray-500">
                    {' '}({distributionCount} shipment{distributionCount !== 1 ? 's' : ''} recorded)
                  </span>
                )}.
              </p>
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                Distribution details are visible in the product journey timeline above.
              </p>
            </div>
          )}
        </Section>

        {/* Raw Materials — material names only */}
        <Section icon={<Layers size={15} />} title="Raw Materials Used" count={materials.length} id="sec-materials">
          {materials.length === 0 && <Empty text="No materials linked to this batch." />}
          {materials.length > 0 && (
            <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {materials.map((m, i) => (
                <div key={i} className="flex items-center gap-2.5 py-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{m.material_name}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Production Information */}
        <ProductionInfoSection product={product} sectionId="sec-production" />

        {/* Footer */}
        <div className="pb-8 pt-2 flex flex-col items-center">
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-900/10 px-6 py-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <ShieldCheck size={16} className="text-emerald-500 dark:text-emerald-400 shrink-0" />
              <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Verified by TraceFlow®</span>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Secure Manufacturing Traceability Platform</p>
          </div>
        </div>

      </div>
    </div>
  )
}
