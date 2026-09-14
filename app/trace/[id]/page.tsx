'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import {
  ShieldCheck, Package, Layers, ShoppingCart,
  AlertCircle, AlertTriangle, Loader2, Activity,
  Factory, Languages,
} from 'lucide-react'
import { LogoIcon } from '../../components/Logo'
import { JourneyMetrics } from './JourneyMetrics'
import { EnhancedTimeline } from './EnhancedTimeline'
import { fmtTraceDate, fmtTraceDateTime } from './eventCategories'
import { useT, fmtNum } from '../../lib/i18n'

// ── Types — strict contract matching get_public_batch_trace RPC ─────────────

type PublicQc = {
  overall_result:    'pass' | 'fail' | 'hold' | 'pending'
  inspection_count:  number
  last_inspected_at: string | null
}

type PublicMaterial = {
  material_name: string
}

type PublicTimelineEvent = {
  event_type:      string
  event_timestamp: string
  title:           string
}

type PublicRecall = {
  recall_number:  string
  title:          string
  severity:       string
  status:         string
  affected_units: number
  initiated_at:   string
  closed_at:      string | null
}

type RecallAlert = {
  has_active_recall: boolean
  recalls:           PublicRecall[]
}

type PublicTraceData = {
  product: {
    name:         string
    sku:          string
    status:       string
    completed_at: string | null
  }
  qc:           PublicQc
  materials:    PublicMaterial[]
  timeline:     PublicTimelineEvent[]
  recall_alert: RecallAlert | null
  risk_level:   'none' | 'low' | 'medium' | 'high' | 'critical'
}

type TFn = (key: string, vars?: Record<string, string | number>) => string

// ── Helpers ────────────────────────────────────────────────────────────────

// Human-readable fallback for an unknown enum value: "in_progress" → "In Progress".
function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase())
}

// Translate a finite enum value; fall back to a humanized raw value if the key
// is absent (t() returns the key path when missing). Never leaks a trace.* key path.
function tEnum(t: TFn, prefix: string, value: string, fallback?: string): string {
  const norm = value.toLowerCase().replace(/[\s-]+/g, '_')
  const key = `${prefix}.${norm}`
  const out = t(key)
  return out === key ? (fallback ?? humanize(value)) : out
}

// Smooth-scroll a section to just below the sticky header.
//
// Root cause of earlier failures: on click, the browser first performs its own
// synchronous scroll (focusing the tapped nav button / making it visible), which
// landed before or overrode an immediate programmatic scroll, so the section top
// ended up flush under the two-row sticky header. We therefore (a) defer to the
// next frame with requestAnimationFrame so our scroll runs AFTER the browser's,
// and (b) measure the sticky header's real height live at that moment (covering
// the two rows and the wrapped badge row) and subtract it from the section's
// absolute document position. The page is window-scrolled (trace renders as bare
// children — no inner scroll container), so window.scrollTo is authoritative.
// Works identically in LTR and RTL (vertical offset only).
function scrollToSection(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  requestAnimationFrame(() => {
    const header  = document.getElementById('trace-sticky')
    const headerH = header ? header.getBoundingClientRect().height : 0
    const top = window.scrollY + el.getBoundingClientRect().top - headerH - 8
    window.scrollTo({ top: top < 0 ? 0 : top, behavior: 'smooth' })
  })
}

const NAV_ITEMS = [
  { key: 'overview',     id: 'sec-overview'     },
  { key: 'journey',      id: 'sec-journey'       },
  { key: 'quality',      id: 'sec-quality'       },
  { key: 'distribution', id: 'sec-distribution' },
  { key: 'materials',    id: 'sec-materials'     },
  { key: 'production',   id: 'sec-production'   },
]

// Shared content width: compact single column on mobile, a measured wider
// column on tablet/desktop so content is easier to scan (not full-bleed).
const CONTENT_W = 'max-w-md md:max-w-2xl'

// ── Badge / status class maps ──────────────────────────────────────────────

type QcStatus = 'pass' | 'fail' | 'hold' | 'pending'
const qcBadgeClass: Record<QcStatus, string> = {
  pass:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  fail:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  hold:    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  pending: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
}

const orderStatusClass: Record<string, string> = {
  completed:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  pending:     'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  cancelled:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

// ── Shared UI primitives ───────────────────────────────────────────────────

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${className}`}>
      {label}
    </span>
  )
}

function Section({ icon, title, count, children, id }: {
  icon: React.ReactNode; title: string; count?: number; children: React.ReactNode; id?: string
}) {
  return (
    <div
      id={id}
      className="scroll-mt-28 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden transition-shadow duration-200 hover:shadow-md"
    >
      <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-700 px-4 py-3.5">
        <span className="text-gray-500 dark:text-gray-400">{icon}</span>
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="ms-auto rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300">
            {count}
          </span>
        )}
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-gray-600 dark:text-gray-300">{label}</span>
      <span className="min-w-0 text-end font-medium text-gray-900 dark:text-white">{value ?? '—'}</span>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-500 dark:text-gray-400 italic">{text}</p>
}

// Status badge — color (tone) is decoupled from the display label so the label
// can be localized without breaking the color logic.
type Tone = 'pass' | 'fail' | 'hold' | 'neutral'

function statusTone(raw: string): Tone {
  const s = raw.toLowerCase().replace(/[\s-]+/g, '')
  if (['pass', 'qcpassed', 'labpassed', 'compliant', 'passed'].includes(s)) return 'pass'
  if (['fail', 'qcfailed', 'labfailed', 'noncompliant', 'failed'].includes(s)) return 'fail'
  if (['hold', 'onhold'].includes(s)) return 'hold'
  return 'neutral'
}

const toneClass: Record<Tone, string> = {
  pass:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  fail:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  hold:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  neutral: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-200',
}

function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${toneClass[tone]}`}>
      {label}
    </span>
  )
}

// ── Section: Quality & Compliance ─────────────────────────────────────────
// Shows aggregate QC summary only — no inspector identity, no free-text notes.

function QualitySection({ qc }: { qc: PublicQc }) {
  const { t, lang } = useT()
  const r = qc.overall_result
  const tone: Tone = r === 'pass' ? 'pass' : r === 'fail' ? 'fail' : r === 'hold' ? 'hold' : 'neutral'

  const qcLabel =
    r === 'pass' ? t('trace.qc.qc_pass')
    : r === 'fail' ? t('trace.qc.qc_fail')
    : r === 'hold' ? t('trace.qc.on_hold')
    :                t('trace.qc.pending')

  const labLabel =
    r === 'pass' ? t('trace.qc.lab_pass')
    : r === 'fail' ? t('trace.qc.lab_fail')
    : r === 'hold' ? t('trace.qc.on_hold')
    :                t('trace.qc.pending')

  const complianceLabel =
    r === 'pass' ? t('trace.qc.compliant')
    : r === 'fail' ? t('trace.qc.non_compliant')
    : r === 'hold' ? t('trace.qc.on_hold')
    :                t('trace.qc.pending')

  return (
    <Section icon={<ShieldCheck size={15} />} title={t('trace.section.quality_compliance')} id="sec-quality">
      <Row label={t('trace.row.qc_result')}         value={<StatusBadge label={qcLabel} tone={tone} />} />
      <Row label={t('trace.row.lab_result')}        value={<StatusBadge label={labLabel} tone={tone} />} />
      <Row label={t('trace.row.compliance_status')} value={<StatusBadge label={complianceLabel} tone={tone} />} />
      <Row
        label={t('trace.row.inspections')}
        value={t(qc.inspection_count !== 1 ? 'trace.inspections_count_other' : 'trace.inspections_count_one', { n: qc.inspection_count })}
      />
      {qc.last_inspected_at && fmtTraceDate(qc.last_inspected_at, lang) && (
        <Row label={t('trace.row.last_inspected')} value={fmtTraceDate(qc.last_inspected_at, lang)} />
      )}
    </Section>
  )
}

// ── Section: Production Information ───────────────────────────────────────
// Operator/Responsible row removed — no actor data in public contract.
// Fabricated factory/line values removed — no such fields in the public contract.

function ProductionInfoSection({
  product,
  sectionId,
}: {
  product:   PublicTraceData['product']
  sectionId?: string
}) {
  const { t, lang } = useT()
  const completed = product.completed_at ? fmtTraceDateTime(product.completed_at, lang) : ''
  return (
    <Section icon={<Factory size={15} />} title={t('trace.section.production_information')} id={sectionId}>
      {completed ? (
        <Row label={t('trace.row.completed')} value={completed} />
      ) : (
        <Empty text={t('trace.empty.completion_unavailable')} />
      )}
    </Section>
  )
}

// ── Scan event logging ─────────────────────────────────────────────────────
// Uses the log_scan_event SECURITY DEFINER RPC instead of a direct insert.
// company_id is derived server-side from the batch — never caller-supplied.

function logScanEvent(batchId: string) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua)
  const browser =
    /Edg\//i.test(ua)     ? 'Edge'    :
    /OPR\//i.test(ua)     ? 'Opera'   :
    /Chrome\//i.test(ua)  ? 'Chrome'  :
    /Safari\//i.test(ua)  ? 'Safari'  :
    /Firefox\//i.test(ua) ? 'Firefox' : 'Other'

  void supabase
    .rpc('log_scan_event', {
      p_batch_id:    batchId,
      p_device_type: isMobile ? 'mobile' : 'desktop',
      p_browser:     browser,
      p_user_agent:  ua.slice(0, 300),
    })
    .then(({ error }) => {
      if (error) console.error('[logScanEvent] rpc failed:', error)
    })
}

// ── UUID detection ─────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Public trace accepts production-order UUIDs only.
// Non-UUID params (e.g. SKU strings) resolve to null immediately — no DB query.
function resolveToUUID(param: string): string | null {
  return UUID_RE.test(param) ? param : null
}

// ── Language toggle ──────────────────────────────────────────────────────────
// Shows the TARGET language name; localized aria-label + title; comfortable tap target.

function LangToggle() {
  const { t, lang, setLang } = useT()
  const targetLabel = lang === 'ar' ? t('trace.lang.label_en') : t('trace.lang.label_ar')
  const action = lang === 'ar' ? t('trace.lang.switch_to_en') : t('trace.lang.switch_to_ar')
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
      aria-label={action}
      title={action}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700/60 px-3 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
    >
      <Languages size={13} aria-hidden="true" />
      <span>{targetLabel}</span>
    </button>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function PublicTracePage() {
  const { id } = useParams<{ id: string }>()
  const { t, lang } = useT()

  const [traceData,     setTraceData]     = useState<PublicTraceData | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [notFound,      setNotFound]      = useState(false)
  const [activeSection, setActiveSection] = useState<string>('sec-overview')
  const [visible,       setVisible]       = useState(false)

  useEffect(() => {
    if (!id) return

    async function load() {
      const batchId = resolveToUUID(id)

      if (!batchId) {
        setNotFound(true)
        setLoading(false)
        return
      }

      logScanEvent(batchId)

      const { data: rpcData, error } = await supabase
        .rpc('get_public_batch_trace', { p_batch_id: batchId })

      if (error || rpcData === null || rpcData === undefined) {
        setNotFound(true)
        setLoading(false)
        return
      }

      setTraceData(rpcData as PublicTraceData)
      setLoading(false)
    }

    load()
  }, [id])

  // Track active section based on scroll position
  useEffect(() => {
    if (!traceData) return
    let raf = 0
    const getActive = () => {
      const threshold = window.scrollY + window.innerHeight * 0.3
      let active = 'sec-overview'
      for (const { id: sid } of NAV_ITEMS) {
        const el = document.getElementById(sid)
        if (el && el.offsetTop <= threshold) active = sid
      }
      setActiveSection(active)
    }
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(getActive) }
    window.addEventListener('scroll', onScroll, { passive: true })
    raf = requestAnimationFrame(getActive)
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [traceData])

  // Fade the page in after data arrives
  useEffect(() => {
    if (traceData) requestAnimationFrame(() => setVisible(true))
  }, [traceData])

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 size={28} className="animate-spin text-blue-600" />
      </div>
    )
  }

  // ── Not found / error ────────────────────────────────────────────────────

  if (notFound || !traceData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 px-6 text-center">
        <AlertCircle size={44} className="mb-3 text-gray-400 dark:text-gray-500" />
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('trace.empty.not_found_title')}</p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('trace.empty.not_found_sub')}</p>
        <div className="mt-6 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <ShieldCheck size={13} />
          <span>{t('trace.powered_by')}</span>
        </div>
      </div>
    )
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const { product, qc, materials, timeline, recall_alert, risk_level } = traceData

  const activeRecalls   = recall_alert?.recalls.filter(r => r.status !== 'closed') ?? []
  const showRecallAlert = (recall_alert?.has_active_recall ?? false) && activeRecalls.length > 0
  const showRiskAlert   = !showRecallAlert && (risk_level === 'high' || risk_level === 'critical')

  const distributionCount = timeline.filter(e => e.event_type.startsWith('distribution.')).length

  const productionBadge = `${t('trace.badge.production')}: ${tEnum(t, 'trace.status', product.status)}`
  const qualityBadge    = `${t('trace.badge.quality')}: ${t('trace.badge_result.' + qc.overall_result)}`

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={`min-h-screen bg-gray-50 dark:bg-gray-900 transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}>

      {/* Sticky header + mini section nav */}
      <div id="trace-sticky" className="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        {/* Primary row */}
        <div className={`mx-auto flex ${CONTENT_W} flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-3`}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <LogoIcon size="sm" />
            <div className="min-w-0">
              <p dir="auto" title={product.name} className="truncate text-xs font-bold text-gray-900 dark:text-white leading-tight">{product.name}</p>
              <p dir="ltr" className="truncate font-mono text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{product.sku}</p>
            </div>
          </div>
          <LangToggle />
          <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
            <Badge label={productionBadge} className={orderStatusClass[product.status] ?? 'bg-gray-100 text-gray-700'} />
            <Badge label={qualityBadge}    className={qcBadgeClass[qc.overall_result] ?? 'bg-gray-100 text-gray-700'} />
          </div>
        </div>
        {/* Section mini nav */}
        <div className="border-t border-gray-100 dark:border-gray-700/50 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className={`flex items-center gap-0.5 px-3 py-1.5 mx-auto ${CONTENT_W} min-w-max`}>
            {NAV_ITEMS.map(({ key, id: navId }) => (
              <button
                key={navId}
                type="button"
                onClick={() => scrollToSection(navId)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition-all duration-200 ${
                  activeSection === navId
                    ? 'bg-gray-900 dark:bg-white/90 text-white dark:text-gray-900'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700/60'
                }`}
              >
                {t('trace.nav.' + key)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body — `isolate` creates a stacking context so the timeline's internal
          z-index layers (phase circles, event markers) stay contained below the
          sticky header instead of painting over it. */}
      <div className={`mx-auto ${CONTENT_W} px-4 py-5 space-y-5 isolate`}>

        <div className="flex flex-col gap-3">

          {/* Hero card — product identity */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white via-blue-50/40 to-blue-100/60 dark:from-gray-800 dark:via-blue-950/20 dark:to-blue-900/30 shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-300 mb-1.5">{t('trace.hero.passport')}</p>
              <h1 dir="auto" className="text-xl font-bold text-gray-900 dark:text-white leading-tight mb-0.5">{product.name}</h1>
              <p dir="ltr" className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{product.sku}</p>
            </div>
            {/* Neutral branding strip — no fabricated provenance fields */}
            <div className="flex items-center gap-2 border-t border-gray-100 dark:border-gray-700/60 bg-emerald-50/50 dark:bg-emerald-900/10 px-5 py-2.5">
              <ShieldCheck size={14} className="text-emerald-500 shrink-0" />
              <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">{t('trace.hero.powered_by_label')}</span>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-300">{t('trace.brand')}</span>
            </div>
          </div>

          {/* Active recall alert */}
          {showRecallAlert && (
            <div className="flex gap-3 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-red-700 dark:text-red-300">{t('trace.alert.active_recall')}</p>
                {activeRecalls.map((r, i) => (
                  <p key={i} dir="auto" className="text-xs text-red-600 dark:text-red-300 mt-0.5">
                    <span dir="ltr">{r.recall_number}</span>: {r.title}
                    {r.affected_units ? ` — ${t('trace.alert.units_affected', { n: fmtNum(r.affected_units, lang) })}` : ''}
                  </p>
                ))}
                <p className="text-xs text-red-600 dark:text-red-300 mt-1.5 font-medium">
                  {t('trace.alert.stop_use')}
                </p>
              </div>
            </div>
          )}

          {/* High / critical risk alert (no active recall) */}
          {showRiskAlert && (
            <div className="flex gap-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-bold text-amber-700 dark:text-amber-300">{t('trace.alert.quality_alert')}</p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  {t('trace.alert.risk_flagged', { level: tEnum(t, 'trace.severity', risk_level) })}
                </p>
              </div>
            </div>
          )}

          {/* Batch Summary */}
          <Section icon={<Package size={15} />} title={t('trace.section.batch_summary')} id="sec-overview">
            <Row label={t('trace.row.product')} value={<span dir="auto">{product.name}</span>} />
            <Row label={t('trace.row.sku')}     value={<span dir="ltr" className="font-mono text-xs">{product.sku}</span>} />
            <Row label={t('trace.row.status')}  value={
              <Badge
                label={tEnum(t, 'trace.status', product.status)}
                className={orderStatusClass[product.status] ?? 'bg-gray-100 text-gray-700'}
              />
            } />
            {product.completed_at && fmtTraceDate(product.completed_at, lang) && (
              <Row label={t('trace.row.completed')} value={fmtTraceDate(product.completed_at, lang)} />
            )}
          </Section>

        </div>

        {/* Product Journey */}
        <Section
          icon={<Activity size={15} />}
          title={t('trace.section.product_journey')}
          count={timeline.length}
          id="sec-journey"
        >
          <EnhancedTimeline events={timeline} isLoading={false} productStatus={product.status} qcResult={qc.overall_result} />
        </Section>

        {/* Quality & Compliance */}
        <QualitySection qc={qc} />

        {/* Journey Metrics */}
        <JourneyMetrics
          completedAt={product.completed_at}
          qc={qc}
          materials={materials}
          distributionCount={distributionCount}
          timeline={timeline}
        />

        {/* Recall details — shown only when recalls exist */}
        {(recall_alert?.recalls.length ?? 0) > 0 && (
          <Section
            icon={<AlertTriangle size={15} />}
            title={t('trace.section.recall_information')}
            count={recall_alert!.recalls.length}
          >
            <div className="space-y-3">
              {recall_alert!.recalls.map((r, i) => (
                <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/20 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span dir="ltr" className="font-mono text-xs font-bold text-gray-700 dark:text-gray-200">{r.recall_number}</span>
                    <StatusBadge label={tEnum(t, 'trace.recall_status', r.status)} tone={statusTone(r.status)} />
                  </div>
                  <p dir="auto" className="text-sm font-medium text-gray-900 dark:text-white">{r.title}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                    <span>{t('trace.row.severity')}: <span className="font-medium text-gray-700 dark:text-gray-200">{tEnum(t, 'trace.severity', r.severity)}</span></span>
                    {r.affected_units > 0 && (
                      <span>{t('trace.alert.units_affected', { n: fmtNum(r.affected_units, lang) })}</span>
                    )}
                    {fmtTraceDate(r.initiated_at, lang) && <span>{t('trace.row.initiated')}: {fmtTraceDate(r.initiated_at, lang)}</span>}
                    {r.closed_at && fmtTraceDate(r.closed_at, lang) && <span>{t('trace.row.closed')}: {fmtTraceDate(r.closed_at, lang)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Distribution */}
        <Section icon={<ShoppingCart size={15} />} title={t('trace.section.distribution')} id="sec-distribution">
          {distributionCount === 0 ? (
            <Empty text={t('trace.empty.no_distribution')} />
          ) : (
            <div className="py-1">
              <p className="text-sm text-gray-700 dark:text-gray-200">
                {t('trace.distribution_body.through_partners')}{' '}
                <span className="text-gray-500 dark:text-gray-400">
                  {t(distributionCount !== 1 ? 'trace.distribution_body.shipments_other' : 'trace.distribution_body.shipments_one', { n: fmtNum(distributionCount, lang) })}
                </span>
              </p>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t('trace.distribution_body.see_timeline')}
              </p>
            </div>
          )}
        </Section>

        {/* Raw Materials — material names only */}
        <Section icon={<Layers size={15} />} title={t('trace.section.raw_materials')} count={materials.length} id="sec-materials">
          {materials.length === 0 && <Empty text={t('trace.empty.no_materials')} />}
          {materials.length > 0 && (
            <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {materials.map((m, i) => (
                <div key={i} className="flex items-center gap-2.5 py-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-500 shrink-0" />
                  <span dir="auto" className="text-sm font-medium text-gray-900 dark:text-white">{m.material_name}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Production Information */}
        <ProductionInfoSection product={product} sectionId="sec-production" />

        {/* Footer */}
        <div className="pb-8 pt-2 flex flex-col items-center">
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-900/10 px-6 py-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <ShieldCheck size={16} className="text-emerald-500 dark:text-emerald-400 shrink-0" />
              <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('trace.powered_by')}</span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('trace.footer.tagline')}</p>
          </div>
        </div>

      </div>
    </div>
  )
}
