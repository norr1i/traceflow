'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Sun, Moon, Menu, X, Languages } from 'lucide-react'
import { useT } from '../lib/i18n'
import { LogoIcon } from '../components/Logo'
import { LANDING_THEME_CSS, LP_THEME_KEY, getInitialLpTheme, type LpTheme } from './theme'
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

  // Toggle the stuck surface based on the overlay's scroll position.
  useEffect(() => {
    const root = document.getElementById('lp-root')
    if (!root) return
    const onScroll = () => setStuck(root.scrollTop > 8)
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
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
  const [theme, setTheme] = useState<LpTheme>(getInitialLpTheme)
  const mounted = useRef(false)

  // Persist the preview theme choice (landing-scoped key). Does not touch the
  // global `tf-theme` / `html.dark` used by the dashboard.
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

  const toggleTheme = useCallback(() => setTheme(v => (v === 'dark' ? 'light' : 'dark')), [])
  const toggleLang = useCallback(() => setLang(lang === 'ar' ? 'en' : 'ar'), [setLang, lang])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LANDING_THEME_CSS }} />
      <div id="lp-root" className="lp-root" data-tf-theme={theme} suppressHydrationWarning>
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
