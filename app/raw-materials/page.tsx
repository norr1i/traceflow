'use client'
import { useT } from '../lib/i18n'
import RawMaterialsClient from './RawMaterialsClient'

export default function RawMaterialsPage() {
  const { t } = useT()
  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('page_title./raw-materials')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('page_subtitle./raw-materials')}</p>
      </div>
      <RawMaterialsClient />
    </div>
  )
}
