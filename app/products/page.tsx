'use client'
import { useT } from '../lib/i18n'
import ProductsClient from './ProductsClient'

export default function ProductsPage() {
  const { t } = useT()
  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('page_title./products')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('page_subtitle./products')}</p>
      </div>
      <ProductsClient />
    </div>
  )
}
