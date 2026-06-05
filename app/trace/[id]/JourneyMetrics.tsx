import { Activity, Clock, ShieldCheck, Truck } from 'lucide-react'

type Order = {
  started_at: string | null
  completed_at: string | null
}

type QcResult = {
  status: 'pass' | 'fail' | 'hold'
}

type Material = {
  material_name: string
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
  value,
  sub,
  icon: Icon,
  valueClass,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  valueClass?: string
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        <Icon size={11} className="shrink-0 text-gray-400 dark:text-gray-500" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {label}
        </span>
      </div>
      <p className={`text-base font-bold leading-tight ${valueClass ?? 'text-gray-900 dark:text-white'}`}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">{sub}</p>
      )}
    </div>
  )
}

export function JourneyMetrics({ order, qcResults, materials, sales, manufacturingEvents }: Props) {
  const duration = formatDuration(order.started_at, order.completed_at)
  const latestQc = qcResults[0]
  const qcDisplay = latestQc ? QC_DISPLAY[latestQc.status] : null

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

  return (
    <div className="grid grid-cols-2 gap-2">
      <KpiCard
        label="Total Events"
        value={manufacturingEvents.length > 0 ? String(manufacturingEvents.length) : '—'}
        sub={dateRange}
        icon={Activity}
      />
      <KpiCard
        label="Production Duration"
        value={duration ?? (order.started_at ? 'In progress' : '—')}
        sub={
          !order.completed_at && order.started_at
            ? 'Not yet completed'
            : qcResults.length > 1
            ? `${qcResults.length} QC checkpoints`
            : undefined
        }
        icon={Clock}
      />
      <KpiCard
        label="QC Status"
        value={qcDisplay ? qcDisplay.label : '—'}
        sub={
          qcResults.length > 0
            ? `${qcResults.length} inspection${qcResults.length !== 1 ? 's' : ''}`
            : 'No inspections recorded'
        }
        icon={ShieldCheck}
        valueClass={
          qcDisplay?.valueClass ??
          'text-gray-400 dark:text-gray-500'
        }
      />
      <KpiCard
        label="Distribution"
        value={sales.length > 0 ? `${sales.length} shipment${sales.length !== 1 ? 's' : ''}` : '—'}
        sub={
          materials.length > 0
            ? `${materials.length} material${materials.length !== 1 ? 's' : ''} used`
            : 'No shipments recorded'
        }
        icon={Truck}
        valueClass={sales.length === 0 ? 'text-gray-400 dark:text-gray-500' : undefined}
      />
    </div>
  )
}
