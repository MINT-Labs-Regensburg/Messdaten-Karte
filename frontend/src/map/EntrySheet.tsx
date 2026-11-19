import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Measurement, Metric, ProjectDetail, ValueIn } from '../api/types'
import { Dialog } from '../components/Dialog'
import { formatNumber, parseDecimal } from '../lib/format'
import { haversineM, inCircle } from '../lib/geo'
import { getAuthorName } from '../lib/storage'

export interface EntryPayload {
  values: ValueIn[]
  author_name: string | null
  note: string | null
}

interface EntrySheetProps {
  project: ProjectDetail
  point: { lat: number; lon: number }
  /** Vorhandene Messung bearbeiten */
  existing?: Measurement
  busy?: boolean
  error?: string | null
  onRelocate?: () => void
  onSubmit: (payload: EntryPayload) => void
  onClose: () => void
}

const SCALE_BUTTON_LIMIT = 10

function stepFor(metric: Metric): number {
  const span = metric.max - metric.min
  if (metric.type === 'scale') return 1
  if (span <= 20) return 0.1
  if (span <= 200) return 0.5
  return 1
}

function roundTo(value: number, step: number): number {
  const decimals = step < 1 ? 1 : 0
  return Number(value.toFixed(decimals))
}

/** Formular: zeigt immer alle Messgrößen, einzelne Werte dürfen leer bleiben (mindestens einer nötig). */
export function EntrySheet({ project, point, existing, busy, error, onRelocate, onSubmit, onClose }: EntrySheetProps) {
  const { t, i18n } = useTranslation()
  const initial = (metric: Metric) => {
    const v = existing?.values.find((x) => x.metric_id === metric.id)?.value
    return v === undefined ? '' : String(v).replace('.', i18n.language.startsWith('de') ? ',' : '.')
  }
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(project.metrics.map((m) => [m.id, initial(m)])),
  )
  const [name, setName] = useState(existing ? (existing.author_name ?? '') : getAuthorName())
  const [note, setNote] = useState(existing?.note ?? '')
  const [localError, setLocalError] = useState<string | null>(null)

  const distance = Math.round(haversineM(point.lat, point.lon, project.center.lat, project.center.lon))
  const inside = inCircle(point, project.center, project.radius_m)

  const setText = (id: string, text: string) => setTexts((s) => ({ ...s, [id]: text }))
  const decimalSeparator = (n: number) => String(n).replace('.', i18n.language.startsWith('de') ? ',' : '.')

  const bump = (metric: Metric, direction: 1 | -1) => {
    const step = stepFor(metric)
    const parsed = parseDecimal(texts[metric.id] ?? '')
    const base = parsed === null || Number.isNaN(parsed) ? (metric.min + metric.max) / 2 - direction * step : parsed
    const next = Math.min(metric.max, Math.max(metric.min, roundTo(base + direction * step, step)))
    setText(metric.id, decimalSeparator(next))
  }

  const submit = () => {
    setLocalError(null)
    if (!inside) return setLocalError(t('entry.err_outside'))
    const values: ValueIn[] = []
    for (const metric of project.metrics) {
      const parsed = parseDecimal(texts[metric.id] ?? '')
      if (parsed === null) continue
      if (Number.isNaN(parsed)) return setLocalError(t('entry.err_nan', { name: metric.name }))
      if (parsed < metric.min || parsed > metric.max) {
        return setLocalError(
          t('entry.err_range', {
            name: metric.name,
            min: formatNumber(metric.min, i18n.language),
            max: formatNumber(metric.max, i18n.language),
          }),
        )
      }
      if (metric.type === 'scale' && !Number.isInteger(parsed)) {
        return setLocalError(t('entry.err_integer', { name: metric.name }))
      }
      values.push({ metric_id: metric.id, value: parsed })
    }
    if (values.length === 0) return setLocalError(t('entry.err_no_values'))
    onSubmit({ values, author_name: name.trim() || null, note: note.trim() || null })
  }

  return (
    <Dialog
      variant="sheet"
      title={existing ? t('entry.title_edit') : t('entry.title_new')}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary btn-lg block" onClick={submit} disabled={busy}>
          {existing ? t('entry.save_changes') : t('entry.save')}
        </button>
      }
    >
      <div className="stack entry">
        {!existing && (
          <div className={`location-card ${inside ? '' : 'location-bad'}`}>
            <span className="location-dot" aria-hidden="true">
              {inside ? '✓' : '!'}
            </span>
            <div className="grow">
              <strong>{inside ? t('entry.inside') : t('entry.outside')}</strong>
              <div className="help">{t('entry.distance', { m: distance })}</div>
            </div>
            {onRelocate && (
              <button type="button" className="btn btn-secondary" onClick={onRelocate}>
                {t('map.my_location')}
              </button>
            )}
          </div>
        )}

        {project.metrics.map((metric) => {
          const unit = metric.unit ? ` ${metric.unit}` : ''
          const hint = `${formatNumber(metric.min, i18n.language)} – ${formatNumber(metric.max, i18n.language)}${unit}`
          const useButtons = metric.type === 'scale' && metric.max - metric.min + 1 <= SCALE_BUTTON_LIMIT
          if (useButtons) {
            const current = parseDecimal(texts[metric.id] ?? '')
            const options = Array.from({ length: metric.max - metric.min + 1 }, (_, i) => metric.min + i)
            return (
              <div key={metric.id} className="field" role="group" aria-label={metric.name}>
                <span className="between">
                  <span>{metric.name}</span>
                  <span className="help">{hint}</span>
                </span>
                <div className="scale-grid">
                  {options.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`scale-btn ${current === n ? 'on' : ''}`}
                      aria-pressed={current === n}
                      onClick={() => setText(metric.id, current === n ? '' : String(n))}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )
          }
          return (
            <div key={metric.id} className="field">
              <label htmlFor={`m-${metric.id}`} className="between">
                <span>{metric.name}</span>
                <span className="help">{hint}</span>
              </label>
              <div className="stepper">
                <button
                  type="button"
                  aria-label={t('entry.decrease', { name: metric.name })}
                  onClick={() => bump(metric, -1)}
                >
                  −
                </button>
                <input
                  id={`m-${metric.id}`}
                  inputMode="decimal"
                  value={texts[metric.id] ?? ''}
                  placeholder="–"
                  onChange={(e) => setText(metric.id, e.target.value)}
                />
                <span className="unit">{metric.unit ?? ''}</span>
                <button
                  type="button"
                  aria-label={t('entry.increase', { name: metric.name })}
                  onClick={() => bump(metric, 1)}
                >
                  +
                </button>
              </div>
            </div>
          )
        })}

        <div className="form-grid">
          <label className="field">
            <span>{t('entry.name')}</span>
            <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t('entry.name_placeholder')} />
          </label>
          <label className="field">
            <span>{t('entry.note')}</span>
            <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t('entry.note_placeholder')} />
          </label>
        </div>
        <p className="help">{t('entry.public_hint')}</p>
        {(localError || error) && (
          <p className="error-text" role="alert">
            {localError ?? error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
