import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { readJson, writeJson } from './storage'

type Preference = 'system' | 'light' | 'dark'
export type Resolved = 'light' | 'dark'

interface ThemeState {
  resolved: Resolved
  toggle: () => void
}

const ThemeContext = createContext<ThemeState>({ resolved: 'light', toggle: () => undefined })

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Preference>(() => readJson<Preference>('mdk.theme', 'system'))
  const [prefersDark, setPrefersDark] = useState(systemDark)

  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mql = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setPrefersDark(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const resolved: Resolved = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const value = useMemo<ThemeState>(
    () => ({
      resolved,
      toggle: () => {
        const next: Preference = resolved === 'dark' ? 'light' : 'dark'
        setPreference(next)
        writeJson('mdk.theme', next)
      },
    }),
    [resolved],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
