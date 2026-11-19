import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

import { AuthProvider } from '../auth/AuthContext'
import { ToastProvider } from '../components/Toast'
import { ThemeProvider } from '../lib/theme'
import type { Limits, ProjectDetail, User } from '../api/types'

export const LIMITS: Limits = { max_radius_m: 5000, max_measurements_per_project: 5000, edit_window_seconds: 900 }

export const ALICE: User = {
  id: 'u1',
  username: 'alice',
  is_admin: false,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  if (status === 204) return new Response(null, { status })
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export interface CallInfo {
  method: string
  path: string
  body: unknown
  headers: Record<string, string>
  search: URLSearchParams
}

type Handler = (call: CallInfo) => Response | Promise<Response>

/** Ersetzt `fetch` durch eine Tabelle „METHODE /pfad“ → Antwort und merkt sich alle Aufrufe. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: CallInfo[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const call: CallInfo = {
      method,
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
      search: url.searchParams,
    }
    calls.push(call)
    const handler = routes[`${method} ${url.pathname}`]
    if (!handler) return json({ code: 'not_found', message: `no mock for ${method} ${url.pathname}` }, 404)
    return handler(call)
  })
  vi.stubGlobal('fetch', fn)
  return { calls, fetch: fn }
}

export function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
}

/** Rendert mit allen Providern der App; `routes` hängt Ziel-Seiten für Weiterleitungen ein. */
export function renderApp(ui: ReactElement, opts: { route?: string; path?: string; routes?: Record<string, ReactElement> } = {}) {
  const client = newQueryClient()
  const result = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[opts.route ?? '/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthProvider>
              <Routes>
                <Route path={opts.path ?? '*'} element={ui} />
                {Object.entries(opts.routes ?? {}).map(([path, element]) => (
                  <Route key={path} path={path} element={element} />
                ))}
              </Routes>
            </AuthProvider>
          </MemoryRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
  return { ...result, client }
}

export function projectFixture(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'p1',
    slug: 'testgebiet',
    name: 'Testgebiet',
    description: null,
    center: { lat: 49.0134, lon: 12.1016 },
    radius_m: 500,
    is_public: true,
    is_editable: true,
    archived: false,
    measurement_count: 0,
    my_role: null,
    created_at: '2026-01-01T00:00:00Z',
    first_measurement_at: null,
    last_measurement_at: null,
    metrics: [
      {
        id: 'm-temp',
        name: 'Temperatur',
        unit: '°C',
        type: 'number',
        min: -30,
        max: 50,
        color_scale: { name: 'viridis' },
        position: 0,
      },
      {
        id: 'm-mood',
        name: 'Wohlbefinden',
        unit: null,
        type: 'scale',
        min: 1,
        max: 10,
        color_scale: { name: 'plasma' },
        position: 1,
      },
    ],
    ...overrides,
  }
}
