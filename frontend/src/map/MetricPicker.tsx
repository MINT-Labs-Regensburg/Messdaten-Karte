import { useTranslation } from 'react-i18next'

import type { Metric } from '../api/types'
import { gradientCss } from '../lib/colorScales'
import { formatNumber } from '../lib/format'
import type { Range } from './dataRange'

interface MetricPickerProps {
  metrics: Metric[]
  selectedId: string | undefined
  onSelect: (id: string) => void
  variant: 'cards' | 'chips'
  /** Kleinster/größter Messwert je Messgröße im Zeitbereich */
  ranges: Record<string, Range | null>
}

export function MetricPicker({ metrics, selectedId, onSelect, variant, ranges }: MetricPickerProps) {
  const { t, i18n } = useTranslation()
  const describe = (m: Metric) => {
    const range = ranges[m.id]
    if (!range) return t('map.no_values')
    const unit = m.unit ? ` ${m.unit}` : ''
    const [lo, hi] = [formatNumber(range.min, i18n.language), formatNumber(range.max, i18n.language)]
    return range.min === range.max ? `${lo}${unit}` : `${lo} – ${hi}${unit}`
  }
  if (variant === 'chips') {
    return (
      <div className="chips" role="group" aria-label={t('map.metric')}>
        {metrics.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`chip chip-float ${m.id === selectedId ? 'on' : ''}`}
            aria-pressed={m.id === selectedId}
            onClick={() => onSelect(m.id)}
          >
            {m.name}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="stack-sm" role="group" aria-label={t('map.metric')}>
      <span className="lbl">{t('map.metric')}</span>
      {metrics.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`metric-card ${m.id === selectedId ? 'on' : ''}`}
          aria-pressed={m.id === selectedId}
          onClick={() => onSelect(m.id)}
        >
          <span className="between">
            <strong>{m.name}</strong>
            <span className="help">{describe(m)}</span>
          </span>
          <span className="scale-mini wide" style={{ background: gradientCss(m.color_scale) }} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
