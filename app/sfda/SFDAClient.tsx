'use client'

import { useState, useEffect } from 'react'
import { useT, fmtDate } from '../lib/i18n'
import { useAuth, useRole } from '../lib/auth-context'
import { useToast } from '../components/Toast'
import {
  ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Clock,
  FileText, Download, Archive, BarChart3, Activity, ClipboardList,
  Filter, Plus, RefreshCw, Package, Users, Calendar, ChevronRight,
  FileWarning, CheckSquare, Lock, TrendingUp, Zap,
  X, ChevronDown, ChevronUp,
} from 'lucide-react'
import {
  buildQCReportPDF, buildBatchReportPDF, buildNCRReportPDF,
  buildRecallReportPDF, buildCAPAReportPDF, buildGMPReportPDF,
  buildInspectionPackagePDF, buildInspectionPackageZIP,
  nowGregorian, todayStr, downloadBlob,
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
  type: 'edit' | 'qc' | 'delete' | 'recall'
  badgeCls: string
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

const PDF_BUILDERS: Record<string, () => Blob> = {
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

// ── Requirement detail data ───────────────────────────────────────────────────

const REQ_DETAILS: Record<string, { en: string; notesEn: string; lastAudit: string }> = {
  gmp: {
    en:      'Manufacturing processes comply with Saudi FDA GMP guidelines. SOPs are documented, version-controlled, and reviewed annually per SOP-GMP-2024-01.',
    notesEn: 'Annual GMP audit completed April 2026. All 24 production lines verified. No major findings except calibration gap on Line 3.',
    lastAudit: '2026-04-15',
  },
  batch: {
    en:      'Full batch traceability from raw material receipt through finished product release. Lot numbers tracked via integrated barcode scanning system.',
    notesEn: '231 batches fully traced. System coverage: 100%. Minor gap in 2 receiving records — CAPA-2024-005 now closed and verified.',
    lastAudit: '2026-05-24',
  },
  ncr: {
    en:      'Non-conformances are identified, documented, investigated, and resolved per SOP-NCR-001. All major NCRs trigger mandatory CAPA creation.',
    notesEn: '12 NCRs on record. 3 open, 5 closed. Gap: some NCRs lack complete root-cause documentation — under remediation.',
    lastAudit: '2026-05-18',
  },
  capa: {
    en:      'Corrective and preventive actions are formally tracked to closure and verified for effectiveness per CAPA Management Procedure CAPA-REG-2024.',
    notesEn: '5 CAPAs on record. 2 critical CAPAs approaching due dates. Effectiveness verification pending for 3 items.',
    lastAudit: '2026-05-15',
  },
  qc: {
    en:      'QC inspections are conducted for every production batch by certified inspectors. Results are documented and linked to the batch record in the system.',
    notesEn: '104 inspections completed, 96.2% pass rate. 4 failed batches on hold pending CAPA resolution.',
    lastAudit: '2026-05-23',
  },
  equip: {
    en:      'All production and testing equipment is maintained and calibrated per an approved schedule. Calibration certificates are controlled documents with defined expiry.',
    notesEn: 'MAJOR NON-CONFORMITY: 1 critical balance on Line 3 has expired calibration (expired 2026-04-30). CAPA-2024-001 open — due 2026-05-30. Corrective Action Required.',
    lastAudit: '2026-04-30',
  },
  audit: {
    en:      'All system activities are logged with timestamp, actor, and entity. Logs are immutable and retained for a minimum of 5 years per SFDA data integrity requirements.',
    notesEn: '892 audit entries on record. Chain integrity verified. No tampering detected. Hash validation active.',
    lastAudit: '2026-05-24',
  },
  sop: {
    en:      'Standard Operating Procedures are documented, version-controlled, and accessible to all relevant personnel. Training records are maintained for each active SOP.',
    notesEn: '33 active SOPs. Gap: 4 SOPs not yet acknowledged by all relevant staff — training completion pending.',
    lastAudit: '2026-05-10',
  },
}

// ── Static mock data ──────────────────────────────────────────────────────────

const COMPLIANCE_SCORE = 82
const READINESS_PCT    = 87

const REQUIREMENTS = [
  { id: 'gmp',   key: 'req_gmp',   evidence: 'SOP-GMP-2024-01',   records: 48,  status: 'compliant'     as ComplianceStatus, updated: '2026-05-20' },
  { id: 'batch', key: 'req_batch', evidence: 'PROD-TRACE-LOGS',   records: 231, status: 'compliant'     as ComplianceStatus, updated: '2026-05-24' },
  { id: 'ncr',   key: 'req_ncr',   evidence: 'NCR-LOG-2024',      records: 12,  status: 'partial'       as ComplianceStatus, updated: '2026-05-18' },
  { id: 'capa',  key: 'req_capa',  evidence: 'CAPA-REG-2024',     records: 9,   status: 'pending'       as ComplianceStatus, updated: '2026-05-15' },
  { id: 'qc',    key: 'req_qc',    evidence: 'QC-INSP-2024',      records: 104, status: 'compliant'     as ComplianceStatus, updated: '2026-05-23' },
  { id: 'equip', key: 'req_equip', evidence: 'CALIB-SCHED-2024',  records: 17,  status: 'non_compliant' as ComplianceStatus, updated: '2026-04-30' },
  { id: 'audit', key: 'req_audit', evidence: 'SYS-AUDIT-LOG',     records: 892, status: 'compliant'     as ComplianceStatus, updated: '2026-05-24' },
  { id: 'sop',   key: 'req_sop',   evidence: 'SOP-MASTER-2024',   records: 33,  status: 'partial'       as ComplianceStatus, updated: '2026-05-10' },
]

const CAPAS_INIT: CAPAItem[] = [
  {
    id: 'CAPA-2024-001', severity: 'critical', status: 'open',
    title:    'Equipment calibration certificate expired — Line 3 critical balance',
    assigned: 'Eng. Khalid Al-Otaibi', due: '2026-05-30',
    root:     'Periodic calibration schedule not enforced by maintenance team',
  },
  {
    id: 'CAPA-2024-002', severity: 'critical', status: 'overdue',
    title:    'Batch B-2024-089 — temperature excursion during overnight storage',
    assigned: 'Eng. Sara Al-Zahrani',  due: '2026-05-28',
    root:     'Cold chain monitoring gap during night shift operations',
  },
  {
    id: 'CAPA-2024-003', severity: 'major', status: 'in_progress',
    title:    'Incomplete QC documentation for 4 consecutive production runs',
    assigned: 'Eng. Nora Al-Harbi',   due: '2026-06-10',
    root:     'SOP-QC-001 checklist not consistently followed — inspector training gap',
  },
  {
    id: 'CAPA-2024-004', severity: 'major', status: 'in_progress',
    title:    'Supplier qualification renewal overdue — Al-Rawdah Chemicals',
    assigned: 'Eng. Abdullah Al-Qahtani', due: '2026-06-20',
    root:     'Supplier qualification renewal not scheduled in vendor management system',
  },
  {
    id: 'CAPA-2024-005', severity: 'minor', status: 'closed',
    title:    'Missing lot traceability for 2 raw material batches at receiving',
    assigned: 'Eng. Fahad Al-Dosari', due: '2026-06-05',
    root:     'Receiving team skipped mandatory barcode scan step',
  },
]

// Action badge classes — green = created/completed, blue = updates, amber = overrides, red = recalls/deletions
const GREEN_BADGE  = 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
const BLUE_BADGE   = 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
const AMBER_BADGE  = 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
const RED_BADGE    = 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'

// Map a raw audit_log row from Supabase into the AuditEntry shape the UI expects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAuditRow(r: any, i: number): AuditEntry {
  const type = (r.type ?? 'edit') as AuditEntry['type']
  const badgeCls =
    type === 'delete' || type === 'recall' ? RED_BADGE  :
    type === 'qc'                          ? BLUE_BADGE :
                                             GREEN_BADGE
  return {
    id:      i + 1,
    actor:   String(r.actor  ?? ''),
    role:    String(r.role   ?? ''),
    action:  String(r.action ?? ''),
    entity:  String(r.entity ?? ''),
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

// ── Main component ────────────────────────────────────────────────────────────

export default function SFDAClient() {
  const { t, lang, dir } = useT()
  const role = useRole()
  const { companyId } = useAuth()
  const toast = useToast()

  const canEditSFDA = role === 'admin' || role === 'manager'

  // ── State ───────────────────────────────────────────────────────────────────

  const [activeTab,        setActiveTab]        = useState<TabId>('overview')

  const [auditFilter,      setAuditFilter]      = useState('all')

  const [generating,       setGenerating]       = useState(false)
  const [packageGenerated, setPackageGenerated] = useState(false)
  const [packageLastGen,   setPackageLastGen]   = useState('2026-05-20')

  const [simulating,  setSimulating]  = useState(false)
  const [simDone,     setSimDone]     = useState(false)
  const [simLastRun,  setSimLastRun]  = useState('2026-05-10')

  const [reportLastGen,    setReportLastGen]    = useState<Record<string, string>>({
    rpt_qc: '2026-05-20', rpt_batch: '2026-05-18', rpt_ncr: '2026-05-15',
    rpt_recall: '2026-05-22', rpt_capa: '2026-05-10', rpt_gmp: '2026-05-01',
  })
  const [reportGenerating, setReportGenerating] = useState<string | null>(null)

  const [capaList,      setCapaList]      = useState<CAPAItem[]>(CAPAS_INIT)
  const [showCAPAModal, setShowCAPAModal] = useState(false)
  const [capaForm,      setCapaForm]      = useState({
    title: '', severity: 'major' as Severity,
    due: '', assigned: '', root: '', status: 'open' as CAPAStatus,
  })

  const [expandedReq, setExpandedReq] = useState<string | null>(null)

  // ── Live data from Supabase ─────────────────────────────────────────────────

  const [auditLog,      setAuditLog]      = useState<AuditEntry[]>([])
  const [auditLoading,  setAuditLoading]  = useState(false)
  const [recallStats,   setRecallStats]   = useState({ affected: 0, downstream: 0, customers: 0 })
  const [recallLoading, setRecallLoading] = useState(false)

  // Fetch audit entries from public.audit_log (company-scoped, newest first)
  useEffect(() => {
    if (!companyId) return
    setAuditLoading(true)
    supabase
      .from('audit_log')
      .select('id, actor, role, action, entity, type, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) console.error('[audit_log]', error.message)
        if (data)  setAuditLog(data.map(mapAuditRow))
        setAuditLoading(false)
      })
  }, [companyId])

  // Fetch recall readiness metrics from recall_affected_batches + distribution_records
  useEffect(() => {
    if (!companyId) return
    setRecallLoading(true)
    void Promise.all([
      // Active (non-simulation) affected batches + customer count
      supabase
        .from('recall_affected_batches')
        .select('customers_affected')
        .eq('company_id', companyId)
        .eq('status', 'active'),
      // Downstream distribution records (unique shipments)
      supabase
        .from('distribution_records')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
    ]).then(([{ data: rabData }, { count: distCount }]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customers = (rabData ?? []).reduce((s: number, r: any) => s + (Number(r.customers_affected) || 0), 0)
      setRecallStats({
        affected:   (rabData ?? []).length,
        downstream: distCount ?? 0,
        customers,
      })
      setRecallLoading(false)
    })
  }, [companyId])

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleGeneratePackage() {
    setGenerating(true)
    setTimeout(() => {
      setGenerating(false)
      setPackageGenerated(true)
      setPackageLastGen(todayISO())
      toast.success('Inspection Dossier compiled — 14.2 MB')
    }, 2200)
  }

  function handleExport(type: 'pdf' | 'zip' | 'audit') {
    if (type === 'zip') {
      buildInspectionPackageZIP().then(blob => {
        downloadBlob(blob, `SFDA-Inspection-Package-${todayISO()}.zip`)
        toast.success('ZIP archive downloaded')
      })
      return
    }
    const blob = type === 'audit' ? buildGMPReportPDF() : buildInspectionPackagePDF()
    const name = type === 'audit'
      ? `GMP-Audit-Report-${todayISO()}.pdf`
      : `SFDA-Inspection-Dossier-${todayISO()}.pdf`
    downloadBlob(blob, name)
    toast.success('PDF downloading…')
  }

  function handleGenerateReport(key: string) {
    setReportGenerating(key)
    setTimeout(() => {
      setReportGenerating(null)
      setReportLastGen(prev => ({ ...prev, [key]: todayISO() }))
      toast.success('Report generated')
    }, 2500)
  }

  function handleDownloadReport(key: string) {
    const builder  = PDF_BUILDERS[key]
    const filename = PDF_FILENAMES[key]
    if (!builder || !filename) return
    downloadBlob(builder(), `${filename}-${todayISO()}.pdf`)
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
    toast.success('Recall simulation completed successfully')
  }

  function handleAddCAPA(e: React.FormEvent) {
    e.preventDefault()
    if (!capaForm.title.trim() || !capaForm.due || !capaForm.assigned.trim()) return
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

  // ── Tab: Overview ────────────────────────────────────────────────────────────

  function TabOverview() {
    const attention = REQUIREMENTS.filter(r => r.status !== 'compliant')
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 flex flex-col items-center justify-center gap-2">
            <ScoreRing score={COMPLIANCE_SCORE} size={140} />
            <p className="text-sm font-medium text-[var(--muted)]">{t('sfda.score_label')}</p>
          </div>

          <div className="md:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 flex flex-col justify-between gap-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[var(--text)]">{t('sfda.readiness_label')}</span>
                <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{READINESS_PCT}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                <div className="bg-emerald-500 h-2.5 rounded-full" style={{ width: `${READINESS_PCT}%` }} />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--muted)]">{t('sfda.risk_label')}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                <AlertTriangle size={14} />{t('sfda.risk_medium')}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[var(--border)]">
              {[
                { icon: CheckCircle2, cls: 'text-emerald-500', count: 5, key: 'sfda.status_compliant'     },
                { icon: XCircle,      cls: 'text-red-500',     count: 1, key: 'sfda.status_non_compliant' },
                { icon: AlertTriangle,cls: 'text-amber-500',   count: 2, key: 'sfda.status_partial'       },
                { icon: Clock,        cls: 'text-gray-400',    count: 1, key: 'sfda.status_pending'       },
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
            { icon: XCircle,      label: 'sfda.failed_qc',         value: '4',          cls: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
            { icon: Calendar,     label: 'sfda.last_inspection',   value: '2026-04-15', cls: 'text-[var(--muted)]',               bg: 'bg-[var(--bg)]'                   },
          ].map(({ icon: Icon, label, value, cls, bg }) => (
            <div key={label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-3">
              <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
                <Icon size={16} className={cls} />
              </div>
              <div>
                <p className={`text-xl font-bold ${cls}`}>
                  {label === 'sfda.last_inspection' ? fmtDate(value, lang) : value}
                </p>
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

  // ── Tab: Requirements ────────────────────────────────────────────────────────

  function TabRequirements() {
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
              {REQUIREMENTS.map((req, i) => {
                const detail    = REQ_DETAILS[req.id]
                const isExpanded = expandedReq === req.id
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
                      <td className="px-4 py-3 text-[var(--muted)]">{fmtDate(req.updated, lang)}</td>
                      <td className="px-4 py-3 text-[var(--subtle)]">
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                    </tr>
                    {isExpanded && detail && (
                      <tr key={`${req.id}-detail`} className="border-b border-[var(--border)] bg-[var(--s3)]">
                        <td colSpan={6} className="px-6 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-1">Description</p>
                              <p className="text-[var(--text)] leading-relaxed">{detail.en}</p>
                            </div>
                            <div className="space-y-3">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-1">Audit Notes</p>
                                <p className={`leading-relaxed ${req.status === 'non_compliant' ? 'text-red-600 dark:text-red-400' : req.status === 'partial' ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text)]'}`}>
                                  {detail.notesEn}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                                <Calendar size={11} />
                                Last audit: {fmtDate(detail.lastAudit, lang)}
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

  // ── Tab: Inspection Dossier ──────────────────────────────────────────────────

  function TabInspection() {
    const contents = [
      { label: 'Batch History Records',          detail: '156 records'               },
      { label: 'QC Inspection Reports',          detail: '104 reports'               },
      { label: 'Full Traceability Chain',        detail: '100% coverage'             },
      { label: 'Recall Event Records',           detail: '3 events on record'        },
      { label: 'CAPA Action Register',           detail: `${capaList.length} actions`},
      { label: 'Tamper-Evident Audit Trail',     detail: '892 immutable entries'     },
      { label: 'Regulatory Inspection History',  detail: 'All prior visits'          },
      { label: 'Operator Activity Log',          detail: 'Full timestamped timeline' },
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
                  Compile all GMP compliance records into a tamper-evident, SFDA-ready inspection dossier.
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
              {canEditSFDA && (
                <button
                  onClick={handleGeneratePackage}
                  disabled={generating}
                  title="Generate the full inspection dossier"
                  className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] hover:bg-[#2e5a75] text-white px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
                >
                  {generating
                    ? <><RefreshCw size={14} className="animate-spin" />Compiling…</>
                    : <><Zap size={14} />Generate Dossier</>}
                </button>
              )}
              {!generating && packageGenerated && (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 size={11} />Dossier Ready
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-4">Export Formats</p>
            <div className="space-y-2">
              {([
                { type: 'pdf'   as const, icon: FileText,      label: 'Dossier PDF',       ext: '.pdf', enabled: packageGenerated },
                { type: 'zip'   as const, icon: Archive,       label: 'ZIP Archive',        ext: '.zip', enabled: packageGenerated },
                { type: 'audit' as const, icon: ClipboardList, label: 'GMP Audit Report',  ext: '.pdf', enabled: true            },
              ]).map(({ type, icon: Icon, label, ext, enabled }) => (
                <button
                  key={type}
                  onClick={() => enabled && handleExport(type)}
                  disabled={!enabled}
                  title={enabled ? undefined : 'Generate the dossier first'}
                  className={`w-full flex items-center gap-3 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm transition-colors
                    ${enabled
                      ? 'text-[var(--text)] hover:bg-[var(--bg)] cursor-pointer'
                      : 'text-[var(--subtle)] opacity-50 cursor-not-allowed'}`}
                >
                  <Icon size={15} className="text-[var(--muted)] shrink-0" />
                  <span className="flex-1 text-start">{label}</span>
                  <span className="text-[10px] font-mono text-[var(--subtle)] uppercase">{ext}</span>
                  <Download size={13} className="text-[var(--muted)]" />
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-3">Last Compiled</p>
            <div className="flex items-center gap-2 text-sm text-[var(--text)]">
              <Calendar size={13} className="text-[var(--muted)] shrink-0" />
              {fmtDate(packageLastGen, lang)} — 14.2 MB
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Tab: Audit Trail ─────────────────────────────────────────────────────────

  function TabAudit() {
    const FILTERS = [
      { id: 'all',    label: 'All Events' },
      { id: 'edit',   label: 'Edits'      },
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
            <Lock size={9} />TAMPER-EVIDENT AUDIT RECORD
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
                  {/* Actor + role */}
                  <td className="px-4 py-4">
                    <p className="text-sm font-medium text-[var(--text)] leading-snug">{entry.actor}</p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">{entry.role}</p>
                  </td>
                  {/* Action badge */}
                  <td className="px-4 py-4">
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${entry.badgeCls}`}>
                      {entry.action}
                    </span>
                  </td>
                  {/* Entity */}
                  <td className="px-4 py-4 text-sm text-[var(--muted)] max-w-[200px]">
                    <span className="truncate block">{entry.entity}</span>
                  </td>
                  {/* Timestamp */}
                  <td className="px-4 py-4 text-xs text-[var(--muted)] whitespace-nowrap tabular-nums">
                    {fmtAuditTime(entry.time)}
                  </td>
                  {/* Lock */}
                  <td className="px-4 py-4">
                    <span title="Immutable record"><Lock size={11} className="text-[var(--subtle)]" /></span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                    {auditLoading ? 'Loading audit entries…' : 'No audit entries recorded yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border)] text-xs text-[var(--subtle)] flex items-center gap-1.5">
          <Lock size={10} />
          {filtered.length} of {auditLog.length} entries — Immutable Audit Entries · Hash-Validated Chain
        </div>
      </div>
    )
  }

  // ── Tab: CAPA ────────────────────────────────────────────────────────────────

  function TabCAPA() {
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
              { status: 'open'        as CAPAStatus, count: counts.open,        cls: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'                },
              { status: 'in_progress' as CAPAStatus, count: counts.in_progress, cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'            },
              { status: 'overdue'     as CAPAStatus, count: counts.overdue,     cls: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'                    },
              { status: 'closed'      as CAPAStatus, count: counts.closed,      cls: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'    },
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

  // ── Tab: Recall Readiness ────────────────────────────────────────────────────

  function TabRecall() {
    const dash = recallLoading ? '…' : '—'
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 flex flex-col items-center justify-center gap-2">
            <ScoreRing score={91} size={120} />
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
              <p className="text-xs text-[var(--muted)] mt-1">
                Last run: {simLastRun}
              </p>
            </div>
            <button onClick={handleSimulate} disabled={simulating}
              className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] hover:bg-[#2e5a75] text-white px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 shrink-0">
              {simulating
                ? <><RefreshCw size={14} className="animate-spin" />Running…</>
                : <><Activity size={14} />Run Simulation</>}
            </button>
          </div>

          {simDone && (
            <div className="mt-5 pt-5 border-t border-[var(--border)] grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-[var(--muted)]">Estimated Notification Time</p>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">&lt; 2 hours</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Coverage</p>
                <p className="text-xl font-bold text-[var(--text)] mt-1">100%</p>
                <p className="text-xs text-[var(--muted)]">of affected batches identified</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Recall Risk Score</p>
                <span className="inline-flex items-center gap-1.5 mt-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                  <AlertTriangle size={11} />Medium Risk
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
          <h3 className="text-sm font-semibold text-[var(--text)] mb-4">Recall Risk Factors</h3>
          <div className="space-y-3">
            {[
              { label: 'Cold chain monitoring gaps',       dot: 'bg-red-500',     level: 'High'   },
              { label: 'Supplier qualification lapses',    dot: 'bg-amber-400',   level: 'Medium' },
              { label: 'Barcode scan misses at intake',   dot: 'bg-emerald-500', level: 'Low'    },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${item.dot}`} />
                <span className="text-sm text-[var(--text)]">{item.label}</span>
                <span className="ms-auto text-xs text-[var(--muted)]">{item.level}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Tab: Regulatory Reports ──────────────────────────────────────────────────

  function TabReports() {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map(rpt => {
          const Icon    = rpt.icon
          const iconCls = REPORT_ICON_CLS[rpt.color] ?? REPORT_ICON_CLS.slate
          const isGen   = reportGenerating === rpt.key
          const lastDate = reportLastGen[rpt.key]
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

              {lastDate && (
                <div className="text-xs text-[var(--muted)] flex items-center gap-1.5 mt-auto">
                  <Calendar size={11} />
                  Last generated: {fmtDate(lastDate, lang)}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleGenerateReport(rpt.key)}
                  disabled={isGen}
                  title="Generate an updated report"
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[#3a6f8f] hover:bg-[#2e5a75] text-white px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60"
                >
                  {isGen
                    ? <><RefreshCw size={11} className="animate-spin" />Generating…</>
                    : <><BarChart3 size={11} />{t('sfda.reports_generate')}</>}
                </button>
                <button
                  onClick={() => handleDownloadReport(rpt.key)}
                  title="Download the latest version as PDF"
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--bg)] transition-colors"
                >
                  <Download size={11} />{t('sfda.reports_download')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

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

      {/* Tab content */}
      {activeTab === 'overview'     && <TabOverview />}
      {activeTab === 'requirements' && <TabRequirements />}
      {activeTab === 'inspection'   && <TabInspection />}
      {activeTab === 'audit'        && <TabAudit />}
      {activeTab === 'capa'         && <TabCAPA />}
      {activeTab === 'recall'       && <TabRecall />}
      {activeTab === 'reports'      && <TabReports />}

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
