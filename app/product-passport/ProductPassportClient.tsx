'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Search, Loader2, ScanLine, Package2, Factory, Layers,
  ShieldCheck, Truck, AlertTriangle, FileWarning,
  CheckCircle2, Circle, XCircle, Clock, ChevronDown, ChevronUp,
  CalendarClock, Wrench, Thermometer, BarChart3, MapPin,
  ClipboardCheck, Users, Archive, ArrowRight, Printer,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'

// ── Types ─────────────────────────────────────────────────────────────────────

type PassportOrder = {
  id:           string
  product_name: string
  sku:          string
  description:  string | null
  quantity:     number
  status:       string
  created_at:   string
  started_at:   string | null
  completed_at: string | null
}

type PassportMaterial = {
  id:                  string
  material_name:       string
  lot_number:          string | null
  quantity:            number
  unit:                string
  supplier_name:       string | null
  received_at:         string | null
  lot_status:          string | null
  raw_material_lot_id: string | null
}

type PassportQc = {
  id:            string
  status:        'pass' | 'fail' | 'hold'
  inspector_name: string | null
  notes:         string | null
  inspected_at:  string
}

type PassportDistribution = {
  id:               string
  recipient_name:   string | null
  recipient_type:   string | null
  quantity_shipped: number
  shipped_at:       string
  notes:            string | null
}

type PassportRecall = {
  id:             string
  recall_number:  string | null
  title:          string
  status:         string
  severity:       string
  affected_units: number | null
  reason:         string | null
  created_at:     string
  closed_at:      string | null
}

type PassportCapa = {
  id:                string
  capa_number:       string | null
  title:             string
  status:            string
  root_cause:        string | null
  corrective_action: string | null
  owner_name:        string | null
  due_date:          string | null
  created_at:        string
  closed_at:         string | null
}

type TimelineStep = {
  stage:       string
  title:       string
  description: string
  timestamp:   string | null
  status:      'done' | 'active' | 'pending' | 'error'
  est:         boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function addHours(iso: string, h: number): string {
  return new Date(new Date(iso).getTime() + h * 3_600_000).toISOString()
}

function fmt(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', ...opts,
  })
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function deriveShift(startedAt: string | null): string {
  if (!startedAt) return 'Morning Shift'
  const h = new Date(startedAt).getHours()
  if (h >= 6  && h < 14) return 'Morning Shift  (06:00 – 14:00)'
  if (h >= 14 && h < 22) return 'Afternoon Shift (14:00 – 22:00)'
  return 'Night Shift (22:00 – 06:00)'
}

function deriveWorkOrder(sku: string, id: string): string {
  return `WO-${sku}-${id.slice(-6).toUpperCase()}`
}

function deriveLine(sku: string): string {
  const prefix = sku.slice(0, 3).toUpperCase()
  const MAP: Record<string, string> = {
    VSR: 'Valve Assembly Line 2',
    VBC: 'Valve / Manifold Line',
    VGV: 'Gate Valve Assembly',
    HPC: 'Hydraulic Cylinder Bay',
    ELV: 'Electrical Assembly Line A',
    ELM: 'Electrical Assembly Line A',
  }
  return MAP[prefix] ?? 'General Manufacturing Line'
}

function deriveFacility(): string {
  return 'Main Manufacturing Facility — Plant A'
}

function deriveWarehouse(sku: string): string {
  const prefix = sku.slice(0, 3).toUpperCase()
  const MAP: Record<string, string> = {
    VSR: 'Finished Goods Store C — Bay 14',
    VBC: 'Finished Goods Store C — Bay 11',
    HPC: 'Heavy Equipment Store D — Bay 3',
    ELV: 'Electrical Store B — Rack E7',
    ELM: 'Electrical Store B — Rack E7',
  }
  return MAP[prefix] ?? 'Finished Goods Store A'
}

function computePassportStatus(
  order: PassportOrder,
  recalls: PassportRecall[],
  capas:   PassportCapa[],
  qc:      PassportQc[],
): { label: string; color: string; bg: string; dotColor: string } {
  const hasActiveRecall = recalls.some(r => r.status === 'open')
  const hasOpenCapa     = capas.some(c => c.status !== 'closed')
  const hasFailedQc     = qc.some(q => q.status === 'fail')

  if (hasActiveRecall) return {
    label: 'Under Recall',
    color: 'text-red-600 dark:text-red-400',
    bg:    'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40',
    dotColor: 'bg-red-500',
  }
  if (hasFailedQc) return {
    label: 'QC Failure',
    color: 'text-orange-600 dark:text-orange-400',
    bg:    'bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800/40',
    dotColor: 'bg-orange-500',
  }
  if (hasOpenCapa) return {
    label: 'CAPA Active — Monitor',
    color: 'text-amber-600 dark:text-amber-400',
    bg:    'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40',
    dotColor: 'bg-amber-500',
  }
  if (order.status === 'completed') return {
    label: 'Released — Compliant',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg:    'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40',
    dotColor: 'bg-emerald-500',
  }
  if (order.status === 'in_progress') return {
    label: 'In Production',
    color: 'text-blue-600 dark:text-blue-400',
    bg:    'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40',
    dotColor: 'bg-blue-500',
  }
  return {
    label: 'Pending',
    color: 'text-gray-500 dark:text-gray-400',
    bg:    'bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
    dotColor: 'bg-gray-400',
  }
}

function synthesizeTimeline(
  order:   PassportOrder,
  qc:      PassportQc[],
  dist:    PassportDistribution[],
  recalls: PassportRecall[],
  capas:   PassportCapa[],
): TimelineStep[] {
  const steps: TimelineStep[] = []
  const started  = order.started_at  ?? order.created_at
  const completed = order.completed_at

  steps.push({
    stage:       'supplier',
    title:       'Supplier Qualification',
    description: 'Approved vendor list verified; material certs on file',
    timestamp:   addHours(started, -72),
    status:      'done',
    est:         true,
  })

  steps.push({
    stage:       'incoming_qc',
    title:       'Incoming Material QC',
    description: 'Raw materials received, inspected, and lot numbers assigned',
    timestamp:   addHours(started, -24),
    status:      order.status !== 'pending' ? 'done' : 'pending',
    est:         true,
  })

  steps.push({
    stage:       'storage',
    title:       'Raw Materials Warehouse',
    description: 'Materials allocated, quarantine lifted, and issued to production floor',
    timestamp:   addHours(started, -2),
    status:      order.status !== 'pending' ? 'done' : 'pending',
    est:         true,
  })

  steps.push({
    stage:       'production_start',
    title:       'Production Started',
    description: `Work order opened — ${order.quantity.toLocaleString()} units planned`,
    timestamp:   order.started_at ?? order.created_at,
    status:      order.status !== 'pending' ? 'done' : 'pending',
    est:         !order.started_at,
  })

  steps.push({
    stage:       'production_complete',
    title:       'Production Completed',
    description: 'All units manufactured; batch closed and transferred to QC',
    timestamp:   completed ?? null,
    status:      order.status === 'completed' ? 'done'
               : order.status === 'in_progress' ? 'active'
               : 'pending',
    est:         false,
  })

  const passedQc = qc.filter(q => q.status === 'pass')
  const failedQc = qc.filter(q => q.status === 'fail')
  steps.push({
    stage:       'final_qc',
    title:       'Final Quality Inspection',
    description: failedQc.length > 0
      ? `QC failed — ${failedQc.length} defect record(s) raised`
      : passedQc.length > 0
      ? `Certified by ${passedQc[passedQc.length - 1].inspector_name ?? 'Quality Lab'}`
      : order.status === 'completed' ? 'Inspection completed' : 'Awaiting inspection',
    timestamp:   passedQc[0]?.inspected_at ?? (completed ? addHours(completed, 2) : null),
    status:      failedQc.length > 0 ? 'error'
               : passedQc.length > 0 ? 'done'
               : order.status === 'completed' ? 'done'
               : 'pending',
    est:         passedQc.length === 0 && order.status === 'completed',
  })

  steps.push({
    stage:       'packaging',
    title:       'Packaging & Labelling',
    description: 'Units packaged, serialised, and release certificate issued',
    timestamp:   completed ? addHours(completed, 4) : null,
    status:      order.status === 'completed' ? 'done' : 'pending',
    est:         true,
  })

  steps.push({
    stage:       'warehouse',
    title:       'Finished Goods Warehouse',
    description: 'Transfer to finished goods store — product held for dispatch',
    timestamp:   completed ? addHours(completed, 6) : null,
    status:      order.status === 'completed' ? 'done' : 'pending',
    est:         true,
  })

  const firstDist = dist[0]
  steps.push({
    stage:       'distribution',
    title:       'Distribution / Shipment',
    description: firstDist
      ? `Shipped to ${firstDist.recipient_name ?? 'distributor'} — ${firstDist.quantity_shipped.toLocaleString()} units`
      : dist.length > 0 ? `${dist.length} shipment(s) dispatched` : 'Not yet dispatched',
    timestamp:   firstDist?.shipped_at ?? null,
    status:      dist.length > 0 ? 'done' : 'pending',
    est:         false,
  })

  steps.push({
    stage:       'receipt',
    title:       'Customer / End-User Receipt',
    description: dist.length > 0
      ? 'Delivery confirmed; product in service'
      : 'Pending delivery confirmation',
    timestamp:   firstDist?.shipped_at ? addHours(firstDist.shipped_at, 72) : null,
    status:      dist.length > 0 ? 'done' : 'pending',
    est:         dist.length > 0,
  })

  if (recalls.length > 0) {
    steps.push({
      stage:       'recall',
      title:       'Recall Initiated',
      description: recalls[0].title,
      timestamp:   recalls[0].created_at,
      status:      recalls[0].status === 'closed' ? 'done' : 'error',
      est:         false,
    })
  }

  if (capas.length > 0) {
    steps.push({
      stage:       'capa',
      title:       'CAPA Opened',
      description: capas[0].title,
      timestamp:   capas[0].created_at,
      status:      capas[0].status === 'closed' ? 'done' : 'active',
      est:         false,
    })
  }

  return steps
}

// ── Small shared UI ───────────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <Icon size={13} className="text-[#4a8fb9] shrink-0" />
      <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)]">{text}</span>
    </div>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 ${className}`}>
      {children}
    </div>
  )
}

function Field({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--subtle)] mb-0.5">{label}</p>
      <p className={`text-[13px] text-[var(--text)] ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</p>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const MAP: Record<string, string> = {
    pass:       'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
    fail:       'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    hold:       'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    available:  'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
    consumed:   'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    quarantine: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    rejected:   'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    open:       'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    closed:     'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
    investigation: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    corrective_action: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
    verification: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    completed:  'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
    in_progress: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    pending:    'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  }
  const cls = MAP[status] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function TimelineSection({ steps }: { steps: TimelineStep[] }) {
  const iconMap: Record<string, React.ElementType> = {
    supplier:           Users,
    incoming_qc:        ClipboardCheck,
    storage:            Archive,
    production_start:   Wrench,
    production_complete: Factory,
    final_qc:           ShieldCheck,
    packaging:          Package2,
    warehouse:          Archive,
    distribution:       Truck,
    receipt:            CheckCircle2,
    recall:             AlertTriangle,
    capa:               FileWarning,
  }

  return (
    <Card>
      <SectionLabel icon={GitBranchIcon} text="Product Journey" />
      <div className="relative">
        <div className="absolute start-[15px] top-0 bottom-0 w-px bg-[var(--border)]" />
        <div className="space-y-0">
          {steps.map((step, idx) => {
            const Icon = iconMap[step.stage] ?? Circle
            const isLast = idx === steps.length - 1

            const dotCls =
              step.status === 'done'    ? 'bg-emerald-500 ring-2 ring-emerald-500/20'
            : step.status === 'active'  ? 'bg-blue-500 ring-2 ring-blue-500/20 animate-pulse'
            : step.status === 'error'   ? 'bg-red-500 ring-2 ring-red-500/20'
            : 'bg-[var(--subtle)] ring-1 ring-[var(--border)]'

            const textCls =
              step.status === 'done'   ? 'text-[var(--text)]'
            : step.status === 'active' ? 'text-blue-500 dark:text-blue-400'
            : step.status === 'error'  ? 'text-red-600 dark:text-red-400'
            : 'text-[var(--subtle)]'

            return (
              <div key={step.stage} className={`relative flex gap-4 ps-9 ${isLast ? '' : 'pb-3'}`}>
                <span className={`absolute start-[9px] top-0.5 h-[14px] w-[14px] rounded-full flex items-center justify-center ${dotCls}`}>
                  {step.status === 'done'
                    ? <CheckCircle2 size={9} className="text-white" />
                    : step.status === 'error'
                    ? <XCircle size={9} className="text-white" />
                    : step.status === 'active'
                    ? <Circle size={9} className="text-white" />
                    : null
                  }
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`text-[12.5px] font-medium ${textCls}`}>{step.title}</span>
                    {step.est && (
                      <span className="rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
                            title="Timestamp estimated from production data">
                        est.
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]">{step.description}</p>
                  {step.timestamp && (
                    <p className="mt-0.5 text-[10px] text-[var(--subtle)]">{fmt(step.timestamp)}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

// tiny inline icon shim for GitBranch (not imported above to avoid conflict)
function GitBranchIcon(props: React.SVGProps<SVGSVGElement> & { size?: number }) {
  const { size = 16, ...rest } = props
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

// ── Section: Production Details ───────────────────────────────────────────────

function ProductionSection({ order }: { order: PassportOrder }) {
  const shift   = deriveShift(order.started_at)
  const wo      = deriveWorkOrder(order.sku, order.id)
  const line    = deriveLine(order.sku)
  const facility = deriveFacility()

  return (
    <Card>
      <SectionLabel icon={Factory} text="Production Details" />
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        <Field label="Work Order" value={<span className="font-mono text-[12px]">{wo}</span>} />
        <Field label="Batch ID"   value={<span className="font-mono text-[11px] text-[var(--muted)]">{order.id.slice(0, 18)}…</span>} />
        <Field label="Facility"   value={facility} />
        <Field label="Line / Bay" value={line} />
        <Field label="Shift"      value={shift} />
        <Field label="Planned Qty" value={`${order.quantity.toLocaleString()} units`} />
        <Field label="Start Time"  value={fmt(order.started_at ?? order.created_at)} />
        <Field label="End Time"    value={order.completed_at ? fmt(order.completed_at) : '—'} />
        <div className="col-span-2">
          <Field label="Current Status" value={
            <span className="mt-1 inline-flex">
              <StatusPill status={order.status} />
            </span>
          } />
        </div>
      </div>
    </Card>
  )
}

// ── Section: Raw Materials ────────────────────────────────────────────────────

function RawMaterialsSection({ materials }: { materials: PassportMaterial[] }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <Card>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <Layers size={13} className="text-[#4a8fb9] shrink-0" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)]">
            Raw Materials Used
          </span>
          <span className="rounded-full bg-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
            {materials.length}
          </span>
        </div>
        <button onClick={() => setCollapsed(c => !c)} className="text-[var(--subtle)] hover:text-[var(--muted)] transition-colors">
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {!collapsed && (
        materials.length === 0 ? (
          <p className="text-[12px] text-[var(--subtle)] text-center py-4">No material records for this batch.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {['Material', 'Lot Number', 'Supplier', 'Qty Used', 'Lot Status'].map(h => (
                    <th key={h} className="pb-2 text-start font-medium text-[var(--subtle)] pe-3 last:pe-0 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {materials.map(m => (
                  <tr key={m.id} className="border-b border-[var(--border-sub)] hover:bg-[var(--border-sub)] transition-colors">
                    <td className="py-2 pe-3 font-medium text-[var(--text)] whitespace-nowrap">{m.material_name}</td>
                    <td className="py-2 pe-3 font-mono text-[10.5px] text-[var(--muted)] whitespace-nowrap">
                      {m.lot_number ?? <span className="text-[var(--subtle)]">—</span>}
                    </td>
                    <td className="py-2 pe-3 text-[var(--muted)] whitespace-nowrap">
                      {m.supplier_name ?? <span className="text-[var(--subtle)]">—</span>}
                    </td>
                    <td className="py-2 pe-3 text-[var(--muted)] whitespace-nowrap">
                      {m.quantity.toLocaleString()} {m.unit}
                    </td>
                    <td className="py-2">
                      {m.lot_status ? <StatusPill status={m.lot_status} /> : <span className="text-[var(--subtle)]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </Card>
  )
}

// ── Section: Quality & Inspection ─────────────────────────────────────────────

const QC_INSPECTION_TYPES: Record<string, string> = {
  incoming:    'Incoming Material QC',
  in_process:  'In-Process Inspection',
  final:       'Final Release Inspection',
  random:      'Random / Audit Check',
}

function QualitySection({ qc }: { qc: PassportQc[] }) {
  const overallPassed = qc.length > 0 && qc.every(q => q.status === 'pass')
  const hasFailure    = qc.some(q => q.status === 'fail')

  return (
    <Card>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={13} className="text-[#4a8fb9] shrink-0" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)]">
            Quality & Inspection Results
          </span>
        </div>
        {qc.length > 0 && (
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide
            ${overallPassed
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
              : hasFailure
              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
              : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
            }`}>
            {overallPassed ? 'All Passed' : hasFailure ? 'Failure Recorded' : 'Hold / Pending'}
          </span>
        )}
      </div>

      {qc.length === 0 ? (
        <p className="text-[12px] text-[var(--subtle)] text-center py-4">No QC records for this batch.</p>
      ) : (
        <div className="space-y-2">
          {qc.map((q, i) => (
            <div key={q.id}
              className={`rounded-xl border px-3.5 py-3 flex items-start gap-3
                ${q.status === 'pass'
                  ? 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-950/10'
                  : q.status === 'fail'
                  ? 'border-red-200 dark:border-red-800/40 bg-red-50/50 dark:bg-red-950/10'
                  : 'border-amber-200 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/10'}
              `}>
              <div className="mt-0.5 shrink-0">
                {q.status === 'pass'
                  ? <CheckCircle2 size={14} className="text-emerald-500" />
                  : q.status === 'fail'
                  ? <XCircle size={14} className="text-red-500" />
                  : <Clock size={14} className="text-amber-500" />
                }
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium text-[var(--text)]">
                    Inspection #{i + 1}
                  </span>
                  <StatusPill status={q.status} />
                </div>
                {q.inspector_name && (
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]">Inspector: {q.inspector_name}</p>
                )}
                {q.notes && (
                  <p className="mt-0.5 text-[11px] text-[var(--muted)] italic">{q.notes}</p>
                )}
                <p className="mt-0.5 text-[10px] text-[var(--subtle)]">{fmt(q.inspected_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Section: Packaging & Warehouse ────────────────────────────────────────────

function PackagingSection({ order }: { order: PassportOrder }) {
  const packagingDate = order.completed_at ? addHours(order.completed_at, 4) : null
  const releaseDate   = order.completed_at ? addHours(order.completed_at, 5) : null
  const warehouse     = deriveWarehouse(order.sku)

  return (
    <Card>
      <SectionLabel icon={Archive} text="Packaging & Warehouse" />
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        <Field label="Packaging Date"    value={packagingDate ? fmtDate(packagingDate) : '—'} />
        <Field label="Packaging Status"  value={
          order.status === 'completed'
            ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">Complete</span>
            : <span className="text-[var(--subtle)]">Pending</span>
        } />
        <Field label="Finished Goods Loc." value={order.status === 'completed' ? warehouse : '—'} />
        <Field label="Release Date"     value={releaseDate ? fmtDate(releaseDate) : '—'} />
        <div className="col-span-2">
          <Field label="Release Status" value={
            order.status === 'completed'
              ? <span className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 size={10} /> Certificate of Conformance Issued
                </span>
              : <span className="mt-1 inline-flex rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-500">
                  Pending Release
                </span>
          } />
        </div>
      </div>
    </Card>
  )
}

// ── Section: Distribution ─────────────────────────────────────────────────────

function DistributionSection({ dist }: { dist: PassportDistribution[] }) {
  return (
    <Card>
      <div className="flex items-center gap-2 mb-2.5">
        <Truck size={13} className="text-[#4a8fb9] shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)]">
          Distribution Details
        </span>
        <span className="rounded-full bg-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
          {dist.length} shipment{dist.length !== 1 ? 's' : ''}
        </span>
      </div>

      {dist.length === 0 ? (
        <p className="text-[12px] text-[var(--subtle)] text-center py-4">No distribution records yet.</p>
      ) : (
        <div className="space-y-3">
          {dist.map(d => (
            <div key={d.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[12.5px] font-medium text-[var(--text)]">
                    {d.recipient_name ?? 'Recipient not recorded'}
                  </p>
                  {d.recipient_type && (
                    <p className="text-[10.5px] text-[var(--muted)] capitalize mt-0.5">{d.recipient_type}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-md bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                  Dispatched
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
                <span><span className="text-[var(--subtle)]">Qty:</span> {d.quantity_shipped.toLocaleString()} units</span>
                <span><span className="text-[var(--subtle)]">Shipped:</span> {fmtDate(d.shipped_at)}</span>
              </div>
              {d.notes && (
                <p className="mt-1.5 text-[11px] text-[var(--muted)] italic">{d.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Section: Recall / CAPA ────────────────────────────────────────────────────

function severityBadgeCls(severity: string) {
  const s = severity.toLowerCase()
  if (s === 'critical' || s === 'high')   return 'bg-red-100    dark:bg-red-900/30    text-red-700    dark:text-red-400'
  if (s === 'medium')                      return 'bg-amber-100  dark:bg-amber-900/30  text-amber-700  dark:text-amber-400'
  return                                          'bg-green-100  dark:bg-green-900/30  text-green-700  dark:text-green-400'
}

function RecallCapaSection({
  recalls, capas,
}: { recalls: PassportRecall[]; capas: PassportCapa[] }) {
  if (recalls.length === 0 && capas.length === 0) return null

  return (
    <div className="space-y-4">
      {recalls.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-2.5">
            <AlertTriangle size={13} className="text-red-500 shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-red-500 dark:text-red-400">
              Active Recall Records
            </span>
            <span className="ml-auto text-[10px] text-[var(--subtle)]">{recalls.length} record{recalls.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-2">
            {recalls.map(r => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-red-200 dark:border-red-800/40 bg-red-50/40 dark:bg-red-950/10 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    {r.recall_number && (
                      <span className="font-mono text-[10px] font-medium text-[var(--muted)] shrink-0">{r.recall_number}</span>
                    )}
                    <StatusPill status={r.status} />
                    <span className={`inline-flex items-center rounded px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide ${severityBadgeCls(r.severity)}`}>
                      {r.severity}
                    </span>
                  </div>
                  <p className="text-[12px] font-medium text-[var(--text)] truncate leading-snug">{r.title}</p>
                  <p className="text-[10px] text-[var(--subtle)] mt-0.5">
                    {r.affected_units != null && <>{r.affected_units.toLocaleString()} units · </>}
                    Opened {fmtDate(r.created_at)}
                  </p>
                </div>
                <Link href="/recall" className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-[#4a8fb9] hover:text-[#2d5a74] dark:hover:text-[#7ab3d0] whitespace-nowrap transition-colors">
                  View <ArrowRight size={10} />
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}

      {capas.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-2.5">
            <FileWarning size={13} className="text-amber-500 shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">
              CAPA Records
            </span>
            <span className="ml-auto text-[10px] text-[var(--subtle)]">{capas.length} record{capas.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-2">
            {capas.map(c => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-950/10 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    {c.capa_number && (
                      <span className="font-mono text-[10px] font-medium text-[var(--muted)] shrink-0">{c.capa_number}</span>
                    )}
                    <StatusPill status={c.status} />
                  </div>
                  <p className="text-[12px] font-medium text-[var(--text)] truncate leading-snug">{c.title}</p>
                  <p className="text-[10px] text-[var(--subtle)] mt-0.5">
                    {c.owner_name && <>{c.owner_name}</>}
                    {c.owner_name && c.due_date && ' · '}
                    {c.due_date && <>Due {fmtDate(c.due_date)}</>}
                  </p>
                </div>
                <Link href="/capa" className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-[#4a8fb9] hover:text-[#2d5a74] dark:hover:text-[#7ab3d0] whitespace-nowrap transition-colors">
                  View <ArrowRight size={10} />
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Product Banner ────────────────────────────────────────────────────────────

function ProductBanner({
  order, status, materials, qc, dist,
}: {
  order:     PassportOrder
  status:    ReturnType<typeof computePassportStatus>
  materials: PassportMaterial[]
  qc:        PassportQc[]
  dist:      PassportDistribution[]
}) {
  const wo = deriveWorkOrder(order.sku, order.id)
  const borderCls = status.dotColor.replace(/^bg-/, 'border-l-')
  return (
    <div className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden border-l-[3px] ${borderCls}`}>
      {/* Manufacturing status strip — one-glance lifecycle state */}
      <div className="flex items-center gap-2 px-4 py-[7px] border-b border-[var(--border)] bg-[var(--bg)]">
        <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${status.dotColor}`} />
        <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[var(--subtle)]">Manufacturing Status</span>
        <span className="text-[var(--border)]">·</span>
        <span className={`text-[10.5px] font-semibold ${status.color}`}>{status.label}</span>
      </div>
      <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-[#3a6f8f]/10 flex items-center justify-center shrink-0">
            <Wrench size={22} className="text-[#4a8fb9]" />
          </div>
          <div>
            <p className="text-[11px] font-mono text-[var(--muted)]">{order.sku}</p>
            <h1 className="text-[18px] font-semibold text-[var(--text)] tracking-tight leading-tight">
              {order.product_name}
            </h1>
            {order.description && (
              <p className="text-[12px] text-[var(--muted)] mt-0.5">{order.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.bg} ${status.color}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${status.dotColor}`} />
                {status.label}
              </span>
              <span className="text-[11px] font-mono text-[var(--subtle)]">{wo}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/product-journey/${order.id}`}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            <GitBranchIcon size={12} />
            Full Journey
          </Link>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            <Printer size={12} />
            Print
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[var(--border)] border-t border-[var(--border)]">
        {[
          { label: 'Batch Qty',       value: `${order.quantity.toLocaleString()} units` },
          { label: 'Materials Used',  value: `${materials.length} raw material${materials.length !== 1 ? 's' : ''}` },
          { label: 'QC Records',      value: `${qc.length} inspection${qc.length !== 1 ? 's' : ''}` },
          { label: 'Shipments',       value: `${dist.length} dispatch${dist.length !== 1 ? 'es' : ''}` },
        ].map(stat => (
          <div key={stat.label} className="px-4 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-[var(--subtle)]">{stat.label}</p>
            <p className="text-[14px] font-semibold text-[var(--text)] mt-0.5">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ProductPassportClient() {
  const { companyId }  = useAuth()
  const searchParams   = useSearchParams()

  const [query,    setQuery]    = useState(searchParams.get('q') ?? '')
  const [inputVal, setInputVal] = useState(searchParams.get('q') ?? '')
  const [loading,  setLoading]  = useState(false)
  const [searched, setSearched] = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const [order,     setOrder]     = useState<PassportOrder | null>(null)
  const [materials, setMaterials] = useState<PassportMaterial[]>([])
  const [qc,        setQc]        = useState<PassportQc[]>([])
  const [dist,      setDist]      = useState<PassportDistribution[]>([])
  const [recalls,   setRecalls]   = useState<PassportRecall[]>([])
  const [capas,     setCapas]     = useState<PassportCapa[]>([])

  const trace = useCallback(async (identifier: string) => {
    if (!companyId || !identifier.trim()) return
    setLoading(true)
    setError(null)
    setSearched(true)

    try {
      // ── 1. Resolve production order ──────────────────────────────────
      let orderRow: any = null

      if (UUID_RE.test(identifier.trim())) {
        const { data } = await supabase
          .from('production_orders')
          .select('id, quantity, status, created_at, started_at, completed_at, products(name, sku, description)')
          .eq('id', identifier.trim())
          .eq('company_id', companyId)
          .maybeSingle()
        orderRow = data
      }

      if (!orderRow) {
        const { data: all } = await supabase
          .from('production_orders')
          .select('id, quantity, status, created_at, started_at, completed_at, products(name, sku, description)')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(100)

        if (all) {
          const q = identifier.trim().toLowerCase()
          orderRow = all.find(o => {
            const p = Array.isArray(o.products) ? o.products[0] : o.products
            return (
              p?.sku?.toLowerCase().includes(q) ||
              p?.name?.toLowerCase().includes(q) ||
              o.id.toLowerCase().startsWith(q)
            )
          }) ?? null
        }
      }

      if (!orderRow) {
        setOrder(null)
        setMaterials([]); setQc([]); setDist([]); setRecalls([]); setCapas([])
        setLoading(false)
        return
      }

      const prod    = Array.isArray(orderRow.products) ? orderRow.products[0] : orderRow.products
      const batchId = orderRow.id as string

      const resolved: PassportOrder = {
        id:           batchId,
        product_name: prod?.name        ?? 'Unknown Product',
        sku:          prod?.sku         ?? '',
        description:  prod?.description ?? null,
        quantity:     orderRow.quantity,
        status:       orderRow.status,
        created_at:   orderRow.created_at,
        started_at:   orderRow.started_at  ?? null,
        completed_at: orderRow.completed_at ?? null,
      }
      setOrder(resolved)

      // ── 2. Parallel fetch ────────────────────────────────────────────
      const [matRes, qcRes, batchesRes, recallRes, capaRes] = await Promise.all([
        supabase
          .from('bill_of_materials')
          .select('id, material_name, lot_number, quantity, unit, created_at, lots:raw_material_lot_id(id, lot_number, status, received_at, suppliers(name))')
          .eq('production_order_id', batchId)
          .eq('company_id', companyId),
        supabase
          .from('batch_qc_results')
          .select('id, status, inspector_name, notes, inspected_at')
          .eq('batch_id', batchId)
          .eq('company_id', companyId)
          .order('inspected_at', { ascending: true }),
        supabase
          .from('batches')
          .select('id')
          .eq('production_order_id', batchId)
          .eq('company_id', companyId),
        supabase
          .from('recalls')
          .select('id, recall_number, title, status, severity, affected_units, reason, created_at, closed_at')
          .eq('batch_id', batchId)
          .eq('company_id', companyId)
          .order('created_at', { ascending: false }),
        supabase
          .from('capas')
          .select('id, capa_number, title, status, root_cause, corrective_action, owner_name, due_date, created_at, closed_at')
          .eq('batch_id', batchId)
          .eq('company_id', companyId)
          .order('created_at', { ascending: false }),
      ])

      // ── 3. Map materials ─────────────────────────────────────────────
      const mappedMaterials: PassportMaterial[] = (matRes.data ?? []).map((row: any) => {
        const lots = Array.isArray(row.lots) ? row.lots[0] : row.lots
        return {
          id:                  row.id,
          material_name:       row.material_name,
          lot_number:          row.lot_number        ?? lots?.lot_number   ?? null,
          quantity:            row.quantity,
          unit:                row.unit,
          supplier_name:       lots?.suppliers?.name ?? null,
          received_at:         lots?.received_at     ?? null,
          lot_status:          lots?.status          ?? null,
          raw_material_lot_id: lots?.id              ?? null,
        }
      })
      setMaterials(mappedMaterials)

      // ── 4. QC results ────────────────────────────────────────────────
      setQc((qcRes.data ?? []) as PassportQc[])

      // ── 5. Distribution (via batches join) ───────────────────────────
      const batchIds = (batchesRes.data ?? []).map((b: any) => b.id)
      if (batchIds.length > 0) {
        const { data: distData } = await supabase
          .from('distribution_records')
          .select('id, recipient_name, recipient_type, quantity_shipped, shipped_at, notes')
          .in('batch_id', batchIds)
          .order('shipped_at', { ascending: false })
        setDist((distData ?? []) as PassportDistribution[])
      } else {
        setDist([])
      }

      setRecalls((recallRes.data ?? []) as PassportRecall[])
      setCapas((capaRes.data   ?? []) as PassportCapa[])
    } catch (e) {
      setError('Failed to load passport data.')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  // Auto-trace if query param provided on mount
  useEffect(() => {
    const q = searchParams.get('q')
    if (q && companyId) trace(q)
  }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setQuery(inputVal)
    trace(inputVal)
  }

  const status   = order ? computePassportStatus(order, recalls, capas, qc) : null
  const timeline = order ? synthesizeTimeline(order, qc, dist, recalls, capas) : []

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-4 space-y-4">

      {/* ── Search header ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-3">
          Scan or Enter Identifier
        </p>
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div className="relative flex-1 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 focus-within:border-[#3a6f8f] focus-within:ring-2 focus-within:ring-[#3a6f8f]/20 transition-all">
            {loading
              ? <Loader2 size={15} className="shrink-0 animate-spin text-[var(--subtle)]" />
              : <ScanLine  size={15} className="shrink-0 text-[var(--subtle)]" />
            }
            <input
              type="text"
              placeholder="QR / Barcode / Batch ID / SKU / Product name…"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-[var(--text)] placeholder:text-[var(--subtle)] outline-none"
            />
            {inputVal && (
              <button type="button" onClick={() => { setInputVal(''); setQuery(''); setSearched(false); setOrder(null) }}
                className="shrink-0 text-[var(--subtle)] hover:text-[var(--muted)] transition-colors">
                ×
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || !inputVal.trim()}
            className="shrink-0 flex items-center gap-1.5 rounded-xl bg-[#3a6f8f] px-5 py-3 text-[13px] font-semibold text-white shadow-sm hover:bg-[#2d5a74] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Trace Product
          </button>
        </form>
        <p className="mt-2.5 text-[11px] text-[var(--subtle)]">
          Examples: <button onClick={() => { setInputVal('VSR-05-010'); setQuery('VSR-05-010'); trace('VSR-05-010') }}
            className="underline decoration-dotted hover:text-[var(--muted)] transition-colors">VSR-05-010</button>
          {' · '}
          <button onClick={() => { setInputVal('VBC-2IN-316'); setQuery('VBC-2IN-316'); trace('VBC-2IN-316') }}
            className="underline decoration-dotted hover:text-[var(--muted)] transition-colors">VBC-2IN-316</button>
          {' · '}
          <button onClick={() => { setInputVal('HPC-50-200'); setQuery('HPC-50-200'); trace('HPC-50-200') }}
            className="underline decoration-dotted hover:text-[var(--muted)] transition-colors">HPC-50-200</button>
          {' · or paste a Batch UUID'}
        </p>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-[12px] text-red-700 dark:text-red-400">
          <AlertTriangle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {/* ── Not found ─────────────────────────────────────────────────────────── */}
      {searched && !loading && !order && !error && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
          <Package2 size={36} className="mx-auto text-[var(--subtle)] mb-3" />
          <p className="text-[14px] font-medium text-[var(--text)]">No batch found for &ldquo;{query}&rdquo;</p>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            Try the product SKU, a batch UUID, or part of the product name.
          </p>
        </div>
      )}

      {/* ── Passport view ─────────────────────────────────────────────────────── */}
      {order && status && (
        <>
          <ProductBanner order={order} status={status} materials={materials} qc={qc} dist={dist} />

          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 lg:items-start">
            {/* Left column — operational detail: production, materials, quality, packaging, distribution */}
            <div className="space-y-4">
              <ProductionSection order={order} />
              <RawMaterialsSection materials={materials} />
              <QualitySection qc={qc} />
              <PackagingSection order={order} />
              <DistributionSection dist={dist} />
            </div>

            {/* Right column — timeline sticks as user scrolls the left column */}
            <div className="lg:sticky lg:top-4">
              <TimelineSection steps={timeline} />
            </div>
          </div>

          {/* Full-width recall/CAPA — only when relevant */}
          <RecallCapaSection recalls={recalls} capas={capas} />

          {/* Footer: doc metadata */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10.5px] text-[var(--subtle)]">
            <span>
              Product Passport · Batch {order.id.slice(0, 8).toUpperCase()} · Generated {fmt(new Date().toISOString())}
            </span>
            <span className="flex items-center gap-1">
              <CalendarClock size={10} />
              Data accurate as of export time — refer to source systems for live status.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
