'use client'

// Original code-built product illustrations for the landing preview. No images,
// no external assets — CSS/SVG + existing lucide icons only. All labels come from
// the marketing locale namespace. These are clearly illustrative UI compositions,
// never live customer data.

import {
  Package, Factory, FlaskConical, QrCode, Truck, ShieldAlert,
  CheckCircle2, Clock, ScanLine, GitBranch, Layers, ClipboardCheck,
  Route, Boxes, type LucideIcon,
} from 'lucide-react'
import { useT } from '../lib/i18n'

type Tone = 'blue' | 'emerald' | 'amber' | 'red' | 'cyan' | 'neutral'

const TONE_VAR: Record<Tone, string> = {
  blue: 'var(--lp-primary)',
  emerald: 'var(--lp-emerald)',
  amber: 'var(--lp-amber)',
  red: 'var(--lp-red)',
  cyan: 'var(--lp-cyan)',
  neutral: 'var(--lp-muted)',
}

function Dot({ tone }: { tone: Tone }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: TONE_VAR[tone], boxShadow: `0 0 0 3px color-mix(in srgb, ${TONE_VAR[tone]} 18%, transparent)` }}
    />
  )
}

/** A small window-chrome frame used to signal "this is a product UI illustration". */
function Frame({ title, refCode, children }: { title: string; refCode: string; children: React.ReactNode }) {
  return (
    <div className="lp-card lp-card-lg overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--lp-border)' }}>
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--lp-border-strong)' }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--lp-border-strong)' }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--lp-border-strong)' }} />
        </span>
        <span className="ms-1 text-[13px] font-semibold">{title}</span>
        <span
          dir="ltr"
          className="ms-auto rounded-md px-2 py-0.5 text-[11px] font-medium tabular-nums"
          style={{ background: 'var(--lp-tint)', color: 'var(--lp-primary)' }}
        >
          {refCode}
        </span>
      </div>
      {children}
    </div>
  )
}

// ── Hero command view ─────────────────────────────────────────────────────────
// A compact operational trace: 6 connected stages with illustrative statuses.
export function HeroCommandView() {
  const { t } = useT()
  const rows: { icon: LucideIcon; node: string; status: string; tone: Tone; done: boolean }[] = [
    { icon: Package,     node: t('marketing.flow_node.material'),     status: t('marketing.flow_status.material'),     tone: 'blue',    done: true },
    { icon: Factory,     node: t('marketing.flow_node.production'),   status: t('marketing.flow_status.production'),   tone: 'blue',    done: true },
    { icon: FlaskConical,node: t('marketing.flow_node.quality'),      status: t('marketing.flow_status.quality'),      tone: 'emerald', done: true },
    { icon: QrCode,      node: t('marketing.flow_node.qr'),           status: t('marketing.flow_status.qr'),           tone: 'cyan',    done: true },
    { icon: Truck,       node: t('marketing.flow_node.distribution'), status: t('marketing.flow_status.distribution'), tone: 'blue',    done: true },
    { icon: ShieldAlert, node: t('marketing.flow_node.recall'),       status: t('marketing.flow_status.recall'),       tone: 'amber',   done: false },
  ]
  return (
    <Frame title={t('marketing.hero.visual_title')} refCode={t('marketing.hero.visual_ref')}>
      <div className="lp-grid-bg p-4 sm:p-5">
        <ol className="relative flex flex-col gap-2.5">
          {rows.map((r, i) => {
            const Icon = r.icon
            return (
              <li key={i} className="relative flex items-center gap-3">
                {/* spine connector */}
                {i < rows.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-[42px] h-[calc(100%-20px)] w-px start-[21px]"
                    style={{ background: 'var(--lp-border-strong)' }}
                  />
                )}
                <span
                  className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: 'var(--lp-icon-bg)', border: '1px solid var(--lp-icon-border)' }}
                >
                  <Icon size={19} style={{ color: r.tone === 'neutral' ? 'var(--lp-muted)' : TONE_VAR[r.tone] }} aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-3 py-2"
                     style={{ background: 'var(--lp-card)', border: '1px solid var(--lp-border)' }}>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold leading-tight" dir="auto">{r.node}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] leading-tight" style={{ color: 'var(--lp-muted)' }} dir="auto">
                      <Dot tone={r.tone} />
                      {r.status}
                    </p>
                  </div>
                  {r.done
                    ? <CheckCircle2 size={16} style={{ color: 'var(--lp-emerald)' }} aria-hidden="true" />
                    : <Clock size={16} style={{ color: 'var(--lp-amber)' }} aria-hidden="true" />}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </Frame>
  )
}

// ── Public trace phone mockup ─────────────────────────────────────────────────
export function TracePhone() {
  const { t } = useT()
  const line = (label: string, value: string, tone?: Tone) => (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[12px]" style={{ color: 'var(--lp-muted)' }} dir="auto">{label}</span>
      <span className="flex items-center gap-1.5 text-[12.5px] font-semibold" dir="auto">
        {tone && <Dot tone={tone} />}{value}
      </span>
    </div>
  )
  return (
    <div
      className="mx-auto w-[262px] max-w-full rounded-[30px] p-2.5"
      style={{ background: 'var(--lp-elevated)', border: '1px solid var(--lp-border-strong)', boxShadow: 'var(--lp-shadow-lg)' }}
    >
      <div className="overflow-hidden rounded-[22px]" style={{ background: 'var(--lp-card)', border: '1px solid var(--lp-border)' }}>
        {/* status bar / language pills */}
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--lp-primary)' }}>
            <ScanLine size={13} aria-hidden="true" /> QR
          </span>
          <span dir="ltr" className="flex overflow-hidden rounded-md text-[10px] font-bold" style={{ border: '1px solid var(--lp-border)' }} aria-hidden="true">
            <span className="px-1.5 py-0.5" style={{ background: 'var(--lp-primary)', color: 'var(--lp-primary-fg)' }}>EN</span>
            <span className="px-1.5 py-0.5" style={{ color: 'var(--lp-muted)' }}>ع</span>
          </span>
        </div>
        <div className="px-4 pb-4">
          <p className="text-[15px] font-bold leading-tight" dir="auto">{t('marketing.showcase.phone_product_val')}</p>
          <p dir="ltr" className="mt-0.5 text-[11px] tabular-nums text-start" style={{ color: 'var(--lp-muted)' }}>
            {t('marketing.showcase.phone_sku')} · {t('marketing.showcase.phone_sku_val')}
          </p>

          <div className="mt-3 divide-y" style={{ borderColor: 'var(--lp-border)' }}>
            <div className="[&>div]:border-b [&>div]:border-[var(--lp-border)] [&>div:last-child]:border-0">
              {line(t('marketing.showcase.phone_status'), t('marketing.showcase.phone_status_val'), 'blue')}
              {line(t('marketing.showcase.phone_quality'), t('marketing.showcase.phone_quality_val'), 'emerald')}
            </div>
          </div>

          {/* mini journey */}
          <p className="mt-3 mb-1.5 text-[11px] font-semibold" style={{ color: 'var(--lp-muted)' }} dir="auto">
            {t('marketing.showcase.phone_journey')}
          </p>
          <div className="flex items-center gap-1" aria-hidden="true">
            {['blue', 'blue', 'emerald', 'cyan', 'blue'].map((tn, i, a) => (
              <div key={i} className="flex flex-1 items-center">
                <span className="h-2 w-2 rounded-full" style={{ background: TONE_VAR[tn as Tone] }} />
                {i < a.length - 1 && <span className="h-px flex-1" style={{ background: 'var(--lp-border-strong)' }} />}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ background: 'var(--lp-icon-bg)', color: 'var(--lp-text)' }}>
              <Boxes size={11} aria-hidden="true" />{t('marketing.showcase.phone_materials')}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ background: 'var(--lp-icon-bg)', color: 'var(--lp-text)' }}>
              <Truck size={11} aria-hidden="true" />{t('marketing.showcase.phone_distribution')}
            </span>
          </div>

          <p className="mt-4 border-t pt-2.5 text-center text-[10px] font-medium" style={{ borderColor: 'var(--lp-border)', color: 'var(--lp-muted)' }} dir="auto">
            {t('marketing.showcase.powered')}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Recall scope graph ────────────────────────────────────────────────────────
export function RecallGraph() {
  const { t } = useT()
  const nodes: { label: string; icon: LucideIcon; tone: Tone }[] = [
    { label: t('marketing.recall.g_lot'),          icon: Package,       tone: 'amber' },
    { label: t('marketing.recall.g_orders'),        icon: Factory,       tone: 'red' },
    { label: t('marketing.recall.g_distribution'),  icon: Truck,         tone: 'amber' },
    { label: t('marketing.recall.g_recipients'),    icon: Route,         tone: 'amber' },
    { label: t('marketing.recall.g_capa'),          icon: ClipboardCheck,tone: 'blue' },
  ]
  return (
    <div className="lp-card lp-card-lg p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: 'color-mix(in srgb, var(--lp-amber) 14%, transparent)', color: 'var(--lp-amber)' }}>
          <ShieldAlert size={13} aria-hidden="true" />{t('marketing.recall.g_example')}
        </span>
      </div>
      <ol className="flex flex-col gap-2">
        {nodes.map((n, i) => {
          const Icon = n.icon
          return (
            <li key={i} className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: 'var(--lp-icon-bg)', border: '1px solid var(--lp-icon-border)' }}>
                <Icon size={16} style={{ color: TONE_VAR[n.tone] }} aria-hidden="true" />
              </span>
              <div className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2"
                   style={{ background: 'var(--lp-elevated)', border: '1px solid var(--lp-border)' }}>
                <Dot tone={n.tone} />
                <span className="text-[12.5px] font-semibold" dir="auto">{n.label}</span>
                {i < nodes.length - 1 && <GitBranch size={13} className="ms-auto" style={{ color: 'var(--lp-muted)' }} aria-hidden="true" />}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ── Differentiated capability mini-visuals ────────────────────────────────────
export type GlyphKind = 'timeline' | 'lot' | 'qc' | 'recall' | 'capa' | 'qr'

export function CapabilityGlyph({ kind }: { kind: GlyphKind }) {
  const box = 'flex h-16 items-center gap-2 rounded-xl px-3'
  const boxStyle = { background: 'var(--lp-elevated)', border: '1px solid var(--lp-border)' } as const
  switch (kind) {
    case 'timeline':
      return (
        <div className={box} style={boxStyle} aria-hidden="true">
          {(['blue', 'blue', 'emerald', 'cyan'] as Tone[]).map((tn, i, a) => (
            <div key={i} className="flex flex-1 items-center">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: TONE_VAR[tn] }} />
              {i < a.length - 1 && <span className="h-px flex-1" style={{ background: 'var(--lp-border-strong)' }} />}
            </div>
          ))}
        </div>
      )
    case 'lot':
      return (
        <div className={box} style={boxStyle} aria-hidden="true">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--lp-icon-bg)' }}>
            <Package size={15} style={{ color: 'var(--lp-primary)' }} />
          </span>
          <span className="h-px flex-1" style={{ background: 'var(--lp-border-strong)' }} />
          <Layers size={15} style={{ color: 'var(--lp-muted)' }} />
          <span className="h-px flex-1" style={{ background: 'var(--lp-border-strong)' }} />
          <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--lp-icon-bg)' }}>
            <Factory size={15} style={{ color: 'var(--lp-primary)' }} />
          </span>
        </div>
      )
    case 'qc':
      return (
        <div className={box + ' justify-between'} style={boxStyle} aria-hidden="true">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--lp-emerald)' }}>
            <CheckCircle2 size={14} /> <Dot tone="emerald" />
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--lp-amber)' }}>
            <Clock size={14} /> <Dot tone="amber" />
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--lp-red)' }}>
            <ShieldAlert size={14} /> <Dot tone="red" />
          </span>
        </div>
      )
    case 'recall':
      return (
        <div className={box} style={boxStyle} aria-hidden="true">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--lp-amber) 14%, transparent)' }}>
            <Package size={15} style={{ color: 'var(--lp-amber)' }} />
          </span>
          <div className="flex flex-1 flex-col gap-1">
            <span className="h-px w-full" style={{ background: 'var(--lp-border-strong)' }} />
            <span className="h-px w-2/3" style={{ background: 'var(--lp-border-strong)' }} />
          </div>
          <div className="flex flex-col gap-1">
            <Dot tone="red" /><Dot tone="amber" />
          </div>
        </div>
      )
    case 'capa':
      return (
        <div className={box} style={boxStyle} aria-hidden="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex flex-1 items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ background: i < 2 ? 'var(--lp-primary)' : 'var(--lp-tint)', color: i < 2 ? 'var(--lp-primary-fg)' : 'var(--lp-muted)' }}>
                {i < 2 ? '✓' : i + 1}
              </span>
              {i < 2 && <span className="h-px flex-1" style={{ background: 'var(--lp-primary)' }} />}
            </div>
          ))}
        </div>
      )
    case 'qr':
      return (
        <div className={box} style={boxStyle} aria-hidden="true">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'var(--lp-icon-bg)' }}>
            <QrCode size={18} style={{ color: 'var(--lp-primary)' }} />
          </span>
          <div className="flex flex-1 flex-col gap-1">
            <span className="h-2 w-4/5 rounded-full" style={{ background: 'var(--lp-border-strong)' }} />
            <span className="h-2 w-3/5 rounded-full" style={{ background: 'var(--lp-border-strong)' }} />
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: 'var(--lp-emerald)' }}>
              <Dot tone="emerald" />
            </span>
          </div>
        </div>
      )
  }
}
