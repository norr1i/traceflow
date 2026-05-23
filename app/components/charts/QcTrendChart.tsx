'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { FlaskConical } from 'lucide-react'

export type QcTrendPoint = {
  date:  string
  label: string
  pass:  number
  fail:  number
  hold:  number
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

export default function QcTrendChart({ data }: { data: QcTrendPoint[] }) {
  const hasData = data.some(d => d.pass + d.fail + d.hold > 0)

  if (!hasData) {
    return (
      <div className="flex h-52 flex-col items-center justify-center gap-2 text-[#525563]">
        <FlaskConical size={24} strokeWidth={1.5} className="opacity-40" />
        <p className="text-sm">No QC inspections in the last 7 days.</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={208}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id="tfQcPass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#10b981" stopOpacity={0.10} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="tfQcFail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.10} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="tfQcHold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#f59e0b" stopOpacity={0.10} />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
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
        />
        <Legend
          iconType="circle"
          iconSize={6}
          wrapperStyle={{ paddingTop: 8 }}
          formatter={(v) => <span style={{ fontSize: 11, color: '#6B7280' }}>{v}</span>}
        />

        <Area type="monotone" dataKey="pass" name="Pass" stroke="#10b981" strokeWidth={1.5}
          fill="url(#tfQcPass)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#10b981' }}
          isAnimationActive animationDuration={600} />
        <Area type="monotone" dataKey="fail" name="Fail" stroke="#ef4444" strokeWidth={1.5}
          fill="url(#tfQcFail)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#ef4444' }}
          isAnimationActive animationDuration={600} animationBegin={100} />
        <Area type="monotone" dataKey="hold" name="Hold" stroke="#f59e0b" strokeWidth={1.5}
          fill="url(#tfQcHold)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#f59e0b' }}
          isAnimationActive animationDuration={600} animationBegin={200} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
