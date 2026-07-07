'use client'

import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  QrCode, MapPin, Globe, ScanLine, Users, Clock, ShieldCheck, TrendingUp,
} from 'lucide-react'
import type { JourneyEvent } from './EnhancedTimeline'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScanRecord = {
  timestamp:    string
  browser:      string | null
  deviceType:   string | null
  userAgent:    string | null
  location?: {
    country?:     string
    city?:        string
    coordinates?: [number, number]
  }
  riskScore?:   number
  scanChannel?: string
  sessionId?:   string
}

// ── Data parsing ──────────────────────────────────────────────────────────────

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

// ── Demo scan generation ──────────────────────────────────────────────────────
// Produces deterministic realistic scan records for demo batches that have no
// real consumer scans yet. Timestamps span from distribution onwards to now so
// the trend chart always has visible data.

const DEMO_CITIES   = ['Riyadh', 'Jeddah', 'Dammam', 'Makkah', 'Al Khobar', 'Medina']
const DEMO_BROWSERS = ['Chrome', 'Safari', 'Edge', 'Firefox']
const DEMO_UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 Safari/605.1.15',
]

function seededFrac(seed: number, i: number): number {
  const x = Math.sin(seed + i * 127.1 + i * i * 0.31) * 43758.5453
  return x - Math.floor(x)
}

function generateDemoScans(orderId: string, afterIso: string): ScanRecord[] {
  const hex   = orderId.replace(/-/g, '')
  const seed  = parseInt(hex.slice(-8), 16)
  const start = new Date(afterIso).getTime() + 14 * 86_400_000 // 14 days after completion
  const count = 5 + (seed % 3) // 5–7 scans

  return Array.from({ length: count }, (_, i) => {
    const city    = DEMO_CITIES[Math.floor(seededFrac(seed + 1, i) * DEMO_CITIES.length)]
    const browser = DEMO_BROWSERS[Math.floor(seededFrac(seed + 2, i) * DEMO_BROWSERS.length)]
    const ua      = DEMO_UAS[Math.floor(seededFrac(seed + 3, i) * DEMO_UAS.length)]
    const mobile  = seededFrac(seed + 4, i) > 0.25

    // i === 0 is pinned 1–3 days ago so the 7-day chart always shows recent data
    let ts: number
    if (i === 0) {
      const daysAgo = 1 + Math.floor(seededFrac(seed, 88) * 3)
      ts = Date.now() - daysAgo * 86_400_000
    } else {
      // Remaining scans distributed over historical window (8+ days ago)
      const histEnd = Date.now() - 8 * 86_400_000
      const span    = Math.max(histEnd - start, 30 * 86_400_000)
      ts = start + Math.floor(seededFrac(seed, i) * span)
    }

    return {
      timestamp:  new Date(ts).toISOString(),
      browser,
      deviceType: mobile ? 'mobile' : 'desktop',
      userAgent:  ua,
      location:   { country: 'Saudi Arabia', city },
    }
  }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// ── Analytics helpers ─────────────────────────────────────────────────────────

function estimateUniqueConsumers(records: ScanRecord[]): number {
  const uas = new Set(records.map(r => r.userAgent).filter(Boolean))
  return uas.size > 0 ? uas.size : records.length
}

function repeatConsumerRate(records: ScanRecord[]): string {
  const uaCounts = new Map<string, number>()
  for (const r of records) {
    if (!r.userAgent) continue
    uaCounts.set(r.userAgent, (uaCounts.get(r.userAgent) ?? 0) + 1)
  }
  const unique = uaCounts.size
  if (unique < 2) return '—'
  const repeaters = [...uaCounts.values()].filter(c => c > 1).length
  return `${Math.round((repeaters / unique) * 100)}%`
}

function buildTrendData(records: ScanRecord[], days: 7 | 30) {
  const buckets = new Map<string, number>()
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    buckets.set(key, 0)
  }
  for (const r of records) {
    const key = r.timestamp.slice(0, 10)
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  return [...buckets.entries()].map(([date, scans]) => ({
    date,
    label: new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
    }),
    scans,
  }))
}

function countLocations(records: ScanRecord[]) {
  const countries = new Map<string, number>()
  const cities    = new Map<string, number>()
  for (const r of records) {
    if (r.location?.country) countries.set(r.location.country, (countries.get(r.location.country) ?? 0) + 1)
    if (r.location?.city)    cities.set(r.location.city,       (cities.get(r.location.city)       ?? 0) + 1)
  }
  return {
    countries: [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    cities:    [...cities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
  }
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, accent = 'default' }: {
  label:  string
  value:  string | number
  icon:   React.ElementType
  accent?: 'default' | 'green' | 'blue' | 'amber'
}) {
  const iconClass: Record<string, string> = {
    default: 'text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700/60',
    green:   'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20',
    blue:    'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
    amber:   'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
  }
  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/60 px-3.5 py-3.5">
      <div className={`flex h-6 w-6 items-center justify-center rounded-md ${iconClass[accent]}`}>
        <Icon size={12} />
      </div>
      <p className="text-base font-bold text-gray-900 dark:text-white leading-none tabular-nums">{value}</p>
      <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide leading-none">{label}</p>
    </div>
  )
}

// ── Scan trend chart ──────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  backgroundColor: '#0F1923',
  border:          '1px solid rgba(255,255,255,0.08)',
  borderRadius:    '10px',
  fontSize:        '12px',
  color:           '#D3D1CE',
  padding:         '8px 12px',
  boxShadow:       '0 8px 32px rgba(0,0,0,0.5)',
}

function ScanTrendChart({ records }: { records: ScanRecord[] }) {
  const [days, setDays] = useState<7 | 30>(7)
  const data    = buildTrendData(records, days)
  const hasData = data.some(d => d.scans > 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Scan Trend
        </p>
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {([7, 30] as const).map(w => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              className={`px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                days === w
                  ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                  : 'bg-white dark:bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/40'
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>
      {hasData ? (
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barSize={days === 7 ? 20 : 8}>
            <defs>
              <linearGradient id="caScanBar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#60a5fa" stopOpacity={0.85} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.28} />
              </linearGradient>
              <filter id="barGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(179,183,186,0.08)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: '#525563', fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              interval={days === 7 ? 0 : 4}
            />
            <YAxis
              tick={{ fill: '#525563', fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={24}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: '#6B7280', marginBottom: 4, fontSize: 10 }}
              itemStyle={{ color: '#D3D1CE', fontSize: 11 }}
              cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              formatter={(val) => [Number(val ?? 0), 'Scans'] as [number, string]}
            />
            <Bar dataKey="scans" fill="url(#caScanBar)" radius={[5, 5, 0, 0]} isAnimationActive animationDuration={500} style={{ filter: 'url(#barGlow)' }} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-[120px] items-center justify-center rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">No scans in the last {days} days</p>
        </div>
      )}
    </div>
  )
}

// ── Top locations ─────────────────────────────────────────────────────────────

function TopLocations({ records }: { records: ScanRecord[] }) {
  const { countries, cities } = countLocations(records)
  const total = records.length

  if (countries.length === 0 && cities.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-5 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
        <MapPin size={15} className="text-gray-300 dark:text-gray-600" />
        <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center leading-relaxed px-4">
          Location data unavailable.{' '}
          <span className="opacity-70">Enable geo-enrichment to unlock country &amp; city analytics.</span>
        </p>
      </div>
    )
  }

  function LocationList({ title, items, icon: Icon }: { title: string; items: [string, number][]; icon: React.ElementType }) {
    const max = items[0]?.[1] ?? 1
    return (
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{title}</p>
        <ul className="space-y-2">
          {items.map(([name, count]) => (
            <li key={name}>
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon size={10} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="text-[11px] text-gray-700 dark:text-gray-300 truncate">{name}</span>
                </div>
                <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 ml-2 tabular-nums">
                  {count} ({total > 0 ? Math.round((count / total) * 100) : 0}%)
                </span>
              </div>
              <div className="h-[5px] w-full rounded-full bg-gray-100 dark:bg-gray-700/80">
                <div
                  className="h-[5px] rounded-full transition-all duration-500"
                  style={{
                    width: `${max > 0 ? Math.round((count / max) * 100) : 0}%`,
                    background: 'linear-gradient(to right, #93c5fd, #3b82f6)',
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <LocationList title="Top Countries" items={countries} icon={Globe} />
      <LocationList title="Top Cities"    items={cities}    icon={MapPin} />
    </div>
  )
}

// ── Public export ─────────────────────────────────────────────────────────────

export function ConsumerActivity({
  events,
  orderId,
  completedAt,
}: {
  events:       JourneyEvent[]
  orderId?:     string
  completedAt?: string | null
}) {
  const realRecords = parseScanRecords(events)
  const isDemo      = realRecords.length === 0 && !!orderId && !!completedAt
  const records     = isDemo ? generateDemoScans(orderId!, completedAt!) : realRecords
  const total       = records.length

  if (total === 0) {
    return (
      <p className="text-sm text-gray-400 dark:text-gray-500 italic">
        No consumer scans recorded yet.
      </p>
    )
  }

  const firstScan  = records[total - 1]
  const lastScan   = records[0]
  const uniqueEst  = estimateUniqueConsumers(records)
  // Demo repeat rate: deterministic realistic value (15–45%) — sparse demo UAs would otherwise skew this
  const demoSeed   = isDemo ? parseInt(orderId!.replace(/-/g, '').slice(-8), 16) : 0
  const repeatRate = isDemo
    ? `${15 + Math.floor(seededFrac(demoSeed, 77) * 31)}%`
    : repeatConsumerRate(records)
  const daySpan    = Math.max(1, Math.round(
    (new Date(lastScan.timestamp).getTime() - new Date(firstScan.timestamp).getTime()) / 86_400_000,
  ))
  const velocity = total > 1 ? `${(total / daySpan).toFixed(1)}/day` : '—'

  return (
    <div className="space-y-5">

      {/* Demo indicator — unobtrusive muted badge */}
      {isDemo && (
        <span className="inline-flex items-center rounded-md border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-700/50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Sample Analytics
        </span>
      )}

      {/* KPI grid: 3×2 */}
      <div className="grid grid-cols-3 gap-2.5">
        <KpiCard label="Total Scans"   value={total}                        icon={ScanLine}    accent="blue"    />
        <KpiCard label="Est. Unique"   value={uniqueEst}                    icon={Users}       accent="default" />
        <KpiCard label="Repeat Rate"   value={repeatRate}                   icon={TrendingUp}  accent="amber"   />
        <KpiCard label="First Scan"    value={fmtDate(firstScan.timestamp)} icon={Clock}       accent="default" />
        <KpiCard label="Last Scan"     value={fmtDate(lastScan.timestamp)}  icon={QrCode}      accent="default" />
        <KpiCard label="Scan Velocity" value={velocity}                     icon={ShieldCheck} accent="green"   />
      </div>

      {/* Scan trend chart with 7d/30d toggle */}
      <ScanTrendChart records={records} />

      {/* Geographic breakdown */}
      <TopLocations records={records} />

    </div>
  )
}
