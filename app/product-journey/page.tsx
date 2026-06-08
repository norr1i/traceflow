import { Suspense } from 'react'
import ProductJourneyClient from './ProductJourneyClient'

export const dynamic = 'force-dynamic'

export default function ProductJourneyPage() {
  return (
    <Suspense>
      <ProductJourneyClient />
    </Suspense>
  )
}
