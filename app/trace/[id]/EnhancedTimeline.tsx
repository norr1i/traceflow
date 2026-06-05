import { classifyEvent } from './eventCategories'

export type JourneyEvent = {
  event_type: string
  event_timestamp: string
  title: string
  description: string | null
  source_table: string
  metadata: Record<string, unknown> | null
}

const SOURCE_LABELS: Record<string, string> = {
  production_orders:    'Production',
  bill_of_materials:    'Materials',
  batch_qc_results:     'QC Results',
  quality_inspections:  'QC Inspection',
  distribution_records: 'Distribution',
  batch_journey_events: 'Journey Log',
  raw_materials:        'Raw Materials',
}

function getSourceLabel(sourceTable: string): string {
  return SOURCE_LABELS[sourceTable] ?? sourceTable.replace(/_/g, ' ')
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function extractActor(event: JourneyEvent): string | null {
  const m = event.metadata
  if (!m) return null
  if (typeof m.inspector_name === 'string' && m.inspector_name) return m.inspector_name
  if (typeof m.performed_by   === 'string' && m.performed_by)   return m.performed_by
  if (typeof m.created_by     === 'string' && m.created_by)     return m.created_by
  if (typeof m.user_name      === 'string' && m.user_name)      return m.user_name
  if (typeof m.inspector_id   === 'string' && m.inspector_id)
    return `Inspector ···${m.inspector_id.slice(-6)}`
  if (typeof m.user_id        === 'string' && m.user_id)
    return `User ···${m.user_id.slice(-6)}`
  return null
}

function AttributionChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700/60 text-[10px] font-medium">
      <span className="text-gray-400 dark:text-gray-500">{label}</span>
      <span className="text-gray-600 dark:text-gray-300">{value}</span>
    </span>
  )
}

function EventCard({ event, isLast }: { event: JourneyEvent; isLast: boolean }) {
  const category = classifyEvent(event.event_type)
  const actor    = extractActor(event)
  const source   = getSourceLabel(event.source_table)
  const { Icon, iconBg, iconColor, badgeClass, label: categoryLabel } = category

  return (
    <div className="relative flex gap-3 group">

      {/* Left: icon + spine */}
      <div className="flex flex-col items-center shrink-0" style={{ width: 32 }}>
        <div
          className={`relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white dark:border-gray-900 shadow-sm ${iconBg} transition-transform duration-150 group-hover:scale-110`}
        >
          <Icon size={14} className={iconColor} />
        </div>
        {!isLast && (
          <div className="mt-1 w-0.5 flex-1 bg-gray-200 dark:bg-gray-700" style={{ minHeight: 16 }} />
        )}
      </div>

      {/* Right: card */}
      <div
        className={`min-w-0 flex-1 rounded-xl border border-gray-100 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 px-3.5 py-3 shadow-sm transition-all duration-150 group-hover:border-gray-200 dark:group-hover:border-gray-600 group-hover:shadow-md ${
          isLast ? 'mb-0.5' : 'mb-3'
        }`}
      >
        {/* Header: title + category badge */}
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">
            {event.title}
          </p>
          <span
            className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}
          >
            {categoryLabel}
          </span>
        </div>

        {/* Description */}
        {event.description && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {event.description}
          </p>
        )}

        {/* Timestamp */}
        <p className="mt-2 text-[10px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">
          {fmtDateTime(event.event_timestamp)}
        </p>

        {/* Attribution footer — every event shows all three fields */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <AttributionChip label="Actor" value={actor ?? 'System'} />
          <AttributionChip label="Source" value={source} />
          <AttributionChip label="Category" value={categoryLabel} />
        </div>
      </div>
    </div>
  )
}

function TimelineSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading timeline">
      {[55, 70, 45].map((w, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center shrink-0" style={{ width: 32 }}>
            <div className="mt-0.5 h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
            {i < 2 && (
              <div className="mt-1 w-0.5 flex-1 bg-gray-200 dark:bg-gray-700" style={{ minHeight: 40 }} />
            )}
          </div>
          <div
            className={`flex-1 rounded-xl border border-gray-100 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 px-3.5 py-3 shadow-sm ${i < 2 ? 'mb-3' : 'mb-0.5'} space-y-2`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="h-3.5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" style={{ width: `${w}%` }} />
              <div className="h-4 w-16 rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse shrink-0" />
            </div>
            <div className="h-2.5 w-4/5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="h-2 w-1/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="flex gap-1.5">
              {[30, 38, 36].map((bw, bi) => (
                <div key={bi} className="h-4 rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" style={{ width: `${bw}%` }} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function EnhancedTimeline({
  events,
  isLoading,
}: {
  events: JourneyEvent[]
  isLoading: boolean
}) {
  if (isLoading) return <TimelineSkeleton />

  if (events.length === 0) {
    return (
      <p className="text-sm text-gray-400 dark:text-gray-500 italic">
        No manufacturing events recorded for this batch.
      </p>
    )
  }

  return (
    <div className="pt-0.5">
      {events.map((event, i) => (
        <EventCard
          key={`${event.event_type}-${event.event_timestamp}-${i}`}
          event={event}
          isLast={i === events.length - 1}
        />
      ))}
    </div>
  )
}
