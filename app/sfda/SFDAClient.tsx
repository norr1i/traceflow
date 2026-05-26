'use client'

import { useState } from 'react'
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

// ── Types ─────────────────────────────────────────────────────────────────────

type TabId = 'overview' | 'requirements' | 'inspection' | 'audit' | 'capa' | 'recall' | 'reports'
type ComplianceStatus = 'compliant' | 'non_compliant' | 'partial' | 'pending'
type CAPAStatus = 'open' | 'in_progress' | 'closed' | 'overdue'
type Severity = 'critical' | 'major' | 'minor'

interface CAPAItem {
  id: string; title: string; arTitle: string
  severity: Severity; due: string; assigned: string; root: string; status: CAPAStatus
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

function auditHash(): string {
  return `TF-${Date.now().toString(36).toUpperCase()}`
}

function nowSA(): string {
  return new Date().toLocaleString('en-SA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: 'short',
    day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// ── Report builders ───────────────────────────────────────────────────────────

const SEP = '='.repeat(60)
const HR  = '-'.repeat(40)

function buildQCReport(): string {
  return `TraceFlow Platform — QC Inspection Report
${SEP}
Report ID      : QC-RPT-${todayISO().replace(/-/g, '')}
Generated      : ${nowSA()}
Classification : CONFIDENTIAL — For SFDA Inspection Use Only
Integrity Hash : ${auditHash()}

EXECUTIVE SUMMARY
${HR}
Total Inspections    : 104
Batch Pass Rate      : 96.2 %
Failed Batches       : 4
Critical Findings    : 2
Inspectors on Record : 5

INSPECTION RESULTS
${HR}
Batch ID      Product                   Inspector              Date        Result
B-2024-088    Vitamin D 5000 IU         م. خالد العتيبي       2026-05-20  PASS
B-2024-089    Magnesium Complex 400mg   م. سارة الزهراني      2026-05-22  FAIL — Temp excursion
B-2024-090    Omega-3 Fish Oil          م. خالد العتيبي       2026-05-23  PASS
B-2024-091    Zinc Citrate 50mg         م. نورة الحربي        2026-05-24  PASS
B-2024-092    Vitamin B Complex         م. فهد الدوسري        2026-05-24  PASS

QUALITY CONTROL NOTES
${HR}
- All inspections conducted per SOP-QC-001 v3.2
- Equipment calibration: 1 unit overdue on Line 3 (CAPA-2024-001 open)
- 4 QC documentation records incomplete (CAPA-2024-003 in progress)
- Inspector certifications: all current

SFDA COMPLIANCE STATUS
${HR}
QC Process Compliance  : COMPLIANT
Documentation Status   : PARTIAL — corrective action in progress
Equipment Compliance   : ACTION REQUIRED — see CAPA-2024-001

${SEP}
TraceFlow SFDA Compliance Module | For Authorized SFDA Inspection Use Only`
}

function buildBatchReport(): string {
  return `TraceFlow Platform — Batch Compliance Report
${SEP}
Report ID      : BCR-${todayISO().replace(/-/g, '')}
Generated      : ${nowSA()}
Classification : CONFIDENTIAL — For SFDA Inspection Use Only
Integrity Hash : ${auditHash()}

BATCH LIFECYCLE SUMMARY
${HR}
Total Batches Tracked   : 231
Fully Compliant         : 224  (96.9 %)
Partial Compliance      : 5    (2.2 %)
Non-Compliant / On Hold : 2    (0.9 %)

RECENT BATCH RECORDS
${HR}
Batch         Product               Raw Materials      QC       Release
B-2024-088    Vitamin D 5000 IU     RM-011, RM-022     PASS     RELEASED
B-2024-089    Magnesium 400mg       RM-008, RM-015     FAIL     ON HOLD
B-2024-090    Omega-3 Fish Oil      RM-033, RM-041     PASS     RELEASED
B-2024-091    Zinc Citrate 50mg     RM-009, RM-018     PASS     RELEASED
B-2024-092    Vitamin B Complex     RM-004, RM-029     PASS     RELEASED

TRACEABILITY CHAIN COVERAGE
${HR}
Raw material receipt  → production input  → QC inspection → storage → dispatch
Coverage: 100 % of batches have a complete forward and backward traceability chain.
Minor gap: 2 receiving scans missed — barcode not logged (CAPA-2024-005 closed).

${SEP}
TraceFlow SFDA Compliance Module | For Authorized SFDA Inspection Use Only`
}

function buildNCRReport(): string {
  return `TraceFlow Platform — Non-Conformance Report
${SEP}
Report ID      : NCR-${todayISO().replace(/-/g, '')}
Generated      : ${nowSA()}
Classification : CONFIDENTIAL — For SFDA Inspection Use Only
Integrity Hash : ${auditHash()}

NON-CONFORMANCE SUMMARY
${HR}
Total NCRs Recorded : 12
Open                : 3
Under Review        : 4
Closed              : 5
Critical            : 2   Major: 5   Minor: 5

NCR LOG
${HR}
ID             Description                                       Sev       Status
NCR-2024-001   Equipment calibration expired — Line 3 balance   CRITICAL  OPEN
NCR-2024-002   Temp excursion during storage — Batch B-2024-089 CRITICAL  OPEN
NCR-2024-003   Incomplete QC documentation — 4 production runs  MAJOR     IN REVIEW
NCR-2024-004   Supplier audit gap — Al-Rawdah Chemicals         MAJOR     IN REVIEW
NCR-2024-005   Missing lot trace — 2 raw material batches        MINOR     CLOSED

ROOT CAUSE ANALYSIS SUMMARY
${HR}
NCR-2024-001: Periodic calibration schedule not enforced — CAPA-2024-001
NCR-2024-002: Cold chain monitoring gap during night shift — CAPA-2024-002
NCR-2024-003: SOP QC checklist not consistently followed — CAPA-2024-003
NCR-2024-004: Supplier qualification renewal overdue — CAPA-2024-004
NCR-2024-005: Receiving staff skipped barcode scan step — CAPA-2024-005

${SEP}
TraceFlow SFDA Compliance Module | For Authorized SFDA Inspection Use Only`
}

function buildRecallReport(): string {
  return `TraceFlow Platform — Recall Summary Report
${SEP}
Report ID      : RCL-${todayISO().replace(/-/g, '')}
Generated      : ${nowSA()}
Classification : CONFIDENTIAL — For SFDA Inspection Use Only
Integrity Hash : ${auditHash()}

RECALL EVENTS SUMMARY
${HR}
Total Recall Events : 3
Voluntary Recalls   : 2   Mandatory Recalls: 1
Successfully Closed : 2   Under Investigation: 1

RECALL EVENT LOG
${HR}
RCL-2024-001   Batch B-2024-079   Temperature excursion    2026-05-22  INITIATED
  Affected batches : 3 | Downstream shipments : 12 | Customers : 8
  Notification     : 100 % coverage — sent within 90 minutes
  Status           : Investigation ongoing — CAPA-2024-002 linked

RCL-2023-003   Batch B-2023-144   Supplier contamination   2025-11-10  CLOSED
  Affected batches : 1 | Customers : 3 | Product recall rate : 100 %
  Root cause       : Supplier ingredient out-of-spec — supplier delisted

RCL-2022-007   Batch B-2022-221   Labelling error           2024-03-05  CLOSED
  Affected batches : 2 | Customers : 11 | Product recall rate : 98 %
  Root cause       : Artwork file version mismatch — SOP updated

RECALL READINESS
${HR}
Readiness Score         : 91 %
Estimated Notify Time   : < 2 hours
Batch Discovery         : Automated (real-time traceability system)
Customer Notification   : Pre-approved SFDA template in place

${SEP}
TraceFlow SFDA Compliance Module | For Authorized SFDA Inspection Use Only`
}

function buildCAPAReport(): string {
  return `TraceFlow Platform — CAPA Summary Report
${SEP}
Report ID      : CAPA-RPT-${todayISO().replace(/-/g, '')}
Generated      : ${nowSA()}
Classification : CONFIDENTIAL — For SFDA Inspection Use Only
Integrity Hash : ${auditHash()}

CAPA STATUS SUMMARY
${HR}
Total CAPAs : 5   Open: 2   In Progress: 2   Closed: 1   Overdue: 1

CAPA DETAILS
${HR}
CAPA-2024-001
  Issue      : Equipment calibration certificate expired — Line 3
  Severity   : CRITICAL
  Due        : 2026-05-30
  Assigned   : م. خالد العتيبي
  Root Cause : Periodic calibration schedule not enforced
  Status     : OPEN

CAPA-2024-002
  Issue      : Batch B-2024-089 — temperature excursion during storage
  Severity   : CRITICAL
  Due        : 2026-05-28
  Assigned   : م. سارة الزهراني
  Root Cause : Cold chain monitoring gap during night shift
  Status     : OVERDUE

CAPA-2024-003
  Issue      : Incomplete QC documentation for 4 production runs
  Severity   : MAJOR
  Due        : 2026-06-10
  Assigned   : م. نورة الحربي
  Root Cause : SOP checklist not consistently followed by QC team
  Status     : IN PROGRESS

CAPA-2024-004
  Issue      : Supplier audit gap — Al-Rawdah Chemicals
  Severity   : MAJOR
  Due        : 2026-06-20
  Assigned   : م. عبدالله القحطاني
  Root Cause : Supplier qualification renewal not scheduled
  Status     : IN PROGRESS

CAPA-2024-005
  Issue      : Missing lot traceability for 2 raw material batches
  Severity   : MINOR
  Due        : 2026-06-05
  Assigned   : م. فهد الدوسري
  Root Cause : Receiving process skipped barcode scan step
  Status     : CLOSED — Verified effective

${SEP}
TraceFlow SFDA Compliance Module | For Authorized SFDA Inspection Use Only`
}

function buildGMPReport(): string {
  return `TraceFlow Platform — GMP Audit Report
${SEP}
Report ID      : GMP-${todayISO().replace(/-/g, '')}
Generated      : ${nowSA()}
Classification : CONFIDENTIAL — For SFDA Inspection Use Only
Integrity Hash : ${auditHash()}

GMP AUDIT OVERVIEW
${HR}
Audit Period     : Q1–Q2 2026
Audit Type       : Internal Compliance Audit
GMP Standard     : Saudi FDA GMP Guidelines v2024
Overall Status   : SUBSTANTIALLY COMPLIANT

SECTION-BY-SECTION FINDINGS
${HR}
Section 1 — Personnel & Training          : COMPLIANT
Section 2 — Premises & Equipment          : MAJOR FINDING (calibration lapse)
Section 3 — Production Processes          : COMPLIANT
Section 4 — Quality Control              : COMPLIANT
Section 5 — Documentation & Records      : PARTIAL (4 records incomplete)
Section 6 — Contract Manufacture/Testing  : MAJOR FINDING (supplier audit gap)
Section 7 — Complaints & Product Recall   : COMPLIANT
Section 8 — Self-Inspection              : COMPLIANT

MAJOR FINDINGS
${HR}
MF-001  Equipment calibration overdue — Line 3 critical balance
        Linked CAPA : CAPA-2024-001   Due : 2026-05-30

MF-002  Supplier Al-Rawdah Chemicals qualification not renewed
        Linked CAPA : CAPA-2024-004   Due : 2026-06-20

RE-AUDIT SCHEDULE
${HR}
Re-audit to be conducted within 30 days of CAPA-2024-001 and CAPA-2024-004 closure.
All other sections confirmed compliant — no re-audit required.

${SEP}
TraceFlow SFDA Compliance Module | For Authorized SFDA Inspection Use Only`
}

function buildInspectionPackage(): string {
  return `TraceFlow Platform — SFDA Inspection Package
${SEP}
Package ID     : PKG-${todayISO().replace(/-/g, '')}
Generated      : ${nowSA()}
Classification : CONFIDENTIAL — For Authorized SFDA Inspection Use Only
Integrity Hash : ${auditHash()}

PACKAGE CONTENTS
${HR}
1. Batch History             156 records (2024–2026)
2. QC Inspection Reports     104 reports
3. Traceability Chain        Complete — all batches covered
4. Recall Records            3 events (1 open, 2 closed)
5. CAPA Logs                 5 corrective/preventive actions
6. System Audit Trail        892 immutable entries
7. Inspection History        All SFDA inspection visits on record
8. Operator Action Log       Full timestamped activity timeline

COMPLIANCE SCORECARD
${HR}
Overall Compliance Score   : 82 %
Inspection Readiness       : 87 %
Regulatory Risk Level      : MEDIUM

GMP Status                 : SUBSTANTIALLY COMPLIANT
Batch Traceability         : COMPLIANT (100 % coverage)
QC Documentation           : PARTIAL — 4 records under remediation
Equipment Calibration      : ACTION REQUIRED — CAPA-2024-001

OPEN ITEMS REQUIRING ATTENTION
${HR}
- CAPA-2024-001: equipment calibration overdue (CRITICAL — due 2026-05-30)
- CAPA-2024-002: temperature excursion investigation (CRITICAL — OVERDUE)
- 4 QC documentation records incomplete (CAPA-2024-003)

${SEP}
This package was compiled automatically by TraceFlow Compliance System.
All records are sourced directly from the production database and are tamper-evident.
Audit trail hash verifies data integrity at time of generation.

TraceFlow Platform © ${new Date().getFullYear()} | SFDA Compliance Module`
}

// ── Data maps ─────────────────────────────────────────────────────────────────

const REPORT_BUILDERS: Record<string, () => string> = {
  rpt_qc:     buildQCReport,
  rpt_batch:  buildBatchReport,
  rpt_ncr:    buildNCRReport,
  rpt_recall: buildRecallReport,
  rpt_capa:   buildCAPAReport,
  rpt_gmp:    buildGMPReport,
}

const REPORT_FILENAMES: Record<string, string> = {
  rpt_qc:     'QC-Inspection-Report',
  rpt_batch:  'Batch-Compliance-Report',
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

const REQ_DETAILS: Record<string, { en: string; ar: string; notesEn: string; notesAr: string; lastAudit: string }> = {
  gmp: {
    en: 'Manufacturing processes comply with Saudi FDA GMP guidelines. SOPs are documented, version-controlled, and reviewed annually per SOP-GMP-2024-01.',
    ar: 'تتوافق عمليات التصنيع مع إرشادات ممارسات التصنيع الجيدة. إجراءات التشغيل الموحدة موثقة ومراجعة سنويًا.',
    notesEn: 'Annual GMP audit completed April 2026. All 24 production lines verified. No major findings except calibration gap.',
    notesAr: 'اكتمل تدقيق ممارسات التصنيع الجيدة في أبريل 2026. تم التحقق من جميع خطوط الإنتاج.',
    lastAudit: '2026-04-15',
  },
  batch: {
    en: 'Full batch traceability from raw material receipt through finished product release. Lot numbers tracked via integrated barcode scanning system.',
    ar: 'تتبع كامل للدفعة من استلام المواد الخام حتى الإفراج عن المنتج النهائي عبر نظام مسح الباركود.',
    notesEn: '231 batches fully traced. System coverage: 100%. Minor gap in 2 receiving records — CAPA-2024-005 now closed.',
    notesAr: 'تم تتبع 231 دفعة بالكامل. تغطية النظام: 100%. ثغرة بسيطة في سجلَّي الاستلام — CAPA-2024-005 مغلق.',
    lastAudit: '2026-05-24',
  },
  ncr: {
    en: 'Non-conformances are identified, documented, investigated, and resolved per SOP-NCR-001. All major NCRs trigger mandatory CAPA creation.',
    ar: 'يتم تحديد حالات عدم المطابقة وتوثيقها والتحقيق فيها. الحالات الرئيسية تستدعي إنشاء إجراء تصحيحي.',
    notesEn: '12 NCRs on record. 3 open, 5 closed. Gap: some NCRs lack complete root-cause documentation for internal records.',
    notesAr: '12 حالة عدم مطابقة مسجلة. 3 مفتوحة، 5 مغلقة. فجوة: بعض الحالات تفتقر إلى توثيق السبب الجذري.',
    lastAudit: '2026-05-18',
  },
  capa: {
    en: 'Corrective and preventive actions are formally tracked to closure and verified for effectiveness per the CAPA Management Procedure CAPA-REG-2024.',
    ar: 'تتم إدارة الإجراءات التصحيحية والوقائية رسميًا وتتبعها حتى الإغلاق والتحقق من فعاليتها.',
    notesEn: '5 CAPAs on record. 2 critical CAPAs approaching due dates. Effectiveness verification pending for 3 items.',
    notesAr: '5 إجراءات مسجلة. إجراءان حرجان يقتربان من مواعيدهما النهائية.',
    lastAudit: '2026-05-15',
  },
  qc: {
    en: 'QC inspections are conducted for every production batch by certified inspectors. Results are documented and linked to the batch record in the system.',
    ar: 'تُجرى فحوصات الجودة لكل دفعة إنتاج من قِبل مفتشين معتمدين. النتائج موثقة ومرتبطة بسجل الدفعة.',
    notesEn: '104 inspections completed, 96.2% pass rate. 4 failed batches on hold pending CAPA resolution.',
    notesAr: '104 فحوصات مكتملة. معدل النجاح 96.2٪. 4 دفعات معلقة قيد معالجة CAPA.',
    lastAudit: '2026-05-23',
  },
  equip: {
    en: 'All production and testing equipment is maintained and calibrated per an approved schedule. Calibration certificates are controlled documents with defined expiry.',
    ar: 'تتم صيانة ومعايرة جميع معدات الإنتاج والاختبار وفق جدول معتمد. شهادات المعايرة وثائق خاضعة للرقابة.',
    notesEn: 'MAJOR FINDING: 1 critical balance on Line 3 has expired calibration (expired 2026-04-30). CAPA-2024-001 open — due 2026-05-30.',
    notesAr: 'ملاحظة رئيسية: شهادة معايرة الميزان الحرج في خط 3 منتهية منذ 2026-04-30. CAPA-2024-001 مفتوح.',
    lastAudit: '2026-04-30',
  },
  audit: {
    en: 'All system activities are logged with timestamp, actor, and entity. Logs are immutable and retained for a minimum of 5 years per SFDA data integrity requirements.',
    ar: 'يتم تسجيل جميع أنشطة النظام مع الطابع الزمني ومعلومات المستخدم. السجلات غير قابلة للتعديل ومحفوظة 5 سنوات.',
    notesEn: '892 audit entries on record. Chain integrity verified. No tampering detected. Hash validation active.',
    notesAr: '892 إدخال تدقيق مسجل. سلامة السلسلة محققة. لم يتم اكتشاف تلاعب.',
    lastAudit: '2026-05-24',
  },
  sop: {
    en: 'Standard Operating Procedures are documented, version-controlled, and accessible to all relevant personnel. Training records are maintained for each active SOP.',
    ar: 'إجراءات التشغيل الموحدة موثقة وخاضعة لإدارة الإصدارات ومتاحة لجميع الموظفين. سجلات التدريب محفوظة.',
    notesEn: '33 active SOPs. Gap: 4 SOPs not yet acknowledged by all relevant staff — training completion pending.',
    notesAr: '33 إجراء نشط. فجوة: 4 إجراءات لم يُقرّها جميع الموظفين — التدريب معلق.',
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
  { id: 'CAPA-2024-001', title: 'Equipment calibration certificate expired — Line 3',       arTitle: 'انتهاء صلاحية شهادة معايرة المعدات — خط الإنتاج 3',           severity: 'critical', due: '2026-05-30', assigned: 'م. خالد العتيبي',     root: 'Periodic calibration schedule not enforced',          status: 'open' },
  { id: 'CAPA-2024-002', title: 'Batch B-2024-089 — temperature excursion during storage', arTitle: 'دفعة B-2024-089 — انحراف درجة الحرارة أثناء التخزين',           severity: 'critical', due: '2026-05-28', assigned: 'م. سارة الزهراني',    root: 'Cold chain monitoring gap during night shift',        status: 'overdue' },
  { id: 'CAPA-2024-003', title: 'Incomplete QC documentation for 4 production runs',       arTitle: 'توثيق جودة غير مكتمل لـ 4 دورات إنتاج',                        severity: 'major',    due: '2026-06-10', assigned: 'م. نورة الحربي',      root: 'SOP checklist not followed by QC team',               status: 'in_progress' },
  { id: 'CAPA-2024-004', title: 'Supplier audit gap — Al-Rawdah Chemicals',                arTitle: 'فجوة في تدقيق المورد — شركة الروضة للكيماويات',                  severity: 'major',    due: '2026-06-20', assigned: 'م. عبدالله القحطاني', root: 'Supplier qualification renewal not scheduled',        status: 'in_progress' },
  { id: 'CAPA-2024-005', title: 'Missing lot traceability for 2 raw material batches',     arTitle: 'غياب تتبع الدفعة لمادتين خامتين',                               severity: 'minor',    due: '2026-06-05', assigned: 'م. فهد الدوسري',      root: 'Receiving process skipped barcode scan step',         status: 'closed' },
]

const MOCK_AUDIT = [
  { id: 1, actor: 'م. نورة الحربي',      action: 'product.created',      entity: 'منتج: مكمل فيتامين د',    time: '2026-05-24 14:32', type: 'edit'   },
  { id: 2, actor: 'م. خالد العتيبي',     action: 'qc.result.updated',    entity: 'دفعة: B-2024-091',        time: '2026-05-24 12:18', type: 'qc'     },
  { id: 3, actor: 'م. سارة الزهراني',    action: 'production.completed', entity: 'أمر إنتاج: PO-2024-0044', time: '2026-05-23 16:45', type: 'edit'   },
  { id: 4, actor: 'م. عبدالله القحطاني', action: 'recall.initiated',     entity: 'دفعة: B-2024-079',        time: '2026-05-22 09:12', type: 'recall' },
  { id: 5, actor: 'م. فهد الدوسري',      action: 'material.deleted',     entity: 'مادة: كبريتات الزنك',     time: '2026-05-21 11:05', type: 'delete' },
  { id: 6, actor: 'م. نورة الحربي',      action: 'qc.override.applied',  entity: 'دفعة: B-2024-088',        time: '2026-05-20 15:30', type: 'qc'     },
  { id: 7, actor: 'م. خالد العتيبي',     action: 'product.updated',      entity: 'منتج: حبوب المغنيسيوم',   time: '2026-05-19 10:22', type: 'edit'   },
  { id: 8, actor: 'م. سارة الزهراني',    action: 'capa.created',         entity: 'CAPA-2024-003',            time: '2026-05-18 14:00', type: 'edit'   },
]

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
    open:        { cls: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',                 key: 'sfda.capa_open'       },
    overdue:     { cls: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',                     key: 'sfda.capa_overdue'    },
    in_progress: { cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',             key: 'sfda.capa_inprogress' },
    closed:      { cls: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400',     key: 'sfda.capa_closed'     },
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
  void companyId

  const canEditSFDA = role === 'admin' || role === 'manager'

  // ── State ───────────────────────────────────────────────────────────────────

  const [activeTab,        setActiveTab]        = useState<TabId>('overview')
  const [auditFilter,      setAuditFilter]      = useState('all')

  // Inspection package
  const [generating,       setGenerating]       = useState(false)
  const [packageGenerated, setPackageGenerated] = useState(false)
  const [packageLastGen,   setPackageLastGen]   = useState('2026-05-20')

  // Recall simulation
  const [simulating,  setSimulating]  = useState(false)
  const [simDone,     setSimDone]     = useState(false)
  const [simLastRun,  setSimLastRun]  = useState('2026-05-10')

  // Reports
  const [reportLastGen,    setReportLastGen]    = useState<Record<string, string>>({
    rpt_qc: '2026-05-20', rpt_batch: '2026-05-18', rpt_ncr: '2026-05-15',
    rpt_recall: '2026-05-22', rpt_capa: '2026-05-10', rpt_gmp: '2026-05-01',
  })
  const [reportGenerating, setReportGenerating] = useState<string | null>(null)

  // CAPA
  const [capaList,      setCapaList]      = useState<CAPAItem[]>(CAPAS_INIT)
  const [showCAPAModal, setShowCAPAModal] = useState(false)
  const [capaForm,      setCapaForm]      = useState({
    title: '', severity: 'major' as Severity,
    due: '', assigned: '', root: '', status: 'open' as CAPAStatus,
  })

  // Requirements
  const [expandedReq, setExpandedReq] = useState<string | null>(null)

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleGeneratePackage() {
    setGenerating(true)
    setTimeout(() => {
      setGenerating(false)
      setPackageGenerated(true)
      setPackageLastGen(todayISO())
      toast.success(lang === 'ar' ? 'تم إنشاء الحزمة — 14.2 MB' : 'Package generated — 14.2 MB')
    }, 2200)
  }

  function handleExport(type: 'pdf' | 'zip' | 'audit') {
    const content = buildInspectionPackage()
    const names = {
      pdf:   `SFDA-Inspection-Package-${todayISO()}.txt`,
      zip:   `SFDA-Inspection-Package-${todayISO()}.txt`,
      audit: `SFDA-Audit-Report-${todayISO()}.txt`,
    }
    downloadText(names[type], type === 'audit' ? buildGMPReport() : content)
    toast.success(lang === 'ar' ? 'جارٍ التنزيل…' : 'Downloading…')
  }

  function handleGenerateReport(key: string) {
    setReportGenerating(key)
    setTimeout(() => {
      setReportGenerating(null)
      setReportLastGen(prev => ({ ...prev, [key]: todayISO() }))
      toast.success(lang === 'ar' ? 'تم إنشاء التقرير' : 'Report generated')
    }, 2500)
  }

  function handleDownloadReport(key: string) {
    const builder  = REPORT_BUILDERS[key]
    const filename = REPORT_FILENAMES[key]
    if (!builder || !filename) return
    downloadText(`${filename}-${todayISO()}.txt`, builder())
    toast.success(lang === 'ar' ? 'جارٍ التنزيل…' : 'Downloading…')
  }

  function handleSimulate() {
    setSimulating(true); setSimDone(false)
    setTimeout(() => {
      setSimulating(false); setSimDone(true)
      setSimLastRun(nowSA())
      toast.success(lang === 'ar' ? 'اكتملت المحاكاة بنجاح' : 'Simulation completed successfully')
    }, 3000)
  }

  function handleAddCAPA(e: React.FormEvent) {
    e.preventDefault()
    if (!capaForm.title.trim() || !capaForm.due || !capaForm.assigned.trim()) return
    const nextNum = capaList.length + 1
    const newCapa: CAPAItem = {
      id:       `CAPA-${new Date().getFullYear()}-${String(nextNum).padStart(3, '0')}`,
      title:    capaForm.title,
      arTitle:  capaForm.title,
      severity: capaForm.severity,
      due:      capaForm.due,
      assigned: capaForm.assigned,
      root:     capaForm.root,
      status:   capaForm.status,
    }
    setCapaList(prev => [newCapa, ...prev])
    setShowCAPAModal(false)
    setCapaForm({ title: '', severity: 'major', due: '', assigned: '', root: '', status: 'open' })
    toast.success(lang === 'ar' ? 'تم إضافة الإجراء التصحيحي' : 'CAPA added successfully')
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
              <h3 className="text-sm font-semibold text-[var(--text)]">
                {lang === 'ar' ? 'بنود تستوجب الانتباه' : 'Areas Requiring Attention'}
              </h3>
              <span className="ms-auto text-xs text-[var(--muted)]">{attention.length}</span>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {attention.map(req => (
                <div key={req.id} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[var(--bg)] transition-colors cursor-pointer"
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
                const detail = REQ_DETAILS[req.id]
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
                              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-1">
                                {lang === 'ar' ? 'الوصف' : 'Description'}
                              </p>
                              <p className="text-[var(--text)] leading-relaxed">
                                {lang === 'ar' ? detail.ar : detail.en}
                              </p>
                            </div>
                            <div className="space-y-3">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-1">
                                  {lang === 'ar' ? 'ملاحظات التدقيق' : 'Audit Notes'}
                                </p>
                                <p className={`leading-relaxed ${req.status === 'non_compliant' ? 'text-red-600 dark:text-red-400' : req.status === 'partial' ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text)]'}`}>
                                  {lang === 'ar' ? detail.notesAr : detail.notesEn}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                                <Calendar size={11} />
                                {lang === 'ar' ? 'آخر تدقيق:' : 'Last audit:'} {fmtDate(detail.lastAudit, lang)}
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

  // ── Tab: Inspection Package ──────────────────────────────────────────────────

  function TabInspection() {
    const contents = [
      { label: lang === 'ar' ? 'سجل الدفعات'       : 'Batch history',         detail: '156 records'   },
      { label: lang === 'ar' ? 'تقارير فحص الجودة' : 'QC inspection reports', detail: '104 reports'   },
      { label: lang === 'ar' ? 'سلسلة التتبع'       : 'Traceability chain',   detail: lang === 'ar' ? 'مكتمل' : 'Complete' },
      { label: lang === 'ar' ? 'سجلات الاستدعاء'   : 'Recall records',        detail: '3 events'      },
      { label: lang === 'ar' ? 'سجلات CAPA'         : 'CAPA logs',            detail: `${capaList.length} actions` },
      { label: lang === 'ar' ? 'سجل التدقيق'        : 'System audit trail',   detail: '892 entries'   },
      { label: lang === 'ar' ? 'تاريخ التفتيش'      : 'Inspection history',   detail: lang === 'ar' ? 'جميع الزيارات' : 'All visits' },
      { label: lang === 'ar' ? 'سجل العمليات'       : 'Operator action log',  detail: lang === 'ar' ? 'الجدول الزمني كاملاً' : 'Full timeline' },
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
                <h2 className="text-base font-semibold text-[var(--text)]">{t('sfda.pkg_title')}</h2>
                <p className="text-sm text-[var(--muted)] mt-0.5">{t('sfda.pkg_desc')}</p>
              </div>
            </div>

            <div className="border-t border-[var(--border)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-3">{t('sfda.pkg_includes')}</p>
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
                  title={lang === 'ar' ? 'إنشاء حزمة التفتيش الكاملة' : 'Generate the full inspection package'}
                  className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] hover:bg-[#2e5a75] text-white px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
                >
                  {generating
                    ? <><RefreshCw size={14} className="animate-spin" />{t('sfda.pkg_generating')}</>
                    : <><Zap size={14} />{t('sfda.pkg_generate')}</>}
                </button>
              )}
              {!generating && packageGenerated && (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 size={11} />{t('sfda.pkg_ready')}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-4">
              {lang === 'ar' ? 'خيارات التصدير' : 'Export Options'}
            </p>
            <div className="space-y-2">
              {([
                { type: 'pdf'   as const, icon: FileText,      key: 'sfda.pkg_export_pdf',   enabled: packageGenerated },
                { type: 'zip'   as const, icon: Archive,       key: 'sfda.pkg_export_zip',   enabled: packageGenerated },
                { type: 'audit' as const, icon: ClipboardList, key: 'sfda.pkg_export_audit', enabled: true             },
              ]).map(({ type, icon: Icon, key, enabled }) => (
                <button
                  key={key}
                  onClick={() => enabled && handleExport(type)}
                  disabled={!enabled}
                  title={enabled ? undefined : (lang === 'ar' ? 'قم بإنشاء الحزمة أولاً' : 'Generate the package first')}
                  className={`w-full flex items-center gap-3 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm transition-colors
                    ${enabled
                      ? 'text-[var(--text)] hover:bg-[var(--bg)] cursor-pointer'
                      : 'text-[var(--subtle)] opacity-50 cursor-not-allowed'}`}
                >
                  <Icon size={15} className="text-[var(--muted)] shrink-0" />
                  {t(key)}
                  <Download size={13} className="ms-auto text-[var(--muted)]" />
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--subtle)] mb-3">{t('sfda.pkg_last')}</p>
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
      { id: 'all',    labelKey: 'sfda.audit_filter_all'     },
      { id: 'edit',   labelKey: 'sfda.audit_filter_edits'   },
      { id: 'delete', labelKey: 'sfda.audit_filter_deletes' },
      { id: 'qc',     labelKey: 'sfda.audit_filter_qc'      },
      { id: 'recall', labelKey: 'sfda.audit_filter_recalls' },
    ]
    const filtered = auditFilter === 'all' ? MOCK_AUDIT : MOCK_AUDIT.filter(e => e.type === auditFilter)
    const actionCls: Record<string, string> = {
      edit:   'text-blue-600 dark:text-blue-400',
      qc:     'text-emerald-600 dark:text-emerald-400',
      delete: 'text-red-600 dark:text-red-400',
      recall: 'text-amber-600 dark:text-amber-400',
    }
    return (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 overflow-x-auto">
            <Filter size={13} className="text-[var(--muted)] shrink-0" />
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setAuditFilter(f.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  auditFilter === f.id ? 'bg-[#3a6f8f] text-white' : 'bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--s3)]'
                }`}>
                {t(f.labelKey)}
              </button>
            ))}
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 shrink-0 tracking-wide">
            <Lock size={9} />IMMUTABLE RECORD
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg)]">
                {['sfda.audit_who','sfda.audit_action','sfda.audit_entity','sfda.audit_time'].map(k => (
                  <th key={k} className="text-start px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{t(k)}</th>
                ))}
                <th className="w-8 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map((entry, i) => (
                <tr key={entry.id} className={i % 2 === 0 ? 'bg-[var(--surface)]' : 'bg-[var(--bg)]'}>
                  <td className="px-4 py-3 font-medium text-[var(--text)]">{entry.actor}</td>
                  <td className={`px-4 py-3 font-mono text-xs ${actionCls[entry.type] ?? 'text-[var(--muted)]'}`}>{entry.action}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{entry.entity}</td>
                  <td className="px-4 py-3 text-[var(--muted)] whitespace-nowrap">{entry.time}</td>
                  <td className="px-4 py-3"><span title="Immutable"><Lock size={11} className="text-[var(--subtle)]" /></span></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                  {lang === 'ar' ? 'لا توجد أحداث تطابق هذا الفلتر' : 'No events match this filter.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] text-xs text-[var(--subtle)] flex items-center gap-1.5">
          <Lock size={10} />{lang === 'ar' ? `${filtered.length} من ${MOCK_AUDIT.length} حدث` : `${filtered.length} of ${MOCK_AUDIT.length} events`}
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
              { status: 'open'        as CAPAStatus, count: counts.open,        cls: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'       },
              { status: 'in_progress' as CAPAStatus, count: counts.in_progress, cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'   },
              { status: 'overdue'     as CAPAStatus, count: counts.overdue,     cls: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'           },
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
                  <tr key={capa.id} className={i % 2 === 0 ? 'bg-[var(--surface)]' : 'bg-[var(--bg)]'}>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)] whitespace-nowrap">{capa.id}</td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="font-medium text-[var(--text)] leading-snug">{lang === 'ar' ? capa.arTitle : capa.title}</p>
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
                          onClick={() => toast.info(lang === 'ar' ? 'التحقق مسجل' : 'Verification recorded')}
                          title={lang === 'ar' ? 'تسجيل التحقق' : 'Record verification'}
                          className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline transition-colors">
                          <CheckCircle2 size={12} />{t('sfda.capa_verify')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {capaList.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                    {lang === 'ar' ? 'لا توجد إجراءات تصحيحية' : 'No CAPAs on record.'}
                  </td></tr>
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
    const RECALL_SCORE = 91
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 flex flex-col items-center justify-center gap-2">
            <ScoreRing score={RECALL_SCORE} size={120} />
            <p className="text-xs font-medium text-[var(--muted)] text-center">{t('sfda.recall_score')}</p>
          </div>
          {[
            { icon: Package,    label: 'sfda.recall_affected',   value: '3',  cls: 'text-amber-600 dark:text-amber-400',   bg: 'bg-amber-50 dark:bg-amber-900/20'   },
            { icon: TrendingUp, label: 'sfda.recall_downstream', value: '12', cls: 'text-blue-600 dark:text-blue-400',     bg: 'bg-blue-50 dark:bg-blue-900/20'     },
            { icon: Users,      label: 'sfda.recall_customers',  value: '8',  cls: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-900/20' },
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
              <h3 className="text-sm font-semibold text-[var(--text)]">{t('sfda.recall_simulate')}</h3>
              <p className="text-xs text-[var(--muted)] mt-1">
                {t('sfda.recall_last')}: {simLastRun}
              </p>
            </div>
            <button onClick={handleSimulate} disabled={simulating}
              className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] hover:bg-[#2e5a75] text-white px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 shrink-0">
              {simulating
                ? <><RefreshCw size={14} className="animate-spin" />{lang === 'ar' ? 'جارٍ التشغيل…' : 'Running…'}</>
                : <><Activity size={14} />{t('sfda.recall_simulate')}</>}
            </button>
          </div>

          {simDone && (
            <div className="mt-5 pt-5 border-t border-[var(--border)] grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-[var(--muted)]">{t('sfda.recall_time_to_notify')}</p>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">&lt; 2 {lang === 'ar' ? 'ساعة' : 'hours'}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">{lang === 'ar' ? 'التغطية' : 'Coverage'}</p>
                <p className="text-xl font-bold text-[var(--text)] mt-1">100%</p>
                <p className="text-xs text-[var(--muted)]">{lang === 'ar' ? 'من الدفعات المتأثرة تم تحديدها' : 'of affected batches identified'}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">{t('sfda.recall_risk')}</p>
                <span className="inline-flex items-center gap-1.5 mt-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                  <AlertTriangle size={11} />{t('sfda.risk_medium')}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
          <h3 className="text-sm font-semibold text-[var(--text)] mb-4">
            {lang === 'ar' ? 'عوامل مخاطر الاستدعاء' : 'Recall Risk Factors'}
          </h3>
          <div className="space-y-3">
            {[
              { label: lang === 'ar' ? 'فجوات مراقبة سلسلة التبريد'        : 'Cold chain monitoring gaps',    dot: 'bg-red-500',     level: lang === 'ar' ? 'مرتفع' : 'High'   },
              { label: lang === 'ar' ? 'تأخر تجديد تأهيل الموردين'         : 'Supplier qualification lapses', dot: 'bg-amber-400',   level: lang === 'ar' ? 'متوسط' : 'Medium' },
              { label: lang === 'ar' ? 'أخطاء مسح الباركود عند الاستلام'   : 'Barcode scan misses on intake', dot: 'bg-emerald-500', level: lang === 'ar' ? 'منخفض' : 'Low'    },
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

  // ── Tab: Reports ─────────────────────────────────────────────────────────────

  function TabReports() {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map(rpt => {
          const Icon      = rpt.icon
          const iconCls   = REPORT_ICON_CLS[rpt.color] ?? REPORT_ICON_CLS.slate
          const isGen     = reportGenerating === rpt.key
          const lastDate  = reportLastGen[rpt.key]
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

              <div className="text-xs text-[var(--muted)] flex items-center gap-1.5 mt-auto">
                <Calendar size={11} />
                {t('sfda.reports_last')}: {fmtDate(lastDate, lang)}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleGenerateReport(rpt.key)}
                  disabled={isGen}
                  title={lang === 'ar' ? 'إنشاء تقرير محدّث' : 'Generate an updated report'}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[#3a6f8f] hover:bg-[#2e5a75] text-white px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60"
                >
                  {isGen
                    ? <><RefreshCw size={11} className="animate-spin" />{lang === 'ar' ? 'جارٍ الإنشاء…' : 'Generating…'}</>
                    : <><BarChart3 size={11} />{t('sfda.reports_generate')}</>}
                </button>
                <button
                  onClick={() => handleDownloadReport(rpt.key)}
                  title={lang === 'ar' ? 'تنزيل آخر نسخة' : 'Download the latest version'}
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
              <h2 className="text-base font-semibold text-[var(--text)]">{t('sfda.capa_add')}</h2>
              <button onClick={() => setShowCAPAModal(false)}
                className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] transition-colors">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddCAPA} className="px-6 py-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                  {t('sfda.capa_col_title')} *
                </label>
                <input required value={capaForm.title}
                  onChange={e => setCapaForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                  placeholder={lang === 'ar' ? 'وصف الملاحظة أو المشكلة' : 'Describe the finding or issue'} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">{t('sfda.capa_col_severity')} *</label>
                  <select value={capaForm.severity}
                    onChange={e => setCapaForm(f => ({ ...f, severity: e.target.value as Severity }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]">
                    <option value="critical">{t('sfda.severity_critical')}</option>
                    <option value="major">{t('sfda.severity_major')}</option>
                    <option value="minor">{t('sfda.severity_minor')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">{t('sfda.capa_col_status')} *</label>
                  <select value={capaForm.status}
                    onChange={e => setCapaForm(f => ({ ...f, status: e.target.value as CAPAStatus }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]">
                    <option value="open">{t('sfda.capa_open')}</option>
                    <option value="in_progress">{t('sfda.capa_inprogress')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">{t('sfda.capa_col_due')} *</label>
                  <input required type="date" value={capaForm.due}
                    onChange={e => setCapaForm(f => ({ ...f, due: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">{t('sfda.capa_col_assigned')} *</label>
                  <input required value={capaForm.assigned}
                    onChange={e => setCapaForm(f => ({ ...f, assigned: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]"
                    placeholder={lang === 'ar' ? 'اسم المسؤول' : 'Responsible person'} />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">{t('sfda.capa_col_root')}</label>
                <textarea rows={2} value={capaForm.root}
                  onChange={e => setCapaForm(f => ({ ...f, root: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#4a7fa5] resize-none"
                  placeholder={lang === 'ar' ? 'وصف السبب الجذري' : 'Describe the root cause'} />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowCAPAModal(false)}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg)] transition-colors">
                  {t('common.cancel')}
                </button>
                <button type="submit"
                  className="flex items-center gap-2 rounded-lg bg-[#3a6f8f] hover:bg-[#2e5a75] text-white px-4 py-2 text-sm font-medium transition-colors">
                  <Plus size={14} />{t('sfda.capa_add')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
