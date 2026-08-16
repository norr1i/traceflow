'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

type Props = {
  page:       number
  totalPages: number
  totalCount: number
  pageSize:   number
  onPage:     (p: number) => void
}

export default function PaginationBar({ page, totalPages, totalCount, pageSize, onPage }: Props) {
  if (totalPages <= 1) return null

  const start = (page - 1) * pageSize + 1
  const end   = Math.min(page * pageSize, totalCount)

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
  const pageItems = pageNums.reduce<(number | '…')[]>((acc, n, i, arr) => {
    if (i > 0 && (n as number) - (arr[i - 1] as number) > 1) acc.push('…')
    acc.push(n)
    return acc
  }, [])

  const btn =
    'flex items-center gap-0.5 rounded-md border border-gray-200 dark:border-gray-700 ' +
    'px-2.5 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 ' +
    'hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150'

  return (
    <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700/40 px-3 py-3 gap-4">
      <p className="shrink-0 text-xs text-gray-400 dark:text-gray-500 tabular-nums">
        {start.toLocaleString()}–{end.toLocaleString()} of {totalCount.toLocaleString()}
      </p>

      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} className={btn}>
          <ChevronLeft size={13} /> Prev
        </button>

        {pageItems.map((n, i) =>
          n === '…' ? (
            <span key={`ell-${i}`} className="px-1 text-xs text-gray-300 dark:text-gray-600 select-none">…</span>
          ) : (
            <button
              key={n}
              onClick={() => onPage(n as number)}
              className={`min-w-[28px] rounded-md border px-2 py-1 text-xs font-medium transition-colors duration-150 ${
                page === n
                  ? 'border-[#3a6f8f]/30 bg-[#3a6f8f]/10 text-[#3a6f8f] dark:bg-[#3a6f8f]/20 dark:text-[#7ab3d0]'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              {n}
            </button>
          )
        )}

        <button onClick={() => onPage(page + 1)} disabled={page >= totalPages} className={btn}>
          Next <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}
