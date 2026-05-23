'use client'

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

// Semantic status colors — muted, readable on dark, never neon
const STATUS_COLOR: Record<string, string> = {
  completed:   '#2A7A52',  // muted green
  in_progress: '#2A6080',  // muted steel blue
  pending:     '#8A6318',  // muted amber
  hold:        '#8A6318',  // same amber — hold ≈ pending
  cancelled:   '#943030',  // muted crimson
}
const FALLBACK_COLOR = '#4A5568'

const TOOLTIP_STYLE = {
  backgroundColor: '#0F1923',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '10px',
  fontSize: '12px',
  color: '#D3D1CE',
  padding: '8px 12px',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
}

type Props = { data: Record<string, number> }

export default function ProductionChart({ data }: Props) {
  const chartData = Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({
      key,
      name: key.replace(/_/g, ' '),
      value,
      fill: STATUS_COLOR[key] ?? FALLBACK_COLOR,
    }))

  if (chartData.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-[#525563]">
        No production orders yet.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={88}
          paddingAngle={3}
          dataKey="value"
          strokeWidth={0}
        >
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: '#6B7280' }}
          itemStyle={{ color: '#D3D1CE' }}
          formatter={(value: unknown, name: unknown) => [Number(value ?? 0), String(name)]}
        />
        <Legend
          iconType="circle"
          iconSize={6}
          wrapperStyle={{ paddingTop: 8 }}
          formatter={(value) => (
            <span style={{ fontSize: 11, color: '#6B7280' }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
