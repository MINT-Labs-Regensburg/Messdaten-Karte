import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { downloadExport } from '../api/client'
import type { ExportFormat, ExportRequest, ProjectDetail } from '../api/types'
import { errorMessage } from '../lib/errors'
import { fromLocalInput, toLocalInput } from '../lib/time'
import { Dialog } from './Dialog'

interface ExportDialogProps {
  project: ProjectDetail
  canModerate: boolean
  defaultFrom?: Date
  defaultTo?: Date
  defaultMetricId?: string
  onClose: () => void
}

const FORMATS: ExportFormat[] = ['csv', 'geojson', 'svg', 'png', 'jpeg']
const isImage = (f: ExportFormat) => f === 'svg' || f === 'png' || f === 'jpeg'

/** Export: vor dem Herunterladen wählt man, welche Daten enthalten sein sollen (siehe projekt.md). */
export function ExportDialog({ project, canModerate, defaultFrom, defaultTo, defaultMetricId, onClose }: ExportDialogProps) {
  const { t } = useTranslation()
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [metricIds, setMetricIds] = useState<string[]>(project.metrics.map((m) => m.id))
  const [from, setFrom] = useState(toLocalInput(defaultFrom))
  const [to, setTo] = useState(toLocalInput(defaultTo))
  const [includeHidden, setIncludeHidden] = useState(false)
  const [includeNotes, setIncludeNotes] = useState(false)
  const [imageMetric, setImageMetric] = useState(defaultMetricId ?? project.metrics[0]?.id ?? '')
  const [size, setSize] = useState('1600')
  const [showPoints, setShowPoints] = useState(true)
  const [showLegend, setShowLegend] = useState(true)

  const mutation = useMutation({
    mutationFn: async () => {
      const body: ExportRequest = {
        format,
        select: {
          metric_ids: isImage(format) ? undefined : metricIds,
          from: fromLocalInput(from)?.toISOString(),
          to: fromLocalInput(to)?.toISOString(),
          include_hidden: includeHidden,
          include_notes_and_names: includeNotes,
        },
      }
      if (isImage(format)) {
        const px = Math.min(8000, Math.max(100, Number(size) || 1600))
        body.image = {
          metric_id: imageMetric,
          width_px: px,
          height_px: px,
          basemap: 'none',
          show_points: showPoints,
          show_legend: showLegend,
        }
      }
      const { blob, filename } = await downloadExport(project.id, body)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    },
    onSuccess: onClose,
  })

  const toggleMetric = (id: string) =>
    setMetricIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  return (
    <Dialog
      title={t('export.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={mutation.isPending || (!isImage(format) && metricIds.length === 0)}
            onClick={() => mutation.mutate()}
          >
            {t('export.download')}
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span>{t('export.format')}</span>
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(`export.format_${f}`)}
              </option>
            ))}
          </select>
        </label>

        {isImage(format) ? (
          <>
            <label className="field">
              <span>{t('export.image_metric')}</span>
              <select className="input" value={imageMetric} onChange={(e) => setImageMetric(e.target.value)}>
                {project.metrics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            {format !== 'svg' && (
              <label className="field">
                <span>{t('export.size')}</span>
                <input className="input" inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} />
                <small className="help">{t('export.size_help')}</small>
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} />
              <span>{t('export.show_points')}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} />
              <span>{t('export.show_legend')}</span>
            </label>
            <p className="help">{format === 'svg' ? t('export.svg_help') : t('export.basemap_help')}</p>
          </>
        ) : (
          <fieldset className="fieldset">
            <legend>{t('export.metrics')}</legend>
            {project.metrics.map((m) => (
              <label key={m.id} className="check">
                <input type="checkbox" checked={metricIds.includes(m.id)} onChange={() => toggleMetric(m.id)} />
                <span>{m.name}</span>
              </label>
            ))}
          </fieldset>
        )}

        <div className="form-grid">
          <label className="field">
            <span>{t('time.from')}</span>
            <input className="input" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('time.to')}</span>
            <input className="input" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        {canModerate && (
          <label className="check">
            <input type="checkbox" checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)} />
            <span>{t('export.include_hidden')}</span>
          </label>
        )}
        {!isImage(format) && (
          <label className="check">
            <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} />
            <span>{t('export.include_notes')}</span>
          </label>
        )}
        {mutation.error && (
          <p className="error-text" role="alert">
            {errorMessage(t, mutation.error)}
          </p>
        )}
      </div>
    </Dialog>
  )
}
