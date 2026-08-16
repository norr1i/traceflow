'use client'

import { useT } from '../lib/i18n'

type Props = { status: string; label?: string }

const DOT: Record<string, string> = {
  pending:     'bg-amber-500 dark:bg-amber-400',
  in_progress: 'bg-blue-500 dark:bg-blue-400',
  completed:   'bg-emerald-500 dark:bg-emerald-400',
  cancelled:   'bg-red-500 dark:bg-red-400',
  refunded:    'bg-gray-400 dark:bg-gray-500',
  active:      'bg-emerald-500 dark:bg-emerald-400',
  archived:    'bg-gray-400 dark:bg-gray-500',
  open:        'bg-blue-500 dark:bg-blue-400',
  closed:      'bg-emerald-500 dark:bg-emerald-400',
}

const TEXT: Record<string, string> = {
  pending:     'text-amber-600 dark:text-amber-400',
  in_progress: 'text-blue-600 dark:text-blue-400',
  completed:   'text-emerald-600 dark:text-emerald-500',
  cancelled:   'text-red-600 dark:text-red-400',
  refunded:    'text-gray-500 dark:text-gray-400',
  active:      'text-emerald-600 dark:text-emerald-500',
  archived:    'text-gray-500 dark:text-gray-400',
  open:        'text-blue-600 dark:text-blue-400',
  closed:      'text-emerald-600 dark:text-emerald-500',
}

export default function StatusBadge({ status, label }: Props) {
  const { t } = useT()
  const key = (status ?? '').toLowerCase()
  const resolvedLabel = label ?? (() => {
    const raw = t(`status.${key}`)
    return raw === `status.${key}` ? key.replace(/_/g, ' ') : raw
  })()
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[key] ?? 'bg-gray-400 dark:bg-gray-500'}`} />
      <span className={TEXT[key] ?? 'text-gray-500 dark:text-gray-400'}>{resolvedLabel}</span>
    </span>
  )
}
