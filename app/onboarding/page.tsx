'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Building2, AlertCircle, Loader2, ShieldCheck } from 'lucide-react'
import { LogoIcon } from '../components/Logo'
import { useT } from '../lib/i18n'

function friendlyError(raw: string, t: (k: string) => string): string {
  if (raw.includes('already belongs to a company'))
    return t('onboarding.err_already_linked')
  if (raw.includes('Company name cannot be empty'))
    return t('onboarding.err_name_empty')
  if (raw.includes('Not authenticated'))
    return t('onboarding.err_session_expired')
  return t('onboarding.err_generic')
}

export default function OnboardingPage() {
  const { t } = useT()
  const [name,    setName]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    const trimmed = name.trim()
    if (!trimmed) { setError(t('onboarding.err_name_required')); return }

    setLoading(true)
    setError(null)

    const { error: rpcErr } = await supabase.rpc('create_my_company', { p_name: trimmed })

    if (rpcErr) {
      // If already has a company, just redirect home
      if (rpcErr.message.includes('already belongs')) {
        window.location.href = '/'
        return
      }
      setError(friendlyError(rpcErr.message, t))
      setLoading(false)
      return
    }

    // Full page reload so auth context re-fetches the new company_id from user_profiles
    window.location.href = '/'
  }

  const inputClass = `
    w-full rounded-xl border border-[#B3B7BA]/[0.12] bg-[#262E36]/50
    px-4 py-2.5 text-sm text-[#D3D1CE] placeholder-[#6C6D74]
    focus:border-[#4a7fa5]/50 focus:outline-none focus:ring-2 focus:ring-[#4a7fa5]/20
    transition-colors
  `

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden bg-[#090F15]">
      <div className="pointer-events-none absolute inset-0" style={{
        background: 'radial-gradient(ellipse 1600px 1000px at 20% 10%, rgba(74,127,165,0.05) 0%, transparent 65%)',
      }} />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-5">
            <LogoIcon size="lg" />
          </div>
          <h1 className="text-2xl font-bold text-[#D3D1CE] tracking-tight">{t('onboarding.title')}</h1>
          <p className="mt-1.5 text-sm text-[#6C6D74]">
            {t('onboarding.subtitle')}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[#B3B7BA]/[0.09] bg-gradient-to-b from-[#262E36]/85 to-[#1a2230]/80 backdrop-blur-xl p-8 shadow-[0_24px_60px_rgba(0,0,0,0.50)]">
          <form onSubmit={handleSubmit} className="space-y-5">

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-[#8a3535]/30 bg-[#8a3535]/10 px-4 py-3 text-sm text-[#c47070]">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#B3B7BA]">
                <span className="flex items-center gap-1.5">
                  <Building2 size={13} className="text-[#4a8fb9]" />
                  {t('onboarding.company_label')}
                </span>
              </label>
              <input
                type="text"
                required
                autoFocus
                autoComplete="organization"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('onboarding.company_placeholder')}
                className={inputClass}
              />
              <p className="mt-1.5 text-xs text-[#6C6D74]">
                {t('onboarding.company_hint')}
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="
                flex w-full items-center justify-center gap-2
                rounded-xl bg-[#3a6f8f] hover:bg-[#2d5a74]
                px-4 py-2.5 text-sm font-semibold text-white
                shadow-[0_0_20px_rgba(74,127,165,0.25)]
                hover:shadow-[0_0_28px_rgba(74,127,165,0.35)]
                focus:outline-none focus:ring-2 focus:ring-[#4a7fa5] focus:ring-offset-2 focus:ring-offset-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200
              "
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? t('onboarding.creating') : t('onboarding.create')}
            </button>
          </form>
        </div>

        {/* Security note */}
        <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-[#6C6D74]/70">
          <ShieldCheck size={12} />
          <span>{t('onboarding.isolation_note')}</span>
        </div>
      </div>
    </div>
  )
}
