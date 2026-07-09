'use client'

import { QRCodeSVG } from 'qrcode.react'
import { deriveBatchRef } from '../lib/batch'

export type LabelSize = 'standard' | 'large'

type Order = {
  id:           string
  quantity:     number
  status:       string
  created_at:   string
  started_at?:  string | null
  products?:    { name: string; sku?: string | null } | null
}

const STATUS_LABEL: Record<string, string> = {
  completed:   'COMPLETED',
  in_progress: 'IN PROGRESS',
  pending:     'PENDING',
  cancelled:   'CANCELLED',
}

type StatusColors = { text: string; border: string }
const STATUS_COLOR: Record<string, StatusColors> = {
  completed:   { text: '#059669', border: '#059669' },
  in_progress: { text: '#2563eb', border: '#2563eb' },
  pending:     { text: '#6b7280', border: '#d1d5db' },
  cancelled:   { text: '#dc2626', border: '#dc2626' },
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ── Inline TraceFlow mark — no 'use client' Logo dependency in print context ──

function TFMark({ boxSize }: { boxSize: number }) {
  const svgSize = Math.round(boxSize * 0.64)
  return (
    <div style={{
      width:           boxSize,
      height:          boxSize,
      borderRadius:    '30%',
      background:      'linear-gradient(135deg, #1b3f58 0%, #0d1e2c 100%)',
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      flexShrink:      0,
    }}>
      <svg width={svgSize} height={svgSize} viewBox="0 0 28 28" fill="none">
        <line x1="4.5" y1="8" x2="23.5" y2="8"
          stroke="rgba(211,209,206,0.70)" strokeWidth="2" strokeLinecap="round" />
        <line x1="18" y1="8" x2="18" y2="21.5"
          stroke="rgba(211,209,206,0.70)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="4.5"  cy="8"    r="2.6" fill="#D3D1CE" fillOpacity="0.85" />
        <circle cx="23.5" cy="8"    r="1.8" fill="#B3B7BA" fillOpacity="0.55" />
        <circle cx="18"   cy="8"    r="1.4" fill="#8aafca" fillOpacity="0.55" />
        <circle cx="18"   cy="21.5" r="3"   fill="#5fb3da" fillOpacity="0.96" />
        <circle cx="17"   cy="20.5" r="1"   fill="white"   fillOpacity="0.38" />
      </svg>
    </div>
  )
}

// ── Inline shield-check — avoids pulling Lucide into the label subtree ────────

function ShieldVerified({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  )
}

// ── Label field row ───────────────────────────────────────────────────────────

function Field({
  label, value, mono = false, labelFS, labelW, valueFS,
}: {
  label: string; value: string; mono?: boolean
  labelFS: number; labelW: number; valueFS: number
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        fontSize:      labelFS,
        fontWeight:    700,
        color:         '#9ca3af',
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        width:         labelW,
        flexShrink:    0,
      }}>
        {label}
      </span>
      <span style={{
        fontSize:     valueFS,
        fontWeight:   600,
        color:        '#111827',
        fontFamily:   mono ? "'Courier New', Courier, monospace" : 'inherit',
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        whiteSpace:   'nowrap' as const,
      }}>
        {value}
      </span>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface BatchLabelProps {
  order:       Order
  companyName: string | null
  size:        LabelSize
  traceUrl:    string
}

export function BatchLabel({ order, companyName, size, traceUrl }: BatchLabelProps) {
  const isLarge = size === 'large'

  // Screen preview dimensions. @media print overrides to physical label sizes.
  const W = 380
  const H = isLarge ? 380 : 190

  // Section heights
  const headerH  = isLarge ? 42 : 30
  const footerH  = isLarge ? 36 : 26

  // Scale-dependent tokens
  const bodyPadX = isLarge ? 14 : 10
  const bodyPadY = isLarge ? 12 : 7
  const qrSize   = isLarge ? 160 : 102
  const markBox  = isLarge ? 26  : 20
  const nameFS   = isLarge ? 16  : 12
  const fieldFS  = isLarge ? 7.5 : 6.5
  const labelW   = isLarge ? 40  : 32
  const valueFS  = isLarge ? 11  : 9
  const fieldGap = isLarge ? 7   : 4
  const headerFS = isLarge ? 10  : 8
  const footerFS = isLarge ? 8.5 : 7
  const shieldSz = isLarge ? 11  : 9

  const batchRef       = deriveBatchRef(order.id, order.created_at)
  const productionDate = fmtDate(order.started_at ?? order.created_at)
  const productName    = order.products?.name ?? 'Unknown Product'
  const sku            = order.products?.sku   ?? '—'
  const statusLabel    = STATUS_LABEL[order.status] ?? order.status.toUpperCase()
  const statusColor    = STATUS_COLOR[order.status] ?? STATUS_COLOR.pending
  const uuidTail       = order.id.slice(-12).toUpperCase()

  return (
    <div
      className={`tf-print-label ${isLarge ? 'tf-label-large' : 'tf-label-standard'}`}
      style={{
        width:           W,
        height:          H,
        backgroundColor: '#ffffff',
        color:           '#111827',
        fontFamily:      'Inter, "SF Pro Display", Arial, Helvetica, sans-serif',
        boxSizing:       'border-box' as const,
        border:          '1px solid #e5e7eb',
        borderRadius:    6,
        overflow:        'hidden',
        display:         'flex',
        flexDirection:   'column' as const,
      }}
    >

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        height:          headerH,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'space-between',
        padding:         `0 ${bodyPadX}px`,
        backgroundColor: '#f9fafb',
        borderBottom:    '1px solid #e5e7eb',
        flexShrink:      0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TFMark boxSize={markBox} />
          <span style={{
            fontSize:      headerFS,
            fontWeight:    700,
            color:         '#1b3f58',
            letterSpacing: '0.05em',
          }}>
            TraceFlow
          </span>
        </div>
        <span style={{
          fontSize:     headerFS - 1,
          fontWeight:   600,
          color:        '#6b7280',
          letterSpacing:'0.02em',
          maxWidth:     '55%',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap' as const,
          textAlign:    'right' as const,
        }}>
          {companyName ?? 'Manufacturer'}
        </span>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div style={{
        flex:           1,
        display:        'flex',
        alignItems:     'center',
        padding:        `${bodyPadY}px ${bodyPadX}px`,
        gap:            10,
        overflow:       'hidden',
      }}>

        {/* Left: data fields */}
        <div style={{
          flex:          1,
          display:       'flex',
          flexDirection: 'column' as const,
          justifyContent:'center',
          gap:           fieldGap,
          minWidth:      0,
          overflow:      'hidden',
        }}>
          <div style={{
            fontSize:         nameFS,
            fontWeight:       800,
            color:            '#111827',
            lineHeight:       1.25,
            display:          '-webkit-box',
            WebkitLineClamp:  isLarge ? 3 : 2,
            WebkitBoxOrient:  'vertical' as const,
            overflow:         'hidden',
            marginBottom:     isLarge ? 6 : 3,
          }}>
            {productName}
          </div>
          <Field label="SKU"   value={sku}                                     mono labelFS={fieldFS} labelW={labelW} valueFS={valueFS} />
          <Field label="Batch" value={batchRef}                                 mono labelFS={fieldFS} labelW={labelW} valueFS={valueFS} />
          <Field label="Qty"   value={`${order.quantity.toLocaleString()} units`}    labelFS={fieldFS} labelW={labelW} valueFS={valueFS} />
          <Field label="Date"  value={productionDate}                               labelFS={fieldFS} labelW={labelW} valueFS={valueFS} />
        </div>

        {/* Right: QR code */}
        <div style={{
          display:       'flex',
          flexDirection: 'column' as const,
          alignItems:    'center',
          justifyContent:'center',
          gap:           4,
          flexShrink:    0,
        }}>
          <div style={{
            padding:         5,
            border:          '1px solid #e5e7eb',
            borderRadius:    6,
            backgroundColor: '#ffffff',
            lineHeight:      0,
          }}>
            <QRCodeSVG value={traceUrl} size={qrSize} level="H" marginSize={0} />
          </div>
          <span style={{
            fontSize:   6.5,
            color:      '#9ca3af',
            letterSpacing: '0.08em',
            fontFamily: "'Courier New', Courier, monospace",
          }}>
            ···{uuidTail}
          </span>
        </div>

      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div style={{
        height:          footerH,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'space-between',
        padding:         `0 ${bodyPadX}px`,
        backgroundColor: '#f9fafb',
        borderTop:       '1px solid #e5e7eb',
        flexShrink:      0,
      }}>
        <span style={{
          fontSize:      footerFS,
          fontWeight:    800,
          letterSpacing: '0.08em',
          padding:       isLarge ? '2px 8px' : '1px 6px',
          borderRadius:  3,
          border:        `1px solid ${statusColor.border}`,
          color:         statusColor.text,
        }}>
          {statusLabel}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <ShieldVerified size={shieldSz} />
          <span style={{
            fontSize:      footerFS,
            fontWeight:    700,
            color:         '#059669',
            letterSpacing: '0.02em',
          }}>
            Verified by TraceFlow®
          </span>
        </div>
      </div>

    </div>
  )
}
