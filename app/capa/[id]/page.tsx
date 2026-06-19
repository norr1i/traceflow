import { Suspense } from 'react'
import CapaDetailClient from './CapaDetailClient'

export const dynamic = 'force-dynamic'

export default async function CapaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <Suspense>
      <CapaDetailClient id={id} />
    </Suspense>
  )
}
