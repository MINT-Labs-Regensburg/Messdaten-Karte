import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/AuthContext'
import { errorMessage } from '../lib/errors'

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/

export default function RegisterPage() {
  const { t } = useTranslation()
  const { user, me, register } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => register(username.trim(), password),
    onSuccess: () => navigate('/projects', { replace: true }),
  })

  if (user) return <Navigate to="/projects" replace />

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    if (!USERNAME_PATTERN.test(username.trim())) return setLocalError(t('errors.username_invalid'))
    if (password.length < 10) return setLocalError(t('errors.password_short'))
    if (password !== repeat) return setLocalError(t('errors.password_mismatch'))
    mutation.mutate()
  }

  const disabled = me !== undefined && !me.registration_enabled

  return (
    <div className="container narrow">
      <section className="card card-pad">
        <h1 className="disp">{t('auth.register_title')}</h1>
        {disabled ? (
          <p role="alert">{t('errors.registration_disabled')}</p>
        ) : (
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
              <small className="help">{t('auth.username_hint')}</small>
            </label>
            <label className="field">
              <span>{t('auth.password')}</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <small className="help">{t('auth.password_hint')}</small>
            </label>
            <label className="field">
              <span>{t('auth.password_repeat')}</span>
              <input
                className="input"
                type="password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            {(localError || mutation.error) && (
              <p className="error-text" role="alert">
                {localError ?? errorMessage(t, mutation.error)}
              </p>
            )}
            <button className="btn btn-primary btn-lg" type="submit" disabled={mutation.isPending}>
              {t('auth.register')}
            </button>
            <p className="help">{t('auth.no_email')}</p>
          </form>
        )}
        <p className="help">
          {t('auth.have_account')} <Link to="/">{t('auth.login')}</Link>
        </p>
      </section>
    </div>
  )
}
