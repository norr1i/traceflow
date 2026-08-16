'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ShoppingCart } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth-context'
import { useT, fmtNum } from '../../lib/i18n'
import type { SaleRecord } from '../../hooks/useSales'
import StatusBadge from '../../components/StatusBadge'

// ── Design tokens ─────────────────────────────────────────────────────────────

const card  = 'rounded-xl border border-[#B3B7BA]/50 dark:border-[#B3B7BA]/[0.10] bg-[#E6E4E0] dark:bg-[#262E36]/38 shadow-sm'
const lbl   = 'mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500'

// ── Helper ────────────────────────────────────────────────────────────────────

function formatSaleNumber(id: string, soldAt: string): string {
  const year = new Date(soldAt).getFullYear()
  const hash = parseInt(id.replace(/-/g, '').slice(0, 8), 16) % 1_000_000
  return `SO-${year}-${String(hash).padStart(6, '0')}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SaleDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const { companyId, loading: authLoading } = useAuth()
  const { t, lang } = useT()

  const [sale,     setSale]     = useState<SaleRecord | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [notFound, setNotFound] = useState(false)

  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'

  function fmt(n: number) {
    return lang === 'ar'
      ? `${fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`
      : `${fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' })
  }

  useEffect(() => {
    if (authLoading) return
    if (!companyId) { setLoading(false); setNotFound(true); return }
    supabase
      .from('sales')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setNotFound(true)
        else setSale(data as SaleRecord)
        setLoading(false)
      })
  }, [id, companyId, authLoading])

  if (loading || authLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-4">
        <div className="h-5 w-32 skeleton rounded" />
        <div className="h-10 w-64 skeleton rounded-lg" />
        <div className="h-64 skeleton rounded-2xl" />
      </div>
    )
  }

  if (notFound || !sale) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
          <ShoppingCart size={40} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Sale not found</p>
          <button
            onClick={() => router.push('/sales')}
            className="mt-4 flex items-center gap-1.5 text-sm text-[#3a6f8f] hover:underline"
          >
            <ArrowLeft size={14} />
            {t('sales.title')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Back */}
      <button
        onClick={() => router.push('/sales')}
        className="mb-6 flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
      >
        <ArrowLeft size={15} />
        {t('sales.title')}
      </button>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-gray-400 dark:text-gray-500">
            {formatSaleNumber(sale.id, sale.sold_at)}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            {sale.product_name || '—'}
          </h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {sale.customer_name || t('sales.guest')}
          </p>
        </div>
        <StatusBadge status={sale.status} />
      </div>

      {/* Detail card */}
      <div className={`${card} p-6`}>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className={lbl}>{t('sales.product')}</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{sale.product_name || '—'}</p>
          </div>
          <div>
            <p className={lbl}>{t('sales.customer')}</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {sale.customer_name || <span className="italic text-gray-400">{t('sales.guest')}</span>}
            </p>
          </div>
          <div>
            <p className={lbl}>{t('sales.quantity')}</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{fmtNum(sale.quantity, lang)}</p>
          </div>
          <div>
            <p className={lbl}>{t('sales.unit_price')}</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {sale.unit_price != null ? fmt(sale.unit_price) : '—'}
            </p>
          </div>
          <div>
            <p className={lbl}>{t('sales.total')}</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{fmt(sale.total_price ?? 0)}</p>
          </div>
          <div>
            <p className={lbl}>{t('sales.date')}</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{fmtDate(sale.sold_at)}</p>
          </div>
          <div>
            <p className={lbl}>{t('common.status')}</p>
            <StatusBadge status={sale.status} />
          </div>
          {sale.product_id && (
            <div>
              <p className={lbl}>Product ID</p>
              <p className="font-mono text-xs text-gray-500 dark:text-gray-400 break-all">{sale.product_id}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
