import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'

import { api, setCsrfToken } from '../api/client'
import type { LoginResponse, MeResponse, User } from '../api/types'

interface AuthValue {
  me: MeResponse | undefined
  user: User | null
  loading: boolean
  login: (username: string, password: string, rememberMe: boolean) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

async function fetchMe(): Promise<MeResponse> {
  const me = await api.get<MeResponse>('/me')
  setCsrfToken(me.csrf_token ?? null)
  return me
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: Infinity })

  const login = useCallback(
    async (username: string, password: string, rememberMe: boolean) => {
      const res = await api.post<LoginResponse>('/auth/login', {
        username,
        password,
        remember_me: rememberMe,
      })
      setCsrfToken(res.csrf_token)
      qc.setQueryData<MeResponse>(['me'], (old) => ({
        registration_enabled: true,
        limits: { max_radius_m: 5000, max_measurements_per_project: 5000, edit_window_seconds: 900 },
        ...old,
        user: res.user,
        csrf_token: res.csrf_token,
      }))
      // Rechte haben sich geändert: alles außer „me“ neu laden
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    },
    [qc],
  )

  const register = useCallback(
    async (username: string, password: string) => {
      await api.post('/auth/register', { username, password })
      qc.setQueryData(['me'], await fetchMe())
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    },
    [qc],
  )

  const logout = useCallback(async () => {
    await api.post('/auth/logout')
    setCsrfToken(null)
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    qc.setQueryData(['me'], await fetchMe())
  }, [qc])

  const value = useMemo<AuthValue>(
    () => ({
      me: query.data,
      user: query.data?.user ?? null,
      loading: query.isPending,
      login,
      register,
      logout,
    }),
    [query.data, query.isPending, login, register, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth braucht den AuthProvider')
  return ctx
}
