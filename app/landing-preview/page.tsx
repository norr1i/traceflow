import { permanentRedirect } from 'next/navigation'

// The approved marketing landing now lives at the public root `/`. This former
// preview route permanently redirects there to avoid duplicate indexed content.
// The shared implementation files in this folder (LandingPreviewClient, sections,
// visuals, theme) are still imported by the root page — only this entry redirects.
export default function LandingPreviewPage() {
  permanentRedirect('/')
}
