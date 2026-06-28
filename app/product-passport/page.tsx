import { Suspense } from 'react'
import ProductPassportClient from './ProductPassportClient'

export const dynamic = 'force-dynamic'

export default function ProductPassportPage() {
  return (
    <Suspense>
      <ProductPassportClient />
    </Suspense>
  )
}
