import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '../api/client'
import type { User, UserList } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Confirm } from '../components/Confirm'
import { Dialog } from '../components/Dialog'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { errorMessage } from '../lib/errors'
import { formatDateTime } from '../lib/format'

export default function AdminPage() {
  const { t, i18n } = useTranslation()
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<User | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [newUser, setNewUser] = useState({ username: '', password: '', is_admin: false })

  const users = useQuery({
    queryKey: ['admin', 'users', search],
    queryFn: () => api.get<UserList>('/admin/users', { q: search || undefined, limit: 200 }),
  })
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<{ registration_enabled: boolean }>('/admin/settings'),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] })

  const toggleRegistration = useMutation({
    mutationFn: (enabled: boolean) => api.patch('/admin/settings', { registration_enabled: enabled }),
    onSuccess: async () => {
      await refresh()
      await qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const patchUser = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/admin/users/${id}`, body),
    onSuccess: refresh,
  })
  const createUser = useMutation({
    mutationFn: () => api.post('/admin/users', { ...newUser, username: newUser.username.trim() }),
    onSuccess: () => {
      setNewUser({ username: '', password: '', is_admin: false })
      toast.show(t('admin.user_created'))
      return refresh()
    },
  })
  const resetPassword = useMutation({
    mutationFn: () => api.patch(`/admin/users/${resetting?.id}`, { new_password: newPassword }),
    onSuccess: () => {
      setResetting(null)
      setNewPassword('')
      toast.show(t('admin.password_reset_done'))
    },
  })
  const deleteUser = useMutation({
    mutationFn: (user: User) => api.delete(`/admin/users/${user.id}`),
    onSuccess: () => {
      setDeleting(null)
      return refresh()
    },
  })

  const onCreate = (event: FormEvent) => {
    event.preventDefault()
    createUser.mutate()
  }

  const actionError = patchUser.error ?? toggleRegistration.error

  return (
    <div className="container stack-lg">
      <h1 className="disp">{t('admin.title')}</h1>

      <section className="card card-pad" aria-labelledby="adm-reg">
        <div className="between">
          <div>
            <h2 id="adm-reg">{t('admin.registration')}</h2>
            <p className="help">{t('admin.registration_help')}</p>
          </div>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={settings.data?.registration_enabled ?? false}
            aria-label={t('admin.registration')}
            disabled={!settings.data}
            onClick={() => toggleRegistration.mutate(!settings.data?.registration_enabled)}
          />
        </div>
      </section>

      <section className="card card-pad" aria-labelledby="adm-new">
        <h2 id="adm-new">{t('admin.create_user')}</h2>
        <form className="form-grid" onSubmit={onCreate}>
          <label className="field">
            <span>{t('auth.username')}</span>
            <input
              className="input"
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
              autoCapitalize="none"
              required
            />
          </label>
          <label className="field">
            <span>{t('auth.password')}</span>
            <input
              className="input"
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              autoComplete="new-password"
              required
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={newUser.is_admin}
              onChange={(e) => setNewUser({ ...newUser, is_admin: e.target.checked })}
            />
            <span>{t('admin.is_admin')}</span>
          </label>
          <div className="form-grid-full row">
            <button className="btn btn-primary" type="submit" disabled={createUser.isPending}>
              {t('admin.create_user_button')}
            </button>
            {createUser.error && (
              <span className="error-text" role="alert">
                {errorMessage(t, createUser.error)}
              </span>
            )}
          </div>
        </form>
      </section>

      <section className="card card-pad stack" aria-labelledby="adm-users">
        <div className="between wrap">
          <h2 id="adm-users">{t('admin.users')}</h2>
          <input
            className="input search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.search')}
            aria-label={t('admin.search')}
          />
        </div>
        {actionError && (
          <p className="error-text" role="alert">
            {errorMessage(t, actionError)}
          </p>
        )}
        {users.isPending && <Spinner />}
        {users.data && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('auth.username')}</th>
                  <th>{t('admin.status')}</th>
                  <th>{t('admin.created')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.username}</strong>
                      {u.id === me?.id && <span className="help"> ({t('admin.you')})</span>}
                    </td>
                    <td>
                      <div className="badges">
                        {u.is_admin && <span className="badge">{t('profile.admin')}</span>}
                        <span className={`badge ${u.is_active ? '' : 'badge-muted'}`}>
                          {u.is_active ? t('admin.active') : t('admin.inactive')}
                        </span>
                      </div>
                    </td>
                    <td>{formatDateTime(u.created_at, i18n.language)}</td>
                    <td className="right">
                      <div className="row wrap end">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => patchUser.mutate({ id: u.id, body: { is_admin: !u.is_admin } })}
                        >
                          {u.is_admin ? t('admin.remove_admin') : t('admin.make_admin')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => patchUser.mutate({ id: u.id, body: { is_active: !u.is_active } })}
                        >
                          {u.is_active ? t('admin.deactivate') : t('admin.activate')}
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setResetting(u)}>
                          {t('admin.reset_password')}
                        </button>
                        <button type="button" className="btn btn-danger" onClick={() => setDeleting(u)}>
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {deleting && (
        <Confirm
          title={t('admin.delete_title')}
          message={t('admin.delete_message', { name: deleting.username })}
          confirmLabel={t('common.delete')}
          danger
          busy={deleteUser.isPending}
          error={deleteUser.error ? errorMessage(t, deleteUser.error) : null}
          onConfirm={() => deleteUser.mutate(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}

      {resetting && (
        <Dialog
          title={t('admin.reset_title', { name: resetting.username })}
          onClose={() => setResetting(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setResetting(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={newPassword.length < 10 || resetPassword.isPending}
                onClick={() => resetPassword.mutate()}
              >
                {t('admin.reset_password')}
              </button>
            </>
          }
        >
          <label className="field">
            <span>{t('profile.new_password')}</span>
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <small className="help">{t('auth.password_hint')}</small>
          </label>
          {resetPassword.error && (
            <p className="error-text" role="alert">
              {errorMessage(t, resetPassword.error)}
            </p>
          )}
        </Dialog>
      )}
    </div>
  )
}
