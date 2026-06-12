'use client'

import { useState, useEffect } from 'react'
import { useT, fmtDate } from '../lib/i18n'
import { useAuth, useRole } from '../lib/auth-context'
import { useToast } from '../components/Toast'
import {
  ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Clock,
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

function TabOverview({ liveRequirements, recallStats, complianceScore, qcFailed, complianceData, complianceLoading, recallLoading, capaList, setActiveTab, setExpandedReq }: TabOverviewProps) {
  const { t, lang } = useT()
  const attention = liveRequirements.filter(r => r.status !== 'compliant' && r.status !== 'pending')
  const reqCounts = {
    compliant:     liveRequirements.filter(r => r.status === 'compliant').length,
    non_compliant: liveRequirements.filter(r => r.status === 'non_compliant').length,
    partial:       liveRequirements.filter(r => r.status === 'partial').length,
    pending:       liveRequirements.filter(r => r.status === 'pending').length,
  }
  const readinessPct = recallStats.score
  const riskKey = complianceScore === 0 ? 'sfda.risk_medium'
    : complianceScore >= 80 ? 'sfda.risk_low'
    : complianceScore >= 60 ? 'sfda.risk_medium'
    : 'sfda.risk_high'
  const riskCls = complianceScore === 0 ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
    : complianceScore >= 80 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
    : complianceScore >= 60 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
    : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
  const lastInspectionLabel = complianceData.qcLastDate ? fmtDate(complianceData.qcLastDate, lang) : '—'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 flex flex-col items-center justify-center gap-2">
          {complianceLoading
            ? <div className="w-[140px] h-[140px] flex items-center justify-center text-sm text-[var(--muted)]">Loading…</div>
            : <ScoreRing score={complianceScore} size={140} />}
          <p className="text-sm font-medium text-[var(--muted)]">{t('sfda.score_label')}</p>
        </div>

        <div className="md:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[var(--text)]">{t('sfda.readiness_label')}</span>
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {recallLoading ? '…' : `${readinessPct}%`}
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
              <div className="bg-emerald-500 h-2.5 rounded-full" style={{ width: `${readinessPct}%` }} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--muted)]">{t('sfda.risk_label')}</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${riskCls}`}>
              <AlertTriangle size={14} />{t(riskKey)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[var(--border)]">
            {[
              { icon: CheckCircle2, cls: 'text-emerald-500', count: reqCounts.compliant,     key: 'sfda.status_compliant'     },
              { icon: XCircle,      cls: 'text-red-500',     count: reqCounts.non_compliant, key: 'sfda.status_non_compliant' },
              { icon: AlertTriangle,cls: 'text-amber-500',   count: reqCounts.partial,       key: 'sfda.status_partial'       },
              { icon: Clock,        cls: 'text-gray-400',    count: reqCounts.pending,       key: 'sfda.status_pending'       },
            ].map(({ icon: Icon, cls, count, key }) => (
              <div key={key} className="flex items-center gap-2 text-sm">
                <Icon size={14} className={`${cls} shrink-0`} />
                <span className="text-[var(--muted)]">{count} {t(key)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: ShieldAlert,  label: 'sfda.open_capas',       value: String(capaList.filter(c => c.status === 'open' || c.status === 'overdue').length), cls: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-50 dark:bg-blue-900/20'   },
          { icon: AlertTriangle,label: 'sfda.critical_findings', value: String(capaList.filter(c => c.severity === 'critical').length),                     cls: 'text-red-600 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-900/20'     },
          { icon: XCircle,      label: 'sfda.failed_qc',         value: complianceLoading ? '…' : String(qcFailed),   cls: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
          { icon: Calendar,     label: 'sfda.last_inspection',   value: complianceLoading ? '…' : lastInspectionLabel, cls: 'text-[var(--muted)]',               bg: 'bg-[var(--bg)]'                   },
        ].map(({ icon: Icon, label, value, cls, bg }) => (
          <div key={label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-3">
            <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
              <Icon size={16} className={cls} />
            </div>
            <div>
              <p className={`text-xl font-bold ${cls}`}>{value}</p>
              <p className="text-xs text-[var(--muted)] mt-0.5">{t(label)}</p>
            </div>
          </div>
        ))}
      </div>

      {attention.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-[var(--text)]">Corrective Actions Requiring Attention</h3>
            <span className="ms-auto text-xs text-[var(--muted)]">{attention.length}</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {attention.map(req => (
              <div key={req.id}
                className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[var(--bg)] transition-colors cursor-pointer"
                onClick={() => { setActiveTab('requirements'); setExpandedReq(req.id) }}>
                <div className="flex items-center gap-3">
                  <ChevronRight size={14} className="text-[var(--subtle)] shrink-0" />
                  <span className="text-sm text-[var(--text)]">{t(`sfda.${req.key}`)}</span>
                </div>
                <StatusBadge status={req.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Requirements ─────────────────────────────────────────────────────────

function TabRequirements({ liveRequirements, expandedReq, setExpandedReq }: TabRequirementsProps) {
  const { t, lang } = useT()
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--bg)]">
              {['sfda.req_col_req','sfda.req_col_evidence','sfda.req_col_records','sfda.req_col_status','sfda.req_col_updated'].map(k => (
                <th key={k} className="text-start px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{t(k)}</th>
              ))}
              <th className="w-8 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {liveRequirements.map((req, i) => {
              const description = REQ_DESCRIPTIONS[req.id]
              const isExpanded  = expandedReq === req.id
              return (
                <>
                  <tr
                    key={req.id}
                    onClick={() => setExpandedReq(isExpanded ? null : req.id)}
                    className={`border-b border-[var(--border)] cursor-pointer transition-colors
                      ${i % 2 === 0 ? 'bg-[var(--surface)]' : 'bg-[var(--bg)]'}
                      hover:bg-[var(--s3)]`}
                  >
                    <td className="px-4 py-3 font-medium text-[var(--text)]">{t(`sfda.${req.key}`)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">{req.evidence}</td>
                    <td className="px-4 py-3 text-[var(--text)]">{req.records.toLocaleString()}</td>
                    <td className="px-4 py-3"><StatusBadge status={req.status} /></td>
                    <td className="px-4 py-3 text-[var(--muted)]">{req.updated ? fmtDate(req.updated, lang) : '—'}</td>
                    <td className="px-4 py-3 text-[var(--subtle)]">
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
                Compile all GMP compliance records into an SFDA-ready inspection dossier.
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
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
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
            <tr className="border-b border-[var(--border)] bg-[var(--bg)]">
              {[
                { label: 'Personnel',        w: 'w-48' },
                { label: 'Action',           w: 'w-44' },
                { label: 'Affected Record',  w: ''     },
                { label: 'Timestamp',        w: 'w-52' },
                { label: '',                 w: 'w-8'  },
              ].map(({ label, w }) => (
                <th key={label} className={`text-start px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted)] ${w}`}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map((entry, i) => (
              <tr
                key={entry.id}
                className={`group transition-colors
                  ${i % 2 === 0 ? 'bg-[var(--surface)]' : 'bg-[var(--bg)]'}
                  hover:bg-[var(--s3)]`}
              >
                <td className="px-4 py-4">
                  <p className="text-sm font-medium text-[var(--text)] leading-snug">{entry.actor}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">{entry.role}</p>
                </td>
                <td className="px-4 py-4">
                  <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${entry.badgeCls}`}>
                    {entry.action}
                  </span>
                </td>
                <td className="px-4 py-4 text-sm text-[var(--muted)] max-w-[200px]">
                  <span className="truncate block">{entry.entity}</span>
                </td>
                <td className="px-4 py-4 text-xs text-[var(--muted)] whitespace-nowrap tabular-nums">
                  {fmtAuditTime(entry.time)}
                </td>
                <td className="px-4 py-4">
                  <span title="Immutable record"><Lock size={11} className="text-[var(--subtle)]" /></span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-[var(--muted)]">
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

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg)]">
                {['sfda.capa_col_id','sfda.capa_col_title','sfda.capa_col_severity','sfda.capa_col_due','sfda.capa_col_assigned','sfda.capa_col_status'].map(k => (
                  <th key={k} className="text-start px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{t(k)}</th>
                ))}
                <th className="w-20 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {capaList.map((capa, i) => (
                <tr key={capa.id} className={`hover:bg-[var(--s3)] transition-colors ${i % 2 === 0 ? 'bg-[var(--surface)]' : 'bg-[var(--bg)]'}`}>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--muted)] whitespace-nowrap">{capa.id}</td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="font-medium text-[var(--text)] leading-snug">{capa.title}</p>
                    {capa.root && <p className="text-xs text-[var(--muted)] mt-0.5 truncate">{capa.root}</p>}
                  </td>
                  <td className="px-4 py-3"><SeverityBadge severity={capa.severity} /></td>
                  <td className={`px-4 py-3 whitespace-nowrap text-sm font-medium ${capa.status === 'overdue' ? 'text-red-600 dark:text-red-400' : 'text-[var(--text)]'}`}>
                    {fmtDate(capa.due, lang)}
                  </td>
                  <td className="px-4 py-3 text-[var(--text)] whitespace-nowrap">{capa.assigned}</td>
                  <td className="px-4 py-3"><CAPAStatusBadge status={capa.status} /></td>
                  <td className="px-4 py-3">
                    {capa.status === 'closed' && (
                      <button
                        onClick={() => toast.info('Verification recorded')}
                        title="Record effectiveness verification"
                        className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline transition-colors">
                        <CheckCircle2 size={12} />{t('sfda.capa_verify')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {capaList.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-[var(--muted)]">No CAPA actions on record.</td></tr>
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
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 flex flex-col items-center justify-center gap-2">
          <ScoreRing score={recallStats.score} size={120} />
          <p className="text-xs font-medium text-[var(--muted)] text-center">{t('sfda.recall_score')}</p>
        </div>
        {[
          { icon: Package,    label: 'sfda.recall_affected',   value: recallLoading ? dash : String(recallStats.affected),   cls: 'text-amber-600 dark:text-amber-400',   bg: 'bg-amber-50 dark:bg-amber-900/20'   },
          { icon: TrendingUp, label: 'sfda.recall_downstream', value: recallLoading ? dash : String(recallStats.downstream), cls: 'text-blue-600 dark:text-blue-400',     bg: 'bg-blue-50 dark:bg-blue-900/20'     },
          { icon: Users,      label: 'sfda.recall_customers',  value: recallLoading ? dash : String(recallStats.customers),  cls: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-900/20' },
        ].map(({ icon: Icon, label, value, cls, bg }) => (
          <div key={label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-3">
            <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
              <Icon size={16} className={cls} />
            </div>
            <p className={`text-2xl font-bold ${cls}`}>{value}</p>
            <p className="text-xs text-[var(--muted)] -mt-2">{t(label)}</p>
          </div>
        ))}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text)]">Recall Simulation</h3>
            <p className="text-xs text-[var(--muted)] mt-1">Last run: {simLastRun}</p>
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
                <div key={item.label} className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${item.dot}`} />
                  <span className="text-sm text-[var(--text)]">{item.label}</span>
                  <span className="ms-auto text-xs text-[var(--muted)]">{item.level}</span>
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
      supabase.from('quality_inspections').select('created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(1),
      supabase.from('production_orders').select('id',  { count: 'exact', head: true }).eq('company_id', companyId),
      supabase.from('activity_logs').select('id',      { count: 'exact', head: true }).eq('company_id', companyId),
    ]).then(([{ count: qcTotal }, { count: qcPassed }, { data: qcLatest }, { count: batchCount }, { count: auditCount }]) => {
      setComplianceData({
        qcTotal:    qcTotal    ?? 0,
        qcPassed:   qcPassed   ?? 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        qcLastDate: (qcLatest as any)?.[0]?.created_at?.split('T')[0] ?? null,
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
    { id: 'capa',  key: 'req_capa',  evidence: '—',                                              records: capaList.length,           status: capaList.length > 0 ? 'partial' : 'pending',                                                              updated: null },
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

    console.log('[buildCtx] fetching PDF data for company:', companyId)

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

    console.log('[buildCtx] rows —',
      'qc:', qcData?.length ?? 'null',
      'batches:', batchData?.length ?? 'null',
      'capas:', capaData?.length ?? 'null',
      'recalls:', recallData?.length ?? 'null',
    )

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
    if (!companyId) { toast.error('Company profile not loaded — please refresh'); return }
    setSimulating(true); setSimDone(false)
    const batchId = `SIM-${Date.now().toString(36).toUpperCase()}`

    const { error: evErr } = await supabase.from('batch_events').insert([
      { company_id: companyId, batch_id: batchId, event_type: 'simulation_start',        description: 'Recall simulation drill — batch identification initiated' },
      { company_id: companyId, batch_id: batchId, event_type: 'simulation_notification', description: 'Simulated SFDA customer notification dispatched within 2 hours' },
      { company_id: companyId, batch_id: batchId, event_type: 'simulation_coverage',     description: 'Full downstream coverage confirmed — 100 % of affected batches identified' },
    ])
    const { error: rabErr } = await supabase.from('recall_affected_batches').insert([
      { company_id: companyId, batch_id: batchId, recall_reason: 'Automated recall simulation drill — not a live event', status: 'simulation', customers_affected: 0 },
    ])

    if (evErr)  console.error('[batch_events insert]', evErr.message)
    if (rabErr) console.error('[recall_affected_batches insert]', rabErr.message)

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
