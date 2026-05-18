'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'
interface ToastItem { id: string; message: string; type: ToastType }
interface ToastAPI {
  success(msg: string): void
  error(msg: string): void
  info(msg: string): void
}

const Ctx = createContext<ToastAPI | null>(null)

const icons = {
  success: CheckCircle2,
  error:   XCircle,
  info:    Info,
}

const styles = {
  success: {
    wrap: 'border-emerald-500/30 bg-emerald-500/10',
    icon: 'text-emerald-400',
    text: 'text-emerald-100',
  },
  error: {
    wrap: 'border-red-500/30 bg-red-500/10',
    icon: 'text-red-400',
    text: 'text-red-100',
  },
  info: {
    wrap: 'border-blue-500/30 bg-blue-500/10',
    icon: 'text-blue-400',
    text: 'text-blue-100',
  },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((message: string, type: ToastType) => {
    const id = `${Date.now()}-${Math.random()}`
    setItems((prev) => [...prev, { id, message, type }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  const dismiss = (id: string) => setItems((prev) => prev.filter((t) => t.id !== id))

  const api: ToastAPI = {
    success: (m) => push(m, 'success'),
    error:   (m) => push(m, 'error'),
    info:    (m) => push(m, 'info'),
  }

  return (
    <Ctx.Provider value={api}>
      {children}

      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
        {items.map((item) => {
          const Icon = icons[item.type]
          const s = styles[item.type]
          return (
            <div
              key={item.id}
              className={`
                pointer-events-auto flex items-center gap-3
                rounded-xl border px-4 py-3
                backdrop-blur-xl shadow-2xl max-w-sm
                ${s.wrap} toast-slide-in
              `}
            >
              <Icon size={16} className={`shrink-0 ${s.icon}`} />
              <span className={`flex-1 text-sm font-medium ${s.text}`}>{item.message}</span>
              <button
                onClick={() => dismiss(item.id)}
                className="ml-1 rounded p-0.5 text-white/40 hover:text-white/80 transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastAPI {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
