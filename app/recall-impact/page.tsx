'use client'

import { ShieldAlert } from 'lucide-react'
import RecallImpactClient from './RecallImpactClient'

export default function RecallImpactPage() {
  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
            <ShieldAlert size={18} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Material Impact Analysis
          </h1>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Trace a raw material, lot, or production batch to every product, batch, and distributor it may have reached.
        </p>
      </div>
      <RecallImpactClient />
    </div>
  )
}
