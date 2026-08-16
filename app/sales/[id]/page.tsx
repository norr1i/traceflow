import { Suspense } from 'react'
import SaleDetailClient from './SaleDetailClient'

export const dynamic = 'force-dynamic'

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <Suspense>
      <SaleDetailClient id={id} />
    </Suspense>
  )
}
