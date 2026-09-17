'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Sun, Moon, Menu, X, Languages } from 'lucide-react'
import { useT } from '../lib/i18n'
import { LogoIcon } from '../components/Logo'
import { LANDING_THEME_CSS, LP_THEME_BOOTSTRAP, LP_THEME_KEY, getInitialLpTheme, type LpTheme } from './theme'
import {
  Hero, CapabilityStrip, ProblemOutcome, FlowShowcase, CoreCapabilities,
  PublicTraceShowcase, RecallReadiness, Roles, TrustSecurity, FinalCta,
} from './sections'

const NAV = [
  { href: '#platform', key: 'marketing.nav.platform' },
  { href: '#how-it-works', key: 'marketing.nav.how' },
  { href: '#capabilities', key: 'marketing.nav.capabilities' },
  { href: '#security', key: 'marketing.nav.security' },
] as const

function Wordmark() {
  return (
    <span dir="ltr" className="text-[15px] font-bold tracking-tight" style={{ color: 'var(--lp-text)' }}>
      <span className="font-medium" style={{ color: 'var(--lp-cyan)' }}>Trace</span>Flow
    </span>
  )
}

function Header({ theme, toggleTheme, toggleLang }: { theme: LpTheme; toggleTheme: () => void; toggleLang: () => void }) {
  const { t } = useT()
  const [stuck, setStuck] = useState(false)
  const [open, setOpen] = useState(false)

  // Toggle the stuck surface based on the document scroll position (normal page
  // flow — the window scrolls, not an overlay container). Threshold unchanged.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8)
    onScroll() // sync initial state (e.g. a hash deep-link that lands already scrolled)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Escape closes the mobile menu.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className="lp-header sticky top-0 z-50" data-stuck={stuck}>
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-3 px-5 sm:px-6 lg:px-8">
        <a href="#top" className="flex items-center gap-2.5" aria-label={t('marketing.nav.primary_label')}>
          <LogoIcon size="sm" />
          <Wordmark />
        </a>

        <nav aria-label={t('marketing.nav.primary_label')} className="ms-6 hidden items-center gap-0.5 lg:flex">
          {NAV.map(n => (
            <a key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors hover:bg-[var(--lp-alt)]" style={{ color: 'var(--lp-text-2)' }}>
              {t(n.key)}
            </a>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-1.5">
          {/* Theme + language: shown from sm up; below sm they live in the menu */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={t(theme === 'dark' ? 'marketing.controls.to_light' : 'marketing.controls.to_dark')}
            title={t(theme === 'dark' ? 'marketing.controls.to_light' : 'marketing.controls.to_dark')}
            className="hidden h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-[var(--lp-alt)] sm:flex"
            style={{ color: 'var(--lp-text)', border: '1px solid var(--lp-border)' }}
          >
            {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>

          <button
            type="button"
            onClick={toggleLang}
            aria-label={t('marketing.controls.lang_switch')}
            title={t('marketing.controls.lang_switch')}
            className="hidden h-9 items-center rounded-lg px-2.5 text-[13px] font-semibold transition-colors hover:bg-[var(--lp-alt)] sm:flex"
            style={{ color: 'var(--lp-text)', border: '1px solid var(--lp-border)' }}
          >
            {t('marketing.controls.lang_label')}
          </button>

          <Link href="/login" className="ms-1 hidden rounded-lg px-3 py-2 text-[13.5px] font-semibold transition-colors hover:bg-[var(--lp-alt)] lg:inline-flex" style={{ color: 'var(--lp-text)' }}>
            {t('marketing.nav.signin')}
          </Link>
          {/* One always-visible primary CTA; the LABEL swaps by breakpoint.
             The label spans are plain (non-.lp-btn) elements, so Tailwind's
             hidden/sm:inline control them reliably — this sidesteps the
             `.lp-btn { display: inline-flex }` rule (injected after Tailwind)
             that would override `hidden`/`sm:hidden` and show both variants. */}
          <a href="#platform" className="lp-btn lp-btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            <span className="sm:hidden">{t('marketing.nav.explore_short')}</span>
            <span className="hidden sm:inline">{t('marketing.nav.explore')}</span>
          </a>

          {/* Mobile menu button */}
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-controls="lp-mobile-menu"
            aria-label={t(open ? 'marketing.nav.close_menu' : 'marketing.nav.open_menu')}
            className="flex h-11 w-11 items-center justify-center rounded-lg lg:hidden"
            style={{ color: 'var(--lp-text)', border: '1px solid var(--lp-border)' }}
          >
            {open ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div id="lp-mobile-menu" className="border-t lg:hidden" style={{ borderColor: 'var(--lp-border)', background: 'var(--lp-card)' }}>
          <nav aria-label={t('marketing.nav.primary_label')} className="mx-auto flex w-full max-w-[1200px] flex-col gap-1 px-5 py-4 sm:px-6">
            {NAV.map(n => (
              <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-[15px] font-medium hover:bg-[var(--lp-alt)]" style={{ color: 'var(--lp-text)' }}>
                {t(n.key)}
              </a>
            ))}
            {/* Theme + language — only here below sm, where the header hides them */}
            <div className="sm:hidden">
              <div className="my-2 h-px" style={{ background: 'var(--lp-border)' }} />
              <button type="button" onClick={toggleTheme} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-[15px] font-medium hover:bg-[var(--lp-alt)]" style={{ color: 'var(--lp-text)' }}>
                {theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
                {t(theme === 'dark' ? 'marketing.controls.to_light' : 'marketing.controls.to_dark')}
              </button>
              <button type="button" onClick={toggleLang} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-[15px] font-medium hover:bg-[var(--lp-alt)]" style={{ color: 'var(--lp-text)' }}>
                <Languages size={17} aria-hidden="true" />
                {t('marketing.controls.lang_switch')}
              </button>
            </div>
            <div className="my-2 h-px" style={{ background: 'var(--lp-border)' }} />
            <Link href="/login" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-[15px] font-semibold hover:bg-[var(--lp-alt)]" style={{ color: 'var(--lp-text)' }}>
              {t('marketing.nav.signin')}
            </Link>
          </nav>
        </div>
      )}
    </header>
  )
}

function Footer() {
  const { t } = useT()
  const year = new Date().getFullYear()
  return (
    <footer style={{ background: 'var(--lp-alt)', borderTop: '1px solid var(--lp-border)' }}>
      <div className="mx-auto w-full max-w-[1200px] px-5 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <LogoIcon size="sm" />
              <Wordmark />
            </div>
            <p className="mt-3 max-w-sm text-[13.5px] leading-relaxed" style={{ color: 'var(--lp-muted)' }} dir="auto">{t('marketing.footer.desc')}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: 'var(--lp-tint)', color: 'var(--lp-primary)' }} dir="auto">
              {t('marketing.preview_badge')}
            </span>
          </div>
          <nav aria-label={t('marketing.footer.col_explore')}>
            <h3 className="text-[12px] font-bold uppercase tracking-wide" style={{ color: 'var(--lp-muted)' }} dir="auto">{t('marketing.footer.col_explore')}</h3>
            <ul className="mt-3 flex flex-col gap-2 text-[13.5px]">
              <li><a href="#platform" className="hover:underline" style={{ color: 'var(--lp-text)' }}>{t('marketing.footer.link_platform')}</a></li>
              <li><a href="#how-it-works" className="hover:underline" style={{ color: 'var(--lp-text)' }}>{t('marketing.footer.link_how')}</a></li>
              <li><a href="#capabilities" className="hover:underline" style={{ color: 'var(--lp-text)' }}>{t('marketing.footer.link_capabilities')}</a></li>
              <li><a href="#security" className="hover:underline" style={{ color: 'var(--lp-text)' }}>{t('marketing.footer.link_security')}</a></li>
            </ul>
          </nav>
          <nav aria-label={t('marketing.footer.col_account')}>
            <h3 className="text-[12px] font-bold uppercase tracking-wide" style={{ color: 'var(--lp-muted)' }} dir="auto">{t('marketing.footer.col_account')}</h3>
            <ul className="mt-3 flex flex-col gap-2 text-[13.5px]">
              <li><Link href="/login" className="hover:underline" style={{ color: 'var(--lp-text)' }}>{t('marketing.footer.link_signin')}</Link></li>
            </ul>
          </nav>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t pt-6 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--lp-border)' }}>
          <p className="text-[12.5px]" style={{ color: 'var(--lp-muted)' }} dir="auto">© {year} {t('marketing.footer.rights')}</p>
          <p className="text-[12.5px]" style={{ color: 'var(--lp-muted)' }} dir="auto">{t('marketing.footer.preview_note')}</p>
        </div>
      </div>
    </footer>
  )
}

export default function LandingPreviewClient() {
  const { setLang, lang } = useT()
  // Stable initial state = 'light' on BOTH the server and the client's first
  // (hydration) render, so theme-dependent descendant markup (Sun/Moon icon,
  // aria-label, title, menu label) is hydration-identical. The saved preference
  // is applied in the post-mount effect below; the inline LP_THEME_BOOTSTRAP has
  // already set data-tf-theme on .lp-root pre-paint, so colours never flash while
  // React state is momentarily 'light'.
  const [theme, setTheme] = useState<LpTheme>('light')
  const mounted = useRef(false)

  // Sync the saved / first-visit theme ONCE after hydration (not during render),
  // so React's first client render matches the server snapshot and there is no
  // descendant hydration mismatch. A no-op when the resolved value is 'light'.
  useEffect(() => {
    setTheme(getInitialLpTheme())
  }, [])

  // Persist the resolved theme to the single site key `tf-theme` (LP_THEME_KEY).
  // Sole writer of the key, so the toggle does not also write it (no duplicate).
  // The `mounted` guard skips the first run, so the stable hydration snapshot
  // 'light' is never written over a saved 'dark' before the sync effect resolves.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    try { localStorage.setItem(LP_THEME_KEY, theme) } catch { /* ignore */ }
  }, [theme])

  // Direct-URL hash load: this overlay mounts client-side (after auth), so the
  // browser's native on-load anchor scroll runs before the target exists. Do a
  // single native scrollIntoView once — it honours the anchor's scroll-margin-top
  // (no manual pixel math, no polling race).
  useEffect(() => {
    const hash = window.location.hash
    if (!hash || hash === '#top') return
    const el = document.getElementById(hash.slice(1))
    if (!el) return
    const raf = requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Flip the marketing theme AND the global `html.dark` together (immediate), so a
  // choice on / carries into auth/dashboard via client navigation with no reload.
  // `tf-theme` itself is written by the persistence effect above (single writer).
  const toggleTheme = useCallback(() => {
    const next: LpTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.classList.toggle('dark', next === 'dark')
  }, [theme])
  const toggleLang = useCallback(() => setLang(lang === 'ar' ? 'en' : 'ar'), [setLang, lang])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LANDING_THEME_CSS }} />
      <div id="lp-root" className="lp-root" data-tf-theme={theme} suppressHydrationWarning>
        {/* Pre-hydration theme bootstrap — sets data-tf-theme on this .lp-root before
            its visible content paints on SSR load, preventing a saved-dark flash.
            Inert on client re-render (theme state is already resolved). */}
        <script dangerouslySetInnerHTML={{ __html: LP_THEME_BOOTSTRAP }} />
        <span id="top" aria-hidden="true" />
        <Header theme={theme} toggleTheme={toggleTheme} toggleLang={toggleLang} />
        <main>
          <Hero />
          <CapabilityStrip />
          <ProblemOutcome />
          <FlowShowcase />
          <CoreCapabilities />
          <PublicTraceShowcase />
          <RecallReadiness />
          <Roles />
          <TrustSecurity />
          <FinalCta />
        </main>
        <Footer />
      </div>
    </>
  )
}
