'use client'

import { useState, useEffect } from 'react'
import { Activity, Clock, ShieldCheck, Truck, Layers } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { traceDateLocale } from './eventCategories'

type TFn = (key: string, vars?: Record<string, string | number>) => string

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

// Honest span between the first and last recorded lifecycle events (not a
// production start→complete duration). Natural, pluralized localized units.
function formatSpan(startIso: string | null, endIso: string | null, t: TFn): string | null {
  if (!startIso || !endIso) return null
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (isNaN(ms) || ms <= 0) return null
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes < 60) return t(totalMinutes !== 1 ? 'trace.metrics.dur_minutes_other' : 'trace.metrics.dur_minutes_one', { n: totalMinutes })
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) return t(totalHours !== 1 ? 'trace.metrics.dur_hours_other' : 'trace.metrics.dur_hours_one', { n: totalHours })
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  return hours > 0
    ? t('trace.metrics.dur_days_hours', { d: days, h: hours })
    : t(days !== 1 ? 'trace.metrics.dur_days_other' : 'trace.metrics.dur_days_one', { n: days })
}

const QC_VALUE_CLASS: Record<string, string> = {
  pass:    'text-emerald-600 dark:text-emerald-400',
  fail:    'text-red-600 dark:text-red-400',
  hold:    'text-amber-600 dark:text-amber-400',
  pending: 'text-gray-400 dark:text-gray-500',
}
const QC_LABEL_KEY: Record<string, string> = { pass: 'passed', fail: 'failed', hold: 'on_hold', pending: 'pending' }

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
        <Icon size={10} className="shrink-0 text-gray-500 dark:text-gray-400" />
        <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400 leading-none">
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
        <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400 leading-snug">{sub}</p>
      )}
    </div>
  )
}

export function JourneyMetrics({ completedAt, qc, materials, distributionCount, timeline }: Props) {
  const { t, lang } = useT()

  const eventDates = timeline
    .map(e => new Date(e.event_timestamp).getTime())
    .filter(t => !isNaN(t))

  const firstMs = eventDates.length > 0 ? Math.min(...eventDates) : null
  const lastMs  = eventDates.length > 0 ? Math.max(...eventDates) : null

  const span = firstMs && lastMs && firstMs !== lastMs
    ? formatSpan(
        new Date(firstMs).toISOString(),
        completedAt ?? new Date(lastMs).toISOString(),
        t,
      )
    : null

  const firstEvent = firstMs ? new Date(firstMs) : null
  const lastEvent  = lastMs  ? new Date(lastMs)  : null

  const loc = traceDateLocale(lang)
  const dateRange =
    firstEvent && lastEvent && firstEvent.getTime() !== lastEvent.getTime()
      ? `${firstEvent.toLocaleDateString(loc, { month: 'short', day: 'numeric' })} – ${lastEvent.toLocaleDateString(loc, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : firstEvent
      ? firstEvent.toLocaleDateString(loc, { month: 'short', day: 'numeric', year: 'numeric' })
      : undefined

  const valueClass = QC_VALUE_CLASS[qc.overall_result] ?? 'text-gray-400 dark:text-gray-500'
  const qcLabelKey = QC_LABEL_KEY[qc.overall_result]

  return (
    <div className="grid grid-cols-2 gap-2">
      {/* Total Events */}
      <KpiCard
        label={t('trace.metrics.total_events')}
        metric={<CountUp to={timeline.length} />}
        unit={t(timeline.length === 1 ? 'trace.metrics.lifecycle_one' : 'trace.metrics.lifecycle_other')}
        sub={dateRange}
        icon={Activity}
      />

      {/* Recorded timeline span (honest: first→last recorded event, not production duration) */}
      <KpiCard
        label={t('trace.metrics.production_duration')}
        metric={span ?? t('trace.metrics.span_unavailable')}
        sub={
          !completedAt
            ? t('trace.metrics.not_yet_completed')
            : qc.inspection_count > 1
            ? t('trace.metrics.qc_checkpoints', { n: qc.inspection_count })
            : undefined
        }
        icon={Clock}
      />

      {/* QC Inspections */}
      <KpiCard
        label={t('trace.metrics.qc_inspections')}
        metric={qc.inspection_count > 0 ? <CountUp to={qc.inspection_count} /> : t('trace.metrics.no_qc')}
        unit={
          qc.inspection_count > 0
            ? t(qc.inspection_count !== 1 ? 'trace.metrics.inspection_other' : 'trace.metrics.inspection_one')
            : undefined
        }
        sub={qcLabelKey ? t('trace.metrics.' + qcLabelKey) : t('trace.metrics.pending_inspection')}
        icon={ShieldCheck}
        metricClass={valueClass}
      />

      {/* Distribution */}
      <KpiCard
        label={t('trace.metrics.distribution')}
        metric={distributionCount > 0 ? <CountUp to={distributionCount} /> : '—'}
        unit={
          distributionCount > 0
            ? t(distributionCount !== 1 ? 'trace.metrics.shipment_other' : 'trace.metrics.shipment_one')
            : undefined
        }
        sub={distributionCount > 0 ? t('trace.metrics.distributed_partners') : t('trace.metrics.no_distribution_recorded')}
        icon={Truck}
        metricClass={distributionCount === 0 ? 'text-gray-400 dark:text-gray-500' : undefined}
      />

      {/* Materials Used — full-width bottom row */}
      <KpiCard
        className="col-span-2"
        label={t('trace.metrics.materials_used')}
        metric={materials.length > 0 ? <CountUp to={materials.length} /> : '—'}
        unit={
          materials.length > 0
            ? t(materials.length !== 1 ? 'trace.metrics.material_other' : 'trace.metrics.material_one')
            : undefined
        }
        sub={
          materials.length > 0
            ? t(materials.length !== 1 ? 'trace.metrics.materials_traced_other' : 'trace.metrics.materials_traced_one', { n: materials.length })
            : t('trace.metrics.no_materials_recorded')
        }
        icon={Layers}
        metricClass={materials.length === 0 ? 'text-gray-400 dark:text-gray-500' : undefined}
      />
    </div>
  )
}
