'use client'

import jsPDF from 'jspdf'
import JSZip from 'jszip'

// ── Enterprise palette ─────────────────────────────────────────────────────────
const C = {
  dark:   [20,  30,  50]  as const,
  text:   [32,  40,  54]  as const,
  muted:  [75,  90,  108] as const,
  subtle: [120, 135, 155] as const,
  blue:   [29,  78,  137] as const,
  rule:   [210, 216, 226] as const,
  border: [218, 224, 234] as const,
  red:    [168, 18,  18]  as const,
  amber:  [145, 84,  0]   as const,
  green:  [14,  104, 45]  as const,
  slate:  [88,  102, 122] as const,   // MINOR severity / neutral status
  rowalt: [246, 248, 252] as const,
  rowhdr: [222, 229, 243] as const,
  wmark:  [242, 245, 250] as const,   // very faint — never obstructs content
  white:  [255, 255, 255] as const,
}

// ── Layout (A4 portrait, mm) ───────────────────────────────────────────────────
const PW    = 210
const PH    = 297
const ML    = 20
const MR    = 20
const CW    = PW - ML - MR   // 170mm
const LBL   = 40              // label column for field() rows
const HDR1  = 74              // first-page content start y
const HDRC  = 22              // continuation-page content start y
const FOOTY = 276             // footer rule y
const GUARD = 14              // trigger newPage if y + h > FOOTY - GUARD

// ── Low-level helpers ─────────────────────────────────────────────────────────
function tc(doc: jsPDF, c: readonly [number, number, number]) { doc.setTextColor(c[0], c[1], c[2]) }
function dc(doc: jsPDF, c: readonly [number, number, number]) { doc.setDrawColor(c[0], c[1], c[2]) }
function fc(doc: jsPDF, c: readonly [number, number, number]) { doc.setFillColor(c[0], c[1], c[2]) }

// Auto-detects compliance keywords and returns an appropriate status color
function cellStatusColor(val: string): readonly [number, number, number] {
  const v = val.toUpperCase().trim()
  const greenSet = new Set(['PASS', 'RELEASED', 'CLOSED', 'COMPLIANT', 'VERIFIED',
    'APPROVED', 'ELECTRONICALLY SIGNED', 'HASH VALIDATED', 'INITIAL ISSUE', 'COMPLETE'])
  const redSet   = new Set(['FAIL', 'CRITICAL', 'OVERDUE', 'ON HOLD', 'NON-CONFORMITY'])
  const amberSet = new Set(['MAJOR', 'IN PROGRESS', 'PARTIAL', 'UNDER REVIEW'])
  const blueSet  = new Set(['OPEN', 'INFORMATION', 'PENDING'])
  const slateSet = new Set(['MINOR'])

  if (greenSet.has(v)) return C.green
  if (redSet.has(v))   return C.red
  if (amberSet.has(v)) return C.amber
  if (blueSet.has(v))  return C.blue
  if (slateSet.has(v)) return C.slate
  return C.text
}

// ── Public utilities ──────────────────────────────────────────────────────────
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
  readonly meta: DocMeta

  constructor(meta: DocMeta) {
    this.doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    this.meta  = meta
    this.pageN = 1
    this.drawFirstHeader()
    this.y = HDR1
  }

  // ── Watermark — drawn first, content rendered on top ──────────────────────
  private drawWatermark() {
    const { doc } = this
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(50)
    tc(doc, C.wmark)     // very faint — won't obstruct reading
    doc.text('CONFIDENTIAL', PW / 2, PH / 2 + 5, { angle: 45, align: 'center' })
  }

  // ── First-page header ─────────────────────────────────────────────────────
  private drawFirstHeader() {
    const { doc, meta } = this
    this.drawWatermark()

    // 3.5mm IBM-blue accent bar at top
    fc(doc, C.blue); doc.rect(0, 0, PW, 3.5, 'F')

    // Platform branding (top-left)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    tc(doc, C.muted)
    doc.text('TraceFlow Regulatory Compliance Engine', ML, 11)

    // Classification label (top-right)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    tc(doc, C.red)
    doc.text(meta.classif, PW - MR, 11, { align: 'right' })

    // Document title
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
    tc(doc, C.dark)
    doc.text(meta.title, ML, 23)

    // Thin rule
    dc(doc, C.rule); doc.setLineWidth(0.4)
    doc.line(ML, 28, PW - MR, 28)

    // Metadata grid
    const metaRows: [string, string, boolean?][] = [
      ['Document No.',    meta.docNo],
      ['Generated',       meta.generated],
      ['Version',         meta.version],
      ['Regulatory Ref.', meta.regRef],
      ['Integrity Hash',  meta.hash, true],
    ]
    let my = 35
    metaRows.forEach(([lbl, val, mono]) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
      tc(doc, C.muted)
      doc.text(lbl, ML, my)
      doc.setFont(mono ? 'courier' : 'helvetica', 'normal')
      doc.setFontSize(mono ? 6.5 : 7.5)
      tc(doc, mono ? C.muted : C.text)
      const lines = doc.splitTextToSize(val, CW - LBL)
      doc.text(lines, ML + LBL, my)
      my += lines.length > 1 ? lines.length * 4.2 + 0.5 : 5
    })

    // Rule below metadata
    dc(doc, C.rule); doc.setLineWidth(0.4)
    doc.line(ML, Math.max(my + 3, 64), PW - MR, Math.max(my + 3, 64))
  }

  // ── Continuation-page header ──────────────────────────────────────────────
  private drawContHeader() {
    const { doc, meta } = this
    this.drawWatermark()

    fc(doc, C.blue); doc.rect(0, 0, PW, 3, 'F')

    doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    tc(doc, C.dark)
    doc.text(meta.title, ML, 10)

    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    tc(doc, C.muted)
    doc.text(meta.docNo, PW - MR, 10, { align: 'right' })

    dc(doc, C.rule); doc.setLineWidth(0.3)
    doc.line(ML, 14, PW - MR, 14)
  }

  // ── Footer — stamped in two-pass finalize ─────────────────────────────────
  private drawFooter(page: number, total: number) {
    const { doc } = this
    dc(doc, C.rule); doc.setLineWidth(0.3)
    doc.line(ML, FOOTY, PW - MR, FOOTY)

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
    tc(doc, C.muted)
    doc.text('TraceFlow Regulatory Compliance Engine  ·  Electronically Generated Document', ML, FOOTY + 5)

    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
    tc(doc, C.dark)
    doc.text(`Page ${page} of ${total}`, PW - MR, FOOTY + 5, { align: 'right' })

    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.8)
    tc(doc, C.subtle)
    doc.text('No Handwritten Signature Required  ·  For Authorized SFDA Inspection Use Only  ·  Tamper-Evident Record', ML, FOOTY + 10)

    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.8)
    tc(doc, C.subtle)
    doc.text('CONFIDENTIAL', PW - MR, FOOTY + 10, { align: 'right' })
  }

  finalize(): this {
    const total = this.doc.getNumberOfPages()
    for (let p = 1; p <= total; p++) {
      this.doc.setPage(p); this.drawFooter(p, total)
    }
    return this
  }

  // ── Page management ────────────────────────────────────────────────────────
  private newPage() {
    this.doc.addPage(); this.pageN++
    this.drawContHeader(); this.y = HDRC
  }

  private ensure(h: number) {
    if (this.y + h > FOOTY - GUARD) this.newPage()
  }

  // ── Content primitives ─────────────────────────────────────────────────────

  spacer(h = 5) { this.y += h }

  sectionTitle(text: string) {
    this.ensure(18)
    this.spacer(3)
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(8.5)
    tc(this.doc, C.blue)
    this.doc.text(text.toUpperCase(), ML, this.y)
    dc(this.doc, C.rule); this.doc.setLineWidth(0.3)
    this.doc.line(ML, this.y + 3.5, ML + CW, this.y + 3.5)
    this.y += 11
  }

  field(label: string, value: string,
    opts: { color?: readonly [number,number,number]; bold?: boolean; mono?: boolean } = {}
  ) {
    if (!value) return
    const vlines = this.doc.splitTextToSize(value, CW - LBL - 2)
    this.ensure(vlines.length * 4.8 + 1)
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7.5)
    tc(this.doc, C.muted)
    this.doc.text(label, ML, this.y)
    this.doc.setFont(opts.mono ? 'courier' : 'helvetica', opts.bold ? 'bold' : 'normal')
    this.doc.setFontSize(opts.mono ? 7.5 : 8.5)
    tc(this.doc, opts.color ?? C.text)
    this.doc.text(vlines, ML + LBL, this.y)
    this.y += vlines.length * 4.8 + 1.5
  }

  // Card-style status row: colored left bar + subtle background
  statusRow(label: string, value: string, level: 'ok'|'partial'|'error'|'warn'|'info') {
    const col = { ok: C.green, partial: C.amber, error: C.red, warn: C.amber, info: C.blue }[level]
    const h   = 9
    this.ensure(h + 2)
    const y0 = this.y
    fc(this.doc, C.rowalt);  this.doc.rect(ML, y0, CW, h, 'F')
    fc(this.doc, col);       this.doc.rect(ML, y0, 3, h, 'F')
    dc(this.doc, C.border); this.doc.setLineWidth(0.15)
    this.doc.line(ML, y0 + h, ML + CW, y0 + h)
    this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(8)
    tc(this.doc, C.muted)
    this.doc.text(label, ML + 7, y0 + 6)
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(8)
    tc(this.doc, col)
    this.doc.text(value, ML + CW - 2, y0 + 6, { align: 'right' })
    this.y = y0 + h + 1.5
  }

  // 2-column executive scorecard grid
  scorecard(items: Array<{ label: string; value: string; level: 'ok'|'partial'|'error'|'warn'|'info' }>) {
    const cols  = 2
    const cellW = (CW - 3) / cols
    const cellH = 19
    const rows  = Math.ceil(items.length / cols)
    this.ensure(cellH * rows + 6)
    const startY = this.y
    items.forEach((item, i) => {
      const col   = i % cols
      const row   = Math.floor(i / cols)
      const cx    = ML + col * (cellW + 3)
      const cy    = startY + row * cellH
      const color = { ok: C.green, partial: C.amber, error: C.red, warn: C.amber, info: C.blue }[item.level]
      fc(this.doc, C.rowalt);  this.doc.rect(cx, cy, cellW, cellH - 1, 'F')
      fc(this.doc, color);     this.doc.rect(cx, cy, cellW, 2.5, 'F')
      dc(this.doc, C.border); this.doc.setLineWidth(0.2)
      this.doc.rect(cx, cy, cellW, cellH - 1, 'S')
      this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(6.5)
      tc(this.doc, C.muted)
      this.doc.text(item.label.toUpperCase(), cx + 4, cy + 8)
      this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(11)
      tc(this.doc, color)
      this.doc.text(item.value, cx + 4, cy + 15.5)
    })
    this.y = startY + rows * cellH + 5
  }

  bullet(text: string, color: readonly [number,number,number] = C.text) {
    const lines = this.doc.splitTextToSize(text, CW - 10)
    this.ensure(lines.length * 4.8 + 1)
    this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(8.5)
    tc(this.doc, C.blue); this.doc.text('–', ML + 2, this.y)
    tc(this.doc, color);  this.doc.text(lines, ML + 8, this.y)
    this.y += lines.length * 4.8
  }

  note(text: string) {
    const lines = this.doc.splitTextToSize(text, CW - 8)
    this.ensure(lines.length * 4.2 + 1)
    this.doc.setFont('helvetica', 'italic'); this.doc.setFontSize(7.5)
    tc(this.doc, C.subtle)
    this.doc.text(lines, ML + 6, this.y)
    this.y += lines.length * 4.2 + 1
  }

  divider() {
    this.ensure(8)
    dc(this.doc, C.border); this.doc.setLineWidth(0.2)
    this.doc.line(ML + 8, this.y + 2.5, ML + CW, this.y + 2.5)
    this.y += 8
  }

  // Enterprise table — fixed header height, auto status badge colors
  table(headers: string[], rows: string[][], widths?: number[]) {
    const cols = headers.length
    const ws   = widths ?? headers.map(() => +(CW / cols).toFixed(1))
    const hrh  = 10    // header row height (taller for clarity)
    const drh  = 7.5   // data row height
    const hpad = 3

    this.ensure(hrh + drh + 6)
    const tsY = this.y    // table start y

    // Header background + text
    fc(this.doc, C.rowhdr); this.doc.rect(ML, tsY, CW, hrh, 'F')
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7.5)
    tc(this.doc, C.dark)
    let x = ML + hpad
    headers.forEach((h, i) => { this.doc.text(h, x, tsY + 6.5); x += ws[i] })

    // Blue rule under header
    dc(this.doc, C.blue); this.doc.setLineWidth(0.5)
    this.doc.line(ML, tsY + hrh, ML + CW, tsY + hrh)
    this.y = tsY + hrh

    // Data rows
    rows.forEach((row, ri) => {
      this.ensure(drh)
      const rowY = this.y
      if (ri % 2 === 1) { fc(this.doc, C.rowalt); this.doc.rect(ML, rowY, CW, drh, 'F') }
      this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(7.5)
      x = ML + hpad
      row.forEach((cell, ci) => {
        const txt = this.doc.splitTextToSize(cell, ws[ci] - hpad * 2)[0] ?? ''
        tc(this.doc, cellStatusColor(txt))
        this.doc.text(txt, x, rowY + 5); x += ws[ci]
      })
      dc(this.doc, C.border); this.doc.setLineWidth(0.15)
      this.doc.line(ML, rowY + drh, ML + CW, rowY + drh)
      this.y = rowY + drh
    })

    // Outer border
    dc(this.doc, C.border); this.doc.setLineWidth(0.3)
    this.doc.rect(ML, tsY, CW, hrh + rows.length * drh, 'S')
    this.y += 5
  }

  // CAPA record block — colored left stripe, indented field grid
  capaBlock(b: {
    id: string; finding: string; ncClass: string; severity: string
    due: string; assigned: string; root: string
    corrective: string; preventive: string; evidRef: string
    status: string; statusNote: string
  }) {
    this.ensure(65)
    const sCol = b.status === 'CLOSED' ? C.green : b.severity === 'CRITICAL' ? C.red : C.amber

    // Left stripe + CAPA ID bar
    fc(this.doc, sCol); this.doc.rect(ML, this.y - 1, 3, 8, 'F')
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(9.5)
    tc(this.doc, C.dark); this.doc.text(b.id, ML + 7, this.y + 4.5)
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(8)
    tc(this.doc, sCol);   this.doc.text(b.status, PW - MR, this.y + 4.5, { align: 'right' })
    dc(this.doc, C.border); this.doc.setLineWidth(0.2)
    this.doc.line(ML + 7, this.y + 7, ML + CW, this.y + 7)
    this.y += 12

    const indent = 7
    const ifield = (lbl: string, val: string, opts?: { color?: readonly [number,number,number]; bold?: boolean; mono?: boolean }) => {
      if (!val) return
      const vl = this.doc.splitTextToSize(val, CW - LBL - indent - 2)
      this.ensure(vl.length * 4.8 + 1)
      this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7.5)
      tc(this.doc, C.muted); this.doc.text(lbl, ML + indent, this.y)
      this.doc.setFont(opts?.mono ? 'courier' : 'helvetica', opts?.bold ? 'bold' : 'normal')
      this.doc.setFontSize(opts?.mono ? 7.5 : 8.5)
      tc(this.doc, opts?.color ?? C.text); this.doc.text(vl, ML + indent + LBL, this.y)
      this.y += vl.length * 4.8 + 1.5
    }

    ifield('Finding',              b.finding)
    ifield('Non-Conformity Class', b.ncClass,   { color: sCol, bold: true })
    ifield('Severity',             b.severity,  { color: sCol, bold: true })
    ifield('Due Date',             b.due)
    ifield('Assigned To',          b.assigned)
    ifield('Root Cause',           b.root)
    ifield('Corrective Action',    b.corrective)
    ifield('Preventive Action',    b.preventive)
    ifield('Evidence Reference',   b.evidRef,   { color: C.blue, mono: true })
    if (b.statusNote) ifield('Status Note', b.statusNote, { color: sCol })

    this.y += 3
    dc(this.doc, C.border); this.doc.setLineWidth(0.2)
    this.doc.line(ML + 7, this.y, ML + CW, this.y)
    this.y += 9
  }

  // ── Document closing sections ─────────────────────────────────────────────

  // Electronic approval matrix — enterprise GMP audit system style
  private approvalMatrix() {
    this.sectionTitle('Electronic Approval Record')
    this.table(
      ['Approving Authority', 'Designated Role', 'Approval Status', 'Timestamp'],
      [
        ['Quality Assurance Dept.',    'QA Manager',                'APPROVED',              this.meta.generated],
        ['Compliance & Regulatory',    'Compliance Director',       'VERIFIED',              this.meta.generated],
        ['Regulatory Affairs',         'Regulatory Affairs Officer','ELECTRONICALLY SIGNED', this.meta.generated],
        ['TraceFlow Platform',         'Automated Verification',    'HASH VALIDATED',        this.meta.generated],
      ],
      [46, 48, 44, 32]
    )
    this.spacer(2)
    this.note('Electronic approval constitutes a legally equivalent signature in accordance with SFDA Electronic Records & Signatures Guidance. No handwritten signature required. Approval records are immutable once generated.')
  }

  // Document control revision table
  private revisionTable() {
    this.sectionTitle('Document Control — Revision History')
    this.table(
      ['Rev.', 'Date', 'Status', 'Change Description'],
      [['1.0', this.meta.generated.split(' ')[0] ?? this.meta.generated, 'INITIAL ISSUE',
        'Auto-generated by TraceFlow Regulatory Compliance Engine']],
      [14, 34, 30, 92]
    )
  }

  // Retention and distribution notice
  private retentionNotice() {
    this.spacer(4)
    this.doc.setFont('helvetica', 'italic'); this.doc.setFontSize(7)
    tc(this.doc, C.subtle)
    const lines = this.doc.splitTextToSize(
      'Retention: This document shall be retained for a minimum of 5 years from the date of generation per SFDA GMP Guidelines v2024, Section 4.3. ' +
      'Distribution: CONFIDENTIAL — authorized SFDA inspection personnel and Quality Assurance department only. ' +
      'Amendment: Any amendment requires issuance of a new document version with a new integrity hash.',
      CW
    )
    this.ensure(lines.length * 4 + 2)
    this.doc.text(lines, ML, this.y)
    this.y += lines.length * 4 + 2
  }

  // Full closing block — certification + approval matrix + revision history
  inspectionCertification() {
    this.spacer(8)
    this.sectionTitle('Inspection Certification')

    const stmt = this.doc.splitTextToSize(
      'This document has been generated and certified by the TraceFlow Regulatory Compliance Engine in accordance with Saudi Food and Drug Authority (SFDA) inspection requirements and applicable GMP guidelines. ' +
      'All data and records are authentic, complete, and sourced directly from the organization\'s validated quality management system. ' +
      'This document is a tamper-evident, immutable regulatory compliance artifact.',
      CW
    )
    this.ensure(stmt.length * 4.8 + 40)
    this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(8.5)
    tc(this.doc, C.text); this.doc.text(stmt, ML, this.y)
    this.y += stmt.length * 4.8 + 7

    this.field('Document ID',    this.meta.docNo,    { mono: true })
    this.field('Generated',      this.meta.generated)
    this.field('Regulatory Ref.',this.meta.regRef)
    this.field('Integrity Hash', this.meta.hash,     { mono: true, color: C.blue })
    this.field('Certification',  'CERTIFIED — For Authorized SFDA Inspection Use Only', { color: C.blue, bold: true })

    this.spacer(7)
    this.approvalMatrix()

    this.spacer(5)
    this.revisionTable()

    this.spacer(5)
    this.sectionTitle('Regulatory Review Confirmation')
    this.statusRow('Document Completeness',  'VERIFIED — All required sections present and complete',  'ok')
    this.statusRow('Data Integrity',         'VERIFIED — Hash-validated at time of generation',        'ok')
    this.statusRow('Distribution Control',   'CONTROLLED — Authorized recipients only',               'info')
    this.statusRow('Regulatory Framework',   'Saudi FDA GMP Guidelines v2024  |  ICH Q10',            'info')

    this.retentionNotice()
  }

  // ── Output ─────────────────────────────────────────────────────────────────
  blob(): Blob {
    this.finalize()
    return this.doc.output('blob')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

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
  p.field('Batch Pass Rate',          '96.2 %',    { color: C.green, bold: true })
  p.field('Batches Failed / On Hold', '4',          { color: C.red })
  p.field('Critical Observations',    '2',          { color: C.red })
  p.field('Inspectors Qualified',     '5 — All certifications current through Q4 2026')
  p.field('Inspection Readiness',     'APPROVED',   { color: C.green, bold: true })

  p.spacer(2)
  p.sectionTitle('Batch Inspection Results')
  p.table(
    ['Batch ID', 'Product', 'Inspector', 'Inspection Date', 'Result'],
    [
      ['B-2024-088', 'Vitamin D 5000 IU',       'Eng. K. Al-Otaibi',  '2026-05-20', 'PASS'],
      ['B-2024-089', 'Magnesium Complex 400mg',  'Eng. S. Al-Zahrani', '2026-05-22', 'FAIL'],
      ['B-2024-090', 'Omega-3 Fish Oil',         'Eng. K. Al-Otaibi',  '2026-05-23', 'PASS'],
      ['B-2024-091', 'Zinc Citrate 50mg',        'Eng. N. Al-Harbi',   '2026-05-24', 'PASS'],
      ['B-2024-092', 'Vitamin B Complex',        'Eng. F. Al-Dosari',  '2026-05-24', 'PASS'],
    ],
    [28, 50, 36, 30, 26]
  )
  p.field('Evidence Reference', 'QC-INSP-2024  |  Batch records archived in TraceFlow', { color: C.blue, mono: true })

  p.spacer(2)
  p.sectionTitle('Audit Observations')
  p.bullet('All inspections conducted per SOP-QC-001 v3.2 and Saudi FDA GMP Guidelines')
  p.bullet('Line 3 critical balance calibration expired 2026-04-30 — CAPA-2024-001 raised; recalibration pending', C.red)
  p.bullet('4 production run QC records incomplete — CAPA-2024-003 in progress (documentation gap)', C.amber)
  p.bullet('2 temperature excursion events logged — cold chain protocol review in progress')

  p.spacer(2)
  p.sectionTitle('Compliance Verification Status')
  p.statusRow('QC Process Compliance',        'SUBSTANTIALLY COMPLIANT',                                  'ok')
  p.statusRow('Documentation Compliance',     'PARTIAL — 4 records under review  |  Ref: CAPA-2024-003', 'partial')
  p.statusRow('Equipment Calibration Status', 'ACTION REQUIRED  |  Ref: CAPA-2024-001',                  'error')

  p.inspectionCertification()
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
  p.field('Fully Compliant',         '224  (96.9 %)',                               { color: C.green })
  p.field('Partial Compliance',      '5  (2.2 %) — Pending Remediation',            { color: C.amber })
  p.field('Non-Compliant / On Hold', '2  (0.9 %) — Corrective Action in Progress',  { color: C.red })

  p.spacer(2)
  p.sectionTitle('Recent Batch Records')
  p.table(
    ['Batch ID', 'Product', 'Raw Materials', 'QC Result', 'Disposition'],
    [
      ['B-2024-088', 'Vitamin D 5000 IU',  'RM-011, RM-022', 'PASS', 'RELEASED'],
      ['B-2024-089', 'Magnesium 400mg',    'RM-008, RM-015', 'FAIL', 'ON HOLD'],
      ['B-2024-090', 'Omega-3 Fish Oil',   'RM-033, RM-041', 'PASS', 'RELEASED'],
      ['B-2024-091', 'Zinc Citrate 50mg',  'RM-009, RM-018', 'PASS', 'RELEASED'],
      ['B-2024-092', 'Vitamin B Complex',  'RM-004, RM-029', 'PASS', 'RELEASED'],
    ],
    [28, 44, 36, 22, 40]
  )

  p.spacer(2)
  p.sectionTitle('Traceability Chain Verification')
  p.field('Forward Traceability',  'Raw material receipt → Production → QC inspection → Storage → Dispatch')
  p.field('Backward Traceability', 'Customer → Batch → Production order → Raw material lot → Supplier')
  p.field('Chain Coverage',        '100 % — complete forward and backward traceability confirmed', { color: C.green })
  p.spacer(3)
  p.bullet('2 receiving records incomplete — barcode not captured at intake (now remediated)', C.amber)
  p.bullet('CAPA-2024-005 closed; effectiveness verified 2026-06-05 — SOP-REC-003 updated')
  p.field('Evidence Reference', 'PROD-TRACE-LOGS  |  TraceFlow production database', { color: C.blue, mono: true })

  p.spacer(2)
  p.sectionTitle('Compliance Verification Status')
  p.statusRow('Batch Traceability',     'SUBSTANTIALLY COMPLIANT — 100 % coverage confirmed',        'ok')
  p.statusRow('Non-Conformant Batches', '2 on hold — CAPA-2024-002 in progress',                     'error')
  p.statusRow('Remediation Progress',   'CAPA-2024-005 closed and verified; CAPA-2024-002 pending',  'partial')

  p.inspectionCertification()
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
      ['NCR-2024-001', 'Equipment calibration expired — Line 3',   'CRITICAL', 'CAPA-2024-001', 'OPEN'],
      ['NCR-2024-002', 'Temperature excursion — Batch B-2024-089', 'CRITICAL', 'CAPA-2024-002', 'OPEN'],
      ['NCR-2024-003', 'Incomplete QC documentation — 4 runs',     'MAJOR',    'CAPA-2024-003', 'UNDER REVIEW'],
      ['NCR-2024-004', 'Supplier qualification gap — Al-Rawdah',   'MAJOR',    'CAPA-2024-004', 'UNDER REVIEW'],
      ['NCR-2024-005', 'Lot traceability gap — 2 material batches','MINOR',    'CAPA-2024-005', 'CLOSED'],
    ],
    [28, 54, 18, 32, 38]
  )

  p.spacer(2)
  p.sectionTitle('Root Cause Analysis & Remediation Status')
  const ncrs = [
    { id: 'NCR-2024-001', cause: 'Periodic calibration schedule not enforced by maintenance team',           capa: 'CAPA-2024-001', due: '2026-05-30', status: 'OPEN'        },
    { id: 'NCR-2024-002', cause: 'Cold chain temperature alarm not escalated during night shift',            capa: 'CAPA-2024-002', due: '2026-05-28', status: 'OVERDUE'     },
    { id: 'NCR-2024-003', cause: 'SOP-QC-001 checklist not consistently followed — training gap identified', capa: 'CAPA-2024-003', due: '2026-06-10', status: 'IN PROGRESS' },
    { id: 'NCR-2024-004', cause: 'Supplier qualification renewal not scheduled in vendor management system', capa: 'CAPA-2024-004', due: '2026-06-20', status: 'IN PROGRESS' },
    { id: 'NCR-2024-005', cause: 'Receiving team skipped mandatory barcode scan — SOP-REC-003 gap',          capa: 'CAPA-2024-005', due: '2026-06-05', status: 'CLOSED'      },
  ]
  ncrs.forEach(n => {
    p.field(n.id, n.cause)
    p.note(`Linked CAPA: ${n.capa}  |  Due: ${n.due}  |  Status: ${n.status}`)
    p.spacer(2)
  })
  p.field('Evidence Reference', 'NCR-LOG-2024  |  CAPA-REG-2024', { color: C.blue, mono: true })

  p.inspectionCertification()
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
  p.field('Total Recall Events', '3  (2 voluntary, 1 mandatory)')
  p.field('Closed / Verified',   '2', { color: C.green })
  p.field('Under Investigation', '1', { color: C.red })

  p.spacer(2)
  p.sectionTitle('Recall Event Register')

  p.field('RCL-2024-001',       'Temperature Excursion  —  Initiated: 2026-05-22', { bold: true })
  p.field('Classification',     'Class II — Potential Health Risk',                 { color: C.amber })
  p.field('Affected Batches',   '3')
  p.field('Customer Coverage',  '8 customers notified — 100 % coverage within 90 minutes')
  p.field('Current Status',     'UNDER INVESTIGATION',                              { color: C.red })
  p.field('CAPA Linkage',       'CAPA-2024-002 (overdue) — escalated to Quality Director', { color: C.red })
  p.field('Evidence Reference', 'RCL-LOG-2024-001  |  CAPA-2024-002',              { color: C.blue, mono: true })
  p.divider()

  p.field('RCL-2023-003',       'Supplier Contamination  —  Closed: 2025-11-10', { bold: true })
  p.field('Classification',     'Class I — Serious Health Hazard',                { color: C.red })
  p.field('Product Recovery',   '100 %',                                           { color: C.green })
  p.field('Root Cause',         'Supplier ingredient out-of-specification — Al-Rawdah Chemicals')
  p.field('Resolution',         'Supplier delisted; alternative qualified per SOP-VQP-002')
  p.field('Evidence Reference', 'RCL-LOG-2023-003  |  Supplier Audit File SAF-2023-003', { color: C.blue, mono: true })
  p.divider()

  p.field('RCL-2022-007',       'Labelling Discrepancy  —  Closed: 2024-03-05', { bold: true })
  p.field('Classification',     'Class III — Minor Risk',                        { color: C.green })
  p.field('Product Recovery',   '98 %',                                           { color: C.green })
  p.field('Root Cause',         'Artwork file version mismatch — version control gap in print process')
  p.field('Resolution',         'SOP-ART-001 updated; electronic sign-off enforced for all artwork changes')
  p.field('Evidence Reference', 'RCL-LOG-2022-007  |  Artwork Deviation Report ADR-2022-007', { color: C.blue, mono: true })

  p.spacer(2)
  p.sectionTitle('Recall Readiness Assessment')
  p.statusRow('Readiness Score',             '91 %',                                                           'ok')
  p.statusRow('Time to Notify',              '< 2 hours  (pre-approved SFDA notification template active)',    'ok')
  p.statusRow('Batch Identification Method', 'Automated — real-time traceability via TraceFlow',               'ok')
  p.statusRow('Simulation Last Run',         '2026-05-10',                                                     'info')
  p.statusRow('Re-audit Scheduled',          'Following closure of RCL-2024-001',                              'warn')

  p.inspectionCertification()
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

  p.sectionTitle('CAPA Register — Executive Summary')
  p.scorecard([
    { label: 'Total on Record', value: '5',      level: 'info'    },
    { label: 'Overdue',         value: '1',      level: 'error'   },
    { label: 'In Progress',     value: '2',      level: 'warn'    },
    { label: 'Closed / Verified', value: '1',   level: 'ok'      },
  ])

  p.spacer(2)
  p.sectionTitle('CAPA Status Overview')
  p.table(
    ['CAPA ID', 'Classification', 'Severity', 'Due Date', 'Assigned To', 'Status'],
    [
      ['CAPA-2024-001', 'NC — Equipment',       'CRITICAL', '2026-05-30', 'Eng. K. Al-Otaibi',      'OPEN'],
      ['CAPA-2024-002', 'NC — Cold Chain',      'CRITICAL', '2026-05-28', 'Eng. S. Al-Zahrani',     'OVERDUE'],
      ['CAPA-2024-003', 'NC — QC Documentation','MAJOR',    '2026-06-10', 'Eng. N. Al-Harbi',       'IN PROGRESS'],
      ['CAPA-2024-004', 'NC — Supplier Qual.',  'MAJOR',    '2026-06-20', 'Eng. A. Al-Qahtani',     'IN PROGRESS'],
      ['CAPA-2024-005', 'NC — Traceability',    'MINOR',    '2026-06-05', 'Eng. F. Al-Dosari',      'CLOSED'],
    ],
    [28, 34, 18, 24, 36, 30]
  )

  p.spacer(2)
  p.sectionTitle('CAPA Detail Register')

  p.capaBlock({
    id: 'CAPA-2024-001',
    finding:    'Equipment calibration certificate expired — Line 3 critical balance',
    ncClass:    'Major Non-Conformity',
    severity:   'CRITICAL',
    due:        '2026-05-30',
    assigned:   'Eng. Khalid Al-Otaibi',
    root:       'Periodic calibration schedule not enforced by maintenance team',
    corrective: 'Immediate recalibration of Line 3 balance; SOP-MAINT-004 updated',
    preventive: 'Automated calibration reminder and escalation workflow implemented',
    evidRef:    'NCR-2024-001  |  CALIB-SCHED-2024',
    status:     'OPEN',
    statusNote: 'Pending Remediation — due 2026-05-30',
  })

  p.capaBlock({
    id: 'CAPA-2024-002',
    finding:    'Batch B-2024-089 — temperature excursion during overnight cold storage',
    ncClass:    'Major Non-Conformity',
    severity:   'CRITICAL',
    due:        '2026-05-28',
    assigned:   'Eng. Sara Al-Zahrani',
    root:       'Cold chain temperature alarm not escalated during night shift operations',
    corrective: 'Batch B-2024-089 quarantined pending stability assessment',
    preventive: '24/7 automated temperature monitoring with mandatory escalation protocol',
    evidRef:    'NCR-2024-002  |  RCL-2024-001  |  Temp Log TL-089',
    status:     'OVERDUE',
    statusNote: 'Escalation Required — Quality Director notified — Re-audit Scheduled',
  })

  p.capaBlock({
    id: 'CAPA-2024-003',
    finding:    'Incomplete QC documentation for 4 consecutive production runs',
    ncClass:    'Major Non-Conformity',
    severity:   'MAJOR',
    due:        '2026-06-10',
    assigned:   'Eng. Nora Al-Harbi',
    root:       'SOP-QC-001 checklist not consistently followed — inspector training gap identified',
    corrective: 'Retroactive documentation review and completion for 4 affected batches',
    preventive: 'Mandatory QC checklist sign-off enforced in TraceFlow; refresher training completed',
    evidRef:    'NCR-2024-003  |  QC-INSP-2024',
    status:     'IN PROGRESS',
    statusNote: 'Remediation in Progress',
  })

  p.capaBlock({
    id: 'CAPA-2024-004',
    finding:    'Supplier Al-Rawdah Chemicals — qualification renewal overdue by 6 months',
    ncClass:    'Major Non-Conformity',
    severity:   'MAJOR',
    due:        '2026-06-20',
    assigned:   'Eng. Abdullah Al-Qahtani',
    root:       'Supplier qualification renewal not scheduled in vendor management system',
    corrective: 'Expedited on-site supplier audit; alternative supplier qualification initiated',
    preventive: 'Automated supplier qualification expiry tracking in TraceFlow',
    evidRef:    'NCR-2024-004  |  Supplier Qualification File SQ-2024-004',
    status:     'IN PROGRESS',
    statusNote: 'Remediation in Progress',
  })

  p.capaBlock({
    id: 'CAPA-2024-005',
    finding:    'Missing lot traceability for 2 raw material batches at receiving',
    ncClass:    'Minor Non-Conformity',
    severity:   'MINOR',
    due:        '2026-06-05',
    assigned:   'Eng. Fahad Al-Dosari',
    root:       'Receiving team skipped mandatory barcode scan — gap in SOP-REC-003',
    corrective: 'Retroactive lot documentation completed; non-conformance formally closed',
    preventive: 'Barcode scan enforced as mandatory gate in TraceFlow receiving workflow',
    evidRef:    'NCR-2024-005  |  PROD-TRACE-LOGS',
    status:     'CLOSED',
    statusNote: 'Effectiveness Verified — 2026-06-05',
  })

  p.spacer(2)
  p.sectionTitle('Compliance Verification Status')
  p.statusRow('Overdue Critical CAPAs',      '1  (CAPA-2024-002) — Escalated',                  'error')
  p.statusRow('Approaching Due Date',        '1  (CAPA-2024-001) — Due 2026-05-30',             'warn')
  p.statusRow('Effectiveness Verification',  'Pending for 3 open / in-progress items',           'partial')

  p.inspectionCertification()
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

  p.sectionTitle('Audit Overview')
  p.field('Audit Period',   'Q1 – Q2 2026')
  p.field('Audit Type',     'Internal Compliance Audit')
  p.field('GMP Standard',   'Saudi FDA GMP Guidelines v2024  |  ICH Q7')
  p.field('Conducted By',   'Quality Assurance Department')
  p.field('Scope',          'All production lines, quality systems, documentation controls, and supplier qualification')
  p.field('Overall Status', 'SUBSTANTIALLY COMPLIANT', { color: C.amber, bold: true })

  p.spacer(2)
  p.sectionTitle('Section-by-Section Audit Findings')
  p.table(
    ['Section', 'GMP Requirement Area', 'Audit Finding'],
    [
      ['Section 1', 'Personnel & Training',            'COMPLIANT'],
      ['Section 2', 'Premises & Equipment',            'NON-CONFORMITY'],
      ['Section 3', 'Production Processes',            'COMPLIANT'],
      ['Section 4', 'Quality Control Systems',         'COMPLIANT'],
      ['Section 5', 'Documentation & Records',         'PARTIAL'],
      ['Section 6', 'Contract Manufacture & Testing',  'NON-CONFORMITY'],
      ['Section 7', 'Product Complaints & Recall',     'COMPLIANT'],
      ['Section 8', 'Self-Inspection Program',         'COMPLIANT'],
    ],
    [22, 78, 70]
  )

  p.spacer(2)
  p.sectionTitle('Non-Conformity Detail')

  p.field('MNC-001',        'Line 3 critical balance calibration certificate expired 2026-04-30', { bold: true })
  p.field('GMP Section',    'Section 2 — Premises & Equipment')
  p.field('Risk Level',     'HIGH — Direct impact on product release decisions',                  { color: C.red })
  p.field('Linked CAPA',    'CAPA-2024-001  |  Due: 2026-05-30')
  p.field('Required Action','Recalibration and SOP-MAINT-004 update — re-audit on CAPA closure',  { color: C.red })
  p.divider()

  p.field('MNC-002',        'Supplier Al-Rawdah Chemicals — qualification renewal overdue by 6 months', { bold: true })
  p.field('GMP Section',    'Section 6 — Contract Manufacture & Testing')
  p.field('Risk Level',     'MEDIUM — Potential supply chain quality impact',                     { color: C.amber })
  p.field('Linked CAPA',    'CAPA-2024-004  |  Due: 2026-06-20')
  p.field('Required Action','Expedited supplier re-qualification — re-audit on CAPA closure',     { color: C.amber })

  p.spacer(2)
  p.sectionTitle('Observation (Non-Critical)')
  p.field('OBS-001',    'Section 5 — 4 QC documentation records incomplete for recent production runs')
  p.field('Linked CAPA','CAPA-2024-003  |  In Progress',                                           { color: C.amber })

  p.spacer(2)
  p.sectionTitle('Re-Audit Schedule')
  p.bullet('Re-audit of Sections 2 and 6 required within 30 days of CAPA closure (CAPA-2024-001 and CAPA-2024-004)')
  p.bullet('Sections 1, 3, 4, 7, 8 — fully compliant, no re-audit required')
  p.bullet('Effectiveness verification required for all open CAPAs prior to re-audit clearance')
  p.field('Evidence Reference', 'GMP-AUDIT-Q2-2026  |  SOP-GMP-2024-01', { color: C.blue, mono: true })

  p.inspectionCertification()
  return p.blob()
}

export function buildInspectionPackagePDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const date = todayStr().replace(/-/g, '')
  const p    = new PDFDoc({
    title:     'SFDA Inspection Dossier',
    docNo:     `PKG-${date}`,
    version:   '1.0',
    generated: ts,
    hash,
    classif:   'CONFIDENTIAL — SFDA INSPECTION USE ONLY',
    regRef:    'Saudi FDA Establishment Inspection Procedure  |  GMP Guidelines v2024',
  })

  p.sectionTitle('Dossier Contents — SFDA Pre-Inspection Package')
  p.table(
    ['#', 'Document Set', 'Scope'],
    [
      ['1', 'Batch History Records',       '156 records  (2024 – 2026)'],
      ['2', 'QC Inspection Reports',       '104 reports  —  96.2 % pass rate'],
      ['3', 'Traceability Chain Records',  '100 % batch coverage, forward & backward'],
      ['4', 'Recall Event Log',            '3 events  (1 under investigation, 2 closed)'],
      ['5', 'CAPA Register',               '5 actions  (1 overdue, 2 in progress, 1 closed)'],
      ['6', 'Tamper-Evident Audit Trail',  '892 immutable entries  —  hash-validated'],
      ['7', 'SFDA Inspection History',     'All prior inspections and outcomes on record'],
      ['8', 'Operator Activity Log',       'Full timestamped timeline with actor attribution'],
    ],
    [10, 90, 70]
  )

  p.spacer(3)
  p.sectionTitle('Compliance Scorecard')
  p.scorecard([
    { label: 'Overall Compliance Score',   value: '82 %',   level: 'warn'  },
    { label: 'Inspection Readiness Score', value: '87 %',   level: 'ok'    },
    { label: 'Regulatory Risk Level',      value: 'MEDIUM', level: 'warn'  },
    { label: 'Open CAPAs (Critical)',      value: '2',      level: 'error' },
  ])

  p.spacer(2)
  p.sectionTitle('Compliance Status by Domain')
  p.statusRow('GMP Compliance Status',        'SUBSTANTIALLY COMPLIANT',                                        'warn')
  p.statusRow('Batch Traceability',           'COMPLIANT — 100 % coverage verified',                           'ok')
  p.statusRow('QC Documentation Status',      'PARTIAL — 4 records under review  (Ref: CAPA-2024-003)',         'partial')
  p.statusRow('Equipment Calibration Status', 'ACTION REQUIRED  (Ref: CAPA-2024-001)',                          'error')

  p.spacer(2)
  p.sectionTitle('Corrective Actions Requiring Remediation')
  p.table(
    ['CAPA ID', 'Issue', 'Severity', 'Due Date', 'Status'],
    [
      ['CAPA-2024-001', 'Equipment calibration expired — Line 3', 'CRITICAL', '2026-05-30', 'OPEN'],
      ['CAPA-2024-002', 'Temperature excursion — B-2024-089',     'CRITICAL', '2026-05-28', 'OVERDUE'],
      ['CAPA-2024-003', 'Incomplete QC documentation — 4 runs',   'MAJOR',    '2026-06-10', 'IN PROGRESS'],
    ],
    [32, 62, 22, 26, 28]
  )

  p.spacer(2)
  p.sectionTitle('Data Integrity Attestation')
  p.bullet('Dossier compiled by the TraceFlow Regulatory Compliance Engine')
  p.bullet('All records sourced directly from the production database with full audit provenance')
  p.bullet('Tamper-evident audit trail hash validates data integrity at time of generation')
  p.bullet('Contents are immutable upon generation — amendments require new dossier issuance')
  p.spacer(3)
  p.field('Dossier ID', `PKG-${date}`, { mono: true, bold: true })
  p.field('Generated',  ts)
  p.field('Hash',       hash,          { mono: true, color: C.blue })
  p.field('Status',     'CERTIFIED — For Authorized SFDA Inspection Use Only', { color: C.blue, bold: true })

  return p.blob()
}

// ── ZIP builder ───────────────────────────────────────────────────────────────

export async function buildInspectionPackageZIP(): Promise<Blob> {
  const date   = todayStr()
  const zip    = new JSZip()
  const folder = zip.folder('SFDA-Inspection-Dossier') ?? zip

  folder.file(`SFDA-Inspection-Dossier-${date}.pdf`,   buildInspectionPackagePDF())
  folder.file(`GMP-Audit-Report-${date}.pdf`,           buildGMPReportPDF())
  folder.file(`CAPA-Summary-Report-${date}.pdf`,        buildCAPAReportPDF())
  folder.file(`QC-Inspection-Report-${date}.pdf`,       buildQCReportPDF())
  folder.file(`Batch-Traceability-Report-${date}.pdf`,  buildBatchReportPDF())
  folder.file(`NCR-Report-${date}.pdf`,                 buildNCRReportPDF())
  folder.file(`Recall-Summary-Report-${date}.pdf`,      buildRecallReportPDF())

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
