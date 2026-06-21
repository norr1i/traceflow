import { Suspense } from 'react'
import RecallDetailClient from './RecallDetailClient'

export const dynamic = 'force-dynamic'

export default async function RecallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <Suspense>
      <RecallDetailClient id={id} />
    </Suspense>
  )
}
