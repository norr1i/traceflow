'use client'

type Size = 'sm' | 'md' | 'lg'

const dims: Record<Size, { box: number; icon: number }> = {
  sm: { box: 32, icon: 16 },
  md: { box: 40, icon: 20 },
  lg: { box: 56, icon: 28 },
}

export function LogoIcon({ size = 'md' }: { size?: Size }) {
  const { box, icon } = dims[size]
  const r = box / 2
  const scale = icon / 28

  return (
    <div
      style={{ width: box, height: box }}
      className="shrink-0 flex items-center justify-center rounded-[28%] bg-gradient-to-br from-[#3a6f8f] to-[#2d5a74] shadow-[0_0_22px_rgba(74,127,165,0.30)]"
    >
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Horizontal trace line */}
        <line x1="4" y1="14" x2="24" y2="14" stroke="rgba(211,209,206,0.35)" strokeWidth="1.5" strokeLinecap="round" />

        {/* Vertical branch down from mid-right */}
        <line x1="18" y1="14" x2="18" y2="21" stroke="rgba(211,209,206,0.35)" strokeWidth="1.5" strokeLinecap="round" />

        {/* Entry node — left */}
        <circle cx="4" cy="14" r="2.5" fill="#D3D1CE" fillOpacity="0.90" />

        {/* Mid node — junction */}
        <circle cx="18" cy="14" r="2" fill="#D3D1CE" fillOpacity="0.70" />

        {/* Exit node — right */}
        <circle cx="24" cy="14" r="2.5" fill="#4a8fb9" fillOpacity="0.95" />

        {/* Branch end node */}
        <circle cx="18" cy="21" r="2" fill="#D3D1CE" fillOpacity="0.55" />

        {/* Top accent node — small */}
        <circle cx="11" cy="9" r="1.5" fill="#D3D1CE" fillOpacity="0.45" />
        <line x1="11" y1="10.5" x2="11" y2="14" stroke="rgba(211,209,206,0.25)" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  )
}

export function LogoLockup({ size = 'md' }: { size?: Size }) {
  const textSize = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-lg' : 'text-base'
  const subSize  = size === 'lg' ? 'text-xs' : 'text-[10px]'

  return (
    <div className="flex items-center gap-3">
      <LogoIcon size={size} />
      <div>
        <p className={`font-bold tracking-tight leading-none text-[#D3D1CE] ${textSize}`}>TraceFlow</p>
        {size !== 'sm' && (
          <p className={`text-[#6C6D74] mt-0.5 tracking-wide ${subSize}`}>Manufacturing OS</p>
        )}
      </div>
    </div>
  )
}
