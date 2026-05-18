type Props = {
  title: string
  subtitle?: string
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}

export default function SectionCard({ title, subtitle, children, action, className = '' }: Props) {
  return (
    <div className={`
      rounded-2xl
      border border-gray-200 dark:border-white/[0.07]
      bg-white dark:bg-white/[0.04]
      dark:backdrop-blur-xl
      shadow-sm dark:shadow-none
      ${className}
    `}>
      <div className="flex items-start justify-between gap-2 px-5 pt-5 pb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </div>
  )
}
