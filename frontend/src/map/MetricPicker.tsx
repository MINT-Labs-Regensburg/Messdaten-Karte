import { useTranslation } from 'react-i18next'

import type { Metric } from '../api/types'
import { gradientCss } from '../lib/colorScales'

interface MetricPickerProps {
  metrics: Metric[]
  selectedId: string | undefined
  onSelect: (id: string) => void
  variant: 'cards' | 'chips'
}

export function MetricPicker({ metrics, selectedId, onSelect, variant }: MetricPickerProps) {
  const { t } = useTranslation()
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
            <span className="help">
              {m.min} – {m.max}
              {m.unit ? ` ${m.unit}` : ''}
            </span>
          </span>
          <span className="scale-mini wide" style={{ background: gradientCss(m.color_scale) }} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
