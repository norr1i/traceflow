import type { Metadata } from 'next'
import { Inter, IBM_Plex_Sans_Arabic } from 'next/font/google'
import './globals.css'
import Providers from './components/Providers'
import AppShell from './components/AppShell'

const inter = Inter({ subsets: ['latin'], display: 'swap' })
const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-arabic',
})

export const metadata: Metadata = {
  title: 'TraceFlow',
  description: 'Production & Quality Control SaaS',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Blocking script prevents dark-mode flash on load. Single source of truth
          is `tf-theme`; the legacy marketing key `tf-marketing-theme` is migrated
          once (only when `tf-theme` is unset) and then removed so the two keys can
          never disagree. First-visit default is light (no system-preference). */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('tf-theme');if(t!=='light'&&t!=='dark'){var m=localStorage.getItem('tf-marketing-theme');if(m==='light'||m==='dark'){t=m;localStorage.setItem('tf-theme',m);}else{t='light';}}localStorage.removeItem('tf-marketing-theme');document.documentElement.classList.toggle('dark',t==='dark')}catch(e){}try{const l=localStorage.getItem('tf-lang')||'en';document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr'}catch(e){}`,
          }}
        />
      </head>
      <body className={`${inter.className} ${ibmPlexArabic.variable} bg-[var(--bg)] text-[var(--text)]`}>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
