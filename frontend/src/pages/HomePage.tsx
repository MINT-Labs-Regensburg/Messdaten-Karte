import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { api } from '../api/client'
import type { ProjectList } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { errorMessage } from '../lib/errors'

export default function HomePage() {
  const { t } = useTranslation()
  const { user, me, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/projects'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)

  const mutation = useMutation({
    mutationFn: () => login(username.trim(), password, remember),
    onSuccess: () => navigate(from, { replace: true }),
  })

  const publicProjects = useQuery({
    queryKey: ['projects', 'public-teaser'],
    queryFn: () => api.get<ProjectList>('/projects', { scope: 'public', limit: 6 }),
  })

  if (user) return <Navigate to={from} replace />

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <div className="container home">
      <section className="home-intro">
        <h1 className="disp">{t('home.title')}</h1>
        <p className="lead">{t('home.lead')}</p>
        <ul className="home-points">
          <li>{t('home.point_map')}</li>
          <li>{t('home.point_live')}</li>
          <li>{t('home.point_iot')}</li>
        </ul>
        {publicProjects.data && publicProjects.data.items.length > 0 && (
          <div className="stack">
            <h2 className="lbl">{t('home.public_maps')}</h2>
            <div className="stack-sm">
              {publicProjects.data.items.map((project) => (
                <Link key={project.id} to={`/p/${project.slug}`} className="card card-link">
                  <strong>{project.name}</strong>
                  {project.description && <span className="help">{project.description}</span>}
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card card-pad login-card" aria-labelledby="login-title">
        <h2 id="login-title" className="disp">
          {t('auth.login_title')}
        </h2>
        <form className="stack" onSubmit={onSubmit}>
          <label className="field">
            <span>{t('auth.username')}</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              required
            />
          </label>
          <label className="field">
            <span>{t('auth.password')}</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>{t('auth.remember_me')}</span>
          </label>
          {mutation.error && (
            <p className="error-text" role="alert">
              {errorMessage(t, mutation.error)}
            </p>
          )}
          <button className="btn btn-primary btn-lg" type="submit" disabled={mutation.isPending}>
            {t('auth.login')}
          </button>
        </form>
        {me?.registration_enabled ? (
          <p className="help">
            {t('auth.no_account')} <Link to="/register">{t('auth.register')}</Link>
          </p>
        ) : (
          <p className="help">{t('auth.registration_closed')}</p>
        )}
      </section>
    </div>
  )
}
