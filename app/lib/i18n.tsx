'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import en from '../../locales/en.json'
import ar from '../../locales/ar.json'

export type Lang = 'en' | 'ar'

const STORAGE_KEY = 'tf-lang'
const TRANSLATIONS: Record<Lang, Record<string, unknown>> = { en, ar }

function resolve(obj: Record<string, unknown>, path: string): string {
  const val = path.split('.').reduce<unknown>((cur, key) =>
    cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[key] : undefined,
  obj)
  return typeof val === 'string' ? val : path
}

interface LangCtx {
  lang: Lang
  dir: 'ltr' | 'rtl'
  setLang: (l: Lang) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const Ctx = createContext<LangCtx>({
  lang: 'en', dir: 'ltr', setLang: () => {}, t: (k) => k,
})

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'ar' || stored === 'en') setLangState(stored)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  function setLang(l: Lang) {
    setLangState(l)
    try { localStorage.setItem(STORAGE_KEY, l) } catch {}
  }

  function t(key: string, vars?: Record<string, string | number>): string {
    let str = resolve(TRANSLATIONS[lang], key)
    if (str === key) str = resolve(TRANSLATIONS.en, key)
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.split(`{{${k}}}`).join(String(v))
      }
    }
    return str
  }

  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr'
  return <Ctx.Provider value={{ lang, dir, setLang, t }}>{children}</Ctx.Provider>
}

export const useT = () => useContext(Ctx)

export function fmtNum(n: number, _lang: Lang, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString('en-US', opts)
}

export function fmtDate(iso: string, lang: Lang, opts?: Intl.DateTimeFormatOptions): string {
  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'
  return new Date(iso).toLocaleDateString(locale, opts)
}
