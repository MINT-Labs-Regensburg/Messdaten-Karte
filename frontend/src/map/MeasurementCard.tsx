import { useTranslation } from 'react-i18next'

import type { Measurement, Metric } from '../api/types'
import { Icon } from '../components/Icon'
import { formatDateTime, formatNumber } from '../lib/format'

interface MeasurementCardProps {
  measurement: Measurement
  metrics: Metric[]
  canEdit: boolean
  canModerate: boolean
  onEdit: () => void
  onDelete: () => void
  onToggleHidden: () => void
  onClose: () => void
}

export function MeasurementCard({ measurement, metrics, canEdit, canModerate, onEdit, onDelete, onToggleHidden, onClose }: MeasurementCardProps) {
  const { t, i18n } = useTranslation()
  const rows = measurement.values
    .map((v) => ({ value: v.value, metric: metrics.find((m) => m.id === v.metric_id) }))
    .filter((r): r is { value: number; metric: Metric } => !!r.metric)

  return (
    <aside className="measurement-card card" aria-label={t('card.title')}>
      <div className="between">
        <span className="help">{formatDateTime(measurement.measured_at, i18n.language)}</span>
        <button type="button" className="iconbtn iconbtn-small" aria-label={t('common.close')} onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <dl className="value-list">
        {rows.map(({ metric, value }) => (
          <div key={metric.id} className="value-row">
            <dt>{metric.name}</dt>
            <dd className="disp">
              {formatNumber(value, i18n.language)}
              {metric.unit && <span className="unit"> {metric.unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {(measurement.author_name || measurement.note) && (
        <p className="card-note">
          {measurement.author_name && <strong>{measurement.author_name}</strong>}
          {measurement.author_name && measurement.note && ' · '}
          {measurement.note && <span>„{measurement.note}“</span>}
        </p>
      )}
      <div className="row wrap">
        <span className="badge badge-muted">{t(`card.source_${measurement.source}`)}</span>
        {measurement.hidden && <span className="badge badge-muted">{t('card.hidden')}</span>}
      </div>
      {(canEdit || canModerate) && (
        <div className="row wrap">
          {canEdit && (
            <button type="button" className="btn btn-secondary" onClick={onEdit}>
              {t('common.edit')}
            </button>
          )}
          {canModerate && (
            <button type="button" className="btn btn-secondary" onClick={onToggleHidden}>
              {measurement.hidden ? t('card.unhide') : t('card.hide')}
            </button>
          )}
          {(canEdit || canModerate) && (
            <button type="button" className="btn btn-secondary" onClick={onDelete}>
              {t('common.delete')}
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
