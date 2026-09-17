import type { Metadata } from 'next'
import LandingPreviewClient from './landing-preview/LandingPreviewClient'

// Public production marketing homepage. Reuses the approved landing implementation
// (rendered in normal document flow — no preview overlay). Indexable: no
// noindex/nofollow. No dashboard code, no auth/session inspection, no redirect,
// no Supabase/database access.
export const metadata: Metadata = {
  title: 'TraceFlow | Manufacturing Traceability Platform',
  description:
    'Connect raw materials, production, quality, distribution, and recalls in one traceable operational record.',
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: 'TraceFlow | Manufacturing Traceability Platform',
    description:
      'Connect raw materials, production, quality, distribution, and recalls in one traceable operational record.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'TraceFlow | Manufacturing Traceability Platform',
    description:
      'Connect raw materials, production, quality, distribution, and recalls in one traceable operational record.',
  },
}

export default function HomePage() {
  return <LandingPreviewClient />
}
