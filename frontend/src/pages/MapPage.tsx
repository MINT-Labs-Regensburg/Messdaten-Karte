import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { api, ApiError } from '../api/client'
import type { Measurement, MeasurementCreated } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Confirm } from '../components/Confirm'
import { ExportDialog } from '../components/ExportDialog'
import { Icon, Logo } from '../components/Icon'
import { ShareDialog } from '../components/ShareDialog'
import { Spinner } from '../components/Spinner'
import { LangToggle, ThemeToggle } from '../components/Toggles'
import { useToast } from '../components/Toast'
import { errorMessage } from '../lib/errors'
import { inCircle } from '../lib/geo'
import { useDebounced, useMediaQuery, useNow } from '../lib/hooks'
import {
  forgetEditToken,
  getEditToken,
  isOwn,
  readJson,
  rememberOwn,
  saveEditToken,
  setAuthorName,
  writeJson,
} from '../lib/storage'
import { useTheme } from '../lib/theme'
import { applyRange, iso, parseRange, resolveRange, type ParsedRange } from '../lib/time'
import { EntrySheet, type EntryPayload } from '../map/EntrySheet'
import { Legend } from '../map/Legend'
import { MapView, type DraftPoint, type UserLocation } from '../map/MapView'
import { MeasurementCard } from '../map/MeasurementCard'
import { MetricPicker } from '../map/MetricPicker'
import { TimeControls } from '../map/TimeControls'
import { applyMeasurementEvent, inRange, scheduleHeatmapRefresh } from '../map/liveCache'
import { useHeatmap, useMeasurements, useProject } from '../map/queries'
import { useProjectLive } from '../map/useProjectLive'
import { useReplay } from '../map/useReplay'

type Basemap = 'street' | 'satellite'

export default function MapPage() {
  const { t } = useTranslation()
  const { slug } = useParams()
  const { user, me } = useAuth()
  const { resolved: theme } = useTheme()
  const toast = useToast()
  const qc = useQueryClient()
  const desktop = useMediaQuery('(min-width: 900px)')
  const [params, setParams] = useSearchParams()

  const projectQuery = useProject(slug)
  const project = projectQuery.data
  const isMember = !!project?.my_role || !!user?.is_admin
  const canAdd = !!project && !project.archived && (isMember || (project.is_public && project.is_editable))

  // ---- Zeitbereich und Messgröße (Teil der URL)
  const parsed = useMemo(() => parseRange(params), [params])
  const now = useNow()
  const resolved = useMemo(() => resolveRange(parsed, now), [parsed, now])
  const metric = project?.metrics.find((m) => m.id === params.get('m')) ?? project?.metrics[0]

  const setRange = (range: ParsedRange) => setParams(applyRange(params, range), { replace: true })
  const setMetric = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('m', id)
    setParams(next, { replace: true })
  }

  // ---- Daten
  const [showHidden, setShowHidden] = useState(false)
  const includeHidden = showHidden && isMember
  const measurementsQuery = useMeasurements(project?.id, iso(resolved.from), iso(resolved.to), includeHidden)
  const measurements = useMemo(() => measurementsQuery.data ?? [], [measurementsQuery.data])
  const liveStatus = useProjectLive(project?.id)

  // ---- Replay
  const times = useMemo(() => measurements.map((m) => Date.parse(m.measured_at)), [measurements])
  const firstTime = times.length ? new Date(Math.min(...times)) : undefined
  const lastTime = times.length ? new Date(Math.max(...times)) : undefined
  const spanFrom = resolved.from ?? firstTime
  const spanTo = resolved.to ?? lastTime
  const replay = useReplay(spanFrom, spanTo)
  const replayEnabled = !!spanFrom && !!spanTo && spanTo > spanFrom && measurements.length > 1

  const shown = useMemo(() => {
    if (!replay.effective) return measurements
    const from = replay.effective.from.toISOString()
    const to = replay.effective.to?.toISOString()
    return measurements.filter((m) => inRange(m, from, to))
  }, [measurements, replay.effective])

  const heatFrom = useDebounced(iso(replay.effective?.from ?? resolved.from), 350)
  const heatTo = useDebounced(iso(replay.effective?.to ?? resolved.to), 350)
  const heatmapQuery = useHeatmap(project?.id, metric?.id, heatFrom, heatTo, desktop ? 60 : 40)

  // ---- Auswahl, Eintragen, Bearbeiten
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftPoint | null>(null)
  const [editing, setEditing] = useState<Measurement | null>(null)
  const [pickMode, setPickMode] = useState(false)
  const [deleting, setDeleting] = useState<Measurement | null>(null)
  const [sharing, setSharing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [timeOpen, setTimeOpen] = useState(false)
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [focus, setFocus] = useState<{ lat: number; lon: number; nonce: number } | null>(null)
  const [basemap, setBasemap] = useState<Basemap>(() => readJson<Basemap>('mdk.basemap', 'street'))

  const selected = measurements.find((m) => m.id === selectedId) ?? null

  useEffect(() => {
    if (project) document.title = `${project.name} – ${t('app.name')}`
  }, [project, t])

  const toggleBasemap = () => {
    const next: Basemap = basemap === 'street' ? 'satellite' : 'street'
    setBasemap(next)
    writeJson('mdk.basemap', next)
    if (next === 'satellite') toast.show(t('map.satellite_hint'))
  }

  const onMapClick = (point: DraftPoint) => {
    setSelectedId(null)
    if (!project || !canAdd || editing) return
    if (!inCircle(point, project.center, project.radius_m)) {
      toast.show(t('map.outside_circle'), 'error')
      return
    }
    setDraft(point)
    setPickMode(false)
  }

  const locate = () => {
    if (!project) return
    if (!navigator.geolocation) return toast.show(t('map.geo_unsupported'), 'error')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }
        setUserLocation(point)
        setFocus({ lat: point.lat, lon: point.lon, nonce: Date.now() })
        if (!canAdd) return
        if (inCircle(point, project.center, project.radius_m)) {
          setDraft({ lat: point.lat, lon: point.lon })
          setPickMode(false)
        } else {
          toast.show(t('map.outside_circle'), 'error')
        }
      },
      (error) => toast.show(t(error.code === 1 ? 'map.geo_denied' : 'map.geo_failed'), 'error'),
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }

  // ---- Änderungen an Messungen
  const editHeaders = (id: string): Record<string, string> | undefined => {
    const token = getEditToken(id)
    return token ? { 'X-Edit-Token': token } : undefined
  }

  const create = useMutation({
    mutationFn: (payload: EntryPayload) =>
      api.post<MeasurementCreated>(`/projects/${project?.id}/measurements`, { ...draft, ...payload }),
    onSuccess: (created, payload) => {
      setAuthorName(payload.author_name ?? '')
      if (created.edit_token) saveEditToken(created.id, created.edit_token, created.edit_expires_at)
      if (user) rememberOwn(created.id)
      if (project) {
        applyMeasurementEvent(qc, project.id, { type: 'measurement.created', measurement: created })
        scheduleHeatmapRefresh(qc, project.id, 500)
      }
      setDraft(null)
      toast.show(
        created.edit_token
          ? t('entry.saved_with_window', { minutes: Math.round((me?.limits.edit_window_seconds ?? 900) / 60) })
          : t('entry.saved'),
      )
    },
  })

  const update = useMutation({
    mutationFn: (payload: EntryPayload) =>
      api.patch<Measurement>(`/projects/${project?.id}/measurements/${editing?.id}`, payload, editHeaders(editing?.id ?? '')),
    onSuccess: (updated) => {
      if (project) {
        applyMeasurementEvent(qc, project.id, { type: 'measurement.updated', measurement: updated })
        scheduleHeatmapRefresh(qc, project.id, 500)
      }
      setEditing(null)
      toast.show(t('entry.saved'))
    },
  })

  const toggleHidden = useMutation({
    mutationFn: (m: Measurement) =>
      api.patch<Measurement>(`/projects/${project?.id}/measurements/${m.id}`, { hidden: !m.hidden }, editHeaders(m.id)),
    onSuccess: (updated) => {
      if (project) {
        applyMeasurementEvent(qc, project.id, { type: 'measurement.updated', measurement: updated })
        scheduleHeatmapRefresh(qc, project.id, 500)
      }
      if (updated.hidden && !includeHidden) setSelectedId(null)
    },
    onError: (error) => toast.show(errorMessage(t, error), 'error'),
  })

  const remove = useMutation({
    mutationFn: (m: Measurement) => api.delete(`/projects/${project?.id}/measurements/${m.id}`, editHeaders(m.id)),
    onSuccess: (_data, m) => {
      forgetEditToken(m.id)
      if (project) {
        applyMeasurementEvent(qc, project.id, { type: 'measurement.deleted', measurement_id: m.id })
        scheduleHeatmapRefresh(qc, project.id, 500)
      }
      setDeleting(null)
      setSelectedId(null)
    },
  })

  const canEdit = (m: Measurement) => !project?.archived && (isMember || (!!user && isOwn(m.id)) || !!getEditToken(m.id))

  // ---- Zustände ohne Projekt
  if (projectQuery.isPending) return <Spinner />
  if (projectQuery.error || !project) {
    const notFound = projectQuery.error instanceof ApiError && projectQuery.error.status === 404
    return (
      <div className="container narrow">
        <section className="card card-pad stack">
          <h1 className="disp">{notFound ? t('map.not_found_title') : t('errors.unknown')}</h1>
          <p>{notFound ? t('map.not_found_text') : errorMessage(t, projectQuery.error)}</p>
          <div className="row">
            <Link className="btn btn-primary" to="/">
              {t('notfound.home')}
            </Link>
          </div>
        </section>
      </div>
    )
  }

  const plainUrl = `${location.origin}/p/${project.slug}`
  const viewUrl = `${plainUrl}${params.toString() ? `?${params.toString()}` : ''}`
  const liveBadge = (
    <span className={`live-badge live-${liveStatus}`}>
      <span className="live-dot" aria-hidden="true" />
      {t(`map.live_${liveStatus}`)}
    </span>
  )
  const attribution =
    basemap === 'satellite' ? (
      <span>Esri, Maxar, Earthstar Geographics</span>
    ) : (
      <span>
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
      </span>
    )

  const timeControls = (
    <TimeControls
      range={parsed}
      resolved={resolved}
      onChange={setRange}
      replay={replay}
      replayEnabled={replayEnabled}
      spanTo={spanTo}
    />
  )

  const addButton = canAdd ? (
    <button type="button" className="btn btn-primary btn-lg float-shadow" onClick={() => setPickMode(true)}>
      <Icon name="plus" size={24} />
      {t('map.add')}
    </button>
  ) : null

  const locateButton = (
    <button type="button" className="iconbtn iconbtn-lg float-shadow" aria-label={t('map.my_location')} onClick={locate}>
      <Icon name="locate" size={26} />
    </button>
  )

  const basemapButtons = (
    <div className="basemap-switch card float-shadow" role="group" aria-label={t('map.layers')}>
      <button
        type="button"
        className={`seg ${basemap === 'street' ? 'on' : ''}`}
        aria-pressed={basemap === 'street'}
        onClick={() => basemap !== 'street' && toggleBasemap()}
      >
        {t('map.street')}
      </button>
      <button
        type="button"
        className={`seg ${basemap === 'satellite' ? 'on' : ''}`}
        aria-pressed={basemap === 'satellite'}
        onClick={() => basemap !== 'satellite' && toggleBasemap()}
      >
        {t('map.satellite')}
      </button>
    </div>
  )

  return (
    <div className="map-page">
      {desktop && (
        <aside className="map-sidebar">
          <div className="between">
            <Link to="/" className="brand">
              <Logo size={28} />
              <span className="disp">{t('app.name')}</span>
            </Link>
            <div className="row">
              <LangToggle />
              <ThemeToggle />
            </div>
          </div>

          <div className="stack-sm">
            <h1 className="disp project-title">{project.name}</h1>
            {project.description && <p className="help">{project.description}</p>}
            <div className="badges">
              {liveBadge}
              <span className="badge badge-muted">
                {project.is_public
                  ? project.is_editable
                    ? t('map.badge_public_editable')
                    : t('map.badge_public_readonly')
                  : t('projects.private')}
              </span>
              {project.archived && <span className="badge badge-muted">{t('projects.archived')}</span>}
            </div>
            <div className="row wrap">
              <button type="button" className="btn btn-secondary" onClick={() => setSharing(true)}>
                <Icon name="share" size={18} /> {t('share.title')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setExporting(true)}>
                <Icon name="download" size={18} /> {t('export.title')}
              </button>
              {isMember && (
                <Link className="btn btn-secondary" to={`/projects/${project.id}/settings`}>
                  {t('projects.settings')}
                </Link>
              )}
            </div>
          </div>

          <MetricPicker variant="cards" metrics={project.metrics} selectedId={metric?.id} onSelect={setMetric} />
          {timeControls}
          {isMember && (
            <label className="check">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
              <span>{t('map.show_hidden')}</span>
            </label>
          )}
          <div className="sidebar-foot">
            {user ? (
              <Link to="/projects" className="help">
                {t('nav.projects')}
              </Link>
            ) : (
              <Link to="/" state={{ from: `/p/${project.slug}` }} className="help">
                {t('nav.login')}
              </Link>
            )}
          </div>
        </aside>
      )}

      <div className="map-stage">
        <MapView
          project={project}
          metric={metric}
          measurements={shown}
          heatmap={heatmapQuery.data}
          basemap={basemap}
          dark={theme === 'dark'}
          draft={draft}
          selectedId={selectedId}
          userLocation={userLocation}
          focus={focus}
          onMapClick={onMapClick}
          onSelect={setSelectedId}
        />

        {project.archived && <div className="map-banner">{t('map.archived_banner')}</div>}
        {pickMode && (
          <div className="map-banner map-banner-pick" role="status">
            {t('map.pick_hint')}
            <button type="button" className="btn btn-secondary" onClick={() => setPickMode(false)}>
              {t('common.cancel')}
            </button>
          </div>
        )}
        {!project.archived && !canAdd && !pickMode && <div className="map-banner map-banner-quiet">{t('map.read_only')}</div>}

        {desktop ? (
          <>
            <div className="map-top-right">
              {basemapButtons}
              {locateButton}
              {addButton}
            </div>
            {metric && (
              <div className="map-bottom-left">
                <Legend metric={metric} heatmap={heatmapQuery.data} pointCount={shown.length} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mobile-top card float-shadow">
              <Link to={user ? '/projects' : '/'} className="iconbtn" aria-label={t('nav.projects')}>
                <Icon name="back" />
              </Link>
              <div className="grow mobile-title">
                <div className="disp project-title">{project.name}</div>
                <div className="help">{liveBadge}</div>
              </div>
              <button type="button" className="iconbtn" aria-label={t('share.title')} onClick={() => setSharing(true)}>
                <Icon name="share" />
              </button>
              <button type="button" className="iconbtn" aria-label={t('map.layers')} onClick={toggleBasemap}>
                <Icon name="layers" />
              </button>
            </div>
            <div className="mobile-chips">
              <MetricPicker variant="chips" metrics={project.metrics} selectedId={metric?.id} onSelect={setMetric} />
            </div>
            <div className="mobile-bottom">
              {metric && <Legend metric={metric} heatmap={heatmapQuery.data} pointCount={shown.length} />}
              <div className="card float-shadow time-card">
                <button type="button" className="time-toggle" aria-expanded={timeOpen} onClick={() => setTimeOpen((o) => !o)}>
                  <span className="help">{t('time.title')}</span>
                  <Icon name="chevron" size={20} />
                </button>
                {timeOpen ? timeControls : <TimeSummary range={parsed} replayPlaying={replay.playing} />}
              </div>
              <div className="row">
                <div className="grow row">{addButton}</div>
                {locateButton}
              </div>
              <div className="map-attrib-inline">{attribution}</div>
            </div>
          </>
        )}

        {desktop && <div className="map-attrib">{attribution}</div>}

        {selected && (
          <MeasurementCard
            measurement={selected}
            metrics={project.metrics}
            canEdit={canEdit(selected)}
            canModerate={isMember && !project.archived}
            onEdit={() => setEditing(selected)}
            onDelete={() => setDeleting(selected)}
            onToggleHidden={() => toggleHidden.mutate(selected)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {draft && !editing && (
        <EntrySheet
          project={project}
          point={draft}
          busy={create.isPending}
          error={create.error ? errorMessage(t, create.error) : null}
          onRelocate={locate}
          onSubmit={(payload) => create.mutate(payload)}
          onClose={() => {
            setDraft(null)
            create.reset()
          }}
        />
      )}
      {editing && (
        <EntrySheet
          project={project}
          point={{ lat: editing.lat, lon: editing.lon }}
          existing={editing}
          busy={update.isPending}
          error={update.error ? errorMessage(t, update.error) : null}
          onSubmit={(payload) => update.mutate(payload)}
          onClose={() => {
            setEditing(null)
            update.reset()
          }}
        />
      )}
      {deleting && (
        <Confirm
          title={t('card.delete_title')}
          message={t('card.delete_message')}
          confirmLabel={t('common.delete')}
          danger
          busy={remove.isPending}
          error={remove.error ? errorMessage(t, remove.error) : null}
          onConfirm={() => remove.mutate(deleting)}
          onCancel={() => {
            setDeleting(null)
            remove.reset()
          }}
        />
      )}
      {sharing && <ShareDialog plainUrl={plainUrl} viewUrl={viewUrl} onClose={() => setSharing(false)} />}
      {exporting && (
        <ExportDialog
          project={project}
          canModerate={isMember}
          defaultFrom={resolved.from}
          defaultTo={resolved.to}
          defaultMetricId={metric?.id}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  )
}

function TimeSummary({ range, replayPlaying }: { range: ParsedRange; replayPlaying: boolean }) {
  const { t } = useTranslation()
  return (
    <strong className="time-summary">
      {range.preset === 'custom' ? t('time.preset_custom') : t(`time.summary_${range.preset}`)}
      {replayPlaying ? ` · ${t('time.playing')}` : ''}
    </strong>
  )
}
