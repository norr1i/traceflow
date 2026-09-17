// ── Marketing theme (unified with the global site preference) ─────────────────
// The whole site now shares ONE preference: `tf-theme` → `.dark` on <html>. The
// marketing page renders its palette from a scoped `data-tf-theme` attribute on
// .lp-root (driving the `--lp-*` variables), and it keeps that attribute in lock
// step with `html.dark` — both derived from the same `tf-theme` key — so a theme
// choice carries seamlessly between marketing, auth, and the dashboard. First
// visit is light. Legacy `tf-marketing-theme` migration lives ONLY in the root
// layout bootstrap; this module reads/writes `tf-theme` exclusively.

export type LpTheme = 'light' | 'dark'

export const LP_THEME_KEY = 'tf-theme'

/**
 * Resolve the initial theme from the single site preference `tf-theme`. Light-
 * first when unset/invalid; no operating-system preference.
 */
export function getInitialLpTheme(): LpTheme {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = localStorage.getItem(LP_THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* ignore */ }
  return 'light'
}

// Static pre-hydration bootstrap. Rendered as the FIRST child inside .lp-root, so
// when the browser parses this inline <script> during the initial SSR HTML load it
// sets data-tf-theme on its parent (.lp-root) BEFORE the visible descendants paint,
// AND keeps html.dark in sync (defensive same-route resolution). Reads only the
// `tf-theme` key, accepts only 'light' | 'dark' (default 'light'), no system
// preference, no `tf-marketing-theme`, and interpolates no dynamic data.
export const LP_THEME_BOOTSTRAP =
  "try{var t=localStorage.getItem('tf-theme');" +
  "if(t!=='dark'&&t!=='light'){t='light';}" +
  "var e=document.currentScript&&document.currentScript.parentElement;" +
  "if(e){e.setAttribute('data-tf-theme',t);}" +
  "document.documentElement.classList.toggle('dark',t==='dark');}catch(_){}"

// Scoped stylesheet. Every selector is under `.lp-root`, so it cannot affect any
// other page. Two independently-designed themes share one `--lp-*` contract.
//
// Surface scale (drives section rhythm, not just "different background"):
//   --lp-bg        page base / neutral sections
//   --lp-alt       alternate neutral section
//   --lp-feature   contrasting feature band (recall / QR moments)
//   --lp-card      raised card
//   --lp-elevated  quiet inset panel (phone shell, glyph boxes, trust rows)
//   --lp-icon-bg   NEUTRAL tile behind icons (keeps icons colored without a
//                  blue wash across the whole page)
export const LANDING_THEME_CSS = `
.lp-root {
  --lp-bg: #F5F7FA;
  --lp-alt: #EEF2F6;
  --lp-feature: #E9EEF4;
  --lp-card: #FFFFFF;
  --lp-elevated: #F8FAFC;
  --lp-icon-bg: #EEF3F8;
  --lp-icon-border: #DCE4EC;
  --lp-text: #0B1628;
  --lp-text-2: #334155;
  --lp-muted: #5B6B7F;
  --lp-border: #D8E0E9;
  --lp-border-strong: #C4D0DC;
  --lp-primary: #2563EB;
  --lp-primary-hover: #1D4FD8;
  --lp-primary-fg: #FFFFFF;
  --lp-cyan: #0891B2;
  --lp-emerald: #059669;
  --lp-amber: #D97706;
  --lp-red: #DC2626;
  --lp-tint: rgba(37,99,235,0.06);
  --lp-tint-strong: rgba(37,99,235,0.10);
  --lp-ring: rgba(37,99,235,0.50);
  --lp-grid: rgba(11,22,40,0.045);
  --lp-shadow-sm: 0 1px 2px rgba(11,22,40,0.05), 0 1px 3px rgba(11,22,40,0.04);
  --lp-shadow-md: 0 2px 8px rgba(11,22,40,0.05), 0 12px 28px rgba(11,22,40,0.06);
  --lp-shadow-lg: 0 8px 26px rgba(11,22,40,0.08), 0 26px 60px rgba(11,22,40,0.07);

  /* Normal document flow — the marketing page IS the whole route (no overlay,
     no fixed positioning, no own scroll container). The document/window scrolls
     and the sticky header sticks to the viewport. */
  background: var(--lp-bg);
  color: var(--lp-text);
  -webkit-font-smoothing: antialiased;
}

/* Smooth in-page anchor scrolling on the document scroll root, scoped so it only
   applies while the marketing page (.lp-root) is mounted — the dashboard route is
   never affected. Disabled under prefers-reduced-motion below. */
html:has(.lp-root) { scroll-behavior: smooth; }

/* Section anchor — a zero-height target placed at the heading level (not on the
   padded outer wrapper) so a hash jump lands the heading ~24px below the 64px
   sticky header, with no stacked offset and no empty gap. scroll-margin-top is
   the single source of the header offset (no global scroll-padding needed). */
.lp-anchor {
  display: block;
  height: 0;
  scroll-margin-top: 5.5rem;
}

.lp-root[data-tf-theme="dark"] {
  --lp-bg: #07111F;
  --lp-alt: #091627;
  --lp-feature: #0B1728;
  --lp-card: #101F33;
  --lp-elevated: #0D1B2D;
  --lp-icon-bg: #17273B;
  --lp-icon-border: rgba(158,173,191,0.14);
  --lp-text: #F4F7FB;
  --lp-text-2: #B4C0CF;
  --lp-muted: #93A4B8;
  --lp-border: rgba(158,173,191,0.18);
  --lp-border-strong: rgba(158,173,191,0.28);
  --lp-primary: #3B82F6;
  --lp-primary-hover: #5A96F8;
  --lp-primary-fg: #FFFFFF;
  --lp-cyan: #22B8CF;
  --lp-emerald: #10B981;
  --lp-amber: #F59E0B;
  --lp-red: #EF4444;
  --lp-tint: rgba(59,130,246,0.10);
  --lp-tint-strong: rgba(59,130,246,0.15);
  --lp-ring: rgba(96,165,250,0.60);
  --lp-grid: rgba(158,173,191,0.06);
  --lp-shadow-sm: 0 1px 2px rgba(0,0,0,0.35);
  --lp-shadow-md: 0 6px 18px rgba(0,0,0,0.38), 0 2px 6px rgba(0,0,0,0.30);
  --lp-shadow-lg: 0 16px 44px rgba(0,0,0,0.45), 0 30px 70px rgba(0,0,0,0.30);
}

/* Blueprint grid texture — restrained. Kept mainly in the hero. */
.lp-grid-bg {
  background-image:
    linear-gradient(var(--lp-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--lp-grid) 1px, transparent 1px);
  background-size: 36px 36px;
  background-position: center;
}
/* Hero grid dissolves before the next section so the texture never carries on. */
.lp-hero-grid {
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 42%, transparent 88%);
  mask-image: linear-gradient(to bottom, #000 0%, #000 42%, transparent 88%);
}

/* Surfaces */
.lp-card {
  background: var(--lp-card);
  border: 1px solid var(--lp-border);
  border-radius: 16px;
  box-shadow: var(--lp-shadow-sm);
}
.lp-card-lg { border-radius: 20px; box-shadow: var(--lp-shadow-md); }

/* Buttons */
.lp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  border-radius: 11px; font-weight: 600; line-height: 1;
  padding: 0.78rem 1.35rem; font-size: 0.9375rem;
  transition: background-color .18s ease, border-color .18s ease, transform .12s ease, box-shadow .18s ease;
  cursor: pointer; white-space: nowrap;
}
.lp-btn:active { transform: translateY(1px); }
.lp-btn-primary { background: var(--lp-primary); color: var(--lp-primary-fg); box-shadow: var(--lp-shadow-sm); }
.lp-btn-primary:hover { background: var(--lp-primary-hover); }
.lp-btn-secondary { background: var(--lp-card); color: var(--lp-text); border: 1px solid var(--lp-border-strong); }
.lp-btn-secondary:hover { background: var(--lp-alt); border-color: var(--lp-primary); }

/* Focus states — visible over every surface, both themes */
.lp-root :where(a, button, [tabindex]):focus-visible {
  outline: 2px solid var(--lp-ring);
  outline-offset: 2px;
  border-radius: 8px;
}

/* Sticky header surface */
.lp-header {
  background: color-mix(in srgb, var(--lp-bg) 82%, transparent);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  backdrop-filter: blur(14px) saturate(150%);
}
.lp-header[data-stuck="true"] {
  background: color-mix(in srgb, var(--lp-bg) 94%, transparent);
  border-bottom: 1px solid var(--lp-border);
  box-shadow: var(--lp-shadow-sm);
}

/* Entrance animation — gated on prefers-reduced-motion */
@keyframes lp-fade-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
.lp-fade-up { animation: lp-fade-up .5s cubic-bezier(0.22,1,0.36,1) both; }

@media (prefers-reduced-motion: reduce) {
  html:has(.lp-root) { scroll-behavior: auto; }
  .lp-fade-up { animation: none; }
  .lp-root * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
}
`
