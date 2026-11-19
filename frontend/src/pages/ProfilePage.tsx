import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { errorMessage } from '../lib/errors'

export default function ProfilePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.patch('/me', { current_password: current, new_password: next }),
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setRepeat('')
      toast.show(t('profile.password_changed'))
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    if (next.length < 10) return setLocalError(t('errors.password_short'))
    if (next !== repeat) return setLocalError(t('errors.password_mismatch'))
    mutation.mutate()
  }

  return (
    <div className="container narrow stack-lg">
      <h1 className="disp">{t('profile.title')}</h1>
      <section className="card card-pad stack">
        <p>
          {t('profile.signed_in_as')} <strong>{user?.username}</strong>
          {user?.is_admin && <span className="badge">{t('profile.admin')}</span>}
        </p>
      </section>
      <section className="card card-pad" aria-labelledby="pw-title">
        <h2 id="pw-title">{t('profile.change_password')}</h2>
        <form className="stack" onSubmit={onSubmit}>
          <label className="field">
            <span>{t('profile.current_password')}</span>
            <input
              className="input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="field">
            <span>{t('profile.new_password')}</span>
            <input
              className="input"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
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
          <div>
            <button className="btn btn-primary" type="submit" disabled={mutation.isPending}>
              {t('profile.save_password')}
            </button>
          </div>
          <p className="help">{t('profile.reset_hint')}</p>
        </form>
      </section>
    </div>
  )
}
