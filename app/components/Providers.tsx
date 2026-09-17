'use client'

import { useEffect } from 'react'
import { AuthProvider } from '../lib/auth-context'
import { LangProvider } from '../lib/i18n'
import { ToastProvider } from './Toast'
import { ConfirmProvider } from './ConfirmDialog'

function ThemeSync() {
  useEffect(() => {
    // Post-mount safety sync only — the layout head script is the authoritative
    // prepaint resolver. Single key `tf-theme`; invalid/missing → light (no
    // system preference, no legacy key).
    const stored = localStorage.getItem('tf-theme')
    const theme = stored === 'dark' || stored === 'light' ? stored : 'light'
    document.documentElement.classList.toggle('dark', theme === 'dark')
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
