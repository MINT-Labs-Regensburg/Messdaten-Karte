import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useCallback, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { api } from '../api/client'
import type { LatLon, MetricInput, Project } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { METRIC_TEMPLATES, MetricDialog, presetScale } from '../components/MetricForm'
import { Spinner } from '../components/Spinner'
import { gradientCss } from '../lib/colorScales'
import { errorMessage } from '../lib/errors'

const AreaPicker = lazy(() => import('../components/AreaPicker').then((m) => ({ default: m.AreaPicker })))

export default function ProjectCreatePage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const maxRadius = me?.limits.max_radius_m ?? 5000

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setPublic] = useState(true)
  const [isEditable, setEditable] = useState(true)
  const [area, setArea] = useState<{ center: LatLon | null; radius: number }>({ center: null, radius: 300 })
  const [metrics, setMetrics] = useState<MetricInput[]>([])
  const [adding, setAdding] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const onArea = useCallback((v: { center: LatLon; radius: number }) => setArea(v), [])

  const mutation = useMutation({
    mutationFn: () =>
      api.post<Project>('/projects', {
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || null,
        center: area.center,
        radius_m: area.radius,
        is_public: isPublic,
        is_editable: isEditable,
        metrics,
      }),
    onSuccess: async (project) => {
      await qc.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/p/${project.slug}`)
    },
  })

  const addTemplate = (id: string) => {
    const tpl = METRIC_TEMPLATES.find((x) => x.id === id)
    if (!tpl) return
    setMetrics((list) => [
      ...list,
      {
        name: t(`metrics.template_${tpl.id}`),
        unit: tpl.unit,
        type: tpl.type,
        min: tpl.min,
        max: tpl.max,
        color_scale: presetScale(tpl.preset),
      },
    ])
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    if (!name.trim()) return setLocalError(t('projects.err_name'))
    if (!area.center) return setLocalError(t('projects.err_area'))
    if (metrics.length === 0) return setLocalError(t('projects.err_metrics'))
    mutation.mutate()
  }

  return (
    <div className="container stack-lg">
      <h1 className="disp">{t('projects.create_title')}</h1>
      <form className="stack-lg" onSubmit={onSubmit}>
        <section className="card card-pad stack" aria-labelledby="c-general">
          <h2 id="c-general">{t('settings.general')}</h2>
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
              pattern="[a-z0-9\-]*"
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder={t('settings.slug_placeholder')}
            />
            <small className="help">{t('settings.slug_help')}</small>
          </label>
          <label className="field">
            <span>{t('settings.description')}</span>
            <textarea
              className="input"
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <SwitchRow
            label={t('settings.public')}
            help={t('settings.public_help')}
            checked={isPublic}
            onChange={setPublic}
          />
          <SwitchRow
            label={t('settings.editable')}
            help={t('settings.editable_help')}
            checked={isEditable}
            onChange={setEditable}
          />
        </section>

        <section className="card card-pad stack" aria-labelledby="c-area">
          <h2 id="c-area">{t('settings.area')}</h2>
          <Suspense fallback={<Spinner />}>
            <AreaPicker center={area.center} radius={area.radius} maxRadius={maxRadius} onChange={onArea} />
          </Suspense>
        </section>

        <section className="card card-pad stack" aria-labelledby="c-metrics">
          <h2 id="c-metrics">{t('settings.metrics')}</h2>
          <p className="help">{t('settings.metrics_help')}</p>
          {metrics.length > 0 && (
            <ul className="plain-list">
              {metrics.map((m, i) => (
                <li key={`${m.name}-${i}`} className="metric-row">
                  <div className="grow">
                    <strong>{m.name}</strong>{' '}
                    <span className="help">
                      {m.unit ? `${m.unit} · ` : ''}
                      {m.min} – {m.max}
                    </span>
                  </div>
                  <span className="scale-mini" style={{ background: gradientCss(m.color_scale) }} aria-hidden="true" />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setMetrics((list) => list.filter((_, k) => k !== i))}
                  >
                    {t('common.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="row wrap">
            {METRIC_TEMPLATES.map((tpl) => (
              <button key={tpl.id} type="button" className="chip" onClick={() => addTemplate(tpl.id)}>
                + {t(`metrics.template_${tpl.id}`)}
              </button>
            ))}
            <button type="button" className="chip" onClick={() => setAdding(true)}>
              + {t('metrics.custom')}
            </button>
          </div>
        </section>

        {(localError || mutation.error) && (
          <p className="error-text" role="alert">
            {localError ?? errorMessage(t, mutation.error)}
          </p>
        )}
        <div className="row">
          <button className="btn btn-primary btn-lg" type="submit" disabled={mutation.isPending}>
            {t('projects.create_button')}
          </button>
          <button className="btn btn-secondary btn-lg" type="button" onClick={() => navigate('/projects')}>
            {t('common.cancel')}
          </button>
        </div>
      </form>

      {adding && (
        <MetricDialog
          onClose={() => setAdding(false)}
          onSave={(value) => {
            setMetrics((list) => [...list, value])
            setAdding(false)
          }}
        />
      )}
    </div>
  )
}

export function SwitchRow({
  label,
  help,
  checked,
  onChange,
}: {
  label: string
  help: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="between switch-row">
      <div>
        <div className="strong">{label}</div>
        <div className="help">{help}</div>
      </div>
      <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />
    </div>
  )
}
