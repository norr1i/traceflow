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
            <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:[stroke:#334155]" />
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
          tickFormatter={(v: number) => `${v.toLocaleString()} ر.س`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#111827',
            border: '1px solid #374151',
            borderRadius: '10px',
            fontSize: '12px',
            color: '#f9fafb',
            padding: '8px 12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
          labelStyle={{ color: '#9ca3af', marginBottom: 4, fontSize: 11 }}
          itemStyle={{ color: '#f9fafb', fontSize: 12 }}
          formatter={(v: unknown) => [`${Number(v ?? 0).toLocaleString()} ر.س`, 'Revenue']}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#3b82f6"
          strokeWidth={2.5}
          fill="url(#revenueGrad)"
          dot={false}
          activeDot={{ r: 4, fill: '#3b82f6' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
