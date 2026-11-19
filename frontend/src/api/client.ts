import type { Measurement, MeasurementPage } from './types'

export interface ErrorDetail {
  field?: string
  code: string
  message: string
}

/** Fehler der API; `code` ist maschinenlesbar und wird im Frontend übersetzt. */
export class ApiError extends Error {
  status: number
  code: string
  details: ErrorDetail[]
  retryAfter?: number

  constructor(status: number, code: string, message: string, details: ErrorDetail[] = [], retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.retryAfter = retryAfter
  }
}

let csrfToken: string | null = null

export function setCsrfToken(token: string | null): void {
  csrfToken = token
}

type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions {
  body?: unknown
  query?: Query
  headers?: Record<string, string>
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return `/api${path}${qs ? `?${qs}` : ''}`
}

export async function rawRequest(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (!SAFE.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken

  let response: Response
  try {
    response = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'network_error', 'Network error')
  }
  if (response.ok) return response

  let code = 'http_error'
  let message = response.statusText
  let details: ErrorDetail[] = []
  try {
    const data = await response.json()
    code = data.code ?? code
    message = data.message ?? message
    details = data.details ?? []
  } catch {
    // Antwort ohne JSON-Körper
  }
  const retry = response.headers.get('Retry-After')
  throw new ApiError(response.status, code, message, details, retry ? Number(retry) : undefined)
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const response = await rawRequest(method, path, opts)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>('POST', path, { body: body ?? {}, headers }),
  patch: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    request<T>('PATCH', path, { body, headers }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  delete: <T = void>(path: string, headers?: Record<string, string>) =>
    request<T>('DELETE', path, { headers }),
}

/** Holt alle Seiten der Messungen (Cursor-Paginierung) im Zeitbereich. */
export async function fetchAllMeasurements(
  projectId: string,
  range: { from?: string; to?: string; includeHidden?: boolean },
): Promise<Measurement[]> {
  const out: Measurement[] = []
  let cursor: string | null | undefined
  for (let page = 0; page < 20; page += 1) {
    const result: MeasurementPage = await api.get(`/projects/${projectId}/measurements`, {
      from: range.from,
      to: range.to,
      include_hidden: range.includeHidden ? true : undefined,
      limit: 1000,
      cursor,
    })
    out.push(...result.items)
    cursor = result.next_cursor
    if (!cursor) break
  }
  return out
}

/** Lädt eine Exportdatei (POST) und gibt Blob und Dateinamen zurück. */
export async function downloadExport(
  projectId: string,
  body: unknown,
): Promise<{ blob: Blob; filename: string }> {
  const response = await rawRequest('POST', `/projects/${projectId}/exports`, { body })
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const match = /filename="?([^";]+)"?/.exec(disposition)
  return { blob: await response.blob(), filename: match?.[1] ?? 'export' }
}
