import { QrCode, Monitor, Smartphone, Globe, Clock, ScanLine } from 'lucide-react'
import type { JourneyEvent } from './EnhancedTimeline'

// ── Extensible scan record type ─────────────────────────────────────────────
// Fields marked "future" are populated by an enrichment service when available.
// Extending this type does not require redesigning the component.
export type ScanRecord = {
  timestamp: string
  browser: string | null
  deviceType: string | null
  userAgent: string | null
  // Future: scan location (geo-IP or GPS)
  location?: {
    country?: string
    city?: string
    coordinates?: [number, number]
  }
  // Future: anti-counterfeit risk score (0–100, higher = more suspicious)
  riskScore?: number
  // Future: scan channel: qr_code | nfc | manual_entry | deep_link
  scanChannel?: string
  // Future: session fingerprint for repeat-scan detection
  sessionId?: string
}

function parseScanRecords(events: JourneyEvent[]): ScanRecord[] {
  return events
    .map(e => ({
      timestamp:  e.event_timestamp,
      browser:    typeof e.metadata?.browser     === 'string' ? e.metadata.browser     : null,
      deviceType: typeof e.metadata?.device_type === 'string' ? e.metadata.device_type : null,
      userAgent:  typeof e.metadata?.user_agent  === 'string' ? e.metadata.user_agent  : null,
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// ── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string | number
  icon: React.ElementType
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2.5">
      <Icon size={13} className="shrink-0 text-gray-400 dark:text-gray-500" />
      <div className="min-w-0">
        <p className="text-xs font-bold text-gray-900 dark:text-white leading-none truncate">{value}</p>
        <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">{label}</p>
      </div>
    </div>
  )
}

// ── Mini bar chart row ───────────────────────────────────────────────────────

function BreakdownRow({
  label,
  count,
  total,
  barColor,
  icon: Icon,
}: {
  label: string
  count: number
  total: number
  barColor: string
  icon: React.ElementType
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <Icon size={11} className="shrink-0 text-gray-400 dark:text-gray-500" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] text-gray-600 dark:text-gray-300 capitalize truncate">{label}</span>
          <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 shrink-0 ml-2 tabular-nums">
            {count}
          </span>
        </div>
        <div className="h-1 w-full rounded-full bg-gray-100 dark:bg-gray-700">
          <div
            className={`h-1 rounded-full ${barColor} transition-all duration-300`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Device + browser breakdown ───────────────────────────────────────────────

function DeviceBreakdown({ records }: { records: ScanRecord[] }) {
  const deviceCounts  = new Map<string, number>()
  const browserCounts = new Map<string, number>()

  for (const r of records) {
    const d = r.deviceType ?? 'Unknown'
    const b = r.browser    ?? 'Unknown'
    deviceCounts.set(d,  (deviceCounts.get(d)  ?? 0) + 1)
    browserCounts.set(b, (browserCounts.get(b) ?? 0) + 1)
  }

  const topDevices  = [...deviceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const topBrowsers = [...browserCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const total = records.length

  return (
    <div className="grid grid-cols-2 gap-4 pt-1">
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Devices
        </p>
        <div className="space-y-2">
          {topDevices.map(([device, count]) => (
            <BreakdownRow
              key={device}
              label={device}
              count={count}
              total={total}
              barColor="bg-blue-400"
              icon={device.toLowerCase().includes('mobile') ? Smartphone : Monitor}
            />
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Browsers
        </p>
        <div className="space-y-2">
          {topBrowsers.map(([browser, count]) => (
            <BreakdownRow
              key={browser}
              label={browser}
              count={count}
              total={total}
              barColor="bg-purple-400"
              icon={Globe}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Scan log table ───────────────────────────────────────────────────────────
// Investigation-grade: every scan with timestamp, browser, device, user agent.
// Designed to support future location and risk score columns without layout changes.

function ScanLog({ records }: { records: ScanRecord[] }) {
  const shown = records.slice(0, 10)

  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        Scan Log — {records.length} record{records.length !== 1 ? 's' : ''}
      </p>
      <div className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/40 border-b border-gray-100 dark:border-gray-700">
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Date / Time
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Browser
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Device
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
            {shown.map((r, i) => (
              <tr
                key={i}
                className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/20"
              >
                <td className="px-3 py-2 font-mono text-[10px] text-gray-600 dark:text-gray-300 tabular-nums whitespace-nowrap">
                  {fmtDateTime(r.timestamp)}
                </td>
                <td className="px-3 py-2 text-[10px] text-gray-600 dark:text-gray-300">
                  {r.browser ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                </td>
                <td className="px-3 py-2 text-[10px] text-gray-600 dark:text-gray-300 capitalize">
                  {r.deviceType ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {records.length > 10 && (
          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/40 border-t border-gray-100 dark:border-gray-700 text-center">
            <p className="text-[10px] text-gray-400 dark:text-gray-500">
              Showing 10 of {records.length} records
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Public export ────────────────────────────────────────────────────────────

export function ConsumerActivity({ events }: { events: JourneyEvent[] }) {
  const records = parseScanRecords(events)
  const total   = records.length

  if (total === 0) {
    return (
      <p className="text-sm text-gray-400 dark:text-gray-500 italic">
        No consumer scans recorded yet.
      </p>
    )
  }

  const firstScan = records[total - 1]
  const lastScan  = records[0]

  return (
    <div className="space-y-4">

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatPill label="Total Scans" value={total} icon={ScanLine} />
        <StatPill label="First Scan"  value={fmtDate(firstScan.timestamp)} icon={Clock} />
        <StatPill label="Last Scan"   value={fmtDate(lastScan.timestamp)}  icon={QrCode} />
      </div>

      {/* Device / browser breakdown — only meaningful with ≥2 scans */}
      {total >= 2 && <DeviceBreakdown records={records} />}

      {/* Full scan log */}
      <ScanLog records={records} />

      {/*
        Future extension points (rendered when data is available):
          - Location map / country breakdown (location field on ScanRecord)
          - Risk score heatmap (riskScore field on ScanRecord)
          - Duplicate scan detector (sessionId field on ScanRecord)
          - Scan channel breakdown (scanChannel field on ScanRecord)
      */}
    </div>
  )
}
