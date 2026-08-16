import { Suspense } from 'react'
import AllBatchesClient from './AllBatchesClient'

export const dynamic = 'force-dynamic'

export default function AllBatchesPage() {
  return (
    <Suspense>
      <AllBatchesClient />
    </Suspense>
  )
}
