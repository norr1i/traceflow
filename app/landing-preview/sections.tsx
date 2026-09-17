'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import {
  Package, Factory, FlaskConical, QrCode, Truck, ShieldAlert, Route, Layers,
  ClipboardCheck, Lock, ShieldCheck, Activity, Eye, Languages, Building2,
  ArrowRight, CheckCircle2, Boxes, GitBranch, type LucideIcon,
} from 'lucide-react'
import { useT } from '../lib/i18n'
import { HeroCommandView, TracePhone, RecallGraph, CapabilityGlyph, type GlyphKind } from './visuals'

// ── Shared layout primitives ──────────────────────────────────────────────────

type Surface = 'base' | 'alt' | 'feature'

function Section({ id, surface = 'base', className = '', children }: { id?: string; surface?: Surface; className?: string; children: React.ReactNode }) {
  const bg = surface === 'alt' ? 'var(--lp-alt)' : surface === 'feature' ? 'var(--lp-feature)' : 'var(--lp-bg)'
  const pad = surface === 'feature' ? 'py-16 sm:py-22' : 'py-14 sm:py-20'
  return (
    <section
      className={className}
      style={{ background: bg, ...(surface !== 'base' ? { borderBlock: '1px solid var(--lp-border)' } : {}) }}
    >
      <div className={`mx-auto w-full max-w-[1200px] px-5 sm:px-6 lg:px-8 ${pad}`}>
        {id && <span id={id} className="lp-anchor" aria-hidden="true" />}
        {children}
      </div>
    </section>
  )
}

function Eyebrow({ icon: Icon, tone = 'primary', children }: { icon?: LucideIcon; tone?: 'primary' | 'amber' | 'cyan' | 'emerald'; children: React.ReactNode }) {
  const { lang } = useT()
  const color = { primary: 'var(--lp-primary)', amber: 'var(--lp-amber)', cyan: 'var(--lp-cyan)', emerald: 'var(--lp-emerald)' }[tone]
  return (
    <span
      className={`inline-flex items-center gap-2 text-[12.5px] font-semibold ${lang === 'ar' ? '' : 'uppercase tracking-[0.12em]'}`}
      style={{ color }}
    >
      {Icon && <Icon size={14} aria-hidden="true" />}
      {children}
    </span>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-3 text-3xl font-bold leading-[1.18] tracking-tight sm:text-4xl" dir="auto">{children}</h2>
}

function Sub({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 max-w-2xl text-base leading-relaxed sm:text-[17px]" style={{ color: 'var(--lp-text-2)' }} dir="auto">{children}</p>
}

// Neutral tile behind an icon — the icon carries the (semantic) colour, the tile
// stays neutral so blue does not wash across every section.
function IconTile({ icon: Icon, tone = 'blue' }: { icon: LucideIcon; tone?: 'blue' | 'emerald' | 'amber' | 'cyan' }) {
  const v = { blue: 'var(--lp-primary)', emerald: 'var(--lp-emerald)', amber: 'var(--lp-amber)', cyan: 'var(--lp-cyan)' }[tone]
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--lp-icon-bg)', border: '1px solid var(--lp-icon-border)' }}>
      <Icon size={20} style={{ color: v }} aria-hidden="true" />
    </span>
  )
}

// ── Hero ──────────────────────────────────────────────────────────────────────

export function Hero() {
  const { t } = useT()
  return (
    <section className="relative overflow-hidden" style={{ background: 'var(--lp-bg)' }}>
      <div className="lp-grid-bg lp-hero-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
      <div className="relative mx-auto grid w-full max-w-[1200px] items-center gap-12 px-5 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:px-8">
        <div className="lp-fade-up">
          <Eyebrow icon={Route}>{t('marketing.hero.eyebrow')}</Eyebrow>
          <h1 className="mt-4 text-[2.35rem] font-extrabold leading-[1.08] tracking-tight sm:text-5xl" dir="auto">
            {t('marketing.hero.headline')}
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed sm:text-lg" style={{ color: 'var(--lp-text-2)' }} dir="auto">
            {t('marketing.hero.sub')}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="#platform" className="lp-btn lp-btn-primary">
              {t('marketing.hero.cta_primary')}
              <ArrowRight size={17} className="rtl:-scale-x-100" aria-hidden="true" />
            </a>
            <Link href="/login" className="lp-btn lp-btn-secondary">{t('marketing.hero.cta_secondary')}</Link>
          </div>
        </div>
        <div className="lp-fade-up" style={{ animationDelay: '80ms' }}>
          <HeroCommandView />
          <p className="mt-3 flex items-center justify-center gap-2 text-center text-[12px]" style={{ color: 'var(--lp-muted)' }} dir="auto">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--lp-cyan)' }} aria-hidden="true" />
            {t('marketing.hero.visual_caption')}
          </p>
        </div>
      </div>
    </section>
  )
}

// ── Capability strip ──────────────────────────────────────────────────────────

export function CapabilityStrip() {
  const { t } = useT()
  const items: { icon: LucideIcon; label: string }[] = [
    { icon: GitBranch, label: t('marketing.strip.batch') },
    { icon: Package, label: t('marketing.strip.lots') },
    { icon: FlaskConical, label: t('marketing.strip.qc') },
    { icon: QrCode, label: t('marketing.strip.qr') },
    { icon: ShieldAlert, label: t('marketing.strip.recall') },
    { icon: ClipboardCheck, label: t('marketing.strip.capa') },
  ]
  return (
    <section aria-label={t('marketing.strip.title')} style={{ background: 'var(--lp-alt)', borderBlock: '1px solid var(--lp-border)' }}>
      <div className="mx-auto w-full max-w-[1200px] px-5 py-7 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          {items.map((it, i) => {
            const Icon = it.icon
            return (
              <div key={i} className="flex items-center gap-2.5">
                <Icon size={18} style={{ color: 'var(--lp-primary)' }} aria-hidden="true" />
                <span className="text-[13px] font-semibold leading-tight" dir="auto">{it.label}</span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ── Problem → outcome (#how-it-works) ─────────────────────────────────────────

export function ProblemOutcome() {
  const { t } = useT()
  const tones = { amber: 'var(--lp-amber)', blue: 'var(--lp-primary)', emerald: 'var(--lp-emerald)' }
  const cards: { tag: string; title: string; body: string; icon: LucideIcon; tone: keyof typeof tones; iconTone: 'amber' | 'blue' | 'emerald' }[] = [
    { tag: t('marketing.problem.before_tag'), title: t('marketing.problem.before_title'), body: t('marketing.problem.before_body'), icon: Layers, tone: 'amber', iconTone: 'amber' },
    { tag: t('marketing.problem.during_tag'), title: t('marketing.problem.during_title'), body: t('marketing.problem.during_body'), icon: Route, tone: 'blue', iconTone: 'blue' },
    { tag: t('marketing.problem.after_tag'), title: t('marketing.problem.after_title'), body: t('marketing.problem.after_body'), icon: Activity, tone: 'emerald', iconTone: 'emerald' },
  ]
  return (
    <Section id="how-it-works">
      <Heading>{t('marketing.problem.heading')}</Heading>
      <Sub>{t('marketing.problem.body')}</Sub>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {cards.map((c, i) => {
          const Icon = c.icon
          return (
            <div key={i} className="lp-card flex h-full flex-col p-6">
              <span className="mb-5 block h-1 w-10 rounded-full" style={{ background: tones[c.tone] }} aria-hidden="true" />
              <div className="flex items-center gap-3">
                <IconTile icon={Icon} tone={c.iconTone} />
                <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: tones[c.tone] }} dir="auto">{c.tag}</span>
              </div>
              <h3 className="mt-4 text-lg font-bold" dir="auto">{c.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--lp-text-2)' }} dir="auto">{c.body}</p>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ── Product-flow storytelling (#platform) — interactive tablist ───────────────

const STAGES: { icon: LucideIcon; tone: 'blue' | 'emerald' | 'amber' | 'cyan'; glyph: GlyphKind }[] = [
  { icon: Package, tone: 'blue', glyph: 'lot' },
  { icon: Factory, tone: 'blue', glyph: 'capa' },
  { icon: FlaskConical, tone: 'emerald', glyph: 'qc' },
  { icon: QrCode, tone: 'cyan', glyph: 'qr' },
  { icon: Truck, tone: 'blue', glyph: 'timeline' },
  { icon: ShieldAlert, tone: 'amber', glyph: 'recall' },
]

export function FlowShowcase() {
  const { t, dir } = useT()
  const [active, setActive] = useState(0)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const names = [1, 2, 3, 4, 5, 6].map(n => t(`marketing.flow.s${n}_name`))
  const descs = [1, 2, 3, 4, 5, 6].map(n => t(`marketing.flow.s${n}_desc`))
  const toneVar = { blue: 'var(--lp-primary)', emerald: 'var(--lp-emerald)', amber: 'var(--lp-amber)', cyan: 'var(--lp-cyan)' }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const fwd = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
    let next = active
    if (e.key === fwd || e.key === 'ArrowDown') next = (active + 1) % 6
    else if (e.key === back || e.key === 'ArrowUp') next = (active - 1 + 6) % 6
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = 5
    else return
    e.preventDefault()
    setActive(next)
    tabRefs.current[next]?.focus()
  }

  const ActiveIcon = STAGES[active].icon
  const accent = toneVar[STAGES[active].tone]
  // Inline-start accent for the selected tab as an inset shadow (no layout shift);
  // flipped for RTL so it always sits on the start edge.
  const selInset = dir === 'rtl' ? 'inset -3px 0 0 0' : 'inset 3px 0 0 0'

  return (
    <Section id="platform" surface="alt">
      <Eyebrow icon={Route}>{t('marketing.nav.platform')}</Eyebrow>
      <Heading>{t('marketing.flow.heading')}</Heading>
      <Sub>{t('marketing.flow.sub')}</Sub>

      <div className="mt-10 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        {/* Tabs */}
        <div role="tablist" aria-label={t('marketing.flow.step_label')} aria-orientation="vertical" onKeyDown={onKeyDown} className="flex flex-col gap-2">
          {names.map((name, i) => {
            const Icon = STAGES[i].icon
            const selected = i === active
            return (
              <button
                key={i}
                ref={el => { tabRefs.current[i] = el }}
                role="tab"
                id={`lp-tab-${i}`}
                aria-selected={selected}
                aria-controls="lp-flow-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(i)}
                className="flex items-center gap-3 rounded-xl px-3.5 py-3.5 text-start transition-colors"
                style={{
                  background: selected ? 'var(--lp-card)' : 'var(--lp-elevated)',
                  border: `1px solid ${selected ? 'var(--lp-border-strong)' : 'var(--lp-border)'}`,
                  boxShadow: selected ? `var(--lp-shadow-sm), ${selInset} ${toneVar[STAGES[i].tone]}` : 'none',
                }}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold"
                      style={{ background: selected ? toneVar[STAGES[i].tone] : 'var(--lp-icon-bg)', color: selected ? 'var(--lp-primary-fg)' : 'var(--lp-text-2)' }}>
                  <Icon size={17} aria-hidden="true" />
                </span>
                <span className="text-[14.5px] font-semibold" style={{ color: selected ? 'var(--lp-text)' : 'var(--lp-text-2)' }} dir="auto">{name}</span>
                <span className="ms-auto text-[11px] font-bold tabular-nums" style={{ color: 'var(--lp-text-2)' }} aria-hidden="true">{i + 1}</span>
              </button>
            )
          })}
        </div>

        {/* Panel */}
        <div
          role="tabpanel"
          id="lp-flow-panel"
          aria-labelledby={`lp-tab-${active}`}
          tabIndex={0}
          className="lp-card lp-card-lg flex flex-col p-6"
        >
          <div className="flex items-center gap-2">
            <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--lp-tint)', color: 'var(--lp-primary)' }} dir="auto">
              {t('marketing.flow.panel_tag')}
            </span>
            <span className="text-[11px] font-medium" style={{ color: 'var(--lp-text-2)' }} dir="auto">{t('marketing.flow.panel_illustrative')}</span>
          </div>
          <span className="mt-5 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: `color-mix(in srgb, ${accent} 15%, transparent)` }}>
            <ActiveIcon size={26} style={{ color: accent }} aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-xl font-bold" dir="auto">{names[active]}</h3>
          <p className="mt-2 max-w-md text-[15.5px] leading-relaxed" style={{ color: 'var(--lp-text-2)' }} dir="auto">{descs[active]}</p>
          <div className="mt-6">
            <CapabilityGlyph kind={STAGES[active].glyph} />
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── Core capabilities (#capabilities) ─────────────────────────────────────────

export function CoreCapabilities() {
  const { t } = useT()
  const cards: { icon: LucideIcon; tone: 'blue' | 'emerald' | 'amber' | 'cyan'; glyph: GlyphKind; n: number }[] = [
    { icon: Route, tone: 'blue', glyph: 'timeline', n: 1 },
    { icon: Layers, tone: 'blue', glyph: 'lot', n: 2 },
    { icon: FlaskConical, tone: 'emerald', glyph: 'qc', n: 3 },
    { icon: ShieldAlert, tone: 'amber', glyph: 'recall', n: 4 },
    { icon: ClipboardCheck, tone: 'blue', glyph: 'capa', n: 5 },
    { icon: QrCode, tone: 'cyan', glyph: 'qr', n: 6 },
  ]
  return (
    <Section id="capabilities">
      <Eyebrow icon={Boxes}>{t('marketing.nav.capabilities')}</Eyebrow>
      <Heading>{t('marketing.capabilities.heading')}</Heading>
      <Sub>{t('marketing.capabilities.sub')}</Sub>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(c => {
          const Icon = c.icon
          return (
            <div key={c.n} className="lp-card flex h-full flex-col p-6">
              <div className="mb-5"><CapabilityGlyph kind={c.glyph} /></div>
              <div className="flex items-center gap-3">
                <IconTile icon={Icon} tone={c.tone} />
                <h3 className="text-[16.5px] font-bold leading-tight" dir="auto">{t(`marketing.capabilities.c${c.n}_title`)}</h3>
              </div>
              <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--lp-text-2)' }} dir="auto">{t(`marketing.capabilities.c${c.n}_body`)}</p>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ── Public trace showcase ─────────────────────────────────────────────────────

export function PublicTraceShowcase() {
  const { t } = useT()
  return (
    <Section surface="feature">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className="order-2 lg:order-1">
          <Eyebrow icon={QrCode} tone="cyan">{t('marketing.strip.qr')}</Eyebrow>
          <Heading>{t('marketing.showcase.heading')}</Heading>
          <Sub>{t('marketing.showcase.body')}</Sub>
          <div className="mt-6 flex items-start gap-3 rounded-xl p-4" style={{ background: 'var(--lp-card)', border: '1px solid var(--lp-border)' }}>
            <ShieldCheck size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--lp-emerald)' }} aria-hidden="true" />
            <p className="text-[14px] leading-relaxed" style={{ color: 'var(--lp-text-2)' }} dir="auto">{t('marketing.showcase.note')}</p>
          </div>
        </div>
        <div className="order-1 flex justify-center lg:order-2"><TracePhone /></div>
      </div>
    </Section>
  )
}

// ── Recall readiness ──────────────────────────────────────────────────────────

export function RecallReadiness() {
  const { t } = useT()
  const benefits = [
    { title: t('marketing.recall.n1'), body: t('marketing.recall.n1_body') },
    { title: t('marketing.recall.n2'), body: t('marketing.recall.n2_body') },
    { title: t('marketing.recall.n3'), body: t('marketing.recall.n3_body') },
  ]
  return (
    <section
      className="scroll-mt-24"
      style={{ background: 'var(--lp-feature)', borderBottom: '1px solid var(--lp-border)', borderTop: '2px solid color-mix(in srgb, var(--lp-amber) 45%, var(--lp-border))' }}
    >
      <div className="mx-auto grid w-full max-w-[1200px] items-center gap-12 px-5 py-16 sm:px-6 sm:py-22 lg:grid-cols-2 lg:px-8">
        <div>
          <Eyebrow icon={ShieldAlert} tone="amber">{t('marketing.recall.eyebrow')}</Eyebrow>
          <Heading>{t('marketing.recall.heading')}</Heading>
          <Sub>{t('marketing.recall.body')}</Sub>
          <ul className="mt-6 flex flex-col gap-4">
            {benefits.map((b, i) => (
              <li key={i} className="flex items-start gap-3">
                <CheckCircle2 size={19} className="mt-0.5 shrink-0" style={{ color: 'var(--lp-emerald)' }} aria-hidden="true" />
                <div>
                  <p className="text-[15px] font-semibold" dir="auto">{b.title}</p>
                  <p className="mt-0.5 text-[14px] leading-relaxed" style={{ color: 'var(--lp-text-2)' }} dir="auto">{b.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <RecallGraph />
      </div>
    </section>
  )
}

// ── Operational roles ─────────────────────────────────────────────────────────

export function Roles() {
  const { t } = useT()
  const roles: { icon: LucideIcon; n: number }[] = [
    { icon: Factory, n: 1 },
    { icon: FlaskConical, n: 2 },
    { icon: ShieldAlert, n: 3 },
    { icon: Building2, n: 4 },
  ]
  return (
    <Section>
      <Heading>{t('marketing.roles.heading')}</Heading>
      <Sub>{t('marketing.roles.sub')}</Sub>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {roles.map(r => {
          const Icon = r.icon
          const tone = r.n === 2 ? 'emerald' : r.n === 3 ? 'amber' : 'blue'
          return (
            <div key={r.n} className="lp-card p-5">
              <IconTile icon={Icon} tone={tone} />
              <h3 className="mt-4 text-[15.5px] font-bold" dir="auto">{t(`marketing.roles.r${r.n}_title`)}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: 'var(--lp-muted)' }} dir="auto">{t(`marketing.roles.r${r.n}_body`)}</p>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ── Trust & security (#security) — only repository-verified claims ────────────

export function TrustSecurity() {
  const { t } = useT()
  const items: { icon: LucideIcon; n: number }[] = [
    { icon: Lock, n: 1 },
    { icon: ShieldCheck, n: 2 },
    { icon: Layers, n: 3 },
    { icon: Activity, n: 4 },
    { icon: Eye, n: 5 },
    { icon: Languages, n: 6 },
  ]
  return (
    <Section id="security" surface="alt">
      <Eyebrow icon={ShieldCheck}>{t('marketing.trust.eyebrow')}</Eyebrow>
      <Heading>{t('marketing.trust.heading')}</Heading>
      <Sub>{t('marketing.trust.sub')}</Sub>
      {/* Quiet rows — deliberately not glowing cards, so this reads as trustworthy. */}
      <div className="mt-10 grid gap-x-10 gap-y-7 sm:grid-cols-2">
        {items.map(it => {
          const Icon = it.icon
          return (
            <div key={it.n} className="flex gap-3.5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--lp-icon-bg)', border: '1px solid var(--lp-icon-border)' }}>
                <Icon size={16} style={{ color: 'var(--lp-primary)' }} aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-[15px] font-bold leading-tight" dir="auto">{t(`marketing.trust.t${it.n}_title`)}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed" style={{ color: 'var(--lp-text-2)' }} dir="auto">{t(`marketing.trust.t${it.n}_body`)}</p>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-10 border-t pt-5 text-[13px]" style={{ borderColor: 'var(--lp-border)', color: 'var(--lp-muted)' }} dir="auto">{t('marketing.trust.disclaimer')}</p>
    </Section>
  )
}

// ── Final CTA ─────────────────────────────────────────────────────────────────

export function FinalCta() {
  const { t } = useT()
  return (
    <Section>
      <div
        className="lp-card-lg relative overflow-hidden px-6 py-10 text-center sm:px-10 sm:py-12"
        style={{ background: 'color-mix(in srgb, var(--lp-primary) 8%, var(--lp-card))', border: '1px solid color-mix(in srgb, var(--lp-primary) 22%, var(--lp-border))' }}
      >
        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl" dir="auto">{t('marketing.final.heading')}</h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed sm:text-[17px]" style={{ color: 'var(--lp-text-2)' }} dir="auto">
            {t('marketing.final.body')}
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              {t('marketing.final.cta_primary')}
              <ArrowRight size={17} className="rtl:-scale-x-100" aria-hidden="true" />
            </Link>
            <a href="#platform" className="lp-btn lp-btn-secondary">{t('marketing.final.cta_secondary')}</a>
          </div>
        </div>
      </div>
    </Section>
  )
}
