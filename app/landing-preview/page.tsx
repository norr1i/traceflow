import type { Metadata } from 'next'
import LandingPreviewClient from './LandingPreviewClient'

// Isolated marketing concept. Explicitly excluded from indexing so an accidental
// preview deployment is never treated as the production marketing homepage.
export const metadata: Metadata = {
  title: 'TraceFlow — Landing Preview',
  description: 'Internal marketing concept preview for TraceFlow. Not for indexing.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
}

export default function LandingPreviewPage() {
  return <LandingPreviewClient />
}
