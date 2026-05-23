'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { useT } from '../../lib/i18n'

type Sale = { id: string; sold_at: string; total_price: number; quantity: number }
type Props = { data: Sale[] }

const TOOLTIP_STYLE = {
  backgroundColor: '#0F1923',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '10px',
  fontSize: '12px',
  color: '#D3D1CE',
  padding: '8px 12px',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
}

export default function SalesChart({ data }: Props) {
  const { t, lang } = useT()
  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'

  const chartData = [...data].reverse().map((s) => ({
    date: new Date(s.sold_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
    revenue: s.total_price,
  }))

  if (chartData.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-[#525563]">
        {t('chart.no_sales')}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#4a8fb9" stopOpacity={0.10} />
            <stop offset="95%" stopColor="#4a8fb9" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(179,183,186,0.08)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#525563' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#525563' }}
          axisLine={false}
          tickLine={false}
          width={60}
          tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: '#6B7280', marginBottom: 4, fontSize: 11 }}
          itemStyle={{ color: '#D3D1CE', fontSize: 12 }}
          formatter={(v: unknown) => [
            `${Number(v ?? 0).toLocaleString(locale)} ${lang === 'ar' ? 'ر.س' : 'SAR'}`,
            t('chart.revenue'),
          ]}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#4a8fb9"
          strokeWidth={1.5}
          fill="url(#revenueGrad)"
          dot={false}
          activeDot={{ r: 4, fill: '#4a8fb9', strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
