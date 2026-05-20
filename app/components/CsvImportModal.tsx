'use client'

import { useRef, useState } from 'react'
import {
  X, Upload, Download, AlertTriangle, CheckCircle2,
  FileText, ChevronRight, Loader2,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

export type CsvFieldDef = {
  key: string        // expected CSV header (lowercase, used for matching)
  label: string      // human label shown in template / errors
  required: boolean
  type?: 'string' | 'number' | 'date'
}

export type ImportResult = {
  inserted: number
  skipped:  number   // duplicates / rows the caller chose not to insert
  errors:   string[] // per-row messages for invalid/failed rows
}

type Props = {
  title:          string
  fields:         CsvFieldDef[]
  sampleFilename: string
  sampleRows:     Record<string, string>[] // rows used for the template download
  onClose:        () => void
  /** Receives only structurally-valid rows (required fields present + correct types).
   *  Caller does deduplication/insertion and returns counts. */
  onImport:       (rows: Record<string, string>[]) => Promise<ImportResult>
}

type Stage = 'pick' | 'preview' | 'importing' | 'done'

// ── CSV parsing ────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { result.push(current); current = '' }
    else { current += ch }
  }
  result.push(current)
  return result.map(s => s.trim().replace(/^"|"$/g, ''))
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)

  if (lines.length < 2) return { headers: [], rows: [] }

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))
  const rows = lines.slice(1).map(line => {
    const vals = parseCsvLine(line)
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
  })
  return { headers, rows }
}

// ── Validation ─────────────────────────────────────────────────────────────

type RowValidation = { row: Record<string, string>; errors: string[] }

function validateRows(
  rows: Record<string, string>[],
  fields: CsvFieldDef[],
): RowValidation[] {
  return rows.map((row, idx) => {
    const errors: string[] = []
    for (const f of fields) {
      const val = row[f.key] ?? ''
      if (f.required && !val) {
        errors.push(`Row ${idx + 2}: "${f.label}" is required`)
      }
      if (val && f.type === 'number' && isNaN(Number(val))) {
        errors.push(`Row ${idx + 2}: "${f.label}" must be a number (got "${val}")`)
      }
    }
    return { row, errors }
  })
}

// ── Template download ──────────────────────────────────────────────────────

function downloadTemplate(
  fields: CsvFieldDef[],
  sampleRows: Record<string, string>[],
  filename: string,
) {
  const headers = fields.map(f => f.key)
  const lines   = [
    headers.join(','),
    ...sampleRows.map(r => headers.map(h => {
      const v = r[h] ?? ''
      return v.includes(',') ? `"${v}"` : v
    }).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── Modal ──────────────────────────────────────────────────────────────────

const PREVIEW_LIMIT = 8

export default function CsvImportModal({
  title, fields, sampleFilename, sampleRows, onClose, onImport,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  const [stage,     setStage]     = useState<Stage>('pick')
  const [filename,  setFilename]  = useState('')
  const [validated, setValidated] = useState<RowValidation[]>([])
  const [result,    setResult]    = useState<ImportResult | null>(null)
  const [dragOver,  setDragOver]  = useState(false)

  const errorRows  = validated.filter(v => v.errors.length > 0)
  const validRows  = validated.filter(v => v.errors.length === 0)
  const allErrors  = errorRows.flatMap(v => v.errors)

  // ── File handling ────────────────────────────────────────────────────────

  function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Please upload a .csv file.')
      return
    }
    setFilename(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { rows } = parseCsv(text)
      const vr = validateRows(rows, fields)
      setValidated(vr)
      setStage('preview')
    }
    reader.readAsText(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  // ── Import ───────────────────────────────────────────────────────────────

  async function handleImport() {
    setStage('importing')
    const rows = validRows.map(v => v.row)
    try {
      const res = await onImport(rows)
      setResult(res)
      setStage('done')
    } catch (err) {
      setResult({ inserted: 0, skipped: 0, errors: [(err as Error).message] })
      setStage('done')
    }
  }

  // ── Shared styles ─────────────────────────────────────────────────────────

  const base = 'w-full max-w-2xl rounded-2xl border border-[#B3B7BA]/[0.10] bg-[#141e28] shadow-[0_24px_64px_rgba(0,0,0,0.60)] backdrop-blur-xl'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className={base}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#B3B7BA]/[0.08] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <FileText size={18} className="text-[#4a8fb9]" />
            <h2 className="text-base font-semibold text-white">{title}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadTemplate(fields, sampleRows, sampleFilename)}
              className="flex items-center gap-1.5 rounded-lg border border-[#B3B7BA]/[0.12] bg-[#262E36]/60 px-3 py-1.5 text-xs font-medium text-[#B3B7BA] hover:bg-[#262E36] transition-colors"
            >
              <Download size={13} /> Download template
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-[#6C6D74] hover:text-[#B3B7BA] transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6">

          {/* ── Stage: pick ─────────────────────────────────────────── */}
          {stage === 'pick' && (
            <div className="space-y-5">
              {/* Required columns */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6C6D74]">
                  Expected columns
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {fields.map(f => (
                    <span
                      key={f.key}
                      className={`rounded-md px-2 py-0.5 text-xs font-mono ${
                        f.required
                          ? 'bg-[#3a6f8f]/20 text-[#7aafcf] border border-[#3a6f8f]/30'
                          : 'bg-[#262E36]/60 text-[#6C6D74] border border-[#B3B7BA]/[0.08]'
                      }`}
                    >
                      {f.key}{f.required ? ' *' : ''}
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-[#6C6D74]">* required</p>
              </div>

              {/* Drop zone */}
              <div
                className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 transition-colors ${
                  dragOver
                    ? 'border-[#4a8fb9]/60 bg-[#4a8fb9]/10'
                    : 'border-[#B3B7BA]/[0.15] hover:border-[#4a8fb9]/40 hover:bg-[#262E36]/30'
                }`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <Upload size={28} className="text-[#4a8fb9]/70" />
                <div className="text-center">
                  <p className="text-sm font-medium text-[#B3B7BA]">Drop your CSV here</p>
                  <p className="mt-0.5 text-xs text-[#6C6D74]">or click to browse</p>
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          )}

          {/* ── Stage: preview ──────────────────────────────────────── */}
          {stage === 'preview' && (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="flex items-center gap-3 text-sm">
                <span className="text-[#B3B7BA] font-medium">{filename}</span>
                <span className="text-[#6C6D74]">·</span>
                <span className="text-emerald-400">{validRows.length} valid</span>
                {errorRows.length > 0 && (
                  <>
                    <span className="text-[#6C6D74]">·</span>
                    <span className="text-red-400">{errorRows.length} with errors (will be skipped)</span>
                  </>
                )}
              </div>

              {/* Preview table */}
              {validRows.length > 0 && (
                <div className="overflow-auto rounded-xl border border-[#B3B7BA]/[0.08]">
                  <table className="w-full text-xs">
                    <thead className="bg-[#262E36]/60">
                      <tr>
                        {fields.map(f => (
                          <th key={f.key} className="px-3 py-2 text-left font-medium text-[#6C6D74] whitespace-nowrap">
                            {f.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#B3B7BA]/[0.06]">
                      {validRows.slice(0, PREVIEW_LIMIT).map((v, i) => (
                        <tr key={i} className="hover:bg-[#262E36]/30">
                          {fields.map(f => (
                            <td key={f.key} className="px-3 py-2 text-[#B3B7BA] max-w-[160px] truncate">
                              {v.row[f.key] || <span className="text-[#6C6D74] italic">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {validRows.length > PREVIEW_LIMIT && (
                    <div className="border-t border-[#B3B7BA]/[0.06] px-3 py-2 text-center text-xs text-[#6C6D74]">
                      …and {validRows.length - PREVIEW_LIMIT} more rows
                    </div>
                  )}
                </div>
              )}

              {/* Validation errors */}
              {allErrors.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                    <AlertTriangle size={13} />
                    Rows with errors (will not be imported)
                  </div>
                  <ul className="space-y-0.5">
                    {allErrors.slice(0, 10).map((e, i) => (
                      <li key={i} className="text-xs text-amber-300/80">{e}</li>
                    ))}
                    {allErrors.length > 10 && (
                      <li className="text-xs text-amber-400/60">…and {allErrors.length - 10} more errors</li>
                    )}
                  </ul>
                </div>
              )}

              {validRows.length === 0 && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  No valid rows found. Fix the errors in your CSV and re-upload.
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => { setStage('pick'); setValidated([]) }}
                  className="text-sm text-[#6C6D74] hover:text-[#B3B7BA] transition-colors"
                >
                  ← Choose different file
                </button>
                <button
                  onClick={handleImport}
                  disabled={validRows.length === 0}
                  className="flex items-center gap-1.5 rounded-xl bg-[#3a6f8f] hover:bg-[#2d5a74] px-5 py-2 text-sm font-medium text-white disabled:opacity-40 transition-colors shadow-[0_0_16px_rgba(74,127,165,0.22)]"
                >
                  Import {validRows.length} row{validRows.length !== 1 ? 's' : ''}
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Stage: importing ────────────────────────────────────── */}
          {stage === 'importing' && (
            <div className="flex flex-col items-center gap-4 py-12">
              <Loader2 size={28} className="animate-spin text-[#4a8fb9]" />
              <p className="text-sm text-[#B3B7BA]">Importing rows…</p>
            </div>
          )}

          {/* ── Stage: done ─────────────────────────────────────────── */}
          {stage === 'done' && result && (
            <div className="space-y-4">
              {/* Success card */}
              {result.inserted > 0 && (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3.5">
                  <CheckCircle2 size={20} className="shrink-0 text-emerald-400" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-300">
                      {result.inserted} row{result.inserted !== 1 ? 's' : ''} imported successfully
                    </p>
                    {result.skipped > 0 && (
                      <p className="mt-0.5 text-xs text-emerald-400/70">
                        {result.skipped} duplicate{result.skipped !== 1 ? 's' : ''} skipped
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Errors card */}
              {result.errors.length > 0 && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-red-400">
                    <AlertTriangle size={13} />
                    {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} failed to import
                  </div>
                  <ul className="space-y-0.5">
                    {result.errors.slice(0, 8).map((e, i) => (
                      <li key={i} className="text-xs text-red-300/80">{e}</li>
                    ))}
                    {result.errors.length > 8 && (
                      <li className="text-xs text-red-400/60">…and {result.errors.length - 8} more</li>
                    )}
                  </ul>
                </div>
              )}

              {result.inserted === 0 && result.errors.length === 0 && result.skipped > 0 && (
                <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3.5">
                  <AlertTriangle size={18} className="shrink-0 text-amber-400" />
                  <p className="text-sm text-amber-300">
                    All {result.skipped} row{result.skipped !== 1 ? 's' : ''} were duplicates and skipped.
                  </p>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  onClick={onClose}
                  className="rounded-xl bg-[#262E36]/60 border border-[#B3B7BA]/[0.10] px-5 py-2 text-sm font-medium text-[#B3B7BA] hover:bg-[#262E36] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
