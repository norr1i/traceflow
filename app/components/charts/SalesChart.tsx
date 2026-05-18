'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

type Sale = { id: string; sold_at: string; total_price: number; quantity: number }
type Props = { data: Sale[] }

export default function SalesChart({ data }: Props) {
  const chartData = [...data].reverse().map((s) => ({
    date: new Date(s.sold_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    revenue: s.total_price,
  }))

  if (chartData.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-gray-400 dark:text-gray-500">
        No sales data yet.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#4a8fb9" stopOpacity={0.22} />
            <stop offset="95%" stopColor="#4a8fb9" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:[stroke:#262E36]" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `SAR ${v.toLocaleString()}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#141e28',
            border: '1px solid rgba(179,183,186,0.12)',
            borderRadius: '12px',
            fontSize: '12px',
            color: '#D3D1CE',
            padding: '8px 12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
          labelStyle={{ color: '#6C6D74', marginBottom: 4, fontSize: 11 }}
          itemStyle={{ color: '#D3D1CE', fontSize: 12 }}
          formatter={(v: unknown) => [`SAR ${Number(v ?? 0).toLocaleString()}`, 'Revenue']}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#4a8fb9"
          strokeWidth={2.5}
          fill="url(#revenueGrad)"
          dot={false}
          activeDot={{ r: 4, fill: '#4a8fb9' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
