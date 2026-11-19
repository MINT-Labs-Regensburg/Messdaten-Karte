import { useTranslation } from 'react-i18next'

import type { Heatmap, Metric } from '../api/types'
import { gradientCss } from '../lib/colorScales'
import { formatNumber } from '../lib/format'

interface LegendProps {
  metric: Metric
  heatmap?: Heatmap
  pointCount: number
}

export function Legend({ metric, heatmap, pointCount }: LegendProps) {
  const { t, i18n } = useTranslation()
  const mid = (metric.min + metric.max) / 2
  const unit = metric.unit ? ` ${metric.unit}` : ''
  const status = heatmap?.status
  return (
    <div className="legend card">
      <div className="between">
        <strong>{metric.unit ? t('map.legend_title_unit', { name: metric.name, unit: metric.unit }) : metric.name}</strong>
        <span className="help">{t('map.measurements_in_range', { count: pointCount })}</span>
      </div>
      <div className="legend-bar" style={{ background: gradientCss(metric.color_scale) }} role="img" aria-label={t('map.legend_aria', { name: metric.name })} />
      <div className="legend-labels">
        <span>{formatNumber(metric.min, i18n.language)}{unit}</span>
        <span>{formatNumber(mid, i18n.language)}</span>
        <span>{formatNumber(metric.max, i18n.language)}{unit}</span>
      </div>
      {status === 'insufficient_data' && <p className="help legend-note">{t('map.insufficient_data')}</p>}
      {status === 'failed' && <p className="error-text legend-note">{t('map.heatmap_failed')}</p>}
      {status === 'ok' && heatmap?.method === 'idw_fallback' && (
        <p className="help legend-note">{t('map.method_idw')}</p>
      )}
    </div>
  )
}
