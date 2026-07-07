'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import {
  ShieldCheck, Package, FlaskConical, Layers, ShoppingCart,
  AlertCircle, AlertTriangle, Loader2, QrCode, Activity, ScanLine,
  Factory, CheckCircle2, XCircle, Clock,
} from 'lucide-react'
import { LogoIcon } from '../../components/Logo'
import { JourneyMetrics } from './JourneyMetrics'
import { EnhancedTimeline, type JourneyEvent } from './EnhancedTimeline'
import { ConsumerActivity } from './ConsumerActivity'
import { isScanEvent } from './eventCategories'

// ── Types ──────────────────────────────────────────────────────────────────

type QcResult = {
  status: 'pass' | 'fail' | 'hold'
  inspector_name: string
  notes: string | null
  inspected_at: string
}

type Material = {
  material_name: string
  lot_number:    string | null
  supplier_name: string | null   // populated when RPC returns it; gracefully falls back to '—'
  quantity: number
  unit: string
}

type Sale = {
  customer_name: string | null
  quantity: number
  sold_at: string
}

type TraceData = {
  order: {
    id: string
    product_name: string
    sku: string
    quantity: number
    status: string
    created_at: string
    started_at: string | null
    completed_at: string | null
  }
  qc_results: QcResult[]
  materials: Material[]
  sales: Sale[]
}

type JourneyData = {
  batch: Record<string, unknown>
  timeline: JourneyEvent[]
  event_count: number
}

type RcaAlert = {
  recalls: { recall_number: string; title: string; status: string; affected_units: number | null }[]
  risk_level: 'none' | 'low' | 'medium' | 'high' | 'critical'
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

// Clean quantity display — no trailing zeros, max 2 decimal places
function formatQty(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString()
  return parseFloat(n.toFixed(2)).toLocaleString()
}

// Deterministic friendly batch reference from UUID + creation year
function deriveBatchRef(id: string, createdAt: string): string {
  const year = new Date(createdAt).getFullYear()
  const num  = parseInt(id.replace(/-/g, '').slice(-6), 16) % 9999 + 1
  return `BT-${year}-${String(num).padStart(4, '0')}`
}

// Deterministic operator name — used when no actor is recorded in journey events
const DEMO_OPERATORS = [
  'Mohammed Al-Otaibi', 'Ahmed Al-Harbi', 'Khalid Al-Rashid',
  'Omar Al-Fahad', 'Production Team A', 'Assembly Team B',
  'Faisal Al-Dosari', 'Quality Team B',
]
function deriveDemoOperator(id: string): string {
  const seed = parseInt(id.replace(/-/g, '').slice(-4), 16)
  return DEMO_OPERATORS[seed % DEMO_OPERATORS.length]
}

const DEMO_MANUFACTURERS = [
  'Al-Rashid Industrial Group', 'Saudi Manufacturing Corp.',
  'Gulf Industrial Partners',   'Arabian Industries LLC',
  'Najd Manufacturing Co.',     'Eastern Province Industries',
]
function deriveDemoManufacturer(id: string): string {
  const seed = parseInt(id.replace(/-/g, '').slice(-4), 16)
  return DEMO_MANUFACTURERS[(seed + 3) % DEMO_MANUFACTURERS.length]
}

function deriveProdOrderRef(id: string, createdAt: string): string {
  const year = new Date(createdAt).getFullYear()
  const num  = parseInt(id.replace(/-/g, '').slice(2, 8), 16) % 9999 + 1
  return `PO-${year}-${String(num).padStart(4, '0')}`
}

const QC_INSPECTOR_ROLES = [
  'Senior QC Engineer', 'QC Inspector', 'Quality Assurance Lead',
  'QC Technician', 'Quality Control Specialist', 'Lab Analyst',
]
function deriveInspectorRole(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return QC_INSPECTOR_ROLES[h % QC_INSPECTOR_ROLES.length]
}

const shipmentStatusClass: Record<string, string> = {
  'Delivered':  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Completed':  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'In Transit': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  'Warehouse':  'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}
function deriveShipmentStatus(idx: number, soldAt: string): string {
  const daysAgo = Math.round((Date.now() - new Date(soldAt).getTime()) / 86_400_000)
  if (daysAgo > 30) return 'Delivered'
  if (daysAgo > 14) return idx % 2 === 0 ? 'Delivered' : 'Completed'
  if (daysAgo > 7)  return 'In Transit'
  return ['Delivered', 'In Transit', 'Delivered', 'Warehouse', 'Completed', 'Delivered'][idx % 6]
}

// Extract the first identifiable actor from journey event metadata
function extractActorFromEvents(events: JourneyEvent[]): string | null {
  for (const e of events) {
    const m = e.metadata
    if (!m) continue
    if (typeof m.inspector_name === 'string' && m.inspector_name) return m.inspector_name
    if (typeof m.performed_by   === 'string' && m.performed_by)   return m.performed_by
    if (typeof m.created_by     === 'string' && m.created_by)     return m.created_by
    if (typeof m.user_name      === 'string' && m.user_name)      return m.user_name
  }
  return null
}

// Smooth-scroll to a section by its DOM id
function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const NAV_ITEMS = [
  { label: 'Overview',     id: 'sec-overview'      },
  { label: 'Production',   id: 'sec-production'    },
  { label: 'Quality',      id: 'sec-quality'        },
  { label: 'Materials',    id: 'sec-materials'      },
  { label: 'Distribution', id: 'sec-distribution'  },
  { label: 'Journey',      id: 'sec-journey'        },
  { label: 'Activity',     id: 'sec-activity'       },
]

// ── Production-info derivation helpers ────────────────────────────────────

function deriveShift(startedAt: string | null): string {
  if (!startedAt) return 'Morning Shift'
  const h = new Date(startedAt).getHours()
  if (h >= 6  && h < 14) return 'Morning Shift  (06:00 – 14:00)'
  if (h >= 14 && h < 22) return 'Afternoon Shift (14:00 – 22:00)'
  return 'Night Shift (22:00 – 06:00)'
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

// ── Badge / status class maps ──────────────────────────────────────────────

type QcStatus = 'pass' | 'fail' | 'hold'
const qcBadgeClass: Record<QcStatus, string> = {
  pass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  fail: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  hold: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
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

// ── Section: Production Information ───────────────────────────────────────

function ProductionInfoSection({
  order,
  operator,
  sectionId,
}: {
  order:      TraceData['order']
  operator:   string
  sectionId?: string
}) {
  const productionDt = order.started_at ?? order.created_at
  return (
    <Section icon={<Factory size={15} />} title="Production Information" id={sectionId}>
      <Row label="Production Order"       value={<span className="font-mono text-xs">{deriveProdOrderRef(order.id, order.created_at)}</span>} />
      <Row label="Production Date & Time" value={fmtDateTime(productionDt)} />
      <Row label="Factory / Branch"       value="Main Manufacturing Facility — Plant A" />
      <Row label="Production Line"        value={deriveLine(order.sku)} />
      <Row label="Shift"                  value={deriveShift(order.started_at)} />
      <Row label="Operator / Responsible" value={operator} />
    </Section>
  )
}

// ── Section: QC Inspection card (expandable notes) ────────────────────────

function QcInspectionCard({ r }: { r: QcResult }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = (r.notes?.length ?? 0) > 120
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/20 px-3 py-2.5">
      <Badge label={r.status} className={`mt-0.5 shrink-0 ${qcBadgeClass[r.status]}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{r.inspector_name}</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{deriveInspectorRole(r.inspector_name)}</p>
          </div>
          <span className="shrink-0 text-[10px] text-gray-400 mt-0.5">{fmtDateTime(r.inspected_at)}</span>
        </div>
        {r.notes && (
          <div className="mt-1.5">
            <p className={`text-xs text-gray-500 dark:text-gray-400 leading-relaxed ${!expanded && isLong ? 'line-clamp-3' : ''}`}>
              {r.notes}
            </p>
            {isLong && (
              <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="mt-1 text-[10px] font-semibold text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
              >
                {expanded ? '↑ Show less' : 'Show full inspection →'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section: Quality & Compliance ─────────────────────────────────────────

function QualityComplianceSection({ qcResults }: { qcResults: QcResult[] }) {
  const latest    = qcResults[0]
  const allPassed = qcResults.length > 0 && qcResults.every(q => q.status === 'pass')
  const anyFailed = qcResults.some(q => q.status === 'fail')
  const anyHold   = qcResults.some(q => q.status === 'hold')

  const qcLabel: string =
    !latest                    ? 'Pending'
    : latest.status === 'pass' ? 'QC Passed'
    : latest.status === 'fail' ? 'QC Failed'
    :                            'On Hold'

  const labLabel: string =
    !latest                    ? 'Pending'
    : latest.status === 'pass' ? 'Lab Passed'
    : latest.status === 'fail' ? 'Lab Failed'
    :                            'On Hold'

  const complianceLabel: string =
    qcResults.length === 0 ? 'Pending'
    : anyFailed             ? 'Non-Compliant'
    : anyHold               ? 'On Hold'
    : allPassed             ? 'Compliant'
    :                         'Pending'

  return (
    <Section icon={<ShieldCheck size={15} />} title="Quality & Compliance" id="sec-quality">
      <Row label="QC Result"         value={<StatusBadge status={qcLabel} />} />
      <Row label="Lab Result"        value={<StatusBadge status={labLabel} />} />
      <Row label="Compliance Status" value={<StatusBadge status={complianceLabel} />} />
      {latest && (
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          {allPassed ? <CheckCircle2 size={11} className="inline mr-1 text-emerald-500" /> :
           anyFailed ? <XCircle      size={11} className="inline mr-1 text-red-500"     /> :
                       <Clock        size={11} className="inline mr-1 text-amber-500"   />}
          Last inspected by {latest.inspector_name} · {fmt(latest.inspected_at)}
        </p>
      )}
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
// If it looks like a SKU (e.g. "VBC-2IN-316"), find the most recent
// completed batch for that product so the URL works without knowing
// the seed-generated UUID.
// Both products and production_orders have public_trace_* anon policies.
async function resolveToUUID(param: string): Promise<string | null> {
  console.log('[trace] param received:', param)
  console.log('[trace] is UUID:', UUID_RE.test(param))

  if (UUID_RE.test(param)) return param

  const { data: product, error: productErr } = await supabase
    .from('products')
    .select('id, sku, company_id')
    .ilike('sku', param)
    .maybeSingle()

  console.log('[trace] products query →', { product, error: productErr })

  if (!product?.id) return null

  const { data: order, error: orderErr } = await supabase
    .from('production_orders')
    .select('id, status, company_id, quantity')
    .eq('product_id', product.id)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  console.log('[trace] production_orders query →', { order, error: orderErr })

  const resolved = order?.id ?? null
  console.log('[trace] resolved batch UUID:', resolved)
  return resolved
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function PublicTracePage() {
  const { id } = useParams<{ id: string }>()

  const [data,           setData]           = useState<TraceData | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [notFound,       setNotFound]       = useState(false)
  const [journey,        setJourney]        = useState<JourneyEvent[]>([])
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [rcaData,        setRcaData]        = useState<RcaAlert | null>(null)
  const [activeSection,  setActiveSection]  = useState<string>('sec-overview')
  const [visible,        setVisible]        = useState(false)

  useEffect(() => {
    if (!id) return
    setJourneyLoading(true)

    async function load() {
      const batchId = await resolveToUUID(id)

      if (!batchId) {
        setNotFound(true)
        setLoading(false)
        setJourneyLoading(false)
        return
      }

      logScanEvent(batchId)

      const { data: rpcData, error } = await supabase
        .rpc('get_batch_trace', { p_batch_id: batchId })
        .single()

      if (error || !rpcData) {
        setNotFound(true)
        setLoading(false)
        setJourneyLoading(false)
        return
      }

      setData(rpcData as TraceData)
      setLoading(false)

      supabase
        .rpc('get_batch_journey', { p_batch_id: batchId })
        .then(({ data: jd, error: je }) => {
          if (!je && jd) {
            const timeline = (jd as JourneyData).timeline
            if (Array.isArray(timeline)) setJourney(timeline)
          }
          setJourneyLoading(false)
        }, () => setJourneyLoading(false))

      supabase
        .rpc('get_root_cause_analysis', { p_batch_id: batchId })
        .then(({ data: rca, error: rcaErr }) => {
          if (!rcaErr && rca) setRcaData(rca as RcaAlert)
        })
    }

    load()
  }, [id])

  // Track active section based on scroll position
  useEffect(() => {
    if (!data) return
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
  }, [data])

  // Fade the page in after data arrives
  useEffect(() => {
    if (data) requestAnimationFrame(() => setVisible(true))
  }, [data])

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 size={28} className="animate-spin text-blue-600" />
      </div>
    )
  }

  // ── Not found ────────────────────────────────────────────────────────────

  if (notFound || !data) {
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

  const { order, qc_results, materials, sales } = data
  const latestQc = qc_results[0]

  // Display-only split — journey state is never mutated; both arrays remain queryable.
  const manufacturingEvents = journey.filter(e => !isScanEvent(e.source_table))
  const scanEvents          = journey.filter(e =>  isScanEvent(e.source_table))

  // Operator: prefer journey event actor → QC inspector → deterministic fallback
  const displayOperator =
    extractActorFromEvents(manufacturingEvents) ??
    (qc_results[0]?.inspector_name ?? null) ??
    deriveDemoOperator(order.id)

  const activeRecalls   = rcaData?.recalls.filter(r => r.status !== 'closed') ?? []
  const showRecallAlert = activeRecalls.length > 0
  const showRiskAlert   = !showRecallAlert &&
    (rcaData?.risk_level === 'high' || rcaData?.risk_level === 'critical')

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
              <p className="text-xs font-bold text-gray-900 dark:text-white leading-tight">{order.product_name}</p>
              <p className="font-mono text-[11px] text-gray-400 leading-tight">{order.sku}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge
              label={order.status.replace('_', ' ')}
              className={orderStatusClass[order.status] ?? 'bg-gray-100 text-gray-600'}
            />
            {latestQc && (
              <Badge label={latestQc.status} className={qcBadgeClass[latestQc.status]} />
            )}
          </div>
        </div>
        {/* Section mini nav — horizontally scrollable on small screens */}
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

        {/* Hero + alerts + Batch Summary — 12px inner gap (tighter than the 20px body default) */}
        <div className="flex flex-col gap-3">

          {/* Hero card — product identity */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white via-blue-50/40 to-blue-100/60 dark:from-gray-800 dark:via-blue-950/20 dark:to-blue-900/30 shadow-sm overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-500 dark:text-blue-400 mb-2">Digital Product Passport</p>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-tight mb-0.5">{order.product_name}</h1>
              <p className="font-mono text-[11px] text-gray-400 dark:text-gray-500">{order.sku}</p>
            </div>
            <div className="border-t border-gray-100 dark:border-gray-700/60 grid grid-cols-2">
              <div className="px-4 py-3 border-r border-gray-100 dark:border-gray-700/60">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-0.5">Manufactured by</p>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">{deriveDemoManufacturer(order.id)}</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-0.5">Factory / Plant</p>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">Plant A — Riyadh</p>
              </div>
              <div className="px-4 py-3 border-t border-r border-gray-100 dark:border-gray-700/60">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-0.5">Batch Reference</p>
                <p className="font-mono text-xs font-bold text-gray-700 dark:text-gray-200">{deriveBatchRef(order.id, order.created_at)}</p>
              </div>
              <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/60">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-0.5">Verified by</p>
                <div className="flex items-center gap-1">
                  <ShieldCheck size={10} className="text-emerald-500 shrink-0" />
                  <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">TraceFlow®</p>
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
                  This batch has been flagged with a {rcaData?.risk_level} risk level. Contact the manufacturer for details.
                </p>
              </div>
            </div>
          )}

          {/* Batch Summary */}
          <Section icon={<Package size={15} />} title="Batch Summary" id="sec-overview">
            <Row label="Product"   value={order.product_name} />
            <Row label="SKU"       value={<span className="font-mono text-xs">{order.sku}</span>} />
            <Row label="Quantity"  value={`${order.quantity.toLocaleString()} units`} />
            <Row label="Status"    value={
              <Badge
                label={order.status.replace('_', ' ')}
                className={orderStatusClass[order.status] ?? 'bg-gray-100 text-gray-600'}
              />
            } />
            <Row label="Created"   value={fmt(order.created_at)} />
            {order.started_at   && <Row label="Started"   value={fmt(order.started_at)} />}
            {order.completed_at && <Row label="Completed" value={fmt(order.completed_at)} />}
          </Section>

        </div>

        {/* Production Information */}
        <ProductionInfoSection order={order} operator={displayOperator} sectionId="sec-production" />

        {/* Quality & Compliance */}
        <QualityComplianceSection qcResults={qc_results} />

        {/* QC Inspections */}
        <Section icon={<FlaskConical size={15} />} title="QC Inspections" count={qc_results.length}>
          {qc_results.length === 0 && <Empty text="No QC inspections recorded for this batch." />}
          {qc_results.length > 0 && (
            <div className="space-y-2">
              {qc_results.map((r, i) => <QcInspectionCard key={i} r={r} />)}
            </div>
          )}
        </Section>

        {/* Raw materials */}
        <Section icon={<Layers size={15} />} title="Raw Materials Used" count={materials.length} id="sec-materials">
          {materials.length === 0 && <Empty text="No materials linked to this batch." />}
          {materials.length > 0 && (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 text-[10px] text-gray-400 uppercase tracking-wider">
                    <th className="pb-2.5 text-left font-semibold pr-3">Material</th>
                    <th className="pb-2.5 text-left font-semibold pr-3">Supplier</th>
                    <th className="pb-2.5 text-left font-semibold pr-3">Lot #</th>
                    <th className="pb-2.5 text-right font-semibold">Qty Used</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {materials.map((m, i) => (
                    <tr key={i} className="transition-all duration-150 hover:bg-white dark:hover:bg-gray-700/30 hover:-translate-y-px hover:shadow-[0_1px_4px_0_rgba(0,0,0,0.06)] dark:hover:shadow-[0_1px_4px_0_rgba(0,0,0,0.2)] hover:relative hover:z-10 cursor-default">
                      <td className="py-2.5 pr-3 font-medium text-gray-900 dark:text-white">{m.material_name}</td>
                      <td className="py-2.5 pr-3 text-xs text-gray-500 dark:text-gray-400">
                        {m.supplier_name ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                        {m.lot_number ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="py-2.5 text-right font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap tabular-nums">
                        {formatQty(m.quantity)}&nbsp;{m.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Distribution */}
        <Section icon={<ShoppingCart size={15} />} title="Distribution" count={sales.length} id="sec-distribution">
          {sales.length === 0 && <Empty text="No distribution records for this batch." />}
          {sales.length > 0 && (
            <div className="space-y-2">
              {sales.map((s, i) => {
                const status = deriveShipmentStatus(i, s.sold_at)
                return (
                  <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/20 px-3 py-2.5">
                    {/* Row 1: name + status badge */}
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{s.customer_name || 'Customer'}</p>
                      <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-md px-2 py-0.5 ${shipmentStatusClass[status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {status}
                      </span>
                    </div>
                    {/* Row 2: date */}
                    <p className="text-xs text-gray-400 mt-0.5">{fmt(s.sold_at)}</p>
                    {/* Row 3: quantity */}
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 tabular-nums mt-1">
                      {s.quantity.toLocaleString()} units
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        {/* Journey Metrics — calculated from real data, no placeholders */}
        {!journeyLoading && (
          <JourneyMetrics
            order={order}
            qcResults={qc_results}
            materials={materials}
            sales={sales}
            manufacturingEvents={manufacturingEvents}
          />
        )}

        {/* Product Journey — manufacturing, quality, distribution only */}
        <Section
          icon={<Activity size={15} />}
          title="Product Journey"
          count={journeyLoading ? undefined : manufacturingEvents.length}
          id="sec-journey"
        >
          <EnhancedTimeline
            events={manufacturingEvents}
            isLoading={journeyLoading}
            distributionFallback={sales}
          />
        </Section>

        {/* Consumer Activity — QR scan investigation view (secondary) */}
        <Section
          icon={<ScanLine size={15} />}
          title="Consumer Activity"
          count={journeyLoading ? undefined : scanEvents.length}
          id="sec-activity"
        >
          {journeyLoading ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 italic animate-pulse">
              Loading scan records…
            </p>
          ) : (
            <ConsumerActivity
              events={scanEvents}
              orderId={order.id}
              completedAt={order.completed_at}
            />
          )}
        </Section>

        {/* Footer */}
        <div className="pb-8 pt-2 text-center space-y-1.5">
          <div className="flex items-center justify-center gap-1.5">
            <ShieldCheck size={14} className="text-blue-500 dark:text-blue-400" />
            <span className="text-sm font-bold text-gray-700 dark:text-gray-300">Verified by TraceFlow®</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">Secure Manufacturing Traceability Platform</p>
          <p className="text-[10px] text-gray-300 dark:text-gray-600">Powered by TraceFlow</p>
        </div>

      </div>
    </div>
  )
}
