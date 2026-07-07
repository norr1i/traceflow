'use client'

import { useState, useEffect } from 'react'
import { Activity, Clock, ShieldCheck, Truck, Layers } from 'lucide-react'

function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (to === 0) { setN(0); return }
    const steps = Math.min(to, 20)
    let step = 0
    const id = setInterval(() => {
      step++
      setN(Math.round((to * step) / steps))
      if (step >= steps) clearInterval(id)
    }, 700 / steps)
    return () => clearInterval(id)
  }, [to])
  return <>{n}</>
}

type Order = {
  started_at:   string | null
  completed_at: string | null
  created_at:   string
}

type QcResult = {
  status: 'pass' | 'fail' | 'hold'
}

type Material = {
  material_name: string
  supplier_name: string | null
}

type Sale = {
  customer_name: string | null
  quantity: number
  sold_at: string
}

type JourneyEvent = {
  event_timestamp: string
}

type Props = {
  order: Order
  qcResults: QcResult[]
  materials: Material[]
  sales: Sale[]
  manufacturingEvents: JourneyEvent[]
}

function formatDuration(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return null
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (ms <= 0) return null
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) return `${totalHours}h`
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  return hours > 0 ? `${days}d ${hours}h` : `${days} day${days !== 1 ? 's' : ''}`
}

const QC_DISPLAY: Record<string, { label: string; valueClass: string }> = {
  pass: {
    label: 'Passed',
    valueClass: 'text-emerald-600 dark:text-emerald-400',
  },
  fail: {
    label: 'Failed',
    valueClass: 'text-red-600 dark:text-red-400',
  },
  hold: {
    label: 'On Hold',
    valueClass: 'text-amber-600 dark:text-amber-400',
  },
}

function KpiCard({
  label,
  metric,
  unit,
  sub,
  icon: Icon,
  metricClass,
  className,
}: {
  label:        string
  metric:       React.ReactNode
  unit?:        string
  sub?:         string
  icon:         React.ElementType
  metricClass?: string
  className?:   string
}) {
  return (
    <div className={`flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3.5 pt-3 pb-3.5 transition-shadow duration-200 hover:shadow-md ${className ?? ''}`}>
      {/* Label — small muted header at top */}
      <div className="flex items-center gap-1 mb-2">
        <Icon size={10} className="shrink-0 text-gray-400 dark:text-gray-500" />
        <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 leading-none">
          {label}
        </span>
      </div>
      {/* Metric — primary element */}
      <p className={`text-lg font-semibold leading-none tabular-nums ${metricClass ?? 'text-gray-900 dark:text-white'}`}>
        {metric}
      </p>
      {/* Unit descriptor — ~30% smaller than metric, sits directly below */}
      {unit && (
        <p className="mt-1 text-sm font-normal text-gray-500 dark:text-gray-400 leading-none">
          {unit}
        </p>
      )}
      {/* Supporting description */}
      {sub && (
        <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500 leading-snug">{sub}</p>
      )}
    </div>
  )
}

export function JourneyMetrics({ order, qcResults, materials, sales, manufacturingEvents }: Props) {
  // Duration: fall back from started_at → created_at so it never shows "—" for completed batches
  const duration  = formatDuration(order.started_at ?? order.created_at, order.completed_at)
  const latestQc  = qcResults[0]
  const qcDisplay = latestQc ? QC_DISPLAY[latestQc.status] : null

  // Total events: prefer journey events; fall back to count of aggregated tracked data
  const totalEvents =
    manufacturingEvents.length > 0
      ? manufacturingEvents.length
      : qcResults.length + sales.length + materials.length

  const eventDates = manufacturingEvents
    .map(e => new Date(e.event_timestamp).getTime())
    .filter(t => !isNaN(t))
  const firstEvent = eventDates.length > 0 ? new Date(Math.min(...eventDates)) : null
  const lastEvent  = eventDates.length > 0 ? new Date(Math.max(...eventDates)) : null

  const dateRange =
    firstEvent && lastEvent && firstEvent.getTime() !== lastEvent.getTime()
      ? `${firstEvent.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${lastEvent.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : firstEvent
      ? firstEvent.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : undefined

  const totalShipped = sales.reduce((acc, s) => acc + s.quantity, 0)
  const withSupplier = materials.filter(m => m.supplier_name).length

  return (
    <div className="grid grid-cols-2 gap-2">
      {/* Total Events */}
      <KpiCard
        label="Total Events"
        metric={<CountUp to={totalEvents} />}
        unit={totalEvents === 1 ? 'Lifecycle Event' : 'Lifecycle Events'}
        sub={dateRange}
        icon={Activity}
      />

      {/* Production Duration */}
      <KpiCard
        label="Production Duration"
        metric={duration ?? (order.completed_at ? 'Recorded' : 'In progress')}
        sub={
          !order.completed_at
            ? 'Not yet completed'
            : qcResults.length > 1
            ? `${qcResults.length} QC checkpoints`
            : undefined
        }
        icon={Clock}
      />

      {/* QC Inspections */}
      <KpiCard
        label="QC Inspections"
        metric={qcResults.length > 0 ? <CountUp to={qcResults.length} /> : 'No QC'}
        unit={qcResults.length > 0 ? (qcResults.length !== 1 ? 'Inspections' : 'Inspection') : undefined}
        sub={qcDisplay ? qcDisplay.label : 'Pending inspection'}
        icon={ShieldCheck}
        metricClass={qcDisplay?.valueClass ?? 'text-gray-400 dark:text-gray-500'}
      />

      {/* Distribution */}
      <KpiCard
        label="Distribution"
        metric={sales.length > 0 ? <CountUp to={sales.length} /> : '—'}
        unit={sales.length > 0 ? (sales.length !== 1 ? 'Shipments' : 'Shipment') : undefined}
        sub={
          sales.length > 0
            ? `${totalShipped.toLocaleString()} units shipped`
            : 'No distribution recorded'
        }
        icon={Truck}
        metricClass={sales.length === 0 ? 'text-gray-400 dark:text-gray-500' : undefined}
      />

      {/* Materials Used — full-width bottom row */}
      <KpiCard
        className="col-span-2"
        label="Materials Used"
        metric={materials.length > 0 ? <CountUp to={materials.length} /> : '—'}
        unit={materials.length > 0 ? (materials.length !== 1 ? 'Materials' : 'Material') : undefined}
        sub={
          materials.length > 0
            ? `${withSupplier} with verified supplier data`
            : 'No raw materials recorded'
        }
        icon={Layers}
        metricClass={materials.length === 0 ? 'text-gray-400 dark:text-gray-500' : undefined}
      />
    </div>
  )
}
