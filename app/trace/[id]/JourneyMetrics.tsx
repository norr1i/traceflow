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

type PublicQc = {
  overall_result:   'pass' | 'fail' | 'hold' | 'pending'
  inspection_count: number
}

type PublicMaterial = {
  material_name: string
}

type PublicTimelineEvent = {
  event_type:      string
  event_timestamp: string
}

type Props = {
  completedAt:       string | null
  qc:                PublicQc
  materials:         PublicMaterial[]
  distributionCount: number
  timeline:          PublicTimelineEvent[]
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
  pass:    { label: 'Passed',  valueClass: 'text-emerald-600 dark:text-emerald-400' },
  fail:    { label: 'Failed',  valueClass: 'text-red-600 dark:text-red-400' },
  hold:    { label: 'On Hold', valueClass: 'text-amber-600 dark:text-amber-400' },
  pending: { label: 'Pending', valueClass: 'text-gray-400 dark:text-gray-500' },
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
      <div className="flex items-center gap-1 mb-2">
        <Icon size={10} className="shrink-0 text-gray-400 dark:text-gray-500" />
        <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 leading-none">
          {label}
        </span>
      </div>
      <p className={`text-lg font-semibold leading-none tabular-nums ${metricClass ?? 'text-gray-900 dark:text-white'}`}>
        {metric}
      </p>
      {unit && (
        <p className="mt-1 text-sm font-normal text-gray-500 dark:text-gray-400 leading-none">
          {unit}
        </p>
      )}
      {sub && (
        <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500 leading-snug">{sub}</p>
      )}
    </div>
  )
}

export function JourneyMetrics({ completedAt, qc, materials, distributionCount, timeline }: Props) {
  const eventDates = timeline
    .map(e => new Date(e.event_timestamp).getTime())
    .filter(t => !isNaN(t))

  const firstMs = eventDates.length > 0 ? Math.min(...eventDates) : null
  const lastMs  = eventDates.length > 0 ? Math.max(...eventDates) : null

  const duration = firstMs && lastMs && firstMs !== lastMs
    ? formatDuration(
        new Date(firstMs).toISOString(),
        completedAt ?? new Date(lastMs).toISOString(),
      )
    : null

  const firstEvent = firstMs ? new Date(firstMs) : null
  const lastEvent  = lastMs  ? new Date(lastMs)  : null

  const dateRange =
    firstEvent && lastEvent && firstEvent.getTime() !== lastEvent.getTime()
      ? `${firstEvent.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${lastEvent.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : firstEvent
      ? firstEvent.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : undefined

  const qcDisplay = QC_DISPLAY[qc.overall_result] ?? null

  return (
    <div className="grid grid-cols-2 gap-2">
      {/* Total Events */}
      <KpiCard
        label="Total Events"
        metric={<CountUp to={timeline.length} />}
        unit={timeline.length === 1 ? 'Lifecycle Event' : 'Lifecycle Events'}
        sub={dateRange}
        icon={Activity}
      />

      {/* Production Duration */}
      <KpiCard
        label="Production Duration"
        metric={duration ?? (completedAt ? 'Recorded' : 'In progress')}
        sub={
          !completedAt
            ? 'Not yet completed'
            : qc.inspection_count > 1
            ? `${qc.inspection_count} QC checkpoints`
            : undefined
        }
        icon={Clock}
      />

      {/* QC Inspections */}
      <KpiCard
        label="QC Inspections"
        metric={qc.inspection_count > 0 ? <CountUp to={qc.inspection_count} /> : 'No QC'}
        unit={
          qc.inspection_count > 0
            ? qc.inspection_count !== 1 ? 'Inspections' : 'Inspection'
            : undefined
        }
        sub={qcDisplay ? qcDisplay.label : 'Pending inspection'}
        icon={ShieldCheck}
        metricClass={qcDisplay?.valueClass ?? 'text-gray-400 dark:text-gray-500'}
      />

      {/* Distribution */}
      <KpiCard
        label="Distribution"
        metric={distributionCount > 0 ? <CountUp to={distributionCount} /> : '—'}
        unit={
          distributionCount > 0
            ? distributionCount !== 1 ? 'Shipments' : 'Shipment'
            : undefined
        }
        sub={distributionCount > 0 ? 'Distributed through partners' : 'No distribution recorded'}
        icon={Truck}
        metricClass={distributionCount === 0 ? 'text-gray-400 dark:text-gray-500' : undefined}
      />

      {/* Materials Used — full-width bottom row */}
      <KpiCard
        className="col-span-2"
        label="Materials Used"
        metric={materials.length > 0 ? <CountUp to={materials.length} /> : '—'}
        unit={
          materials.length > 0
            ? materials.length !== 1 ? 'Materials' : 'Material'
            : undefined
        }
        sub={
          materials.length > 0
            ? `${materials.length} raw material${materials.length !== 1 ? 's' : ''} traced`
            : 'No raw materials recorded'
        }
        icon={Layers}
        metricClass={materials.length === 0 ? 'text-gray-400 dark:text-gray-500' : undefined}
      />
    </div>
  )
}
