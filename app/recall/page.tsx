import { AlertTriangle } from 'lucide-react'
import RecallClient from './RecallClient'

export default function RecallPage() {
  return (
    <div className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
            <AlertTriangle size={18} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Recall Dashboard</h1>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Search any lot number, batch ID, or SKU to trace affected batches, QC results, and downstream shipments.
        </p>
      </div>
      <RecallClient />
    </div>
  )
}
