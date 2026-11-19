import { afterEach, describe, expect, it, vi } from 'vitest'

import { json, mockApi } from '../test/utils'
import { ApiError, api, fetchAllMeasurements, setCsrfToken } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
  setCsrfToken(null)
})

describe('API-Client', () => {
  it('sendet das CSRF-Token nur bei zustandsändernden Requests', async () => {
    const mock = mockApi({
      'GET /api/ping': () => json({ ok: true }),
      'POST /api/thing': () => json({ ok: true }),
      'DELETE /api/thing': () => json(null, 204),
    })
    setCsrfToken('tok-1')
    await api.get('/ping')
    await api.post('/thing', { a: 1 })
    await api.delete('/thing')
    const [get, post, del] = mock.calls
    expect(get.headers['X-CSRF-Token']).toBeUndefined()
    expect(post.headers['X-CSRF-Token']).toBe('tok-1')
    expect(post.body).toEqual({ a: 1 })
    expect(del.headers['X-CSRF-Token']).toBe('tok-1')
  })

  it('ohne Anmeldung wird kein Token gesendet', async () => {
    const mock = mockApi({ 'POST /api/thing': () => json({}) })
    await api.post('/thing', {})
    expect(mock.calls[0].headers['X-CSRF-Token']).toBeUndefined()
  })

  it('übersetzt Fehlerantworten in ApiError mit Code und Details', async () => {
    mockApi({
      'POST /api/thing': () =>
        json(
          { code: 'validation_error', message: 'bad', details: [{ field: 'values.0.value', code: 'value_out_of_range', message: 'x' }] },
          422,
        ),
    })
    const error = await api.post('/thing', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'validation_error' })
    expect((error as ApiError).details[0].field).toBe('values.0.value')
  })

  it('liest Retry-After bei 429', async () => {
    mockApi({ 'POST /api/thing': () => json({ code: 'rate_limited', message: 'x' }, 429, { 'Retry-After': '17' }) })
    const error = (await api.post('/thing', {}).catch((e: unknown) => e)) as ApiError
    expect(error.retryAfter).toBe(17)
  })

  it('Netzwerkfehler und Antworten ohne JSON werden zu ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await api.get('/x').catch((e: unknown) => e)).toMatchObject({ code: 'network_error', status: 0 })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })))
    expect(await api.get('/x').catch((e: unknown) => e)).toMatchObject({ code: 'http_error', status: 502 })
  })

  it('lässt leere Parameter weg', async () => {
    const mock = mockApi({ 'GET /api/list': () => json([]) })
    await api.get('/list', { a: 1, b: undefined, c: null, d: '', e: false })
    expect([...mock.calls[0].search.entries()]).toEqual([
      ['a', '1'],
      ['e', 'false'],
    ])
  })

  it('holt alle Seiten der Messungen über den Cursor', async () => {
    const page = (id: string, next: string | null) => json({ items: [{ id }], next_cursor: next })
    const mock = mockApi({
      'GET /api/projects/p1/measurements': (call) =>
        call.search.get('cursor') === 'c2' ? page('b', null) : page('a', 'c2'),
    })
    const all = await fetchAllMeasurements('p1', { from: '2026-01-01T00:00:00Z', includeHidden: true })
    expect(all.map((m) => m.id)).toEqual(['a', 'b'])
    expect(mock.calls).toHaveLength(2)
    expect(mock.calls[0].search.get('from')).toBe('2026-01-01T00:00:00Z')
    expect(mock.calls[0].search.get('include_hidden')).toBe('true')
    expect(mock.calls[1].search.get('cursor')).toBe('c2')
  })
})
