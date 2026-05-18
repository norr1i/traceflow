'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '../lib/auth-context'
import { canVisit, homeFor } from '../lib/roles'
import Sidebar from './Sidebar'

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#070d1b]" style={{
      background: 'radial-gradient(ellipse 1200px 800px at 20% 20%, rgba(59,130,246,0.08) 0%, transparent 65%), radial-gradient(ellipse 800px 700px at 80% 80%, rgba(139,92,246,0.07) 0%, transparent 60%), #070d1b',
    }}>
      <div className="flex flex-col items-center gap-5">
        <div className="
          flex h-14 w-14 items-center justify-center rounded-2xl
          bg-gradient-to-br from-blue-500 to-violet-600
          text-white text-lg font-bold
          shadow-[0_0_32px_rgba(139,92,246,0.5)]
        ">
          TF
        </div>
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-blue-500" />
      </div>
    </div>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading, role } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  const isAuthOnlyPage = pathname === '/login' || pathname === '/signup'
  const isTracePage = pathname.startsWith('/trace/')
  const isVerifyPage = pathname === '/verify-email'
  const isPublic = isAuthOnlyPage || isTracePage || isVerifyPage

  useEffect(() => {
    if (loading) return

    if (isAuthOnlyPage && session) {
      router.replace(role ? homeFor(role) : '/')
      return
    }

    if (!isPublic && !session) {
      router.replace('/login')
      return
    }

    if (!isPublic && session && role && !canVisit(role, pathname)) {
      router.replace(homeFor(role))
    }
  }, [session, loading, role, isAuthOnlyPage, isPublic, pathname, router])

  if (isPublic) {
    return <>{children}</>
  }

  if (loading) return <LoadingScreen />
  if (!session) return <LoadingScreen />

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
