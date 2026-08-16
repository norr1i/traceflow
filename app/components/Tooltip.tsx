import { type ReactNode } from 'react'

/**
 * Lightweight CSS-only tooltip that works with hover and keyboard focus.
 * Wraps children in a relative group; the tooltip panel appears below via
 * group-hover / group-focus-within without any JS or Radix dependency.
 * Pass no content (or undefined) to render children as-is with no tooltip.
 */
export function Tooltip({ content, children }: { content?: string; children: ReactNode }) {
  if (!content) return <>{children}</>
  return (
    <div className="group relative">
      {children}
      <div
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 w-max max-w-[260px] rounded-lg bg-[#1C242B] px-2.5 py-1.5 text-xs font-medium leading-snug text-white opacity-0 shadow-lg ring-1 ring-[#B3B7BA]/[0.15] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {content}
      </div>
    </div>
  )
}
