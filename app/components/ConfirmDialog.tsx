'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ConfirmOpts {
  title?: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOpts) => Promise<boolean>

const Ctx = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    opts: ConfirmOpts
    resolve: (v: boolean) => void
  } | null>(null)

  const confirm = useCallback((opts: ConfirmOpts) =>
    new Promise<boolean>((resolve) => setState({ opts, resolve }))
  , [])

  function handle(yes: boolean) {
    state?.resolve(yes)
    setState(null)
  }

  return (
    <Ctx.Provider value={confirm}>
      {children}

      {state && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="
            w-full max-w-sm rounded-2xl p-6
            border border-white/[0.08]
            bg-[#0d1829] backdrop-blur-xl
            shadow-[0_24px_64px_rgba(0,0,0,0.6)]
          ">
            <div className="flex items-start gap-4 mb-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertTriangle size={18} className="text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white">
                  {state.opts.title ?? 'Confirm action'}
                </h3>
                <p className="mt-1 text-sm text-gray-400">
                  {state.opts.message}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => handle(false)}
                className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/[0.08] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handle(true)}
                className={`rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors ${
                  state.opts.danger !== false
                    ? 'bg-red-600 hover:bg-red-700 shadow-[0_0_16px_rgba(239,68,68,0.3)]'
                    : 'bg-blue-600 hover:bg-blue-700 shadow-[0_0_16px_rgba(59,130,246,0.3)]'
                }`}
              >
                {state.opts.confirmLabel ?? 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider')
  return ctx
}
