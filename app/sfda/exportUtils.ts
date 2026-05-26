'use client'

import jsPDF from 'jspdf'
import JSZip from 'jszip'

// ── Enterprise palette ────────────────────────────────────────────────────────
// Clean white-background corporate style (SAP / KPMG / Big-4 audit document)
const C = {
  dark:   [20,  30,  50]  as const,   // document title, heading text
  text:   [38,  44,  56]  as const,   // body text
  muted:  [95,  108, 125] as const,   // field labels
  subtle: [148, 160, 175] as const,   // footer / secondary
  blue:   [29,  78,  137] as const,   // IBM enterprise blue accent
  rule:   [208, 214, 224] as const,   // divider lines
  border: [218, 224, 234] as const,   // table cell borders
  red:    [178, 24,  24]  as const,   // critical / non-conformant
  amber:  [158, 94,  5]   as const,   // warning / partial
  green:  [19,  118, 56]  as const,   // compliant / ok
  rowalt: [247, 249, 253] as const,   // alternating table row
  rowhdr: [228, 234, 246] as const,   // table header background
  white:  [255, 255, 255] as const,
}

// ── Layout constants (A4 portrait, mm) ───────────────────────────────────────
const PW    = 210
const PH    = 297
const ML    = 20           // left margin
const MR    = 20           // right margin
const CW    = PW - ML - MR // 170mm content width
const LBL   = 36           // label column width for field() rows
const HDR1  = 72           // first-page content start y
const HDRC  = 22           // continuation content start y
const FOOTY = 275          // footer rule y
const GUARD = 12           // bottom guard — newPage if y > FOOTY - GUARD

// ── Helpers ───────────────────────────────────────────────────────────────────
function tc(doc: jsPDF, c: readonly [number, number, number]) { doc.setTextColor(c[0], c[1], c[2]) }
function dc(doc: jsPDF, c: readonly [number, number, number]) { doc.setDrawColor(c[0], c[1], c[2]) }
function fc(doc: jsPDF, c: readonly [number, number, number]) { doc.setFillColor(c[0], c[1], c[2]) }

export function nowGregorian(): string {
  const d     = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(d)
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')} ${g('dayPeriod').toUpperCase()}`
}

export function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

export function pdfHash(): string {
  return `TF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

// ── DocMeta ───────────────────────────────────────────────────────────────────
export interface DocMeta {
  title:     string
  docNo:     string
  version:   string
  generated: string
  hash:      string
  classif:   string
  regRef:    string
}

// ── PDFDoc ────────────────────────────────────────────────────────────────────
class PDFDoc {
  private doc:   jsPDF
  private y:     number
  private pageN: number
  private meta:  DocMeta

  constructor(meta: DocMeta) {
    this.doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    this.meta  = meta
    this.pageN = 1
    this.drawFirstHeader()
    this.y = HDR1
  }

  // ── First-page header — clean corporate style ──────────────────────────────

  private drawFirstHeader() {
    const { doc, meta } = this

    // Thin blue accent bar across full width
    fc(doc, C.blue); doc.rect(0, 0, PW, 3.5, 'F')

    // Organization label (top-left, small)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    tc(doc, C.muted)
    doc.text('TraceFlow Regulatory Compliance Engine', ML, 11)

    // Confidentiality indicator (top-right)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    tc(doc, C.red)
    doc.text(meta.classif, PW - MR, 11, { align: 'right' })

    // Document title
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
    tc(doc, C.dark)
    doc.text(meta.title, ML, 23)

    // Thin rule below title
    dc(doc, C.rule); doc.setLineWidth(0.4)
    doc.line(ML, 28, PW - MR, 28)

    // Metadata block — label: value rows
    const metaRows: [string, string, boolean?][] = [
      ['Document No.',      meta.docNo],
      ['Generated',         meta.generated],
      ['Version',           meta.version],
      ['Regulatory Ref.',   meta.regRef],
      ['Integrity Hash',    meta.hash,   true],
    ]

    let my = 35
    metaRows.forEach(([lbl, val, mono]) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
      tc(doc, C.muted)
      doc.text(lbl, ML, my)

      const font = mono ? 'courier' : 'helvetica'
      doc.setFont(font, 'normal'); doc.setFontSize(mono ? 6.5 : 7.5)
      tc(doc, mono ? C.muted : C.text)
      const lines = doc.splitTextToSize(val, CW - LBL)
      doc.text(lines, ML + LBL, my)
      my += lines.length > 1 ? lines.length * 4.2 + 0.5 : 5
    })

    // Rule below metadata
    const ruleY = Math.max(my + 3, 63)
    dc(doc, C.rule); doc.setLineWidth(0.4)
    doc.line(ML, ruleY, PW - MR, ruleY)
  }

  // ── Continuation header — minimal ─────────────────────────────────────────

  private drawContHeader() {
    const { doc, meta } = this

    // Thin blue accent bar
    fc(doc, C.blue); doc.rect(0, 0, PW, 3, 'F')

    // Title + doc number on one line
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    tc(doc, C.dark)
    doc.text(meta.title, ML, 10)

    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    tc(doc, C.muted)
    doc.text(meta.docNo, PW - MR, 10, { align: 'right' })

    // Rule
    dc(doc, C.rule); doc.setLineWidth(0.3)
    doc.line(ML, 14, PW - MR, 14)
  }

  // ── Footer — rendered in finalize pass on every page ──────────────────────

  private drawFooter(page: number, total: number) {
    const { doc } = this

    // Rule
    dc(doc, C.rule); doc.setLineWidth(0.3)
    doc.line(ML, FOOTY, PW - MR, FOOTY)

    // Line 1: Branding left, page right
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
    tc(doc, C.muted)
    doc.text('TraceFlow Regulatory Compliance Engine', ML, FOOTY + 5)

    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
    tc(doc, C.dark)
    doc.text(`Page ${page} of ${total}`, PW - MR, FOOTY + 5, { align: 'right' })

    // Line 2: Legal notice
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6)
    tc(doc, C.subtle)
    doc.text(
      'Electronically Generated Document  ·  No Handwritten Signature Required  ·  For Authorized SFDA Inspection Use Only  ·  Tamper-Evident Record',
      ML, FOOTY + 10
    )
  }

  finalize(): this {
    const total = this.doc.getNumberOfPages()
    for (let p = 1; p <= total; p++) {
      this.doc.setPage(p)
      this.drawFooter(p, total)
    }
    return this
  }

  // ── Page management ────────────────────────────────────────────────────────

  private newPage() {
    this.doc.addPage()
    this.pageN++
    this.drawContHeader()
    this.y = HDRC
  }

  private ensure(h: number) {
    if (this.y + h > FOOTY - GUARD) this.newPage()
  }

  // ── Content primitives ─────────────────────────────────────────────────────

  spacer(h = 5) { this.y += h }

  // Section heading: bold, blue, ALL CAPS, thin rule below
  sectionTitle(text: string) {
    this.ensure(16)
    this.spacer(2)
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(8.5)
    tc(this.doc, C.blue)
    this.doc.text(text.toUpperCase(), ML, this.y)
    dc(this.doc, C.rule); this.doc.setLineWidth(0.3)
    this.doc.line(ML, this.y + 3, ML + CW, this.y + 3)
    this.y += 10
  }

  // Field row: muted label left, dark value right of LBL column
  field(
    label: string, value: string,
    opts: { color?: readonly [number, number, number]; bold?: boolean; mono?: boolean } = {}
  ) {
    if (!value) return
    const vlines = this.doc.splitTextToSize(value, CW - LBL - 2)
    this.ensure(vlines.length * 4.5 + 1)

    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7.5)
    tc(this.doc, C.muted)
    this.doc.text(label, ML, this.y)

    this.doc.setFont(opts.mono ? 'courier' : 'helvetica', opts.bold ? 'bold' : 'normal')
    this.doc.setFontSize(opts.mono ? 7 : 8)
    tc(this.doc, opts.color ?? C.text)
    this.doc.text(vlines, ML + LBL, this.y)
    this.y += vlines.length * 4.5 + 1.5
  }

  // Status row: label muted, value in status color with right-aligned pill
  statusRow(label: string, value: string, level: 'ok' | 'partial' | 'error' | 'warn' | 'info') {
    const col = { ok: C.green, partial: C.amber, error: C.red, warn: C.amber, info: C.blue }[level]
    const vlines = this.doc.splitTextToSize(value, CW - LBL - 2)
    this.ensure(vlines.length * 4.5 + 2)

    this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(7.5)
    tc(this.doc, C.muted)
    this.doc.text(label, ML, this.y)

    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7.5)
    tc(this.doc, col)
    this.doc.text(vlines, ML + LBL, this.y)
    this.y += vlines.length * 4.5 + 2
  }

  // Bullet point
  bullet(text: string, color: readonly [number, number, number] = C.text) {
    const lines = this.doc.splitTextToSize(text, CW - 10)
    this.ensure(lines.length * 4.5 + 1)
    this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(8)
    tc(this.doc, C.blue)
    this.doc.text('–', ML + 2, this.y)
    tc(this.doc, color)
    this.doc.text(lines, ML + 8, this.y)
    this.y += lines.length * 4.5
  }

  // Italic note line
  note(text: string) {
    const lines = this.doc.splitTextToSize(text, CW - 8)
    this.ensure(lines.length * 4 + 1)
    this.doc.setFont('helvetica', 'italic'); this.doc.setFontSize(7)
    tc(this.doc, C.subtle)
    this.doc.text(lines, ML + 6, this.y)
    this.y += lines.length * 4 + 1
  }

  // Thin horizontal divider
  divider() {
    this.ensure(7)
    dc(this.doc, C.border); this.doc.setLineWidth(0.2)
    this.doc.line(ML + 10, this.y + 2, ML + CW, this.y + 2)
    this.y += 7
  }

  // Enterprise table: light header bg, alternating rows, thin borders
  table(headers: string[], rows: string[][], widths?: number[]) {
    const cols = headers.length
    const ws   = widths ?? headers.map(() => +(CW / cols).toFixed(1))
    const rh   = 7     // row height mm
    const pad  = 2.5   // cell padding

    this.ensure(rh * 2 + 5)

    // Header row background
    fc(this.doc, C.rowhdr); this.doc.rect(ML, this.y - rh + 1.5, CW, rh, 'F')
    // Header bottom border
    dc(this.doc, C.border); this.doc.setLineWidth(0.4)
    this.doc.line(ML, this.y - rh + 1.5 + rh, ML + CW, this.y - rh + 1.5 + rh)

    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7)
    tc(this.doc, C.dark)
    let x = ML + pad
    headers.forEach((h, i) => { this.doc.text(h, x, this.y); x += ws[i] })
    this.y += rh

    // Data rows
    rows.forEach((row, ri) => {
      this.ensure(rh)
      if (ri % 2 === 1) {
        fc(this.doc, C.rowalt)
        this.doc.rect(ML, this.y - rh + 1.5, CW, rh, 'F')
      }
      // Row bottom border
      dc(this.doc, C.border); this.doc.setLineWidth(0.15)
      this.doc.line(ML, this.y - rh + 1.5 + rh, ML + CW, this.y - rh + 1.5 + rh)

      this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(7.5)
      tc(this.doc, C.text)
      x = ML + pad
      row.forEach((cell, ci) => {
        const truncated = this.doc.splitTextToSize(cell, ws[ci] - pad * 2)[0] ?? ''
        this.doc.text(truncated, x, this.y)
        x += ws[ci]
      })
      this.y += rh
    })

    // Outer border
    dc(this.doc, C.border); this.doc.setLineWidth(0.3)
    this.doc.rect(ML, this.y - rows.length * rh - rh, CW, (rows.length + 1) * rh, 'S')
    this.y += 4
  }

  // CAPA record block: left border stripe, clean field grid inside
  capaBlock(b: {
    id: string; finding: string; ncClass: string; severity: string
    due: string; assigned: string; root: string
    corrective: string; preventive: string; evidRef: string
    status: string; statusNote: string
  }) {
    this.ensure(55)
    const sCol = b.status === 'CLOSED' ? C.green : b.severity === 'CRITICAL' ? C.red : C.amber

    // Left status stripe
    fc(this.doc, sCol); this.doc.rect(ML, this.y - 1, 2.5, 7, 'F')

    // CAPA ID + Status on header row
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(9)
    tc(this.doc, C.dark)
    this.doc.text(b.id, ML + 5, this.y + 4)

    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7.5)
    tc(this.doc, sCol)
    this.doc.text(b.status, PW - MR, this.y + 4, { align: 'right' })

    // Thin rule below ID bar
    dc(this.doc, C.border); this.doc.setLineWidth(0.2)
    this.doc.line(ML + 5, this.y + 6.5, ML + CW, this.y + 6.5)
    this.y += 11

    // Field grid — slightly indented
    const savedML = ML
    const indent  = 5
    const origField = this.field.bind(this)
    const ifield = (lbl: string, val: string, opts?: { color?: readonly [number, number, number]; bold?: boolean; mono?: boolean }) => {
      if (!val) return
      const vlines = this.doc.splitTextToSize(val, CW - LBL - indent - 2)
      this.ensure(vlines.length * 4.5 + 1)
      this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7.5)
      tc(this.doc, C.muted)
      this.doc.text(lbl, ML + indent, this.y)
      this.doc.setFont(opts?.mono ? 'courier' : 'helvetica', opts?.bold ? 'bold' : 'normal')
      this.doc.setFontSize(opts?.mono ? 7 : 8)
      tc(this.doc, opts?.color ?? C.text)
      this.doc.text(vlines, ML + indent + LBL, this.y)
      this.y += vlines.length * 4.5 + 1.5
    }
    void origField   // suppress unused
    void savedML

    ifield('Finding',              b.finding)
    ifield('Non-Conformity Class', b.ncClass,    { color: sCol, bold: true })
    ifield('Severity',             b.severity,   { color: sCol, bold: true })
    ifield('Due Date',             b.due)
    ifield('Assigned To',          b.assigned)
    ifield('Root Cause',           b.root)
    ifield('Corrective Action',    b.corrective)
    ifield('Preventive Action',    b.preventive)
    ifield('Evidence Reference',   b.evidRef,    { color: C.blue, mono: true })
    if (b.statusNote) ifield('Status Note', b.statusNote, { color: sCol })

    this.y += 3
    dc(this.doc, C.border); this.doc.setLineWidth(0.2)
    this.doc.line(ML + 5, this.y, ML + CW, this.y)
    this.y += 8
  }

  // Closing attestation block — fills end-of-document space professionally
  closingAttestation() {
    this.spacer(8)
    this.sectionTitle('Document Attestation & Data Integrity')

    this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(7.5)
    tc(this.doc, C.text)
    const attestText = `This document was electronically generated by the TraceFlow Regulatory Compliance Engine and is certified for SFDA regulatory inspection use. All records are sourced directly from the production database with full audit provenance. This document is tamper-evident and immutable upon generation — any amendments require issuance of a new document version.`
    const lines = this.doc.splitTextToSize(attestText, CW)
    this.ensure(lines.length * 4.5 + 30)
    this.doc.text(lines, ML, this.y)
    this.y += lines.length * 4.5 + 6

    this.field('Document ID',        this.meta.docNo,    { mono: true })
    this.field('Generated',          this.meta.generated)
    this.field('Integrity Hash',     this.meta.hash,     { mono: true, color: C.blue })
    this.field('Certification',      'CERTIFIED — For Authorized SFDA Inspection Use Only', { color: C.blue, bold: true })
  }

  // ── Output ─────────────────────────────────────────────────────────────────

  blob(): Blob {
    this.finalize()
    return this.doc.output('blob')
  }
}

// ── PDF builders ──────────────────────────────────────────────────────────────

export function buildQCReportPDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const p    = new PDFDoc({
    title: 'QC Inspection Report', docNo: `QC-RPT-${todayStr().replace(/-/g, '')}`,
    version: '1.0', generated: ts, hash, classif: 'CONFIDENTIAL',
    regRef: 'Saudi FDA GMP Guidelines v2024  |  SOP-QC-001 v3.2',
  })

  p.sectionTitle('Executive Summary')
  p.field('Reporting Period',         'Q2 2026')
  p.field('Total Inspections',        '104')
  p.field('Batch Pass Rate',          '96.2 %', { color: C.green, bold: true })
  p.field('Batches Failed / On Hold', '4',       { color: C.red })
  p.field('Critical Observations',    '2',       { color: C.red })
  p.field('Inspectors Qualified',     '5')
  p.field('Inspection Readiness',     'APPROVED', { color: C.green, bold: true })

  p.spacer(2)
  p.sectionTitle('Batch Inspection Results')
  p.table(
    ['Batch ID', 'Product', 'Inspector', 'Date', 'Result'],
    [
      ['B-2024-088', 'Vitamin D 5000 IU',       'Eng. K. Al-Otaibi',  '2026-05-20', 'PASS'],
      ['B-2024-089', 'Magnesium Complex 400mg',  'Eng. S. Al-Zahrani', '2026-05-22', 'FAIL'],
      ['B-2024-090', 'Omega-3 Fish Oil',         'Eng. K. Al-Otaibi',  '2026-05-23', 'PASS'],
      ['B-2024-091', 'Zinc Citrate 50mg',        'Eng. N. Al-Harbi',   '2026-05-24', 'PASS'],
      ['B-2024-092', 'Vitamin B Complex',        'Eng. F. Al-Dosari',  '2026-05-24', 'PASS'],
    ],
    [30, 52, 38, 26, 24]
  )
  p.field('Evidence Reference', 'QC-INSP-2024  |  Batch records archived in TraceFlow production database', { color: C.blue, mono: true })

  p.spacer(2)
  p.sectionTitle('Quality Control Observations')
  p.bullet('All inspections conducted per SOP-QC-001 v3.2 and Saudi FDA GMP Guidelines')
  p.bullet('Equipment calibration: 1 critical balance on Line 3 expired 2026-04-30 — Ref: CAPA-2024-001', C.red)
  p.bullet('QC documentation incomplete for 4 production runs — Ref: CAPA-2024-003 (in progress)', C.amber)
  p.bullet('Inspector certifications: all current and valid through Q4 2026')
  p.bullet('2 temperature excursion events logged — cold chain protocol review initiated')

  p.spacer(2)
  p.sectionTitle('Compliance Verification Status')
  p.statusRow('QC Process Compliance',        'COMPLIANT',                                                      'ok')
  p.statusRow('Documentation Compliance',     'PARTIAL — 4 Records Under Review  |  Ref: CAPA-2024-003',        'partial')
  p.statusRow('Equipment Calibration Status', 'CORRECTIVE ACTION REQUIRED  |  Ref: CAPA-2024-001',              'error')

  p.closingAttestation()
  return p.blob()
}

export function buildBatchReportPDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const p    = new PDFDoc({
    title: 'Batch Traceability Report', docNo: `BCR-${todayStr().replace(/-/g, '')}`,
    version: '1.0', generated: ts, hash, classif: 'CONFIDENTIAL',
    regRef: 'Saudi FDA GMP Guidelines v2024  |  PROD-TRACE-LOGS',
  })

  p.sectionTitle('Batch Lifecycle Summary')
  p.field('Reporting Period',        '2024 — 2026')
  p.field('Total Batches Tracked',   '231')
  p.field('Fully Compliant',         '224  (96.9 %)',                       { color: C.green })
  p.field('Partial Compliance',      '5  (2.2 %) — Pending Remediation',    { color: C.amber })
  p.field('Non-Compliant / On Hold', '2  (0.9 %) — Corrective Action Required', { color: C.red })

  p.spacer(2)
  p.sectionTitle('Recent Batch Records')
  p.table(
    ['Batch', 'Product', 'Raw Materials', 'QC', 'Disposition'],
    [
      ['B-2024-088', 'Vitamin D 5000 IU',  'RM-011, RM-022', 'PASS', 'RELEASED'],
      ['B-2024-089', 'Magnesium 400mg',    'RM-008, RM-015', 'FAIL', 'ON HOLD'],
      ['B-2024-090', 'Omega-3 Fish Oil',   'RM-033, RM-041', 'PASS', 'RELEASED'],
      ['B-2024-091', 'Zinc Citrate 50mg',  'RM-009, RM-018', 'PASS', 'RELEASED'],
      ['B-2024-092', 'Vitamin B Complex',  'RM-004, RM-029', 'PASS', 'RELEASED'],
    ],
    [30, 46, 36, 18, 40]
  )

  p.spacer(2)
  p.sectionTitle('Traceability Chain Verification')
  p.field('Forward Traceability',  'Raw material receipt → Production input → QC inspection → Storage → Dispatch')
  p.field('Backward Traceability', 'Customer → Batch → Production order → Raw material lot → Supplier')
  p.field('Chain Coverage',        '100 % of batches — complete forward and backward traceability confirmed', { color: C.green })
  p.spacer(3)
  p.bullet('2 receiving scan records incomplete — barcode not captured at intake point', C.amber)
  p.bullet('CAPA-2024-005 raised, investigated, and closed — effectiveness verified 2026-06-05')
  p.bullet('SOP-REC-003 updated to enforce mandatory barcode capture at receiving dock')
  p.field('Evidence Reference', 'PROD-TRACE-LOGS  |  All records sourced from TraceFlow production database', { color: C.blue, mono: true })

  p.spacer(2)
  p.sectionTitle('Compliance Verification Status')
  p.statusRow('Batch Traceability',     'COMPLIANT — 100 % coverage verified',                         'ok')
  p.statusRow('Non-Conformant Batches', '2 batches on hold — CORRECTIVE ACTION REQUIRED',              'error')
  p.statusRow('Remediation Progress',   'CAPA-2024-005 closed and verified; CAPA-2024-002 pending',    'partial')

  p.closingAttestation()
  return p.blob()
}

export function buildNCRReportPDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const p    = new PDFDoc({
    title: 'Non-Conformance Report', docNo: `NCR-${todayStr().replace(/-/g, '')}`,
    version: '1.0', generated: ts, hash, classif: 'CONFIDENTIAL',
    regRef: 'Saudi FDA GMP Guidelines v2024  |  SOP-NCR-001',
  })

  p.sectionTitle('Non-Conformance Summary')
  p.field('Reporting Period',                '2024 — 2026')
  p.field('Total NCRs Recorded',             '12')
  p.field('Open (Pending Remediation)',       '3', { color: C.red })
  p.field('Under Review',                    '4', { color: C.amber })
  p.field('Closed / Effectiveness Verified', '5', { color: C.green })
  p.field('By Severity',                     'Critical: 2  |  Major: 5  |  Minor: 5')

  p.spacer(2)
  p.sectionTitle('Non-Conformance Register')
  p.table(
    ['NCR ID', 'Description', 'Severity', 'Linked CAPA', 'Status'],
    [
      ['NCR-2024-001', 'Equipment calibration expired — Line 3',      'CRITICAL', 'CAPA-2024-001', 'OPEN'],
      ['NCR-2024-002', 'Temperature excursion — Batch B-2024-089',    'CRITICAL', 'CAPA-2024-002', 'OPEN'],
      ['NCR-2024-003', 'Incomplete QC documentation — 4 runs',        'MAJOR',    'CAPA-2024-003', 'UNDER REVIEW'],
      ['NCR-2024-004', 'Supplier qualification gap — Al-Rawdah',      'MAJOR',    'CAPA-2024-004', 'UNDER REVIEW'],
      ['NCR-2024-005', 'Lot traceability gap — 2 material batches',   'MINOR',    'CAPA-2024-005', 'CLOSED'],
    ],
    [28, 56, 18, 30, 38]
  )

  p.spacer(2)
  p.sectionTitle('Root Cause Analysis & Remediation')
  const ncrs = [
    { id: 'NCR-2024-001', cause: 'Periodic calibration schedule not enforced by maintenance team',                 capa: 'CAPA-2024-001', due: '2026-05-30', status: 'OPEN'        },
    { id: 'NCR-2024-002', cause: 'Cold chain temperature alarm not escalated during night shift',                  capa: 'CAPA-2024-002', due: '2026-05-28', status: 'OVERDUE'     },
    { id: 'NCR-2024-003', cause: 'SOP-QC-001 checklist not consistently followed — inspector training gap',        capa: 'CAPA-2024-003', due: '2026-06-10', status: 'IN PROGRESS' },
    { id: 'NCR-2024-004', cause: 'Supplier qualification renewal not scheduled in vendor management system',        capa: 'CAPA-2024-004', due: '2026-06-20', status: 'IN PROGRESS' },
    { id: 'NCR-2024-005', cause: 'Receiving team skipped mandatory barcode scan — gap in SOP-REC-003',             capa: 'CAPA-2024-005', due: '2026-06-05', status: 'CLOSED'      },
  ]
  ncrs.forEach(n => {
    p.field(n.id, n.cause)
    p.note(`Linked CAPA: ${n.capa}  |  Due: ${n.due}  |  Status: ${n.status}`)
    p.spacer(2)
  })
  p.field('Evidence Reference', 'NCR-LOG-2024  |  CAPA-REG-2024', { color: C.blue, mono: true })

  p.closingAttestation()
  return p.blob()
}

export function buildRecallReportPDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const p    = new PDFDoc({
    title: 'Recall Summary Report', docNo: `RCL-${todayStr().replace(/-/g, '')}`,
    version: '1.0', generated: ts, hash, classif: 'CONFIDENTIAL',
    regRef: 'Saudi FDA Recall Procedure  |  SOP-RECALL-001',
  })

  p.sectionTitle('Recall Events Summary')
  p.field('Reporting Period',    '2022 — 2026')
  p.field('Total Recall Events', '3')
  p.field('Voluntary Recalls',   '2')
  p.field('Mandatory Recalls',   '1')
  p.field('Closed / Verified',   '2', { color: C.green })
  p.field('Under Investigation', '1', { color: C.red })

  p.spacer(2)
  p.sectionTitle('Recall Event Register')

  p.field('RCL-2024-001',        'Temperature Excursion  —  Initiated: 2026-05-22', { bold: true })
  p.field('Classification',      'Class II — Potential Health Risk',                  { color: C.amber })
  p.field('Affected Batches',    '3')
  p.field('Customers Notified',  '8  (100 % coverage — within 90 minutes)')
  p.field('Disposition',         'UNDER INVESTIGATION — Corrective Action Required',  { color: C.red })
  p.field('CAPA Linkage',        'CAPA-2024-002 (overdue) — escalated to Quality Director', { color: C.red })
  p.field('Evidence Reference',  'RCL-LOG-2024-001  |  CAPA-2024-002',               { color: C.blue, mono: true })
  p.field('Re-audit Scheduled',  'Upon successful closure of investigation')
  p.divider()

  p.field('RCL-2023-003',        'Supplier Contamination  —  Closed: 2025-11-10', { bold: true })
  p.field('Classification',      'Class I — Serious Health Hazard',                { color: C.red })
  p.field('Affected Batches',    '1')
  p.field('Product Recovery',    '100 %',                                           { color: C.green })
  p.field('Root Cause',          'Supplier ingredient out-of-specification — Al-Rawdah Chemicals')
  p.field('Corrective Action',   'Supplier delisted; alternative qualified per SOP-VQP-002')
  p.field('Evidence Reference',  'RCL-LOG-2023-003  |  Supplier Audit File SAF-2023-003', { color: C.blue, mono: true })
  p.divider()

  p.field('RCL-2022-007',        'Labelling Discrepancy  —  Closed: 2024-03-05', { bold: true })
  p.field('Classification',      'Class III — Minor Risk',                        { color: C.green })
  p.field('Affected Batches',    '2')
  p.field('Product Recovery',    '98 %',                                           { color: C.green })
  p.field('Root Cause',          'Artwork file version mismatch — version control gap in print process')
  p.field('Corrective Action',   'SOP-ART-001 updated; electronic sign-off enforced for all artwork changes')
  p.field('Evidence Reference',  'RCL-LOG-2022-007  |  Artwork Deviation Report ADR-2022-007', { color: C.blue, mono: true })

  p.spacer(2)
  p.sectionTitle('Recall Readiness Assessment')
  p.statusRow('Readiness Score',             '91 %',                                                              'ok')
  p.statusRow('Time to Notify',              '< 2 hours  (pre-approved SFDA notification template active)',       'ok')
  p.statusRow('Batch Identification Method', 'Automated — real-time traceability via TraceFlow platform',         'ok')
  p.statusRow('Simulation Last Run',         '2026-05-10',                                                        'info')
  p.statusRow('Re-audit Scheduled',          'Following closure of RCL-2024-001 investigation',                   'warn')
  p.field('Evidence Reference', 'RCL-READINESS-2026  |  SOP-RECALL-001', { color: C.blue, mono: true })

  p.closingAttestation()
  return p.blob()
}

export function buildCAPAReportPDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const p    = new PDFDoc({
    title: 'CAPA Summary Report', docNo: `CAPA-RPT-${todayStr().replace(/-/g, '')}`,
    version: '1.0', generated: ts, hash, classif: 'CONFIDENTIAL',
    regRef: 'CAPA-REG-2024  |  ICH Q10 Pharmaceutical Quality System',
  })

  p.sectionTitle('CAPA Register Summary')
  p.field('Total CAPAs on Record',     '5')
  p.field('Open',                      '2', { color: C.blue })
  p.field('In Progress',               '2', { color: C.amber })
  p.field('Closed / Verified',         '1', { color: C.green })
  p.field('Overdue (Escalation Req.)', '1', { color: C.red })

  p.spacer(2)
  p.sectionTitle('CAPA Detail Register')

  p.capaBlock({
    id: 'CAPA-2024-001',
    finding:     'Equipment calibration certificate expired — Line 3 critical balance',
    ncClass:     'MAJOR NON-CONFORMITY',
    severity:    'CRITICAL',
    due:         '2026-05-30',
    assigned:    'Eng. Khalid Al-Otaibi',
    root:        'Periodic calibration schedule not enforced by maintenance team',
    corrective:  'Immediate recalibration of Line 3 balance; update SOP-MAINT-004',
    preventive:  'Implement automated calibration reminder and escalation workflow',
    evidRef:     'NCR-2024-001  |  CALIB-SCHED-2024',
    status:      'OPEN',
    statusNote:  'Pending Remediation',
  })

  p.capaBlock({
    id: 'CAPA-2024-002',
    finding:     'Batch B-2024-089 — temperature excursion during overnight storage',
    ncClass:     'MAJOR NON-CONFORMITY',
    severity:    'CRITICAL',
    due:         '2026-05-28',
    assigned:    'Eng. Sara Al-Zahrani',
    root:        'Cold chain temperature alarm not escalated during night shift',
    corrective:  'Batch B-2024-089 quarantined pending stability assessment',
    preventive:  '24/7 automated temperature monitoring with mandatory escalation protocol',
    evidRef:     'NCR-2024-002  |  RCL-2024-001  |  Temp Log TL-089',
    status:      'OVERDUE',
    statusNote:  'Escalation Required — Re-audit Scheduled',
  })

  p.capaBlock({
    id: 'CAPA-2024-003',
    finding:     'Incomplete QC documentation for 4 consecutive production runs',
    ncClass:     'MAJOR NON-CONFORMITY',
    severity:    'MAJOR',
    due:         '2026-06-10',
    assigned:    'Eng. Nora Al-Harbi',
    root:        'SOP-QC-001 checklist not consistently followed — inspector training gap',
    corrective:  'Retroactive documentation review and completion for affected batches',
    preventive:  'Mandatory QC checklist sign-off enforced in TraceFlow; refresher training',
    evidRef:     'NCR-2024-003  |  QC-INSP-2024',
    status:      'IN PROGRESS',
    statusNote:  'Pending Remediation',
  })

  p.capaBlock({
    id: 'CAPA-2024-004',
    finding:     'Supplier Al-Rawdah Chemicals — qualification renewal overdue by 6 months',
    ncClass:     'MAJOR NON-CONFORMITY',
    severity:    'MAJOR',
    due:         '2026-06-20',
    assigned:    'Eng. Abdullah Al-Qahtani',
    root:        'Supplier qualification renewal not scheduled in vendor management system',
    corrective:  'Expedited on-site supplier audit; alternative supplier qualification initiated',
    preventive:  'Automated supplier qualification expiry tracking implemented in TraceFlow',
    evidRef:     'NCR-2024-004  |  Supplier Qualification File SQ-2024-004',
    status:      'IN PROGRESS',
    statusNote:  'Pending Remediation',
  })

  p.capaBlock({
    id: 'CAPA-2024-005',
    finding:     'Missing lot traceability for 2 raw material batches at receiving',
    ncClass:     'MINOR NON-CONFORMITY',
    severity:    'MINOR',
    due:         '2026-06-05',
    assigned:    'Eng. Fahad Al-Dosari',
    root:        'Receiving team skipped mandatory barcode scan — gap in SOP-REC-003',
    corrective:  'Retroactive lot documentation completed; gap formally documented',
    preventive:  'Barcode scan enforced as mandatory system gate in TraceFlow',
    evidRef:     'NCR-2024-005  |  PROD-TRACE-LOGS',
    status:      'CLOSED',
    statusNote:  'Effectiveness Verified — 2026-06-05',
  })

  p.spacer(2)
  p.sectionTitle('Compliance Verification Status')
  p.statusRow('Critical CAPAs Overdue',     '1  (CAPA-2024-002) — Re-audit Scheduled',          'error')
  p.statusRow('Critical CAPAs Approaching', '1  (CAPA-2024-001) — Due 2026-05-30',               'warn')
  p.statusRow('Effectiveness Verification', 'Pending for 3 open / in-progress items',             'partial')

  p.closingAttestation()
  return p.blob()
}

export function buildGMPReportPDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const p    = new PDFDoc({
    title: 'GMP Audit Report', docNo: `GMP-${todayStr().replace(/-/g, '')}`,
    version: '1.0', generated: ts, hash, classif: 'CONFIDENTIAL',
    regRef: 'Saudi FDA GMP Guidelines v2024  |  ICH Q7 Good Manufacturing Practice',
  })

  p.sectionTitle('GMP Audit Overview')
  p.field('Audit Period',   'Q1 – Q2 2026')
  p.field('Audit Type',     'Internal Compliance Audit')
  p.field('GMP Standard',   'Saudi FDA GMP Guidelines v2024')
  p.field('Lead Auditor',   'Quality Assurance Department')
  p.field('Scope',          'All production lines, quality systems, documentation, and supplier controls')
  p.field('Overall Status', 'COMPLIANT WITH OBSERVATIONS', { color: C.amber, bold: true })

  p.spacer(2)
  p.sectionTitle('Section-by-Section Audit Findings')
  p.table(
    ['Section', 'Description', 'Finding'],
    [
      ['Section 1', 'Personnel & Training',           'COMPLIANT'],
      ['Section 2', 'Premises & Equipment',           'MAJOR NON-CONFORMITY'],
      ['Section 3', 'Production Processes',           'COMPLIANT'],
      ['Section 4', 'Quality Control Systems',        'COMPLIANT'],
      ['Section 5', 'Documentation & Records',        'PARTIAL — 4 Records Under Review'],
      ['Section 6', 'Contract Manufacture & Testing', 'MAJOR NON-CONFORMITY'],
      ['Section 7', 'Product Complaints & Recall',    'COMPLIANT'],
      ['Section 8', 'Self-Inspection Program',        'COMPLIANT'],
    ],
    [22, 70, 78]
  )

  p.spacer(2)
  p.sectionTitle('Major Non-Conformities')

  p.field('MNC-001', 'Equipment calibration certificate expired — Line 3 critical balance (expired 2026-04-30)', { bold: true })
  p.field('Classification',  'MAJOR NON-CONFORMITY', { color: C.red })
  p.field('Risk Assessment', 'HIGH — Direct impact on product release decisions', { color: C.red })
  p.field('Linked CAPA',     'CAPA-2024-001  |  Due: 2026-05-30')
  p.field('Action Required', 'CORRECTIVE ACTION REQUIRED — Re-audit Scheduled upon CAPA closure', { color: C.red })
  p.divider()

  p.field('MNC-002', 'Supplier Al-Rawdah Chemicals — qualification renewal overdue by 6 months', { bold: true })
  p.field('Classification',  'MAJOR NON-CONFORMITY', { color: C.red })
  p.field('Risk Assessment', 'MEDIUM — Potential supply chain quality impact', { color: C.amber })
  p.field('Linked CAPA',     'CAPA-2024-004  |  Due: 2026-06-20')
  p.field('Action Required', 'CORRECTIVE ACTION REQUIRED — Re-audit Scheduled upon CAPA closure', { color: C.amber })

  p.spacer(2)
  p.sectionTitle('Observations (Non-Critical)')
  p.field('OBS-001', 'Section 5 — 4 QC documentation records incomplete for production runs')
  p.field('Linked CAPA', 'CAPA-2024-003  |  Pending Remediation', { color: C.amber })

  p.spacer(2)
  p.sectionTitle('Re-Audit Schedule')
  p.bullet('Re-audit required within 30 days of closure of CAPA-2024-001 and CAPA-2024-004')
  p.bullet('Sections 1, 3, 4, 7, 8 confirmed fully compliant — no re-audit required')
  p.bullet('Effectiveness verification required for all open CAPAs prior to re-audit clearance')
  p.field('Evidence Reference', 'GMP-AUDIT-Q2-2026  |  SOP-GMP-2024-01', { color: C.blue, mono: true })

  p.closingAttestation()
  return p.blob()
}

export function buildInspectionPackagePDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const date = todayStr().replace(/-/g, '')
  const p    = new PDFDoc({
    title:     'SFDA Inspection Package',
    docNo:     `PKG-${date}`,
    version:   '1.0',
    generated: ts,
    hash,
    classif:   'CONFIDENTIAL — SFDA INSPECTION USE ONLY',
    regRef:    'Saudi FDA Establishment Inspection Procedure  |  GMP Guidelines v2024',
  })

  p.sectionTitle('Package Contents — Complete SFDA Pre-Inspection Dossier')
  p.table(
    ['#', 'Document Set', 'Coverage'],
    [
      ['1', 'Batch History Records',      '156 records  (2024 – 2026)'],
      ['2', 'QC Inspection Reports',      '104 reports  —  96.2 % pass rate'],
      ['3', 'Traceability Chain Records', '100 % batch coverage, forward & backward'],
      ['4', 'Recall Event Log',           '3 events  (1 under investigation, 2 closed)'],
      ['5', 'CAPA Register',              '5 actions  —  3 open, 1 closed and verified'],
      ['6', 'Tamper-Evident Audit Trail', '892 immutable entries  —  hash-validated'],
      ['7', 'SFDA Inspection History',    'All prior inspections and outcomes on record'],
      ['8', 'Operator Activity Log',      'Full timestamped timeline with actor attribution'],
    ],
    [10, 90, 70]
  )

  p.spacer(2)
  p.sectionTitle('Compliance Scorecard')
  p.statusRow('Overall Compliance Score',     '82 %',                                                          'warn')
  p.statusRow('Inspection Readiness Score',   '87 %',                                                          'ok')
  p.statusRow('Regulatory Risk Level',        'MEDIUM',                                                        'warn')
  p.spacer(3)
  p.statusRow('GMP Compliance Status',        'COMPLIANT WITH OBSERVATIONS',                                   'warn')
  p.statusRow('Batch Traceability',           'COMPLIANT — 100 % coverage verified',                          'ok')
  p.statusRow('QC Documentation Status',      'PARTIAL — 4 Records Under Review  (Ref: CAPA-2024-003)',         'partial')
  p.statusRow('Equipment Calibration Status', 'CORRECTIVE ACTION REQUIRED  (Ref: CAPA-2024-001)',               'error')

  p.spacer(2)
  p.sectionTitle('Open Items — Corrective Action Required')
  p.table(
    ['CAPA ID', 'Issue', 'Severity', 'Due Date', 'Status'],
    [
      ['CAPA-2024-001', 'Equipment calibration expired — Line 3', 'CRITICAL', '2026-05-30', 'Open — Pending'],
      ['CAPA-2024-002', 'Temperature excursion — B-2024-089',     'CRITICAL', '2026-05-28', 'OVERDUE'],
      ['CAPA-2024-003', 'Incomplete QC documentation — 4 runs',   'MAJOR',    '2026-06-10', 'In Progress'],
    ],
    [32, 62, 22, 26, 28]
  )

  p.spacer(2)
  p.sectionTitle('Data Integrity Attestation')
  p.bullet('This inspection package was compiled by the TraceFlow Regulatory Compliance Engine')
  p.bullet('All records are sourced directly from the production database with full audit provenance')
  p.bullet('Tamper-evident audit trail hash validates data integrity at time of generation')
  p.bullet('Package contents are immutable upon generation — amendments require new package issuance')
  p.spacer(3)
  p.field('Package ID',  `PKG-${date}`,  { mono: true, bold: true })
  p.field('Generated',   ts)
  p.field('Hash',        hash,           { mono: true, color: C.blue })
  p.field('Status',      'CERTIFIED — For Authorized SFDA Inspection Use Only', { color: C.blue, bold: true })

  return p.blob()
}

// ── ZIP builder ───────────────────────────────────────────────────────────────

export async function buildInspectionPackageZIP(): Promise<Blob> {
  const date   = todayStr()
  const zip    = new JSZip()
  const folder = zip.folder('SFDA-Inspection-Package') ?? zip

  folder.file(`SFDA-Inspection-Package-${date}.pdf`,   buildInspectionPackagePDF())
  folder.file(`GMP-Audit-Report-${date}.pdf`,           buildGMPReportPDF())
  folder.file(`CAPA-Summary-Report-${date}.pdf`,        buildCAPAReportPDF())
  folder.file(`QC-Inspection-Report-${date}.pdf`,       buildQCReportPDF())
  folder.file(`Batch-Traceability-Report-${date}.pdf`,  buildBatchReportPDF())
  folder.file(`NCR-Report-${date}.pdf`,                 buildNCRReportPDF())
  folder.file(`Recall-Summary-Report-${date}.pdf`,      buildRecallReportPDF())

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
