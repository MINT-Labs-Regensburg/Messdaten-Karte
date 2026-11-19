import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useCallback, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api/client'
import type { LatLon, Member, Metric, MetricInput, ProjectDetail, ProjectRole } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Confirm } from '../components/Confirm'
import { ExportDialog } from '../components/ExportDialog'
import { MetricDialog } from '../components/MetricForm'
import { ShareDialog } from '../components/ShareDialog'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { gradientCss } from '../lib/colorScales'
import { errorMessage } from '../lib/errors'
import { SwitchRow } from './ProjectCreatePage'

const AreaPicker = lazy(() => import('../components/AreaPicker').then((m) => ({ default: m.AreaPicker })))

export default function ProjectSettingsPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get<ProjectDetail>(`/projects/${id}`),
  })

  if (query.isPending) return <Spinner />
  if (query.error || !query.data) {
    return (
      <div className="container narrow">
        <p className="error-text" role="alert">
          {errorMessage(t, query.error)}
        </p>
      </div>
    )
  }
  const project = query.data
  const isAdmin = !!user?.is_admin
  const canManage = !!project.my_role || isAdmin
  if (!canManage) {
    return (
      <div className="container narrow">
        <p role="alert">{t('errors.forbidden')}</p>
        <Link to={`/p/${project.slug}`}>{t('settings.back_to_map')}</Link>
      </div>
    )
  }
  const isOwner = project.my_role === 'owner' || isAdmin

  return (
    <div className="container stack-lg">
      <div className="between wrap">
        <div>
          <div className="help">
            <Link to="/projects">{t('nav.projects')}</Link> › {project.name}
          </div>
          <h1 className="disp">{t('settings.title')}</h1>
        </div>
        <Link className="btn btn-secondary" to={`/p/${project.slug}`}>
          {t('settings.back_to_map')}
        </Link>
      </div>
      <div className="settings-grid">
        <div className="stack-lg">
          <GeneralSection key={project.slug + project.name} project={project} />
          <MetricsSection project={project} />
          <DangerSection project={project} isOwner={isOwner} />
        </div>
        <div className="stack-lg">
          <AreaSection project={project} />
          <MembersSection project={project} isOwner={isOwner} />
          <ShareSection project={project} />
        </div>
      </div>
    </div>
  )
}

function useRefresh() {
  const qc = useQueryClient()
  return useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['project'] })
    await qc.invalidateQueries({ queryKey: ['projects'] })
  }, [qc])
}

// ------------------------------------------------------------------ Allgemein

function GeneralSection({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation()
  const toast = useToast()
  const refresh = useRefresh()
  const [name, setName] = useState(project.name)
  const [slug, setSlug] = useState(project.slug)
  const [description, setDescription] = useState(project.description ?? '')
  const [isPublic, setPublic] = useState(project.is_public)
  const [isEditable, setEditable] = useState(project.is_editable)

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/projects/${project.id}`, {
        name: name.trim(),
        slug,
        description: description.trim() || null,
        is_public: isPublic,
        is_editable: isEditable,
      }),
    onSuccess: async () => {
      toast.show(t('common.saved'))
      await refresh()
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <section className="card card-pad" aria-labelledby="s-general">
      <h2 id="s-general">{t('settings.general')}</h2>
      <form className="stack" onSubmit={onSubmit}>
        <label className="field">
          <span>{t('settings.name')}</span>
          <input className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          <span>{t('settings.slug')}</span>
          <input
            className="input"
            value={slug}
            maxLength={100}
            pattern="[a-z0-9\-]+"
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            required
          />
          {slug !== project.slug && <small className="help">{t('settings.slug_warning')}</small>}
        </label>
        <label className="field">
          <span>{t('settings.description')}</span>
          <textarea className="input" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <SwitchRow label={t('settings.public')} help={t('settings.public_help')} checked={isPublic} onChange={setPublic} />
        <SwitchRow label={t('settings.editable')} help={t('settings.editable_help')} checked={isEditable} onChange={setEditable} />
        {mutation.error && (
          <p className="error-text" role="alert">
            {errorMessage(t, mutation.error)}
          </p>
        )}
        <div>
          <button className="btn btn-primary" type="submit" disabled={mutation.isPending}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </section>
  )
}

// ----------------------------------------------------------------- Messgebiet

function AreaSection({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation()
  const { me } = useAuth()
  const toast = useToast()
  const refresh = useRefresh()
  const [area, setArea] = useState<{ center: LatLon; radius: number }>({
    center: project.center,
    radius: project.radius_m,
  })
  const onArea = useCallback((v: { center: LatLon; radius: number }) => setArea(v), [])

  const mutation = useMutation({
    mutationFn: () => api.patch(`/projects/${project.id}`, { center: area.center, radius_m: area.radius }),
    onSuccess: async () => {
      toast.show(t('common.saved'))
      await refresh()
    },
  })

  return (
    <section className="card card-pad stack" aria-labelledby="s-area">
      <h2 id="s-area">{t('settings.area')}</h2>
      <Suspense fallback={<Spinner />}>
        <AreaPicker
          center={area.center}
          radius={area.radius}
          maxRadius={me?.limits.max_radius_m ?? 5000}
          onChange={onArea}
        />
      </Suspense>
      <div className="notice">
        <span>{t('settings.area_help', { count: project.measurement_count ?? 0 })}</span>
      </div>
      {mutation.error && (
        <p className="error-text" role="alert">
          {errorMessage(t, mutation.error)}
        </p>
      )}
      <div>
        <button className="btn btn-primary" type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {t('common.save')}
        </button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- Messgrößen

function MetricsSection({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation()
  const refresh = useRefresh()
  const [editing, setEditing] = useState<Metric | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Metric | null>(null)

  const save = useMutation({
    mutationFn: (value: MetricInput) =>
      editing && editing !== 'new'
        ? api.patch(`/projects/${project.id}/metrics/${editing.id}`, {
            name: value.name,
            unit: value.unit,
            min: value.min,
            max: value.max,
            color_scale: value.color_scale,
          })
        : api.post(`/projects/${project.id}/metrics`, value),
    onSuccess: async () => {
      setEditing(null)
      await refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (metric: Metric) => api.delete(`/projects/${project.id}/metrics/${metric.id}`),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
    },
  })
  const move = useMutation({
    mutationFn: async ({ a, b }: { a: Metric; b: Metric }) => {
      // Positionen tauschen; bei gleicher Position die Reihenfolge der Liste verwenden
      const posA = a.position === b.position ? project.metrics.indexOf(a) : a.position
      const posB = a.position === b.position ? project.metrics.indexOf(b) : b.position
      await api.patch(`/projects/${project.id}/metrics/${a.id}`, { position: posB })
      await api.patch(`/projects/${project.id}/metrics/${b.id}`, { position: posA })
    },
    onSuccess: refresh,
  })

  const metrics = project.metrics

  return (
    <section className="card card-pad stack" aria-labelledby="s-metrics">
      <div className="between wrap">
        <h2 id="s-metrics">{t('settings.metrics')}</h2>
        <span className="help">{t('settings.metrics_order')}</span>
      </div>
      <ul className="plain-list">
        {metrics.map((m, i) => (
          <li key={m.id} className="metric-row">
            <div className="grow">
              <strong>{m.name}</strong>{' '}
              <span className="help">
                {m.unit ? `${m.unit} · ` : ''}
                {t(`metrics.type_${m.type}`)} · {m.min} – {m.max}
              </span>
            </div>
            <span className="scale-mini" style={{ background: gradientCss(m.color_scale) }} aria-hidden="true" />
            <div className="row">
              <button
                type="button"
                className="iconbtn"
                aria-label={t('settings.move_up', { name: m.name })}
                disabled={i === 0 || move.isPending}
                onClick={() => move.mutate({ a: m, b: metrics[i - 1] })}
              >
                ↑
              </button>
              <button
                type="button"
                className="iconbtn"
                aria-label={t('settings.move_down', { name: m.name })}
                disabled={i === metrics.length - 1 || move.isPending}
                onClick={() => move.mutate({ a: m, b: metrics[i + 1] })}
              >
                ↓
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(m)}>
                {t('common.edit')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setDeleting(m)}>
                {t('common.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {move.error && (
        <p className="error-text" role="alert">
          {errorMessage(t, move.error)}
        </p>
      )}
      <div>
        <button type="button" className="btn btn-soft" onClick={() => setEditing('new')}>
          + {t('settings.add_metric')}
        </button>
      </div>

      {editing && (
        <MetricDialog
          metric={editing === 'new' ? undefined : editing}
          busy={save.isPending}
          error={save.error ? errorMessage(t, save.error) : null}
          onSave={(value) => save.mutate(value)}
          onClose={() => {
            setEditing(null)
            save.reset()
          }}
        />
      )}
      {deleting && (
        <Confirm
          title={t('settings.delete_metric_title')}
          message={t('settings.delete_metric_message', { name: deleting.name })}
          confirmLabel={t('common.delete')}
          danger
          busy={remove.isPending}
          error={remove.error ? errorMessage(t, remove.error) : null}
          onConfirm={() => remove.mutate(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}

// ----------------------------------------------------------------- Mitglieder

function MembersSection({ project, isOwner }: { project: ProjectDetail; isOwner: boolean }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<ProjectRole>('editor')

  const members = useQuery({
    queryKey: ['project', project.id, 'members'],
    queryFn: () => api.get<Member[]>(`/projects/${project.id}/members`),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['project', project.id, 'members'] })

  const add = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/members`, { username: username.trim(), role }),
    onSuccess: () => {
      setUsername('')
      return refresh()
    },
  })
  const changeRole = useMutation({
    mutationFn: ({ id, value }: { id: string; value: ProjectRole }) =>
      api.patch(`/projects/${project.id}/members/${id}`, { role: value }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${project.id}/members/${id}`),
    onSuccess: refresh,
  })

  const onAdd = (event: FormEvent) => {
    event.preventDefault()
    add.mutate()
  }
  const error = add.error ?? changeRole.error ?? remove.error

  return (
    <section className="card card-pad stack" aria-labelledby="s-members">
      <h2 id="s-members">{t('settings.members')}</h2>
      {members.isPending && <Spinner />}
      <ul className="plain-list">
        {members.data?.map((m) => (
          <li key={m.user_id} className="member-row">
            <span className="avatar" aria-hidden="true">
              {m.username.slice(0, 1).toUpperCase()}
            </span>
            <span className="grow strong">
              {m.username}
              {m.user_id === user?.id && <span className="help"> ({t('admin.you')})</span>}
            </span>
            <select
              className="input role-select"
              value={m.role}
              disabled={!isOwner}
              aria-label={t('settings.role_of', { name: m.username })}
              onChange={(e) => changeRole.mutate({ id: m.user_id, value: e.target.value as ProjectRole })}
            >
              <option value="owner">{t('roles.owner')}</option>
              <option value="editor">{t('roles.editor')}</option>
            </select>
            {isOwner && (
              <button
                type="button"
                className="btn btn-secondary"
                aria-label={t('settings.remove_member', { name: m.username })}
                onClick={() => remove.mutate(m.user_id)}
              >
                {t('common.remove')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <form className="row wrap end" onSubmit={onAdd}>
          <label className="field grow">
            <span>{t('settings.add_member')}</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('auth.username')}
              autoCapitalize="none"
              required
            />
          </label>
          <select
            className="input role-select"
            value={role}
            aria-label={t('settings.role')}
            onChange={(e) => setRole(e.target.value as ProjectRole)}
          >
            <option value="editor">{t('roles.editor')}</option>
            <option value="owner">{t('roles.owner')}</option>
          </select>
          <button className="btn btn-primary" type="submit" disabled={add.isPending}>
            {t('common.add')}
          </button>
        </form>
      )}
      {error && (
        <p className="error-text" role="alert">
          {errorMessage(t, error)}
        </p>
      )}
    </section>
  )
}

// --------------------------------------------------------------- Teilen/Export

function ShareSection({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation()
  const [share, setShare] = useState(false)
  const [exporting, setExporting] = useState(false)
  const url = `${location.origin}/p/${project.slug}`
  return (
    <section className="card card-pad stack" aria-labelledby="s-share">
      <h2 id="s-share">{t('settings.share_export')}</h2>
      <p className="help">{t('settings.share_help')}</p>
      <div className="row wrap">
        <button type="button" className="btn btn-secondary" onClick={() => setShare(true)}>
          {t('share.title')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setExporting(true)}>
          {t('export.title')}
        </button>
      </div>
      {share && <ShareDialog plainUrl={url} viewUrl={url} onClose={() => setShare(false)} />}
      {exporting && <ExportDialog project={project} canModerate onClose={() => setExporting(false)} />}
    </section>
  )
}

// ------------------------------------------------------ Archivieren / Löschen

function DangerSection({ project, isOwner }: { project: ProjectDetail; isOwner: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const refresh = useRefresh()
  const [confirming, setConfirming] = useState(false)

  const archive = useMutation({
    mutationFn: () => (project.archived ? api.delete(`/projects/${project.id}/archive`) : api.put(`/projects/${project.id}/archive`)),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${project.id}`),
    onSuccess: async () => {
      await refresh()
      navigate('/projects')
    },
  })

  return (
    <section className="card card-pad stack" aria-labelledby="s-danger">
      <h2 id="s-danger">{t('settings.danger')}</h2>
      <div className="between wrap">
        <div>
          <div className="strong">{project.archived ? t('settings.unarchive') : t('settings.archive')}</div>
          <div className="help">{project.archived ? t('settings.unarchive_help') : t('settings.archive_help')}</div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => archive.mutate()} disabled={archive.isPending}>
          {project.archived ? t('settings.unarchive') : t('settings.archive')}
        </button>
      </div>
      {isOwner && (
        <div className="between wrap divider">
          <div>
            <div className="strong">{t('settings.delete')}</div>
            <div className="help">{t('settings.delete_help')}</div>
          </div>
          <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
            {t('settings.delete_button')}
          </button>
        </div>
      )}
      {archive.error && (
        <p className="error-text" role="alert">
          {errorMessage(t, archive.error)}
        </p>
      )}
      {confirming && (
        <Confirm
          title={t('settings.delete')}
          message={t('settings.delete_message', { name: project.name })}
          confirmLabel={t('common.delete')}
          danger
          busy={remove.isPending}
          error={remove.error ? errorMessage(t, remove.error) : null}
          onConfirm={() => remove.mutate()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  )
}
