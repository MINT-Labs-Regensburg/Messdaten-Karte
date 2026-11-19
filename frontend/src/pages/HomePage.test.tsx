import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setCsrfToken } from '../api/client'
import { ALICE, LIMITS, json, mockApi, renderApp } from '../test/utils'
import HomePage from './HomePage'

afterEach(() => {
  vi.unstubAllGlobals()
  setCsrfToken(null)
})

const anonymous = () => json({ user: null, registration_enabled: true, limits: LIMITS })
const emptyList = () => json({ items: [], total: 0 })

async function fillAndSubmit(username: string, password: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Benutzername'), username)
  await user.type(screen.getByLabelText('Passwort'), password)
  await user.click(screen.getByRole('button', { name: 'Anmelden' }))
}

describe('Login', () => {
  it('meldet an, setzt das CSRF-Token und leitet zur Projektliste weiter', async () => {
    const api = mockApi({
      'GET /api/me': anonymous,
      'GET /api/projects': emptyList,
      'POST /api/auth/login': () => json({ user: ALICE, csrf_token: 'csrf-123' }),
    })
    renderApp(<HomePage />, { route: '/', routes: { '/projects': <p>Projektliste</p> } })

    await fillAndSubmit('alice', 'ein-langes-passwort')

    expect(await screen.findByText('Projektliste')).toBeInTheDocument()
    const login = api.calls.find((c) => c.path === '/api/auth/login')
    expect(login?.method).toBe('POST')
    expect(login?.body).toEqual({ username: 'alice', password: 'ein-langes-passwort', remember_me: false })
  })

  it('schickt „Angemeldet bleiben“ mit', async () => {
    const api = mockApi({
      'GET /api/me': anonymous,
      'GET /api/projects': emptyList,
      'POST /api/auth/login': () => json({ user: ALICE, csrf_token: 'x' }),
    })
    renderApp(<HomePage />, { routes: { '/projects': <p>Projektliste</p> } })
    const user = userEvent.setup()
    await user.click(await screen.findByLabelText('Angemeldet bleiben'))
    await fillAndSubmit('alice', 'ein-langes-passwort')
    await screen.findByText('Projektliste')
    expect(api.calls.find((c) => c.path === '/api/auth/login')?.body).toMatchObject({ remember_me: true })
  })

  it('zeigt bei falschen Zugangsdaten die übersetzte Fehlermeldung', async () => {
    mockApi({
      'GET /api/me': anonymous,
      'GET /api/projects': emptyList,
      'POST /api/auth/login': () => json({ code: 'invalid_credentials', message: 'x' }, 401),
    })
    renderApp(<HomePage />, { routes: { '/projects': <p>Projektliste</p> } })

    await fillAndSubmit('alice', 'falsch')

    expect(await screen.findByRole('alert')).toHaveTextContent('Benutzername oder Passwort ist falsch.')
    expect(screen.queryByText('Projektliste')).not.toBeInTheDocument()
  })

  it('zeigt die Wartezeit bei Rate-Limit', async () => {
    mockApi({
      'GET /api/me': anonymous,
      'GET /api/projects': emptyList,
      'POST /api/auth/login': () => json({ code: 'rate_limited', message: 'x' }, 429, { 'Retry-After': '42' }),
    })
    renderApp(<HomePage />)
    await fillAndSubmit('alice', 'x')
    expect(await screen.findByRole('alert')).toHaveTextContent('42 Sekunden')
  })

  it('blendet den Registrierungslink aus, wenn die Registrierung aus ist', async () => {
    mockApi({
      'GET /api/me': () => json({ user: null, registration_enabled: false, limits: LIMITS }),
      'GET /api/projects': emptyList,
    })
    renderApp(<HomePage />)
    expect(await screen.findByText('Die Registrierung ist derzeit deaktiviert.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Registrieren' })).not.toBeInTheDocument()
  })

  it('leitet bereits angemeldete Benutzer direkt weiter', async () => {
    mockApi({
      'GET /api/me': () => json({ user: ALICE, csrf_token: 't', registration_enabled: true, limits: LIMITS }),
      'GET /api/projects': emptyList,
    })
    renderApp(<HomePage />, { routes: { '/projects': <p>Projektliste</p> } })
    // HomePage rendert unter „*“, der Redirect trifft die Route „/projects“
    expect(await screen.findByText('Projektliste')).toBeInTheDocument()
  })
})
