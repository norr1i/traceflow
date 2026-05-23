'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { QrCode } from 'lucide-react'

export type ScanTrendPoint = {
  date:          string
  label:         string
  scans:         number
  uniqueBatches: number
}

const TOOLTIP_STYLE = {
  backgroundColor: '#0F1923',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '10px',
  fontSize: '12px',
  color: '#D3D1CE',
  padding: '8px 12px',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
}

export default function ScanActivityChart({ data }: { data: ScanTrendPoint[] }) {
  const hasData = data.some(d => d.scans > 0)

  if (!hasData) {
    return (
      <div className="flex h-52 flex-col items-center justify-center gap-2 text-[#525563]">
        <QrCode size={24} strokeWidth={1.5} className="opacity-40" />
        <p className="text-sm">No QR scan activity in the last 7 days.</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={208}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }} barSize={18}>
        <defs>
          <linearGradient id="tfScanBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#4a8fb9" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#4a8fb9" stopOpacity={0.18} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke="rgba(179,183,186,0.08)" vertical={false} />

        <XAxis
          dataKey="label"
          tick={{ fill: '#525563', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: '#525563', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={28}
        />

        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: '#6B7280', marginBottom: 4, fontSize: 11 }}
          itemStyle={{ color: '#D3D1CE', fontSize: 12 }}
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          formatter={(val) => [Number(val ?? 0), 'Total scans'] as [number, string]}
        />

        <Bar dataKey="scans" name="scans" fill="url(#tfScanBar)"
          radius={[4, 4, 0, 0]} isAnimationActive animationDuration={600} />
      </BarChart>
    </ResponsiveContainer>
  )
}
