import { Suspense } from 'react'
import CapaDetailClient from './CapaDetailClient'

export const dynamic = 'force-dynamic'

export default function CapaDetailPage({ params }: { params: { id: string } }) {
  return (
    <Suspense>
      <CapaDetailClient id={params.id} />
    </Suspense>
  )
}
