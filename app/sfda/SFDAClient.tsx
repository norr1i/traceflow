'use client'

import { useState, useEffect } from 'react'
import { useT, fmtDate } from '../lib/i18n'
import { useAuth, useRole } from '../lib/auth-context'
import { useToast } from '../components/Toast'
import {
  ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Clock,
  FileText, Download, Archive, Activity, ClipboardList,
  Filter, Plus, RefreshCw, Package, Users, Calendar, ChevronRight,
  FileWarning, CheckSquare, Lock, TrendingUp,
  X, ChevronDown, ChevronUp,
} from 'lucide-react'
import {
  buildQCReportPDF, buildBatchReportPDF, buildNCRReportPDF,
  buildRecallReportPDF, buildCAPAReportPDF, buildGMPReportPDF,
  buildInspectionPackagePDF, buildInspectionPackageZIP,
  nowGregorian, todayStr, downloadBlob,
  type ReportContext,
} from './exportUtils'
import { supabase } from '../lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabId = 'overview' | 'requirements' | 'inspection' | 'audit' | 'capa' | 'recall' | 'reports'
type ComplianceStatus = 'compliant' | 'non_compliant' | 'partial' | 'pending'
type CAPAStatus = 'open' | 'in_progress' | 'closed' | 'overdue'
type Severity = 'critical' | 'major' | 'minor'

interface CAPAItem {
  id: string; title: string
  severity: Severity; due: string; assigned: string; root: string; status: CAPAStatus
}

interface AuditEntry {
  id: number
  actor: string
  role: string
  action: string
  entity: string
  time: string
  type: 'edit' | 'qc' | 'delete' | 'recall' | 'create'
  badgeCls: string
}

interface RequirementRow {
  id: string; key: string; evidence: string; records: number
  status: ComplianceStatus; updated: string | null
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function todayISO(): string { return todayStr() }
function nowSA(): string    { return nowGregorian() }

function fmtAuditTime(raw: string): string {
  const parts = raw.split(' ')
  const datePart = parts[0] ?? ''
  const timePart = parts[1] ?? ''
  const seg = datePart.split('-').map(Number)
  const year = seg[0] ?? 0; const month = seg[1] ?? 1; const day = seg[2] ?? 1
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December']
  return `${day} ${months[month - 1]} ${year} — ${timePart}`
}

// ── PDF report maps ───────────────────────────────────────────────────────────

const PDF_BUILDERS: Record<string, (ctx: ReportContext) => Blob> = {
  rpt_qc:     buildQCReportPDF,
  rpt_batch:  buildBatchReportPDF,
  rpt_ncr:    buildNCRReportPDF,
  rpt_recall: buildRecallReportPDF,
  rpt_capa:   buildCAPAReportPDF,
  rpt_gmp:    buildGMPReportPDF,
}

const PDF_FILENAMES: Record<string, string> = {
  rpt_qc:     'QC-Inspection-Report',
  rpt_batch:  'Batch-Traceability-Report',
  rpt_ncr:    'Non-Conformance-Report',
  rpt_recall: 'Recall-Summary-Report',
  rpt_capa:   'CAPA-Summary-Report',
  rpt_gmp:    'GMP-Audit-Report',
}

const REPORT_ICON_CLS: Record<string, string> = {
  emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
  blue:    'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  amber:   'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  red:     'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  violet:  'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400',
  slate:   'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
}

// ── Requirement descriptions (regulatory text only — no audit observations) ──

const REQ_DESCRIPTIONS: Record<string, string> = {
  gmp:   'Manufacturing processes comply with Saudi FDA GMP guidelines. SOPs are documented, version-controlled, and reviewed annually.',
  batch: 'Full batch traceability from raw material receipt through finished product release. Lot numbers tracked via integrated barcode scanning system.',
  ncr:   'Non-conformances are identified, documented, investigated, and resolved. All major NCRs trigger mandatory CAPA creation.',
  capa:  'Corrective and preventive actions are formally tracked to closure and verified for effectiveness.',
  qc:    'QC inspections are conducted for every production batch by certified inspectors. Results are documented and linked to the batch record.',
  equip: 'All production and testing equipment is maintained and calibrated per an approved schedule. Calibration certificates are controlled documents.',
  audit: 'All system activities are logged with timestamp, actor, and entity. Logs are timestamped and company-scoped; retention period depends on your Supabase plan.',
  sop:   'Standard Operating Procedures are documented, version-controlled, and accessible to all relevant personnel. Training records are maintained.',
}

// Action badge classes — green = created/completed, blue = updates, amber = overrides, red = recalls/deletions
const GREEN_BADGE  = 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
const BLUE_BADGE   = 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
const RED_BADGE    = 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'

// Map a raw activity_logs row into the AuditEntry shape the UI expects.
// activity_logs columns: actor_email, action_type, entity_type, entity_id, message, created_at
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAuditRow(r: any, i: number): AuditEntry {
  const actionType = String(r.action_type ?? '')
  let type: AuditEntry['type'] = 'edit'
  if      (actionType.includes('qc') || actionType.includes('inspection')) type = 'qc'
  else if (actionType.includes('recall'))                                   type = 'recall'
  else if (actionType.includes('delete') || actionType.includes('removed')) type = 'delete'
  else if (actionType.includes('created') || actionType.includes('imported')) type = 'create'

  const badgeCls =
    type === 'delete' || type === 'recall' ? RED_BADGE  :
    type === 'qc'                          ? BLUE_BADGE :
                                             GREEN_BADGE

  const entityParts = [r.entity_type, r.entity_id].filter(Boolean).join(' #')

  return {
    id:      i + 1,
    actor:   r.actor_email ? String(r.actor_email) : 'System / SQL Editor',
    role:    '',
    action:  actionType.replace(/_/g, ' ').replace(/\./g, ' — ').replace(/\b\w/g, c => c.toUpperCase()) || '(no action)',
    entity:  entityParts || String(r.message ?? ''),
    time:    String(r.created_at ?? '').replace('T', ' ').slice(0, 16),
    type,
    badgeCls,
  }
}

const REPORTS = [
  { key: 'rpt_qc',     icon: ShieldCheck,   color: 'emerald' },
  { key: 'rpt_batch',  icon: Package,       color: 'blue'    },
  { key: 'rpt_ncr',    icon: FileWarning,   color: 'amber'   },
  { key: 'rpt_recall', icon: AlertTriangle, color: 'red'     },
  { key: 'rpt_capa',   icon: CheckSquare,   color: 'violet'  },
  { key: 'rpt_gmp',    icon: ClipboardList, color: 'slate'   },
]

// ── Helper components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ComplianceStatus }) {
  const { t } = useT()
  const map: Record<ComplianceStatus, { icon: React.ElementType; cls: string; key: string }> = {
    compliant:     { icon: CheckCircle2,  cls: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400', key: 'sfda.status_compliant'     },
    non_compliant: { icon: XCircle,       cls: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',                key: 'sfda.status_non_compliant' },
    partial:       { icon: AlertTriangle, cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',        key: 'sfda.status_partial'       },
    pending:       { icon: Clock,         cls: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',              key: 'sfda.status_pending'       },
  }
  const { icon: Icon, cls, key } = map[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <Icon size={11} />{t(key)}
    </span>
  )
}

function CAPAStatusBadge({ status }: { status: CAPAStatus }) {
  const { t } = useT()
  const map: Record<CAPAStatus, { cls: string; key: string }> = {
    open:        { cls: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',              key: 'sfda.capa_open'       },
    overdue:     { cls: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',                  key: 'sfda.capa_overdue'    },
    in_progress: { cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',          key: 'sfda.capa_inprogress' },
    closed:      { cls: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400',  key: 'sfda.capa_closed'     },
  }
  const { cls, key } = map[status]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{t(key)}</span>
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useT()
  const map: Record<Severity, { cls: string; key: string }> = {
    critical: { cls: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',         key: 'sfda.severity_critical' },
    major:    { cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400', key: 'sfda.severity_major'    },
    minor:    { cls: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',       key: 'sfda.severity_minor'    },
  }
  const { cls, key } = map[severity]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{t(key)}</span>
}

function ScoreRing({ score, size = 160 }: { score: number; size?: number }) {
  const r = 45; const c = 2 * Math.PI * r
  const offset = c - (score / 100) * c
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-gray-200 dark:text-gray-700" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset} transform="rotate(-90 50 50)"
        style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      <text x="50" y="47" textAnchor="middle" dominantBaseline="central" fontSize="20" fontWeight="700" fill={color}>{score}</text>
      <text x="50" y="62" textAnchor="middle" fontSize="9" fill="#9ca3af">%</text>
    </svg>
  )
}

// ── Prop types for hoisted tab components ────────────────────────────────────

type SFDARecallStats    = { affected: number; downstream: number; customers: number; score: number; coveragePct: number }
type SFDAComplianceData = { qcTotal: number; qcPassed: number; qcLastDate: string | null; batchCount: number; auditCount: number }
type SFDASimResult      = { notificationTime: string; coverage: number; riskLevel: string; riskCls: string }
type SFDARiskFactor     = { label: string; dot: string; level: string }

type TabOverviewProps = {
  liveRequirements:  RequirementRow[]
  recallStats:       SFDARecallStats
  complianceScore:   number
  qcFailed:          number
  complianceData:    SFDAComplianceData
  complianceLoading: boolean
  recallLoading:     boolean
  capaList:          CAPAItem[]
  setActiveTab:      (tab: TabId) => void
  setExpandedReq:    (req: string | null) => void
}
type TabRequirementsProps = {
  liveRequirements: RequirementRow[]
  expandedReq:      string | null
  setExpandedReq:   (req: string | null) => void
}
type TabInspectionProps = {
  complianceData: SFDAComplianceData
  recallStats:    SFDARecallStats
  capaList:       CAPAItem[]
  auditLog:       AuditEntry[]
  generating:     boolean
  onExport:       (type: 'pdf' | 'zip' | 'audit') => void
}
type TabAuditProps = {
  auditLog:       AuditEntry[]
  auditFilter:    string
  setAuditFilter: (f: string) => void
  auditLoading:   boolean
  auditError:     string | null
  companyId:      string | null
}
type TabCAPAProps = {
  capaList:         CAPAItem[]
  canEditSFDA:      boolean
  setShowCAPAModal: (v: boolean) => void
}
type TabRecallProps = {
  recallStats:   SFDARecallStats
  recallLoading: boolean
  simLastRun:    string
  simulating:    boolean
  simDone:       boolean
  simResult:     SFDASimResult | null
  riskFactors:   SFDARiskFactor[]
  onSimulate:    () => void
}
type TabReportsProps = {
  onDownloadReport: (key: string) => void
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function reqDisplayLabel(req: RequirementRow, t: (k: string) => string): { label: string; dotCls: string; textCls: string } {
  if (req.id === 'batch' && req.status === 'compliant') {
    return { label: t('sfda.status_data_connected'), dotCls: 'bg-teal-400', textCls: 'text-teal-700 dark:text-teal-400' }
  }
  if (req.id === 'audit' && req.status === 'compliant') {
    return { label: t('sfda.status_logs_available'), dotCls: 'bg-teal-400', textCls: 'text-teal-700 dark:text-teal-400' }
  }
  if (req.evidence === '—' && req.records === 0 && req.status === 'pending') {
    return { label: t('sfda.status_not_assessed'), dotCls: 'bg-gray-300 dark:bg-gray-600', textCls: 'text-gray-400 dark:text-gray-500' }
  }
  const map: Record<ComplianceStatus, { label: string; dotCls: string; textCls: string }> = {
    compliant:     { label: t('sfda.status_compliant'),     dotCls: 'bg-emerald-500', textCls: 'text-emerald-700 dark:text-emerald-400' },
    non_compliant: { label: t('sfda.status_non_compliant'), dotCls: 'bg-red-500',     textCls: 'text-red-700 dark:text-red-400'         },
    partial:       { label: t('sfda.status_partial'),       dotCls: 'bg-amber-400',   textCls: 'text-amber-700 dark:text-amber-400'     },
    pending:       { label: t('sfda.status_pending'),       dotCls: 'bg-blue-300 dark:bg-blue-500', textCls: 'text-blue-600 dark:text-blue-400' },
  }
  return map[req.status]
}

function TabOverview({ liveRequirements, recallStats, complianceScore, qcFailed, complianceData, complianceLoading, recallLoading, capaList, setActiveTab, setExpandedReq }: TabOverviewProps) {
  const { t, lang } = useT()

  // ── Derived values ──────────────────────────────────────────────────────────
  const hasQCData     = complianceData.qcTotal > 0
  const openCAPAs     = capaList.filter(c => c.status !== 'closed').length
  const overdueCAPAs  = capaList.filter(c => c.status === 'overdue').length
  const criticalCAPAs = capaList.filter(c => c.severity === 'critical' && c.status !== 'closed').length
  const activeRecalls = recallStats.affected
  const hasReadiness  = !recallLoading && recallStats.downstream > 0
  const lastInspectionLabel = complianceData.qcLastDate
    ? new Date(complianceData.qcLastDate).toLocaleDateString(
        lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB',
        { day: 'numeric', month: 'short', year: 'numeric' }
      )
    : '—'

  const riskKey = !hasQCData ? 'sfda.risk_unassessed'
    : complianceScore >= 80 ? 'sfda.risk_low'
    : complianceScore >= 60 ? 'sfda.risk_medium'
    : 'sfda.risk_high'
  const riskDotCls = !hasQCData ? 'bg-gray-300 dark:bg-gray-600'
    : complianceScore >= 80 ? 'bg-emerald-500'
    : complianceScore >= 60 ? 'bg-amber-400'
    : 'bg-red-500'

  // ── Requires Attention — 3 consolidated themes ──────────────────────────────
  type AttnItem = { key: string; icon: React.ElementType; iconCls: string; label: string; sub: string; dest: string; onClick?: () => void; href?: string }
  const attentionItems: AttnItem[] = []

  if (overdueCAPAs > 0 || criticalCAPAs > 0) {
    const parts: string[] = []
    if (overdueCAPAs > 0)  parts.push(`${overdueCAPAs} overdue`)
    if (criticalCAPAs > 0) parts.push(`${criticalCAPAs} critical`)
    attentionItems.push({
      key: 'capa-issues', icon: AlertTriangle, iconCls: 'text-red-500',
      label: 'CAPA Issues', sub: parts.join(' · '), dest: 'CAPA Audit View',
      onClick: () => setActiveTab('capa'),
    })
  }

  const qcReq = liveRequirements.find(r => r.id === 'qc')
  if (qcFailed > 0) {
    attentionItems.push({
      key: 'qc-issues', icon: AlertTriangle,
      iconCls: qcReq?.status === 'non_compliant' ? 'text-red-500' : 'text-amber-500',
      label: 'QC Issues',
      sub:  `${qcFailed} non-passing inspection${qcFailed !== 1 ? 's' : ''}`,
      dest: 'Quality',
      href: '/quality',
    })
  }

  if (activeRecalls > 0) {
    attentionItems.push({
      key: 'recall-exposure', icon: AlertTriangle, iconCls: 'text-amber-500',
      label: 'Recall Exposure',
      sub:  `${activeRecalls} affected batch${activeRecalls !== 1 ? 'es' : ''}`,
      dest: 'Recall Readiness',
      onClick: () => setActiveTab('recall'),
    })
  }

  // ── Requirement display order: highest-signal first ─────────────────────────
  const matrixOrder = ['qc', 'capa', 'batch', 'audit', 'gmp', 'ncr', 'equip', 'sop']
  const matrixReqs  = matrixOrder
    .map(id => liveRequirements.find(r => r.id === id))
    .filter((r): r is RequirementRow => !!r)
  const matrixRows: [RequirementRow | undefined, RequirementRow | undefined][] = [
    [matrixReqs[0], matrixReqs[1]],
    [matrixReqs[2], matrixReqs[3]],
    [matrixReqs[4], matrixReqs[5]],
    [matrixReqs[6], matrixReqs[7]],
  ]

  return (
    <div className="space-y-4">

      {/* ── 1. Top Posture Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

        {/* A: QC Pass Rate */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl py-3.5 px-4 flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--subtle)]">{t('sfda.score_label')}</p>
          {complianceLoading
            ? <p className="text-3xl font-bold text-[var(--muted)]">…</p>
            : <>
                <p className={`text-3xl font-bold ${hasQCData ? 'text-[var(--text)]' : 'text-gray-400 dark:text-gray-500'}`}>
                  {hasQCData ? `${complianceScore}%` : '—'}
                </p>
                <p className="text-sm text-[var(--muted)]">
                  {hasQCData
                    ? `${complianceData.qcPassed} of ${complianceData.qcTotal} passed`
                    : 'No QC inspection records'}
                </p>
                <p className="inline-flex items-center gap-1 text-xs text-[var(--subtle)] mt-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${riskDotCls}`} />
                  {t('sfda.risk_label')}: {t(riskKey)}
                </p>
              </>
          }
        </div>

        {/* B: Open CAPAs */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl py-3.5 px-4 flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--subtle)]">{t('sfda.open_capas')}</p>
          <p className={`text-3xl font-bold ${openCAPAs > 0 ? 'text-[var(--text)]' : 'text-gray-400 dark:text-gray-500'}`}>
            {openCAPAs > 0 ? openCAPAs : '—'}
          </p>
          <p className={`text-sm ${overdueCAPAs > 0 ? 'text-red-600 dark:text-red-400' : 'text-[var(--subtle)]'}`}>
            {overdueCAPAs > 0 ? `${overdueCAPAs} overdue` : openCAPAs === 0 ? 'None recorded' : 'None overdue'}
          </p>
        </div>

        {/* C: Affected Recall Batches */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl py-3.5 px-4 flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--subtle)]">{t('sfda.active_recalls')}</p>
          {recallLoading
            ? <p className="text-3xl font-bold text-[var(--muted)]">…</p>
            : <>
                <p className={`text-3xl font-bold ${activeRecalls > 0 ? 'text-[var(--text)]' : 'text-gray-400 dark:text-gray-500'}`}>
                  {activeRecalls > 0 ? activeRecalls : '—'}
                </p>
                <p className="text-sm text-[var(--subtle)]">
                  {activeRecalls === 0 ? 'None recorded' : 'Batches flagged under active recall'}
                </p>
              </>
          }
        </div>
      </div>

      {/* ── 2. Requirement Coverage Matrix ───────────────────────────────────── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--subtle)]">Requirement Coverage</p>
          <button onClick={() => setActiveTab('requirements')}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            View all
          </button>
        </div>
        <div>
          {matrixRows.map((pair, rowIdx) => (
            <div key={rowIdx} className={`grid grid-cols-1 sm:grid-cols-2${rowIdx < matrixRows.length - 1 ? ' border-b border-[var(--border)]' : ''}`}>
              {pair.filter((r): r is RequirementRow => !!r).map((req, col) => {
                const dl = reqDisplayLabel(req, t)
                return (
                  <button key={req.id}
                    onClick={() => { setActiveTab('requirements'); setExpandedReq(req.id) }}
                    className={`flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-[var(--bg)] transition-colors text-start w-full${col === 0 ? ' border-b sm:border-b-0 sm:border-r border-[var(--border)]' : ''}`}>
                    <span className="text-sm text-[var(--text)] font-medium">{t(`sfda.${req.key}`)}</span>
                    <span className="inline-flex items-center gap-1.5 shrink-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dl.dotCls}`} />
                      <span className={`text-xs ${dl.textCls}`}>{dl.label}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        {hasReadiness && (
          <div className="border-t border-[var(--border)] px-5 py-2.5">
            <p className="text-[13px] text-[var(--muted)]">
              Downstream customer identification coverage: {recallStats.coveragePct}% — based on available recorded sales.
            </p>
          </div>
        )}
      </div>

      {/* ── 3. Requires Attention ────────────────────────────────────────────── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2">
          <AlertTriangle size={13} className="text-amber-500 shrink-0" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--subtle)]">Requires Attention</p>
        </div>
        {attentionItems.length === 0
          ? <p className="px-5 py-4 text-sm text-[var(--subtle)]">
              No open actions based on currently connected compliance data.
            </p>
          : <div className="divide-y divide-[var(--border)]">
              {attentionItems.map(item => {
                const Icon = item.icon
                const inner = (
                  <>
                    <Icon size={15} className={`${item.iconCls} shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-[var(--text)] leading-snug">{item.label}</p>
                      <p className="text-[13px] text-[var(--muted)] mt-0.5">{item.sub}</p>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-0.5 text-[13px] text-[var(--muted)]">
                      {item.dest}
                      <ChevronRight size={12} />
                    </span>
                  </>
                )
                const rowCls = 'w-full flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--bg)] transition-colors text-start'
                return item.href
                  ? <a key={item.key} href={item.href} className={rowCls}>{inner}</a>
                  : <button key={item.key} onClick={() => item.onClick?.()} className={rowCls}>{inner}</button>
              })}
            </div>
        }
      </div>

      {/* ── Last QC Inspection strip ─────────────────────────────────────────── */}
      {!complianceLoading && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-4 py-2.5 flex items-center gap-2">
          <Calendar size={13} className="text-[var(--subtle)] shrink-0" />
          <span className="text-sm text-[var(--muted)]">
            {t('sfda.last_inspection')}: <span className="font-medium text-[var(--text)]">{lastInspectionLabel}</span>
          </span>
        </div>
      )}

      {/* ── Evidence & Audit ─────────────────────────────────────────────────── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--subtle)]">Evidence & Audit</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
          {([
            { tab: 'inspection' as TabId, icon: Archive,       label: 'Compile Inspection Dossier', sub: 'Compile inspection evidence package' },
            { tab: 'reports'    as TabId, icon: FileText,      label: t('sfda.tab_reports'),        sub: 'Download individual reports'         },
            { tab: 'audit'      as TabId, icon: ClipboardList, label: t('sfda.tab_audit'),          sub: 'View system activity history'        },
          ] as const).map(({ tab, icon: Icon, label, sub }) => (
            <button key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex items-start gap-3 px-5 py-4 hover:bg-[var(--bg)] transition-colors text-start w-full">
              <div className="w-8 h-8 rounded-lg bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center shrink-0 mt-0.5">
                <Icon size={14} className="text-[var(--muted)]" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-[var(--text)]">{label}</p>
                <p className="text-[13px] text-[var(--muted)] mt-0.5">{sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}

// ── Tab: Requirements ─────────────────────────────────────────────────────────

function TabRequirements({ liveRequirements, expandedReq, setExpandedReq }: TabRequirementsProps) {
  const { t, lang } = useT()
  return (
    <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/40 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-300 dark:border-gray-500 bg-gray-100 dark:bg-[#2e3c52] text-xs tracking-wide">
              {['sfda.req_col_req','sfda.req_col_evidence','sfda.req_col_records','sfda.req_col_status','sfda.req_col_updated'].map(k => (
                <th key={k} className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t(k)}</th>
              ))}
              <th className="w-8 px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/40 bg-white dark:bg-gray-800">
            {liveRequirements.map((req) => {
              const description = REQ_DESCRIPTIONS[req.id]
              const isExpanded  = expandedReq === req.id
              const dl          = reqDisplayLabel(req, t)
              return (
                <>
                  <tr
                    key={req.id}
                    onClick={() => setExpandedReq(isExpanded ? null : req.id)}
                    className="group cursor-pointer hover:bg-[rgba(58,111,143,0.07)] dark:hover:bg-[rgba(58,111,143,0.13)] hover:shadow-[inset_3px_0_0_rgba(58,111,143,0.4)] transition-colors duration-150"
                  >
                    <td className="px-3 py-1.5 font-medium text-[var(--text)]">{t(`sfda.${req.key}`)}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-[var(--muted)]">{req.evidence}</td>
                    <td className="px-3 py-1.5 text-[var(--text)]">{req.records.toLocaleString()}</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${dl.dotCls}`} />
                        <span className={`text-xs font-medium ${dl.textCls}`}>{dl.label}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[var(--muted)]">{req.updated ? fmtDate(req.updated, lang) : '—'}</td>
                    <td className="px-3 py-1.5 text-[var(--subtle)]">
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${req.id}-detail`} className="border-b border-[var(--border)] bg-[var(--s3)]">
                      <td colSpan={6} className="px-6 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-1">Description</p>
                            <p className="text-[var(--text)] leading-relaxed">{description}</p>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-1">Audit Notes</p>
                              <p className="text-[var(--muted)] leading-relaxed italic">No audit notes recorded yet.</p>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                              <Calendar size={11} />
                              Last record: {req.updated ? fmtDate(req.updated, lang) : '—'}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Tab: Inspection Dossier ───────────────────────────────────────────────────

function TabInspection({ complianceData, recallStats, capaList, auditLog, generating, onExport }: TabInspectionProps) {
  const contents = [
    { label: 'Batch History Records',         detail: complianceData.batchCount > 0 ? `${complianceData.batchCount} records` : 'No records on file' },
    { label: 'QC Inspection Reports',         detail: complianceData.qcTotal > 0 ? `${complianceData.qcTotal} reports` : 'No records on file'       },
    { label: 'Full Traceability Chain',       detail: recallStats.downstream > 0 ? `${recallStats.coveragePct}% coverage` : 'No data'               },
    { label: 'Recall Event Records',          detail: recallStats.affected > 0 ? `${recallStats.affected} events on record` : 'No active recalls'   },
    { label: 'CAPA Action Register',          detail: `${capaList.length} actions`                                                                   },
    { label: 'Timestamped Activity Log',       detail: auditLog.length > 0 ? `${auditLog.length}+ entries` : 'No entries recorded'                   },
    { label: 'Regulatory Inspection History', detail: 'All prior visits'                                                                             },
    { label: 'Operator Activity Log',         detail: 'Full timestamped timeline'                                                                    },
  ]
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-5">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
              <Archive size={18} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text)]">Compile Inspection Dossier</h2>
              <p className="text-sm text-[var(--muted)] mt-0.5">
                Compile GMP compliance records into an inspection evidence dossier for internal audit readiness.
              </p>
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-3">Dossier Contents</p>
            <div className="space-y-2">
              {contents.map(item => (
                <div key={item.label} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                    <span className="text-sm text-[var(--text)]">{item.label}</span>
                  </div>
                  <span className="text-xs text-[var(--muted)]">{item.detail}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-4 mt-4 flex items-center gap-3 flex-wrap">
            <button
              onClick={() => { onExport('pdf') }}
              disabled={generating}
              title="Download the full inspection dossier as PDF"
              className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] hover:bg-[#2e5a75] text-white px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
            >
              {generating
                ? <><RefreshCw size={14} className="animate-spin" />Generating…</>
                : <><Download size={14} />Download Dossier</>}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-4">Export Formats</p>
          <div className="space-y-2">
            {([
              { type: 'pdf'   as const, icon: FileText,      label: 'Dossier PDF',      ext: '.pdf' },
              { type: 'zip'   as const, icon: Archive,       label: 'ZIP Archive',       ext: '.zip' },
              { type: 'audit' as const, icon: ClipboardList, label: 'GMP Audit Report', ext: '.pdf' },
            ]).map(({ type, icon: Icon, label, ext }) => (
              <button key={type}
                onClick={() => { onExport(type) }}
                disabled={generating}
                className="w-full flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text)] hover:bg-[var(--s3)] transition-colors disabled:opacity-60 text-start">
                <Icon size={14} className="text-[var(--muted)] shrink-0" />
                <span className="flex-1">{label}</span>
                <span className="text-xs text-[var(--subtle)] font-mono">{ext}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Audit Trail ──────────────────────────────────────────────────────────

function TabAudit({ auditLog, auditFilter, setAuditFilter, auditLoading, auditError, companyId }: TabAuditProps) {
  const FILTERS = [
    { id: 'all',    label: 'All Events' },
    { id: 'edit',   label: 'Edits'      },
    { id: 'create', label: 'Creates'    },
    { id: 'delete', label: 'Deletions'  },
    { id: 'qc',     label: 'QC Changes' },
    { id: 'recall', label: 'Recalls'    },
  ]
  const filtered = auditFilter === 'all' ? auditLog : auditLog.filter(e => e.type === auditFilter)

  return (
    <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/40 overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 overflow-x-auto">
          <Filter size={13} className="text-[var(--muted)] shrink-0" />
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setAuditFilter(f.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                auditFilter === f.id
                  ? 'bg-[#3a6f8f] text-white'
                  : 'bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--s3)]'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 shrink-0 tracking-wide">
          <Lock size={9} />ACTIVITY LOG
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-300 dark:border-gray-500 bg-gray-100 dark:bg-[#2e3c52] text-xs tracking-wide">
              {[
                { label: 'Personnel',        w: 'w-48' },
                { label: 'Action',           w: 'w-44' },
                { label: 'Affected Record',  w: ''     },
                { label: 'Timestamp',        w: 'w-52' },
                { label: '',                 w: 'w-8'  },
              ].map(({ label, w }) => (
                <th key={label} className={`px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold ${w}`}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/40 bg-white dark:bg-gray-800">
            {filtered.map((entry) => (
              <tr
                key={entry.id}
                className="hover:bg-[rgba(58,111,143,0.07)] dark:hover:bg-[rgba(58,111,143,0.13)] transition-colors duration-150"
              >
                <td className="px-3 py-1.5">
                  <p className="text-sm font-medium text-[var(--text)] leading-snug">{entry.actor}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">{entry.role}</p>
                </td>
                <td className="px-3 py-1.5">
                  <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${entry.badgeCls}`}>
                    {entry.action}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-sm text-[var(--muted)] max-w-[200px]">
                  <span className="truncate block">{entry.entity}</span>
                </td>
                <td className="px-3 py-1.5 text-xs text-[var(--muted)] whitespace-nowrap tabular-nums">
                  {fmtAuditTime(entry.time)}
                </td>
                <td className="px-3 py-1.5">
                  <span title="Immutable record"><Lock size={11} className="text-[var(--subtle)]" /></span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
                  {auditLoading
                    ? 'Loading audit entries…'
                    : auditError
                      ? <span className="text-red-500 dark:text-red-400">RLS / permission error — {auditError}</span>
                      : !companyId
                        ? 'Company profile not loaded — please refresh the page'
                        : 'No audit entries recorded yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[var(--border)] text-xs text-[var(--subtle)] flex items-center gap-1.5">
        <Lock size={10} />
        {filtered.length} of {auditLog.length} entries — company-scoped activity log
      </div>
    </div>
  )
}

// ── Tab: CAPA ─────────────────────────────────────────────────────────────────

function TabCAPA({ capaList, canEditSFDA, setShowCAPAModal }: TabCAPAProps) {
  const { t, lang } = useT()
  const toast = useToast()
  const counts = {
    open:        capaList.filter(c => c.status === 'open').length,
    in_progress: capaList.filter(c => c.status === 'in_progress').length,
    closed:      capaList.filter(c => c.status === 'closed').length,
    overdue:     capaList.filter(c => c.status === 'overdue').length,
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {([
            { status: 'open'        as CAPAStatus, count: counts.open,        cls: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'             },
            { status: 'in_progress' as CAPAStatus, count: counts.in_progress, cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'         },
            { status: 'overdue'     as CAPAStatus, count: counts.overdue,     cls: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'                 },
            { status: 'closed'      as CAPAStatus, count: counts.closed,      cls: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' },
          ]).map(({ status, count, cls }) => (
            <span key={status} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>
              <span className="text-sm font-bold">{count}</span>
              <CAPAStatusBadge status={status} />
            </span>
          ))}
        </div>
        {canEditSFDA && (
          <button onClick={() => setShowCAPAModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] hover:bg-[#2e5a75] text-white px-4 py-2 text-sm font-medium transition-colors">
            <Plus size={14} />{t('sfda.capa_add')}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-300 dark:border-gray-500 bg-gray-100 dark:bg-[#2e3c52] text-xs tracking-wide">
                {['sfda.capa_col_id','sfda.capa_col_title','sfda.capa_col_severity','sfda.capa_col_due','sfda.capa_col_assigned','sfda.capa_col_status'].map(k => (
                  <th key={k} className="px-3 py-2 text-left text-gray-700 dark:text-gray-100 font-bold">{t(k)}</th>
                ))}
                <th className="w-20 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/40 bg-white dark:bg-gray-800">
              {capaList.map((capa) => (
                <tr key={capa.id} className="hover:bg-[rgba(58,111,143,0.07)] dark:hover:bg-[rgba(58,111,143,0.13)] transition-colors duration-150">
                  <td className="px-3 py-1.5 font-mono text-xs text-[var(--muted)] whitespace-nowrap">{capa.id}</td>
                  <td className="px-3 py-1.5 max-w-xs">
                    <p className="font-medium text-[var(--text)] leading-snug">{capa.title}</p>
                    {capa.root && <p className="text-xs text-[var(--muted)] mt-0.5 truncate">{capa.root}</p>}
                  </td>
                  <td className="px-3 py-1.5"><SeverityBadge severity={capa.severity} /></td>
                  <td className={`px-3 py-1.5 whitespace-nowrap text-sm font-medium ${capa.status === 'overdue' ? 'text-red-600 dark:text-red-400' : 'text-[var(--text)]'}`}>
                    {fmtDate(capa.due, lang)}
                  </td>
                  <td className="px-3 py-1.5 text-[var(--text)] whitespace-nowrap">{capa.assigned}</td>
                  <td className="px-3 py-1.5"><CAPAStatusBadge status={capa.status} /></td>
                  <td className="px-3 py-1.5">
                    {capa.status === 'closed' && (
                      <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 size={12} />Verified
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {capaList.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400 dark:text-gray-500">No CAPA actions on record.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Recall Readiness ─────────────────────────────────────────────────────

function TabRecall({ recallStats, recallLoading, simLastRun, simulating, simDone, simResult, riskFactors, onSimulate }: TabRecallProps) {
  const { t } = useT()
  const dash = recallLoading ? '…' : '—'
  const customersUnknown = !recallLoading && recallStats.affected > 0 && recallStats.customers === 0
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 flex flex-col items-center justify-center gap-2">
          <ScoreRing score={recallStats.score} size={120} />
          <p className="text-xs font-medium text-[var(--muted)] text-center">{t('sfda.recall_score')}</p>
        </div>
        {[
          { icon: Package,    label: 'sfda.recall_affected',   value: recallLoading ? dash : String(recallStats.affected),   cls: 'text-amber-600 dark:text-amber-400',   bg: 'bg-amber-50 dark:bg-amber-900/20',  sub: undefined },
          { icon: TrendingUp, label: 'sfda.recall_downstream', value: recallLoading ? dash : String(recallStats.downstream), cls: 'text-blue-600 dark:text-blue-400',     bg: 'bg-blue-50 dark:bg-blue-900/20',    sub: undefined },
          { icon: Users,      label: 'sfda.recall_customers',
            value: recallLoading ? dash : customersUnknown ? 'Unknown' : String(recallStats.customers),
            cls:   customersUnknown ? 'text-gray-400 dark:text-gray-500' : 'text-violet-600 dark:text-violet-400',
            bg:    customersUnknown ? 'bg-gray-50 dark:bg-gray-800/30'   : 'bg-violet-50 dark:bg-violet-900/20',
            sub:   customersUnknown ? t('sfda.recall_customers_note') : undefined },
        ].map(({ icon: Icon, label, value, cls, bg, sub }) => (
          <div key={label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-3">
            <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
              <Icon size={16} className={cls} />
            </div>
            <p className={`text-2xl font-bold ${cls}`}>{value}</p>
            <p className="text-xs text-[var(--muted)] -mt-2">{t(label)}</p>
            {sub && <p className="text-xs text-[var(--subtle)] -mt-2">{sub}</p>}
          </div>
        ))}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text)]">Recall Simulation</h3>
            <p className="text-xs text-[var(--muted)] mt-1">Last run: {simLastRun}</p>
            <p className="text-xs text-[var(--subtle)] mt-0.5">This simulation is calculated locally and does not modify recall records.</p>
          </div>
          <button onClick={onSimulate} disabled={simulating}
            className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] hover:bg-[#2e5a75] text-white px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 shrink-0">
            {simulating
              ? <><RefreshCw size={14} className="animate-spin" />Running…</>
              : <><Activity size={14} />Run Simulation</>}
          </button>
        </div>

        {simDone && simResult && (
          <div className="mt-5 pt-5 border-t border-[var(--border)] grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-[var(--muted)]">Estimated Notification Time</p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{simResult.notificationTime}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)]">Coverage</p>
              <p className="text-xl font-bold text-[var(--text)] mt-1">{simResult.coverage}%</p>
              <p className="text-xs text-[var(--muted)]">of affected batches identified</p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)]">Recall Risk Score</p>
              <span className={`inline-flex items-center gap-1.5 mt-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${simResult.riskCls}`}>
                <AlertTriangle size={11} />{simResult.riskLevel}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-sm font-semibold text-[var(--text)] mb-4">Recall Risk Factors</h3>
        <div className="space-y-3">
          {riskFactors.length === 0
            ? <p className="text-sm text-[var(--muted)]">No risk factors recorded.</p>
            : riskFactors.map(item => (
                <div key={item.label} className="grid grid-cols-[1fr_max-content] items-center gap-x-4 max-w-md">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${item.dot}`} />
                    <span className="text-sm text-[var(--text)]">{item.label}</span>
                  </div>
                  <span className="text-xs font-medium text-[var(--muted)]">{item.level}</span>
                </div>
              ))
          }
        </div>
      </div>
    </div>
  )
}

// ── Tab: Regulatory Reports ───────────────────────────────────────────────────

function TabReports({ onDownloadReport }: TabReportsProps) {
  const { t } = useT()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {REPORTS.map(rpt => {
        const Icon    = rpt.icon
        const iconCls = REPORT_ICON_CLS[rpt.color] ?? REPORT_ICON_CLS.slate
        return (
          <div key={rpt.key} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconCls}`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text)] leading-snug">{t(`sfda.${rpt.key}`)}</p>
                <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">{t(`sfda.${rpt.key}_desc`)}</p>
              </div>
            </div>

            <button
              onClick={() => { void onDownloadReport(rpt.key) }}
              title="Download as PDF"
              className="mt-auto flex items-center justify-center gap-1.5 rounded-lg bg-[#3a6f8f] hover:bg-[#2e5a75] text-white px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <Download size={11} />{t('sfda.reports_download')}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SFDAClient() {
  const { t, dir } = useT()
  const role = useRole()
  const { companyId } = useAuth()
  const toast = useToast()

  const canEditSFDA = role === 'admin' || role === 'manager'

  // ── State ───────────────────────────────────────────────────────────────────

  const [activeTab,        setActiveTab]        = useState<TabId>('overview')

  const [auditFilter,      setAuditFilter]      = useState('all')

  const [generating,   setGenerating]   = useState(false)

  const [simulating,  setSimulating]  = useState(false)
  const [simDone,     setSimDone]     = useState(false)
  const [simLastRun,  setSimLastRun]  = useState('')

  const [capaList,      setCapaList]      = useState<CAPAItem[]>([])
  const [capaLoading,   setCapaLoading]   = useState(false)
  const [showCAPAModal, setShowCAPAModal] = useState(false)
  const [capaForm,      setCapaForm]      = useState({
    title: '', severity: 'major' as Severity,
    due: '', assigned: '', root: '', status: 'open' as CAPAStatus,
  })

  const [expandedReq, setExpandedReq] = useState<string | null>(null)

  // ── Live data from Supabase ─────────────────────────────────────────────────

  const [auditLog,      setAuditLog]      = useState<AuditEntry[]>([])
  const [auditLoading,  setAuditLoading]  = useState(false)
  const [auditError,    setAuditError]    = useState<string | null>(null)
  const [recallStats,   setRecallStats]   = useState({ affected: 0, downstream: 0, customers: 0, score: 0, coveragePct: 0 })
  const [recallLoading, setRecallLoading] = useState(false)
  const [simResult,     setSimResult]     = useState<{ notificationTime: string; coverage: number; riskLevel: string; riskCls: string } | null>(null)
  const [riskFactors,   setRiskFactors]   = useState<Array<{ label: string; dot: string; level: string }>>([])

  const [complianceData,    setComplianceData]    = useState({ qcTotal: 0, qcPassed: 0, qcLastDate: null as string | null, batchCount: 0, auditCount: 0 })
  const [complianceLoading, setComplianceLoading] = useState(false)

  // Load CAPAs from the capas table. Falls back gracefully if table not yet deployed.
  useEffect(() => {
    if (!companyId) return
    setCapaLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    supabase
      .from('capas')
      .select('id, capa_number, title, severity, root_cause, owner_name, due_date, status, closed_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (!error && data) {
          setCapaList(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (data as any[]).map(r => {
              const isOverdue = r.status !== 'closed' && r.due_date && r.due_date < today
              const sfdaStatus: CAPAStatus =
                r.status === 'closed' ? 'closed'
                : isOverdue           ? 'overdue'
                : r.status === 'open' ? 'open'
                : 'in_progress'
              return {
                id:       r.capa_number ?? r.id.slice(0, 12),
                title:    r.title,
                severity: (r.severity ?? 'major') as Severity,
                due:      r.due_date ?? '',
                assigned: r.owner_name ?? '—',
                root:     r.root_cause ?? '',
                status:   sfdaStatus,
              } satisfies CAPAItem
            })
          )
        }
        setCapaLoading(false)
      })
  }, [companyId])

  // Fetch audit entries from public.activity_logs (company-scoped, newest first)
  useEffect(() => {
    if (!companyId) return
    setAuditLoading(true)
    setAuditError(null)
    supabase
      .from('activity_logs')
      .select('id, actor_email, actor_user_id, action_type, entity_type, entity_id, message, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) {
          console.error('[activity_logs] error:', error.code, error.message)
          setAuditError(`${error.code}: ${error.message}`)
        }
        if (data) {
          setAuditLog(data.map(mapAuditRow))
        }
        setAuditLoading(false)
      })
  }, [companyId])

  // Fetch recall readiness metrics from real live tables.
  // Score = weighted average of customer traceability (60%) and QC pass rate (40%),
  //         capped at 100, minus 15 per active recall batch. Zero when no sales data.
  // Coverage = % of sales that have an identified customer_name (real traceability).
  useEffect(() => {
    if (!companyId) return
    setRecallLoading(true)
    void Promise.all([
      // 1. Active recall batches + customers affected
      supabase
        .from('recall_affected_batches')
        .select('customers_affected')
        .eq('company_id', companyId)
        .eq('status', 'active'),
      // 2. Total non-cancelled sales (downstream shipment count)
      supabase
        .from('sales')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .neq('status', 'cancelled'),
      // 3. Sales with an identified customer (traceability coverage numerator)
      supabase
        .from('sales')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .neq('status', 'cancelled')
        .not('customer_name', 'is', null),
      // 4. Passed QC inspections count
      supabase
        .from('quality_inspections')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'passed'),
      // 5. Total QC inspections count
      supabase
        .from('quality_inspections')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
      // 6. Failed/conditional inspections for risk factor panel
      supabase
        .from('quality_inspections')
        .select('status')
        .eq('company_id', companyId)
        .in('status', ['failed', 'conditional']),
    ]).then(([{ data: rabData }, { count: totalSales }, { count: tracedSales }, { count: passedQI }, { count: totalQI }, { data: qiData }]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customers   = (rabData ?? []).reduce((s: number, r: any) => s + (Number(r.customers_affected) || 0), 0)
      const affected    = (rabData ?? []).length
      const downstream  = totalSales  ?? 0
      const traced      = tracedSales ?? 0
      const coveragePct = downstream > 0 ? Math.round((traced / downstream) * 100) : 0
      const qiPass      = passedQI ?? 0
      const qiTotal     = totalQI  ?? 0
      const qiPassRate  = qiTotal > 0 ? Math.round((qiPass / qiTotal) * 100) : 100
      // Weighted score: 60% customer traceability + 40% QC pass rate, minus recall penalty
      const baseScore   = downstream > 0 ? Math.round(coveragePct * 0.6 + qiPassRate * 0.4) : 0
      const score       = Math.max(0, Math.min(100, baseScore - affected * 15))
      const QI_RISK: Record<string, { label: string; dot: string; level: string }> = {
        failed:      { label: 'Failed QC inspections on record',          dot: 'bg-red-500',   level: 'High'   },
        conditional: { label: 'Conditional QC outcomes requiring review', dot: 'bg-amber-400', level: 'Medium' },
      }
      const seen = new Set<string>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const factors: { label: string; dot: string; level: string }[] = (qiData ?? []).reduce((acc: { label: string; dot: string; level: string }[], r: any) => {
        const t = String(r.status)
        if (QI_RISK[t] && !seen.has(t)) { seen.add(t); acc.push(QI_RISK[t]) }
        return acc
      }, [])
      factors.sort((a, b) => (a.level === 'High' ? 0 : 1) - (b.level === 'High' ? 0 : 1))
      setRecallStats({ affected, downstream, customers, score, coveragePct })
      setRiskFactors(factors)
      setRecallLoading(false)
    })
  }, [companyId])

  // Fetch compliance metrics: QC pass rate, batch count, audit entry count.
  useEffect(() => {
    if (!companyId) return
    setComplianceLoading(true)
    void Promise.all([
      supabase.from('quality_inspections').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      supabase.from('quality_inspections').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'passed'),
      supabase.from('quality_inspections').select('inspection_date, created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(1),
      supabase.from('production_orders').select('id',  { count: 'exact', head: true }).eq('company_id', companyId),
      supabase.from('activity_logs').select('id',      { count: 'exact', head: true }).eq('company_id', companyId),
    ]).then(([{ count: qcTotal }, { count: qcPassed }, { data: qcLatest }, { count: batchCount }, { count: auditCount }]) => {
      setComplianceData({
        qcTotal:    qcTotal    ?? 0,
        qcPassed:   qcPassed   ?? 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        qcLastDate: (qcLatest as any)?.[0]?.inspection_date
          ?? (qcLatest as any)?.[0]?.created_at?.split('T')[0]
          ?? null,
        batchCount: batchCount ?? 0,
        auditCount: auditCount ?? 0,
      })
      setComplianceLoading(false)
    })
  }, [companyId])

  // ── Derived compliance metrics ──────────────────────────────────────────────

  const qcPassRate     = complianceData.qcTotal > 0 ? Math.round((complianceData.qcPassed / complianceData.qcTotal) * 100) : 0
  const qcFailed       = complianceData.qcTotal - complianceData.qcPassed
  const complianceScore = complianceData.qcTotal > 0 ? Math.max(0, Math.min(100, qcPassRate)) : 0

  const liveRequirements: RequirementRow[] = [
    { id: 'gmp',   key: 'req_gmp',   evidence: '—',                                              records: 0,                         status: 'pending',                                                                                                updated: null },
    { id: 'batch', key: 'req_batch', evidence: complianceData.batchCount > 0 ? 'PROD-TRACE-LOGS' : '—', records: complianceData.batchCount, status: complianceData.batchCount > 0 ? 'compliant' : 'pending',                                          updated: null },
    { id: 'ncr',   key: 'req_ncr',   evidence: '—',                                              records: 0,                         status: 'pending',                                                                                                updated: null },
    { id: 'capa',  key: 'req_capa',  evidence: '—',
      records: capaList.length,
      status: (() => {
        if (capaList.length === 0) return 'pending' as ComplianceStatus
        if (capaList.some(c => c.status === 'overdue') ||
            capaList.some(c => c.severity === 'critical' && c.status !== 'closed'))
          return 'partial' as ComplianceStatus
        if (capaList.every(c => c.status === 'closed')) return 'compliant' as ComplianceStatus
        return 'pending' as ComplianceStatus
      })(),
      updated: null },
    { id: 'qc',    key: 'req_qc',    evidence: complianceData.qcTotal > 0 ? 'QC-INSP-DATA' : '—', records: complianceData.qcTotal,   status: complianceData.qcTotal === 0 ? 'pending' : qcPassRate >= 95 ? 'compliant' : qcPassRate >= 80 ? 'partial' : 'non_compliant', updated: complianceData.qcLastDate },
    { id: 'equip', key: 'req_equip', evidence: '—',                                              records: 0,                         status: 'pending',                                                                                                updated: null },
    { id: 'audit', key: 'req_audit', evidence: complianceData.auditCount > 0 ? 'SYS-AUDIT-LOG' : '—', records: complianceData.auditCount, status: complianceData.auditCount > 0 ? 'compliant' : 'pending',                                           updated: null },
    { id: 'sop',   key: 'req_sop',   evidence: '—',                                              records: 0,                         status: 'pending',                                                                                                updated: null },
  ]

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function fetchCompanyName(): Promise<string> {
    if (!companyId) return ''
    const { data } = await supabase.from('companies').select('name').eq('id', companyId).single()
    return (data as { name?: string } | null)?.name ?? ''
  }

  // Fetch all live data needed for PDF reports in one parallel round-trip.
  async function buildCtx(): Promise<ReportContext> {
    const companyName = await fetchCompanyName()
    if (!companyId) {
      console.warn('[buildCtx] companyId is null — returning empty context')
      return { companyName }
    }

    const [
      { data: qcData,     error: qcErr     },
      { data: batchData,  error: batchErr  },
      { data: capaData,   error: capaErr   },
      { data: recallData, error: recallErr },
    ] = await Promise.all([
      supabase
        .from('quality_inspections')
        .select('batch_id, inspection_date, inspection_type, status, overall_score, notes, inspector_id, inspector_name')
        .eq('company_id', companyId)
        .order('inspection_date', { ascending: false })
        .limit(100),
      supabase
        .from('production_orders')
        .select('id, quantity, status, created_at, completed_at, products(name, sku)')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('capas')
        .select('id, capa_number, title, severity, due_date, owner_name, root_cause, corrective_action, preventive_action, status, closed_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('recalls')
        .select('id, title, status, created_at, closed_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    if (qcErr)     console.error('[buildCtx] quality_inspections error:', qcErr.code, qcErr.message)
    if (batchErr)  console.error('[buildCtx] production_orders error:',   batchErr.code, batchErr.message)
    if (capaErr)   console.error('[buildCtx] capas error:',               capaErr.code, capaErr.message)
    if (recallErr) console.error('[buildCtx] recalls error:',             recallErr.code, recallErr.message)

    // UUID pattern — only keep QC rows whose batch_id references a real production order.
    // Filters out base-seed text IDs like 'BATCH-2026-001' and 'BATCH-SEED-NNN'.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qcRows = (qcData ?? [])
      .filter((r: any) => UUID_RE.test(String(r.batch_id ?? '')))
      .map((r: any) => ({
        batch_id:        String(r.batch_id ?? ''),
        inspection_date: String(r.inspection_date ?? ''),
        inspection_type: String(r.inspection_type ?? ''),
        status:          String(r.status ?? ''),
        overall_score:   Number(r.overall_score ?? 0),
        notes:           (r.notes           as string | null) ?? null,
        inspector_name:  (r.inspector_name  as string | null) ?? (r.inspector_id as string | null) ?? null,
      }))

    // Demo-first ordering for the batch report: pin the main story SKUs to the
    // top of the PDF table so the report opens with the most compelling examples.
    const DEMO_BATCH_SKU_ORDER = [
      'VBC-2IN-316',  // Ball Valve — completed, distributed
      'HPC-50-200',   // Hydraulic Cylinder — CAPA link
      'VSR-05-010',   // Safety Relief Valve — recall story
      'ELV-7K5-VFD',  // VFD — in progress, pending QC
      'ELM-3P-250A',  // MCCB — pending
      'VGV-DN50-16',  // Gate Valve — in progress, QC hold
    ]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batchRows = (batchData ?? []).map((r: any) => {
      const prod = Array.isArray(r.products) ? r.products[0] : r.products
      return {
        id:           String(r.id),
        product_name: (prod?.name as string | undefined) ?? 'Unknown Product',
        sku:          (prod?.sku  as string | undefined) ?? '—',
        quantity:     Number(r.quantity ?? 0),
        status:       String(r.status ?? ''),
        created_at:   String(r.created_at ?? ''),
        completed_at: r.completed_at ? String(r.completed_at) : null,
      }
    }).sort((a, b) => {
      const ai = DEMO_BATCH_SKU_ORDER.indexOf(a.sku)
      const bi = DEMO_BATCH_SKU_ORDER.indexOf(b.sku)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return 0
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const capaRows = (capaData ?? []).map((r: any) => ({
      capa_number:       (r.capa_number       as string | null) ?? null,
      id:                String(r.id),
      title:             String(r.title ?? ''),
      severity:          String(r.severity ?? 'major'),
      due_date:          (r.due_date          as string | null) ?? null,
      owner_name:        (r.owner_name        as string | null) ?? null,
      root_cause:        (r.root_cause        as string | null) ?? null,
      corrective_action: (r.corrective_action as string | null) ?? null,
      preventive_action: (r.preventive_action as string | null) ?? null,
      status:            String(r.status ?? 'open'),
      closed_at:         (r.closed_at         as string | null) ?? null,
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recallRows = (recallData ?? []).map((r: any) => ({
      id:         String(r.id),
      title:      String(r.title ?? ''),
      status:     String(r.status ?? ''),
      created_at: String(r.created_at ?? ''),
      closed_at:  (r.closed_at as string | null) ?? null,
    }))

    return { companyName, qcRows, batchRows, capaRows, recallRows }
  }

  async function handleExport(type: 'pdf' | 'zip' | 'audit') {
    setGenerating(true)
    try {
      const ctx = await buildCtx()
      if (type === 'zip') {
        const blob = await buildInspectionPackageZIP(ctx)
        downloadBlob(blob, `SFDA-Inspection-Package-${todayISO()}.zip`)
        toast.success('ZIP archive downloaded')
      } else {
        const blob = type === 'audit' ? buildGMPReportPDF(ctx) : buildInspectionPackagePDF(ctx)
        const name = type === 'audit'
          ? `GMP-Audit-Report-${todayISO()}.pdf`
          : `SFDA-Inspection-Dossier-${todayISO()}.pdf`
        downloadBlob(blob, name)
        toast.success('PDF downloading…')
      }
    } finally {
      setGenerating(false)
    }
  }

  async function handleDownloadReport(key: string) {
    const builder  = PDF_BUILDERS[key]
    const filename = PDF_FILENAMES[key]
    if (!builder || !filename) return
    const ctx = await buildCtx()
    downloadBlob(builder(ctx), `${filename}-${todayISO()}.pdf`)
    toast.success('PDF downloading…')
  }

  async function handleSimulate() {
    setSimulating(true); setSimDone(false)

    await new Promise<void>(resolve => setTimeout(resolve, 900))

    setSimulating(false); setSimDone(true)
    setSimLastRun(nowSA())
    const s = recallStats.score
    const riskLevel = s === 0 ? 'No Data' : s > 80 ? 'Low Risk' : s > 50 ? 'Medium Risk' : 'High Risk'
    const riskCls   = s === 0 ? 'bg-gray-100 dark:bg-gray-900/30 text-gray-600 dark:text-gray-400'
                    : s > 80  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                    : s > 50  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                    :            'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
    setSimResult({ notificationTime: '< 2 hours', coverage: recallStats.coveragePct, riskLevel, riskCls })
    toast.success('Recall simulation completed successfully')
  }

  async function handleAddCAPA(e: React.FormEvent) {
    e.preventDefault()
    if (!capaForm.title.trim() || !capaForm.due || !capaForm.assigned.trim()) return
    if (companyId) {
      // Persist to DB; the useEffect will reload. If table not deployed yet, fall back to local state.
      const { data, error } = await supabase
        .from('capas')
        .insert([{
          company_id:        companyId,
          title:             capaForm.title,
          severity:          capaForm.severity,
          root_cause:        capaForm.root || null,
          owner_name:        capaForm.assigned,
          due_date:          capaForm.due,
          status:            capaForm.status === 'in_progress' ? 'investigation'
                            : capaForm.status === 'overdue'    ? 'open'
                            : capaForm.status,
        }])
        .select('id, capa_number')
        .single()
      if (!error && data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = data as any
        const newCapa: CAPAItem = {
          id:       row.capa_number ?? row.id.slice(0, 12),
          title:    capaForm.title,
          severity: capaForm.severity,
          due:      capaForm.due,
          assigned: capaForm.assigned,
          root:     capaForm.root,
          status:   capaForm.status,
        }
        setCapaList(prev => [newCapa, ...prev])
        setShowCAPAModal(false)
        setCapaForm({ title: '', severity: 'major', due: '', assigned: '', root: '', status: 'open' })
        toast.success('CAPA action added successfully')
        return
      }
    }
    // Fallback: local-only (capas table not yet deployed)
    const nextNum = capaList.length + 1
    const newCapa: CAPAItem = {
      id:       `CAPA-${new Date().getFullYear()}-${String(nextNum).padStart(3, '0')}`,
      title:    capaForm.title,
      severity: capaForm.severity,
      due:      capaForm.due,
      assigned: capaForm.assigned,
      root:     capaForm.root,
      status:   capaForm.status,
    }
    setCapaList(prev => [newCapa, ...prev])
    setShowCAPAModal(false)
    setCapaForm({ title: '', severity: 'major', due: '', assigned: '', root: '', status: 'open' })
    toast.success('CAPA action added successfully')
  }

  // ── Tab definitions ──────────────────────────────────────────────────────────

  const TABS: { id: TabId; labelKey: string }[] = [
    { id: 'overview',     labelKey: 'sfda.tab_overview'      },
    { id: 'requirements', labelKey: 'sfda.tab_requirements'  },
    { id: 'inspection',   labelKey: 'sfda.tab_inspection'    },
    { id: 'audit',        labelKey: 'sfda.tab_audit'         },
    { id: 'capa',         labelKey: 'sfda.tab_capa'          },
    { id: 'recall',       labelKey: 'sfda.tab_recall'        },
    { id: 'reports',      labelKey: 'sfda.tab_reports'       },
  ]

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5" dir={dir}>
      {/* Tab bar */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-[var(--border)]">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-[var(--s3)] text-[var(--text)]'
                : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--border)]'
            }`}>
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Tab content — components defined at module scope, props passed explicitly */}
      {activeTab === 'overview'     && (
        <TabOverview
          liveRequirements={liveRequirements}
          recallStats={recallStats}
          complianceScore={complianceScore}
          qcFailed={qcFailed}
          complianceData={complianceData}
          complianceLoading={complianceLoading}
          recallLoading={recallLoading}
          capaList={capaList}
          setActiveTab={setActiveTab}
          setExpandedReq={setExpandedReq}
        />
      )}
      {activeTab === 'requirements' && (
        <TabRequirements
          liveRequirements={liveRequirements}
          expandedReq={expandedReq}
          setExpandedReq={setExpandedReq}
        />
      )}
      {activeTab === 'inspection'   && (
        <TabInspection
          complianceData={complianceData}
          recallStats={recallStats}
          capaList={capaList}
          auditLog={auditLog}
          generating={generating}
          onExport={handleExport}
        />
      )}
      {activeTab === 'audit'        && (
        <TabAudit
          auditLog={auditLog}
          auditFilter={auditFilter}
          setAuditFilter={setAuditFilter}
          auditLoading={auditLoading}
          auditError={auditError}
          companyId={companyId}
        />
      )}
      {activeTab === 'capa'         && (
        <TabCAPA
          capaList={capaList}
          canEditSFDA={canEditSFDA}
          setShowCAPAModal={setShowCAPAModal}
        />
      )}
      {activeTab === 'recall'       && (
        <TabRecall
          recallStats={recallStats}
          recallLoading={recallLoading}
          simLastRun={simLastRun}
          simulating={simulating}
          simDone={simDone}
          simResult={simResult}
          riskFactors={riskFactors}
          onSimulate={handleSimulate}
        />
      )}
      {activeTab === 'reports'      && (
        <TabReports onDownloadReport={handleDownloadReport} />
      )}

      {/* CAPA modal */}
      {showCAPAModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <h2 className="text-base font-semibold text-[var(--text)]">New CAPA Action</h2>
              <button onClick={() => setShowCAPAModal(false)}
                className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] transition-colors">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddCAPA} className="px-6 py-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                  Finding / Issue *
                </label>
                <input required value={capaForm.title}
                  onChange={e => setCapaForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  placeholder="Describe the finding or issue" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Severity *</label>
                  <select value={capaForm.severity}
                    onChange={e => setCapaForm(f => ({ ...f, severity: e.target.value as Severity }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]">
                    <option value="critical">Critical</option>
                    <option value="major">Major</option>
                    <option value="minor">Minor</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Status *</label>
                  <select value={capaForm.status}
                    onChange={e => setCapaForm(f => ({ ...f, status: e.target.value as CAPAStatus }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]">
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Due Date *</label>
                  <input required type="date" value={capaForm.due}
                    onChange={e => setCapaForm(f => ({ ...f, due: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Assigned To *</label>
                  <input required value={capaForm.assigned}
                    onChange={e => setCapaForm(f => ({ ...f, assigned: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                    placeholder="Responsible person" />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">Root Cause</label>
                <textarea rows={2} value={capaForm.root}
                  onChange={e => setCapaForm(f => ({ ...f, root: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#4a7fa5] resize-none"
                  placeholder="Describe the root cause" />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowCAPAModal(false)}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg)] transition-colors">
                  Cancel
                </button>
                <button type="submit"
                  className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] hover:bg-[#2e5a75] text-white px-4 py-2 text-sm font-medium transition-colors">
                  <Plus size={14} />Add CAPA
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
