import { Suspense } from 'react'
import CapaClient from './CapaClient'

export const dynamic = 'force-dynamic'

export default function CapaPage() {
  return (
    <Suspense>
      <CapaClient />
    </Suspense>
  )
}
