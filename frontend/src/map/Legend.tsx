import { useTranslation } from 'react-i18next'

import type { Heatmap, Metric } from '../api/types'
import { gradientCss } from '../lib/colorScales'
import { formatNumber } from '../lib/format'
import type { Range } from './dataRange'

interface LegendProps {
  metric: Metric
  /** Skala aus den Messwerten im Zeitbereich; null = noch keine Werte */
  range: Range | null
  heatmap?: Heatmap
  pointCount: number
}

export function Legend({ metric, range, heatmap, pointCount }: LegendProps) {
  const { t, i18n } = useTranslation()
  const unit = metric.unit ? ` ${metric.unit}` : ''
  const fmt = (value: number) => formatNumber(value, i18n.language)
  const status = heatmap?.status
  const constant = range !== null && range.min === range.max
  return (
    <div className="legend card">
      <div className="between">
        <strong>{metric.unit ? t('map.legend_title_unit', { name: metric.name, unit: metric.unit }) : metric.name}</strong>
        <span className="help">{t('map.measurements_in_range', { count: pointCount })}</span>
      </div>
      {range === null ? (
        <p className="help legend-note">{t('map.legend_empty')}</p>
      ) : (
        <>
          <div
            className="legend-bar"
            style={{ background: gradientCss(metric.color_scale) }}
            role="img"
            aria-label={t('map.legend_aria', { name: metric.name })}
          />
          {constant ? (
            <p className="help legend-note">{t('map.legend_constant', { value: `${fmt(range.min)}${unit}` })}</p>
          ) : (
            <div className="legend-labels">
              <span>
                {fmt(range.min)}
                {unit}
              </span>
              <span>{fmt((range.min + range.max) / 2)}</span>
              <span>
                {fmt(range.max)}
                {unit}
              </span>
            </div>
          )}
        </>
      )}
      {status === 'insufficient_data' && <p className="help legend-note">{t('map.insufficient_data')}</p>}
      {status === 'failed' && <p className="error-text legend-note">{t('map.heatmap_failed')}</p>}
      {status === 'ok' && heatmap?.method === 'idw_fallback' && !constant && (
        <p className="help legend-note">{t('map.method_idw')}</p>
      )}
    </div>
  )
}
