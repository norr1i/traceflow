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
  slate:  [88,  102, 122] as const,
  rowalt: [246, 248, 252] as const,
  rowhdr: [222, 229, 243] as const,
  certbg: [247, 249, 254] as const,   // certification / verification section tint
  paper:  [252, 252, 250] as const,   // warm paper depth — barely perceptible
  wmk1:   [244, 248, 254] as const,   // main diagonal watermark (~4 % equivalent)
  wmk2:   [249, 252, 255] as const,   // background typography (~2 % equivalent)
  white:  [255, 255, 255] as const,
}

// ── Layout (A4 portrait, mm) ───────────────────────────────────────────────────
const PW    = 210
const PH    = 297
const ML    = 20
const MR    = 20
const CW    = PW - ML - MR   // 170 mm
const LBL   = 42              // label column width for field() rows
const HDR1  = 76              // first-page content start y
const HDRC  = 22              // continuation-page content start y
const FOOTY = 276             // footer rule y
const GUARD = 14              // newPage trigger threshold

// ── Low-level color helpers ───────────────────────────────────────────────────
function tc(doc: jsPDF, c: readonly [number, number, number]) { doc.setTextColor(c[0], c[1], c[2]) }
function dc(doc: jsPDF, c: readonly [number, number, number]) { doc.setDrawColor(c[0], c[1], c[2]) }
function fc(doc: jsPDF, c: readonly [number, number, number]) { doc.setFillColor(c[0], c[1], c[2]) }

// Auto-detects compliance keywords → appropriate status colour
function cellStatusColor(val: string): readonly [number, number, number] {
  const v = val.toUpperCase().trim()
  const gSet = new Set(['PASS', 'RELEASED', 'CLOSED', 'COMPLIANT', 'VERIFIED',
    'APPROVED', 'ELECTRONICALLY SIGNED', 'HASH VALIDATED', 'INITIAL ISSUE', 'COMPLETE'])
  const rSet = new Set(['FAIL', 'CRITICAL', 'OVERDUE', 'ON HOLD', 'NON-CONFORMITY'])
  const aSet = new Set(['MAJOR', 'IN PROGRESS', 'PARTIAL', 'UNDER REVIEW'])
  const bSet = new Set(['OPEN', 'INFORMATION', 'PENDING'])
  const sSet = new Set(['MINOR'])
  if (gSet.has(v)) return C.green
  if (rSet.has(v)) return C.red
  if (aSet.has(v)) return C.amber
  if (bSet.has(v)) return C.blue
  if (sSet.has(v)) return C.slate
  return C.text
}

// ── Public utilities ──────────────────────────────────────────────────────────
export function nowGregorian(): string {
  const d     = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const hh = g('hour') === '24' ? '00' : g('hour')
  return `${g('year')}-${g('month')}-${g('day')} ${hh}:${g('minute')}`
}

export function todayStr(): string {
  return new Date().toISOString().split('T')[0] ?? ''
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

  // ── Page background: warm paper tint + scattered typography + main diagonal ─
  private drawPageBackground() {
    const { doc } = this

    // Barely-warm paper depth — differentiates from flat white
    fc(doc, C.paper); doc.rect(0, 0, PW, PH, 'F')

    // Background typography — very faint, scattered across the page
    // Positions chosen to cover the full sheet without clustering near content
    const bgWords: [string, number, number, number, number][] = [
      // [text,          x,     y,    angle, size]
      ['TRACEFLOW',      22,    62,   -14,   20],
      ['SFDA',          162,   205,    16,   24],
      ['COMPLIANCE',     32,   238,     7,   14],
      ['VERIFIED',      108,   117,    -9,   16],
      ['GMP',            16,   158,    26,   23],
      ['REGULATORY',     56,   272,     5,   11],
    ]
    doc.setFont('helvetica', 'bold')
    tc(doc, C.wmk2)
    bgWords.forEach(([text, x, y, angle, size]) => {
      doc.setFontSize(size)
      doc.text(text, x, y, { angle })
    })

    // Main diagonal — slightly stronger to read as primary watermark
    doc.setFontSize(28)
    tc(doc, C.wmk1)
    doc.text('CONFIDENTIAL', PW / 2, PH / 2, { angle: 45, align: 'center' })
  }

  // ── First-page header ─────────────────────────────────────────────────────
  private drawFirstHeader() {
    const { doc, meta } = this
    this.drawPageBackground()

    // 3.5 mm IBM-blue accent bar
    fc(doc, C.blue); doc.rect(0, 0, PW, 3.5, 'F')

    // Platform branding
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    tc(doc, C.muted)
    doc.text('TraceFlow Regulatory Compliance Engine', ML, 11)

    // Classification label
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    tc(doc, C.red)
    doc.text(meta.classif, PW - MR, 11, { align: 'right' })

    // Document title
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
    tc(doc, C.dark)
    doc.text(meta.title, ML, 23)

    // Rule under title
    dc(doc, C.rule); doc.setLineWidth(0.4)
    doc.line(ML, 28.5, PW - MR, 28.5)

    // Metadata grid
    const baseMeta: [string, string, boolean?][] = [
      ['Document No.',    meta.docNo],
      ['Generated',       meta.generated],
      ['Version',         meta.version],
      ['Regulatory Ref.', meta.regRef],
      ['Integrity Hash',  meta.hash, true],
    ]
    let my = 35.5
    baseMeta.forEach(([lbl, val, mono]) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
      tc(doc, C.muted)
      doc.text(lbl, ML, my)
      doc.setFont(mono ? 'courier' : 'helvetica', 'normal')
      doc.setFontSize(mono ? 6.5 : 7.5)
      tc(doc, mono ? C.subtle : C.text)
      const lines = doc.splitTextToSize(val, CW - LBL - 2)
      doc.text(lines, ML + LBL, my)
      my += lines.length > 1 ? lines.length * 4.3 + 0.5 : 5.2
    })

    // Rule below metadata block
    const ruleY = Math.max(my + 2, 67)
    dc(doc, C.rule); doc.setLineWidth(0.35)
    doc.line(ML, ruleY, PW - MR, ruleY)
  }

  // ── Continuation-page header ──────────────────────────────────────────────
  private drawContHeader() {
    const { doc, meta } = this
    this.drawPageBackground()

    fc(doc, C.blue); doc.rect(0, 0, PW, 3, 'F')

    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    tc(doc, C.dark)
    doc.text(meta.title, ML, 10)

    doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    tc(doc, C.muted)
    doc.text(meta.docNo, PW - MR, 10, { align: 'right' })

    dc(doc, C.rule); doc.setLineWidth(0.3)
    doc.line(ML, 14, PW - MR, 14)
  }

  // ── Footer — stamped in finalize two-pass ─────────────────────────────────
  private drawFooter(page: number, total: number) {
    const { doc, meta } = this

    dc(doc, C.rule); doc.setLineWidth(0.2)
    doc.line(ML, FOOTY, PW - MR, FOOTY)

    // Line 1: platform · docNo  |  Page N of M
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
    tc(doc, C.muted)
    doc.text(`TraceFlow Regulatory Compliance Engine  ·  ${meta.docNo}`, ML, FOOTY + 5)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
    tc(doc, C.muted)
    doc.text(`Page ${page} of ${total}`, PW - MR, FOOTY + 5, { align: 'right' })

    // Line 2: platform tag  |  CONFIDENTIAL
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6)
    tc(doc, C.subtle)
    doc.text('Generated by TraceFlow Compliance Platform', ML, FOOTY + 10)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6)
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

  sectionTitle(text: string, minFollowing = 0) {
    this.ensure(19 + minFollowing)
    this.spacer(3)
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(8)
    tc(this.doc, C.blue)
    this.doc.text(text.toUpperCase(), ML, this.y)
    dc(this.doc, C.rule); this.doc.setLineWidth(0.25)
    this.doc.line(ML, this.y + 3, ML + CW, this.y + 3)
    this.y += 9
  }

  field(label: string, value: string,
    opts: { color?: readonly [number,number,number]; bold?: boolean; mono?: boolean } = {}
  ) {
    if (!value) return
    const vlines = this.doc.splitTextToSize(value, CW - LBL - 4)
    this.ensure(vlines.length * 4.5 + 1.5)
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7)
    tc(this.doc, C.muted)
    this.doc.text(label, ML, this.y)
    this.doc.setFont(opts.mono ? 'courier' : 'helvetica', opts.bold ? 'bold' : 'normal')
    this.doc.setFontSize(opts.mono ? 7 : 8)
    tc(this.doc, opts.color ?? C.text)
    this.doc.text(vlines, ML + LBL, this.y)
    this.y += vlines.length * 4.5 + 1.5
  }

  statusRow(label: string, value: string, level: 'ok'|'partial'|'error'|'warn'|'info') {
    const col = { ok: C.green, partial: C.amber, error: C.red, warn: C.amber, info: C.blue }[level]
    const h   = 9
    this.ensure(h + 2)
    const y0 = this.y
    fc(this.doc, C.rowalt);  this.doc.rect(ML, y0, CW, h, 'F')
    fc(this.doc, col);       this.doc.rect(ML, y0, 3, h, 'F')
    dc(this.doc, C.border); this.doc.setLineWidth(0.12)
    this.doc.line(ML, y0 + h, ML + CW, y0 + h)
    this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(7.5)
    tc(this.doc, C.muted)
    this.doc.text(label, ML + 7, y0 + 6)
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7.5)
    tc(this.doc, col)
    this.doc.text(value, ML + CW - 3, y0 + 6, { align: 'right' })
    this.y = y0 + h + 1
  }

  scorecard(items: Array<{ label: string; value: string; level: 'ok'|'partial'|'error'|'warn'|'info' }>) {
    const cols  = 2
    const gap   = 4
    const cellW = (CW - gap) / cols
    const cellH = 20
    const rows  = Math.ceil(items.length / cols)
    this.ensure(cellH * rows + 6)
    const startY = this.y
    items.forEach((item, i) => {
      const col   = i % cols
      const row   = Math.floor(i / cols)
      const cx    = ML + col * (cellW + gap)
      const cy    = startY + row * cellH
      const color = { ok: C.green, partial: C.amber, error: C.red, warn: C.amber, info: C.blue }[item.level]
      fc(this.doc, C.rowalt);  this.doc.rect(cx, cy, cellW, cellH - 2, 'F')
      fc(this.doc, color);     this.doc.rect(cx, cy, cellW, 3, 'F')
      dc(this.doc, C.border); this.doc.setLineWidth(0.2)
      this.doc.rect(cx, cy, cellW, cellH - 2, 'S')
      this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(6.5)
      tc(this.doc, C.muted)
      this.doc.text(item.label.toUpperCase(), cx + 5, cy + 10)
      this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(12)
      tc(this.doc, color)
      this.doc.text(item.value, cx + 5, cy + 16.5)
    })
    this.y = startY + rows * cellH + 4
  }

  bullet(text: string, color: readonly [number,number,number] = C.text) {
    const lines = this.doc.splitTextToSize(text, CW - 12)
    this.ensure(lines.length * 4.5 + 2)
    this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(8)
    tc(this.doc, C.blue); this.doc.text('-', ML + 2, this.y)
    tc(this.doc, color);  this.doc.text(lines, ML + 8, this.y)
    this.y += lines.length * 4.5 + 1
  }

  note(text: string) {
    const lines = this.doc.splitTextToSize(text, CW - 16)
    this.ensure(lines.length * 4.0 + 2)
    this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(7)
    tc(this.doc, C.subtle)
    this.doc.text(lines, ML + 8, this.y)
    this.y += lines.length * 4.0 + 1.5
  }

  divider() {
    this.ensure(9)
    dc(this.doc, C.border); this.doc.setLineWidth(0.2)
    this.doc.line(ML + 8, this.y + 3, ML + CW, this.y + 3)
    this.y += 9
  }

  // Enterprise table — proportional padding, auto-color status cells
  table(headers: string[], rows: string[][], widths?: number[]) {
    const cols = headers.length
    const ws   = widths ?? headers.map(() => +(CW / cols).toFixed(1))
    const hrh  = 9      // header row height
    const drh  = 8      // data row height
    const hp   = 3      // horizontal cell padding

    this.ensure(hrh + drh + 5)
    const tsY = this.y

    // Header
    fc(this.doc, C.rowhdr); this.doc.rect(ML, tsY, CW, hrh, 'F')
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7)
    tc(this.doc, C.dark)
    let x = ML + hp
    headers.forEach((h, i) => {
      const maxW = ws[i] - hp * 2
      const txt  = this.doc.splitTextToSize(h, maxW)[0] ?? h
      this.doc.text(txt, x, tsY + 6)
      x += ws[i]
    })

    // Header separator
    dc(this.doc, C.blue); this.doc.setLineWidth(0.4)
    this.doc.line(ML, tsY + hrh, ML + CW, tsY + hrh)
    this.y = tsY + hrh

    // Data rows
    rows.forEach((row, ri) => {
      this.ensure(drh)
      const rowY = this.y
      if (ri % 2 === 1) { fc(this.doc, C.rowalt); this.doc.rect(ML, rowY, CW, drh, 'F') }
      this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(7)
      x = ML + hp
      row.forEach((cell, ci) => {
        const txt = this.doc.splitTextToSize(cell, ws[ci] - hp * 2)[0] ?? ''
        tc(this.doc, cellStatusColor(txt))
        this.doc.text(txt, x, rowY + 5.4)
        x += ws[ci]
      })
      dc(this.doc, C.border); this.doc.setLineWidth(0.1)
      this.doc.line(ML, rowY + drh, ML + CW, rowY + drh)
      this.y = rowY + drh
    })

    // Outer border
    dc(this.doc, C.border); this.doc.setLineWidth(0.2)
    this.doc.rect(ML, tsY, CW, hrh + rows.length * drh, 'S')
    this.y += 5
  }

  // CAPA detail block — prominent header band, status pill, severity label
  capaBlock(b: {
    id: string; finding: string; ncClass: string; severity: string
    due: string; assigned: string; root: string
    corrective: string; preventive: string; evidRef: string
    status: string; statusNote: string
  }) {
    this.ensure(48)

    const sCol = b.status === 'CLOSED'     ? C.green
               : b.status === 'OVERDUE'    ? C.red
               : b.severity === 'CRITICAL' ? C.red
               : b.severity === 'MAJOR'    ? C.amber
               : C.slate

    const hH = 10, y0 = this.y
    // Header band
    fc(this.doc, C.rowalt); this.doc.rect(ML, y0, CW, hH, 'F')
    fc(this.doc, sCol);     this.doc.rect(ML, y0, 4, hH, 'F')
    // CAPA ID
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(9)
    tc(this.doc, C.dark); this.doc.text(b.id, ML + 9, y0 + 7)
    // Status pill
    const pillW = 28
    fc(this.doc, sCol); this.doc.rect(PW - MR - pillW, y0 + 2.5, pillW, 5.5, 'F')
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(6)
    tc(this.doc, C.white)
    this.doc.text(b.status, PW - MR - 2.5, y0 + 6.5, { align: 'right' })
    // Severity label
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(6.5)
    tc(this.doc, sCol)
    this.doc.text(b.severity, PW - MR - pillW - 3, y0 + 6.8, { align: 'right' })
    // Rule under header
    dc(this.doc, C.border); this.doc.setLineWidth(0.12)
    this.doc.line(ML, y0 + hH, ML + CW, y0 + hH)
    this.y = y0 + hH + 3

    const indent = 6
    const ifield = (lbl: string, val: string, opts?: { color?: readonly [number,number,number]; bold?: boolean; mono?: boolean }) => {
      if (!val) return
      const vl = this.doc.splitTextToSize(val, CW - LBL - indent - 4)
      this.ensure(vl.length * 4.5 + 1)
      this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7)
      tc(this.doc, C.muted); this.doc.text(lbl, ML + indent, this.y)
      this.doc.setFont(opts?.mono ? 'courier' : 'helvetica', opts?.bold ? 'bold' : 'normal')
      this.doc.setFontSize(opts?.mono ? 7 : 8)
      tc(this.doc, opts?.color ?? C.text); this.doc.text(vl, ML + indent + LBL, this.y)
      this.y += vl.length * 4.5 + 1.5
    }

    ifield('Finding',              b.finding)
    ifield('Non-Conformity Class', b.ncClass,   { color: sCol, bold: true })
    ifield('Due Date',             b.due)
    ifield('Assigned To',          b.assigned)
    ifield('Root Cause',           b.root)
    ifield('Corrective Action',    b.corrective)
    ifield('Preventive Action',    b.preventive)
    ifield('Evidence Reference',   b.evidRef,   { color: C.blue, mono: true })
    if (b.statusNote) ifield('Status Note', b.statusNote, { color: sCol })

    this.y += 1
    dc(this.doc, C.border); this.doc.setLineWidth(0.12)
    this.doc.line(ML + 6, this.y, ML + CW, this.y)
    this.y += 4
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
  const date = todayStr()
  const p = new PDFDoc({
    title:     'QC Inspection Report',
    docNo:     `QC-RPT-${date.replace(/-/g, '')}`,
    version:   '1.0',
    generated: ts, hash,
    classif:   'CONFIDENTIAL',
    regRef:    'Saudi FDA GMP Guidelines v2024  |  SOP-QC-001 v3.2',
  })

  p.sectionTitle('Executive Summary', 32)
  p.field('Reporting Period',         'Q2 2026')
  p.field('Total Inspections',        '104')
  p.field('Batch Pass Rate',          '96.2 %',    { color: C.green, bold: true })
  p.field('Batches Failed / On Hold', '4',          { color: C.red })
  p.field('Critical Observations',    '2',          { color: C.red })
  p.field('Qualified Inspectors Assigned', '5')
  p.field('Inspection Readiness',     'APPROVED',   { color: C.green, bold: true })

  p.spacer(3)
  p.sectionTitle('Batch Inspection Results', 60)
  p.table(
    ['Batch ID', 'Product', 'Inspector', 'Inspection Date', 'Result'],
    [
      ['B-2024-088', 'Vitamin D 5000 IU',       'Eng. K. Al-Otaibi',  '2026-05-20', 'PASS'],
      ['B-2024-089', 'Magnesium Complex 400mg',  'Eng. S. Al-Zahrani', '2026-05-22', 'FAIL'],
      ['B-2024-090', 'Omega-3 Fish Oil',         'Eng. K. Al-Otaibi',  '2026-05-23', 'PASS'],
      ['B-2024-091', 'Zinc Citrate 50mg',        'Eng. N. Al-Harbi',   '2026-05-24', 'PASS'],
      ['B-2024-092', 'Vitamin B Complex',        'Eng. F. Al-Dosari',  '2026-05-24', 'PASS'],
    ],
    [28, 50, 38, 30, 24]
  )
  p.field('Evidence Reference', 'QC-INSP-2024  |  Batch records archived in TraceFlow', { color: C.blue, mono: true })

  p.spacer(3)
  p.sectionTitle('Audit Observations', 22)
  p.bullet('All inspections conducted per SOP-QC-001 v3.2 and Saudi FDA GMP Guidelines')
  p.bullet('Line 3 critical balance calibration expired 2026-04-30 — CAPA-2024-001 raised; recalibration pending', C.red)
  p.bullet('4 production run QC records incomplete — CAPA-2024-003 in progress (documentation gap)', C.amber)
  p.bullet('2 temperature excursion events logged — cold chain protocol review in progress')

  p.spacer(3)
  p.sectionTitle('Compliance Verification Status', 33)
  p.statusRow('QC Process Compliance',        'SUBSTANTIALLY COMPLIANT',                                  'ok')
  p.statusRow('Documentation Compliance',     'PARTIAL — 4 records under review  |  Ref: CAPA-2024-003', 'partial')
  p.statusRow('Equipment Calibration Status', 'ACTION REQUIRED  |  Ref: CAPA-2024-001',                  'error')

  return p.blob()
}

export function buildBatchReportPDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const date = todayStr()
  const p = new PDFDoc({
    title:     'Batch Traceability Report',
    docNo:     `BCR-${date.replace(/-/g, '')}`,
    version:   '1.0',
    generated: ts, hash,
    classif:   'CONFIDENTIAL',
    regRef:    'Saudi FDA GMP Guidelines v2024  |  PROD-TRACE-LOGS',
  })

  p.sectionTitle('Batch Lifecycle Summary', 25)
  p.field('Reporting Period',        '2024 — 2026')
  p.field('Total Batches Tracked',   '231')
  p.field('Fully Compliant',         '224  (96.9 %)',                               { color: C.green })
  p.field('Partial Compliance',      '5  (2.2 %) — Pending Remediation',            { color: C.amber })
  p.field('Non-Compliant / On Hold', '2  (0.9 %) — Corrective Action in Progress',  { color: C.red })

  p.spacer(3)
  p.sectionTitle('Recent Batch Records', 60)
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

  p.spacer(3)
  p.sectionTitle('Traceability Chain Verification', 30)
  p.table(
    ['Forward Traceability Chain', 'Backward Traceability Chain'],
    [
      ['1.  Raw Material Receipt', '1.  Customer'],
      ['2.  Production',           '2.  Batch'],
      ['3.  QC Inspection',        '3.  Production Order'],
      ['4.  Storage',              '4.  Raw Material Lot'],
      ['5.  Dispatch',             '5.  Supplier'],
    ],
    [85, 85]
  )
  p.field('Chain Coverage',     '100 % — complete forward and backward traceability confirmed', { color: C.green })
  p.field('Evidence Reference', 'PROD-TRACE-LOGS  |  TraceFlow production database', { color: C.blue, mono: true })

  p.spacer(3)
  p.sectionTitle('Traceability Exceptions', 36)
  p.table(
    ['Exception ID', 'Batch / Material', 'Type', 'Detected', 'Status'],
    [
      ['EXC-2024-001', 'RM intake — 2 batches',  'Missing barcode scan at receiving',       '2024-11-14', 'CLOSED'],
      ['EXC-2024-002', 'B-2024-089',              'Cold chain excursion — record gap',       '2026-05-22', 'OPEN'],
    ],
    [28, 38, 56, 24, 24]
  )

  p.spacer(3)
  p.sectionTitle('Affected Batches & Corrective Actions', 30)
  p.field('EXC-2024-001',  'Retroactive barcode documentation completed for 2 raw material batches — gap in SOP-REC-003 identified and resolved')
  p.note('Corrective Action: SOP-REC-003 updated; barcode scan enforced as mandatory gate in TraceFlow receiving workflow  |  Ref: CAPA-2024-005')
  p.spacer(2)
  p.field('EXC-2024-002',  'Batch B-2024-089 quarantined — stability assessment in progress; temperature log gap under review')
  p.note('Corrective Action: 24/7 automated cold chain monitoring activated; manual escalation protocol enforced  |  Ref: CAPA-2024-002')

  p.spacer(3)
  p.sectionTitle('Coverage Metrics', 33)
  p.table(
    ['Metric', 'Current Period', 'Prior Period', 'Target'],
    [
      ['Full Traceability Coverage',     '100 %',  '99.1 %',  '100 %'],
      ['Batch Records Complete',         '229 / 231', '215 / 218', '100 %'],
      ['Exceptions Resolved < 30 Days',  '1 / 2',  '3 / 3',   '100 %'],
      ['Avg. Exception Resolution Time', '14 days', '11 days', 'max. 15 days'],
    ],
    [78, 30, 30, 32]
  )

  p.spacer(3)
  p.sectionTitle('Compliance Verification Status', 33)
  p.statusRow('Batch Traceability',     '100 % coverage confirmed — 2 exceptions logged',              'ok')
  p.statusRow('Non-Conformant Batches', '2 on hold — CAPA-2024-002 in progress',                       'error')
  p.statusRow('Remediation Progress',   'CAPA-2024-005 closed and verified; CAPA-2024-002 pending',    'partial')

  return p.blob()
}

export function buildNCRReportPDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const date = todayStr()
  const p = new PDFDoc({
    title:     'Non-Conformance Report',
    docNo:     `NCR-${date.replace(/-/g, '')}`,
    version:   '1.0',
    generated: ts, hash,
    classif:   'CONFIDENTIAL',
    regRef:    'Saudi FDA GMP Guidelines v2024  |  SOP-NCR-001',
  })

  p.sectionTitle('Non-Conformance Summary', 30)
  p.field('Reporting Period',                '2024 — 2026')
  p.field('Total NCRs Recorded',             '12')
  p.field('Open (Pending Remediation)',       '3', { color: C.red })
  p.field('Under Review',                    '4', { color: C.amber })
  p.field('Closed / Effectiveness Verified', '5', { color: C.green })
  p.field('By Severity',                     'Critical: 2  |  Major: 5  |  Minor: 5')

  p.spacer(3)
  p.sectionTitle('Non-Conformance Register', 60)
  p.table(
    ['NCR ID', 'Description', 'Severity', 'Linked CAPA', 'Status'],
    [
      ['NCR-2024-001', 'Equipment calibration expired — Line 3',   'CRITICAL', 'CAPA-2024-001', 'OPEN'],
      ['NCR-2024-002', 'Temperature excursion — Batch B-2024-089', 'CRITICAL', 'CAPA-2024-002', 'OPEN'],
      ['NCR-2024-003', 'Incomplete QC documentation — 4 runs',     'MAJOR',    'CAPA-2024-003', 'UNDER REVIEW'],
      ['NCR-2024-004', 'Supplier qualification gap — Al-Rawdah',   'MAJOR',    'CAPA-2024-004', 'UNDER REVIEW'],
      ['NCR-2024-005', 'Lot traceability gap — 2 material batches','MINOR',    'CAPA-2024-005', 'CLOSED'],
    ],
    [28, 50, 22, 34, 36]
  )

  p.spacer(3)
  p.sectionTitle('Root Cause Analysis & Remediation Status', 50)
  p.table(
    ['NCR ID', 'Root Cause Summary', 'Linked CAPA', 'Due', 'Status'],
    [
      ['NCR-2024-001', 'Calibration schedule not enforced — maintenance gap',       'CAPA-2024-001', '2026-05-30', 'OPEN'],
      ['NCR-2024-002', 'Cold chain alarm not escalated during night shift',          'CAPA-2024-002', '2026-05-28', 'OVERDUE'],
      ['NCR-2024-003', 'SOP-QC-001 checklist not followed — training gap',          'CAPA-2024-003', '2026-06-10', 'IN PROGRESS'],
      ['NCR-2024-004', 'Supplier renewal not scheduled in vendor management system', 'CAPA-2024-004', '2026-06-20', 'IN PROGRESS'],
      ['NCR-2024-005', 'Barcode scan skipped at receiving — SOP-REC-003 gap',       'CAPA-2024-005', '2026-06-05', 'CLOSED'],
    ],
    [28, 62, 28, 24, 28]
  )
  p.field('Evidence Reference', 'NCR-LOG-2024  |  CAPA-REG-2024', { color: C.blue, mono: true })

  p.spacer(3)
  p.sectionTitle('Trend Analysis', 33)
  p.table(
    ['Period', 'NCRs Raised', 'Critical', 'Major', 'Minor', 'Closed'],
    [
      ['Q1 2025', '3', '0', '2', '1', '3'],
      ['Q2 2025', '4', '1', '2', '1', '3'],
      ['Q3 2025', '2', '0', '1', '1', '2'],
      ['Q4 2025', '1', '0', '1', '0', '1'],
      ['Q1 2026', '2', '1', '1', '0', '0'],
      ['Q2 2026', '2', '1', '1', '0', '1'],
    ],
    [28, 28, 26, 26, 26, 36]
  )

  p.spacer(3)
  p.sectionTitle('Severity Distribution & CAPA Closure Metrics', 44)
  p.table(
    ['Severity', 'Total Raised', 'Open', 'In Progress', 'Closed', 'Avg. Days to Close'],
    [
      ['Critical', '2', '2', '0', '0', '—'],
      ['Major',    '5', '0', '2', '3', '22 days'],
      ['Minor',    '5', '0', '0', '5', '18 days'],
    ],
    [28, 28, 22, 28, 24, 40]
  )
  p.spacer(2)
  p.statusRow('Overall CAPA Closure Rate', '5 / 12 closed (41.7 %) — 7 active items require resolution', 'partial')
  p.statusRow('Overdue CAPAs',             '1 critical overdue (CAPA-2024-002) — escalation in effect',   'error')
  p.statusRow('On-Time Closure Rate',       '100 % for closed items — no missed deadlines on closed NCRs', 'ok')

  return p.blob()
}

export function buildRecallReportPDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const date = todayStr()
  const p = new PDFDoc({
    title:     'Recall Summary Report',
    docNo:     `RCL-${date.replace(/-/g, '')}`,
    version:   '1.0',
    generated: ts, hash,
    classif:   'CONFIDENTIAL',
    regRef:    'Saudi FDA Recall Procedure  |  SOP-RECALL-001',
  })

  p.sectionTitle('Recall Events Summary', 22)
  p.field('Reporting Period',    '2022 — 2026')
  p.field('Total Recall Events', '3  (2 voluntary, 1 mandatory)')
  p.field('Closed / Verified',   '2', { color: C.green })
  p.field('Under Investigation', '1', { color: C.red })

  p.spacer(3)
  p.sectionTitle('Recall Event Register', 80)
  p.table(
    ['Event ID', 'Type', 'Class', 'Batches', 'Recovery', 'Status'],
    [
      ['RCL-2024-001', 'Temperature Excursion',  'Class II',  '3',  'Pending',  'UNDER INVESTIGATION'],
      ['RCL-2023-003', 'Supplier Contamination', 'Class I',   'All', '100 %',   'CLOSED'],
      ['RCL-2022-007', 'Labelling Discrepancy',  'Class III', 'All', '98 %',    'CLOSED'],
    ],
    [28, 42, 20, 20, 22, 38]
  )

  p.spacer(2)
  p.field('RCL-2024-001 Detail', 'Initiated 2026-05-22 — 8 customers notified within 90 min — stability assessment ongoing', { color: C.amber })
  p.note('CAPA Linkage: CAPA-2024-002 (overdue, Quality Director escalation in effect)  |  Ref: RCL-LOG-2024-001')
  p.spacer(1)
  p.field('RCL-2023-003 Detail', 'Al-Rawdah Chemicals ingredient out-of-spec — supplier delisted; SOP-VQP-002 updated', { color: C.muted })
  p.note('Ref: RCL-LOG-2023-003  |  SAF-2023-003')
  p.spacer(1)
  p.field('RCL-2022-007 Detail', 'Artwork version mismatch — SOP-ART-001 updated; electronic sign-off enforced', { color: C.muted })
  p.note('Ref: RCL-LOG-2022-007  |  ADR-2022-007')

  p.spacer(3)
  p.sectionTitle('Recall Readiness Assessment', 55)
  p.statusRow('Readiness Score',             '91 % — active investigation affecting open event (RCL-2024-001)',    'ok')
  p.statusRow('Time to Notify',              '< 2 hours  (pre-approved SFDA notification template active)',        'ok')
  p.statusRow('Batch Identification Method', 'Automated — real-time traceability via TraceFlow',                   'ok')
  p.statusRow('Simulation Last Run',         '2026-05-10',                                                         'info')
  p.statusRow('Re-audit Scheduled',          'Following closure of RCL-2024-001 and CAPA-2024-002',               'warn')

  return p.blob()
}

export function buildCAPAReportPDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const date = todayStr()
  const p = new PDFDoc({
    title:     'CAPA Summary Report',
    docNo:     `CAPA-RPT-${date.replace(/-/g, '')}`,
    version:   '1.0',
    generated: ts, hash,
    classif:   'CONFIDENTIAL',
    regRef:    'CAPA-REG-2024  |  ICH Q10 Pharmaceutical Quality System',
  })

  // ── Page 1: executive dashboard ───────────────────────────────────────────
  p.sectionTitle('CAPA Register — Executive Summary', 46)
  p.scorecard([
    { label: 'Total on Record',   value: '5',  level: 'info'  },
    { label: 'Overdue',           value: '1',  level: 'error' },
    { label: 'In Progress',       value: '2',  level: 'warn'  },
    { label: 'Closed / Verified', value: '1',  level: 'ok'    },
  ])

  p.spacer(2)
  p.sectionTitle('Executive Risk Summary', 30)
  p.field('Overall CAPA Risk Level',  'HIGH — 1 Overdue + 2 Open Critical Actions Pending Resolution', { color: C.red, bold: true })
  p.field('Compliance Impact',        'Equipment failure and cold chain breach present direct batch release risk')
  p.field('Regulatory Exposure',      '2 Critical NCRs require closure before SFDA inspection clearance')
  p.field('Recommended Escalation',   'Quality Director review required for CAPA-2024-002; SFDA notification timeline under review')
  p.field('Assessment Date',          ts)

  p.spacer(2)
  p.sectionTitle('Escalation Alerts', 44)
  p.statusRow('CAPA-2024-002 — Cold Chain Excursion',   'OVERDUE since 2026-05-28 — Quality Director escalation in effect',    'error')
  p.statusRow('CAPA-2024-001 — Equipment Calibration',  'Due 2026-05-30 — 3 days remaining — corrective action required',       'warn')
  p.statusRow('2 Critical Actions Open',                'Regulatory inspection risk elevated — resolution required',             'error')
  p.statusRow('Recall Exposure (RCL-2024-001)',          'Linked to CAPA-2024-002 — escalated simultaneously',                  'warn')

  p.spacer(3)
  p.sectionTitle('CAPA Status Overview', 60)
  p.table(
    ['CAPA ID', 'Classification', 'Severity', 'Due Date', 'Responsible Function', 'Status'],
    [
      ['CAPA-2024-001', 'NC / Equipment Calibration', 'CRITICAL', '2026-05-30', 'Maintenance Engineering',  'OPEN'],
      ['CAPA-2024-002', 'NC / Cold Chain Excursion',  'CRITICAL', '2026-05-28', 'Cold Chain Quality',       'OVERDUE'],
      ['CAPA-2024-003', 'NC / QC Documentation',      'MAJOR',    '2026-06-10', 'QC Documentation',         'IN PROGRESS'],
      ['CAPA-2024-004', 'NC / Supplier Qual.',         'MAJOR',    '2026-06-20', 'Supplier Quality',         'IN PROGRESS'],
      ['CAPA-2024-005', 'NC / Lot Traceability',       'MINOR',    '2026-06-05', 'Receiving Operations',     'CLOSED'],
    ],
    [28, 38, 22, 22, 40, 20]
  )

  p.sectionTitle('CAPA Detail Register', 60)

  p.capaBlock({
    id: 'CAPA-2024-001',
    finding:    'Equipment calibration certificate expired — Line 3 critical balance',
    ncClass:    'Major Non-Conformity',
    severity:   'CRITICAL',
    due:        '2026-05-30',
    assigned:   'Maintenance Engineering Lead',
    root:       'Periodic calibration schedule not enforced by maintenance team',
    corrective: 'Recalibration of Line 3 balance initiated; SOP-MAINT-004 updated',
    preventive: 'Automated calibration reminder and escalation workflow implemented in TraceFlow',
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
    assigned:   'Cold Chain Quality Engineer',
    root:       'Temperature alarm not escalated during night shift — monitoring gap',
    corrective: 'Batch B-2024-089 quarantined; stability assessment in progress',
    preventive: '24/7 automated monitoring with mandatory escalation protocol activated',
    evidRef:    'NCR-2024-002  |  RCL-2024-001  |  Temp Log TL-089',
    status:     'OVERDUE',
    statusNote: 'Escalation in effect — Quality Director notified',
  })

  p.capaBlock({
    id: 'CAPA-2024-003',
    finding:    'Incomplete QC documentation — 4 consecutive production runs',
    ncClass:    'Major Non-Conformity',
    severity:   'MAJOR',
    due:        '2026-06-10',
    assigned:   'QC Documentation Specialist',
    root:       'SOP-QC-001 checklist not consistently followed — training gap identified',
    corrective: 'Retroactive documentation review completed for 4 affected batches',
    preventive: '',
    evidRef:    'NCR-2024-003  |  QC-INSP-2024',
    status:     'IN PROGRESS',
    statusNote: '',
  })

  p.capaBlock({
    id: 'CAPA-2024-004',
    finding:    'Supplier Al-Rawdah Chemicals — qualification renewal overdue by 6 months',
    ncClass:    'Major Non-Conformity',
    severity:   'MAJOR',
    due:        '2026-06-20',
    assigned:   'Supplier Quality Manager',
    root:       'Supplier renewal not scheduled in vendor management system',
    corrective: 'Expedited on-site audit initiated; alternative supplier qualification underway',
    preventive: '',
    evidRef:    'NCR-2024-004  |  SQ-2024-004',
    status:     'IN PROGRESS',
    statusNote: '',
  })

  p.capaBlock({
    id: 'CAPA-2024-005',
    finding:    'Missing lot traceability — 2 raw material batches at receiving',
    ncClass:    'Minor Non-Conformity',
    severity:   'MINOR',
    due:        '2026-06-05',
    assigned:   'Receiving Operations Lead',
    root:       'Barcode scan skipped at receiving — gap in SOP-REC-003',
    corrective: 'Retroactive lot documentation completed; non-conformance closed',
    preventive: '',
    evidRef:    'NCR-2024-005  |  PROD-TRACE-LOGS',
    status:     'CLOSED',
    statusNote: '',
  })

  p.spacer(3)
  p.sectionTitle('Compliance Verification Status', 33)
  p.statusRow('Overdue Critical CAPAs',     '1  (CAPA-2024-002) — Escalated to Quality Director',   'error')
  p.statusRow('Approaching Due Date',       '1  (CAPA-2024-001) — Due 2026-05-30',                  'warn')
  p.statusRow('Effectiveness Verification', 'Pending for 3 open / in-progress items',                'partial')

  return p.blob()
}

export function buildGMPReportPDF(): Blob {
  const ts   = nowGregorian()
  const hash = pdfHash()
  const date = todayStr()
  const p = new PDFDoc({
    title:     'GMP Audit Report',
    docNo:     `GMP-${date.replace(/-/g, '')}`,
    version:   '1.0',
    generated: ts, hash,
    classif:   'CONFIDENTIAL',
    regRef:    'Saudi FDA GMP Guidelines v2024  |  ICH Q7 Good Manufacturing Practice',
  })

  p.sectionTitle('Audit Overview', 30)
  p.field('Audit Period',   'Q1 – Q2 2026')
  p.field('Audit Type',     'Internal Compliance Audit')
  p.field('GMP Standard',   'Saudi FDA GMP Guidelines v2024  |  ICH Q7')
  p.field('Conducted By',   'Quality Assurance Department')
  p.field('Scope',          'All production lines, quality systems, documentation controls, and supplier qualification')
  p.field('Overall Status', 'Compliant with Minor Findings', { color: C.amber, bold: true })

  p.spacer(3)
  p.sectionTitle('Section-by-Section Audit Findings', 80)
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

  p.spacer(3)
  p.sectionTitle('Non-Conformity Detail', 50)
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

  p.spacer(3)
  p.sectionTitle('Observation (Non-Critical)', 12)
  p.field('OBS-001',    'Section 5 — 4 QC documentation records incomplete for recent production runs')
  p.field('Linked CAPA','CAPA-2024-003  |  In Progress',                                           { color: C.amber })

  p.spacer(3)
  p.sectionTitle('Re-Audit Schedule', 22)
  p.bullet('Re-audit of Sections 2 and 6 required within 30 days of CAPA closure (CAPA-2024-001 and CAPA-2024-004)')
  p.bullet('Sections 1, 3, 4, 7, 8 — fully compliant, no re-audit required')
  p.bullet('Effectiveness verification required for all open CAPAs prior to re-audit clearance')
  p.field('Evidence Reference', 'GMP-AUDIT-Q2-2026  |  SOP-GMP-2024-01', { color: C.blue, mono: true })

  return p.blob()
}

export function buildInspectionPackagePDF(): Blob {
  const ts       = nowGregorian()
  const hash     = pdfHash()
  const date     = todayStr()
  const dateFlat = date.replace(/-/g, '')
  const p = new PDFDoc({
    title:     'SFDA Inspection Dossier',
    docNo:     `PKG-${dateFlat}`,
    version:   '1.0',
    generated: ts, hash,
    classif:   'CONFIDENTIAL — REGULATORY INSPECTION USE ONLY',
    regRef:    'Saudi FDA Establishment Inspection Procedure  |  GMP Guidelines v2024',
  })

  p.sectionTitle('Dossier Contents — SFDA Pre-Inspection Package', 80)
  p.table(
    ['#', 'Document Set', 'Scope'],
    [
      ['1', 'Batch History Records',       '156 records  (2024 – 2026)'],
      ['2', 'QC Inspection Reports',       '104 reports  —  96.2 % pass rate'],
      ['3', 'Traceability Chain Records',  '100 % batch coverage, forward & backward'],
      ['4', 'Recall Event Log',            '3 events  (1 under investigation, 2 closed)'],
      ['5', 'CAPA Register',               '5 actions  (1 overdue, 2 in progress, 1 closed)'],
      ['6', 'Audit Trail',                 '892 verified entries  —  integrity hash confirmed'],
      ['7', 'SFDA Inspection History',     'All prior inspections and outcomes on record'],
      ['8', 'Operator Activity Log',       'Full timestamped timeline with actor attribution'],
    ],
    [10, 90, 70]
  )

  p.spacer(3)
  p.sectionTitle('Compliance Scorecard', 46)
  p.scorecard([
    { label: 'Overall Compliance Score',   value: '82 %',   level: 'warn'  },
    { label: 'Inspection Readiness Score', value: '87 %',   level: 'ok'    },
    { label: 'Regulatory Risk Level',      value: 'MEDIUM', level: 'warn'  },
    { label: 'Open CAPAs (Critical)',      value: '2',      level: 'error' },
  ])

  p.spacer(3)
  p.sectionTitle('Compliance Status by Domain', 44)
  p.statusRow('GMP Compliance Status',        'Compliant – Corrective Actions in Progress',                     'warn')
  p.statusRow('Batch Traceability',           'COMPLIANT — 100 % coverage verified',                           'ok')
  p.statusRow('QC Documentation Status',      'PARTIAL — 4 records under review  (Ref: CAPA-2024-003)',         'partial')
  p.statusRow('Equipment Calibration Status', 'ACTION REQUIRED  (Ref: CAPA-2024-001)',                          'error')

  p.spacer(3)
  p.sectionTitle('Corrective Actions Requiring Remediation', 38)
  p.table(
    ['CAPA ID', 'Issue', 'Severity', 'Due Date', 'Status'],
    [
      ['CAPA-2024-001', 'Equipment calibration expired — Line 3', 'CRITICAL', '2026-05-30', 'OPEN'],
      ['CAPA-2024-002', 'Temperature excursion — B-2024-089',     'CRITICAL', '2026-05-28', 'OVERDUE'],
      ['CAPA-2024-003', 'Incomplete QC documentation — 4 runs',   'MAJOR',    '2026-06-10', 'IN PROGRESS'],
    ],
    [32, 62, 22, 26, 28]
  )

  return p.blob()
}

// ── ZIP builder ───────────────────────────────────────────────────────────────

export async function buildInspectionPackageZIP(): Promise<Blob> {
  const date   = todayStr()
  const zip    = new JSZip()
  const folder = zip.folder('SFDA-Inspection-Dossier') ?? zip

  folder.file(`SFDA-Inspection-Dossier-${date}.pdf`,  buildInspectionPackagePDF())
  folder.file(`GMP-Audit-Report-${date}.pdf`,          buildGMPReportPDF())
  folder.file(`CAPA-Summary-Report-${date}.pdf`,       buildCAPAReportPDF())
  folder.file(`QC-Inspection-Report-${date}.pdf`,      buildQCReportPDF())
  folder.file(`Batch-Traceability-Report-${date}.pdf`, buildBatchReportPDF())
  folder.file(`NCR-Report-${date}.pdf`,                buildNCRReportPDF())
  folder.file(`Recall-Summary-Report-${date}.pdf`,     buildRecallReportPDF())

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
