'use client'

import { useEffect } from 'react'
import { AuthProvider } from '../lib/auth-context'
import { LangProvider } from '../lib/i18n'
import { ToastProvider } from './Toast'
import { ConfirmProvider } from './ConfirmDialog'

function ThemeSync() {
  useEffect(() => {
    const stored = localStorage.getItem('tf-theme')
    const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    document.documentElement.classList.toggle('dark', (stored ?? preferred) === 'dark')
  }, [])
  return null
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LangProvider>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <ThemeSync />
            {children}
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </LangProvider>
  )
}
