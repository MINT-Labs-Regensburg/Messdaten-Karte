import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ColorScale, Metric, MetricInput, MetricType } from '../api/types'
import { COLOR_PRESETS, gradientCss, presetIdOf } from '../lib/colorScales'
import { parseDecimal } from '../lib/format'
import { Dialog } from './Dialog'

/** Vorlagen für neue Messgrößen (Name wird beim Hinzufügen übersetzt). */
export const METRIC_TEMPLATES: { id: string; unit: string | null; type: MetricType; min: number; max: number; preset: string }[] = [
  { id: 'temperature', unit: '°C', type: 'number', min: -30, max: 50, preset: 'earth_sky' },
  { id: 'humidity', unit: '%', type: 'number', min: 0, max: 100, preset: 'forest' },
  { id: 'particulates', unit: 'µg/m³', type: 'number', min: 0, max: 500, preset: 'plasma' },
  { id: 'wellbeing', unit: null, type: 'scale', min: 1, max: 10, preset: 'viridis' },
]

export function presetScale(id: string): ColorScale {
  return (COLOR_PRESETS.find((p) => p.id === id) ?? COLOR_PRESETS[0]).scale
}

interface MetricDialogProps {
  /** Vorhandene Messgröße (Typ ist dann fest); ohne: neue anlegen */
  metric?: Metric
  onSave: (value: MetricInput) => void
  onClose: () => void
  busy?: boolean
  error?: string | null
}

export function MetricDialog({ metric, onSave, onClose, busy, error }: MetricDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(metric?.name ?? '')
  const [unit, setUnit] = useState(metric?.unit ?? '')
  const [type, setType] = useState<MetricType>(metric?.type ?? 'number')
  const [min, setMin] = useState(metric ? String(metric.min) : '0')
  const [max, setMax] = useState(metric ? String(metric.max) : '100')
  const [preset, setPreset] = useState(metric ? presetIdOf(metric.color_scale) : 'earth_sky')
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = () => {
    const lo = parseDecimal(min)
    const hi = parseDecimal(max)
    if (!name.trim()) return setLocalError(t('metrics.err_name'))
    if (lo === null || hi === null || Number.isNaN(lo) || Number.isNaN(hi)) return setLocalError(t('metrics.err_bounds'))
    if (lo >= hi) return setLocalError(t('metrics.err_order'))
    if (type === 'scale' && (!Number.isInteger(lo) || !Number.isInteger(hi))) return setLocalError(t('metrics.err_integer'))
    setLocalError(null)
    const keepCustom = metric && preset === 'custom' ? metric.color_scale : presetScale(preset)
    onSave({ name: name.trim(), unit: unit.trim() || null, type, min: lo, max: hi, color_scale: keepCustom })
  }

  const previewScale = metric && preset === 'custom' ? metric.color_scale : presetScale(preset)

  return (
    <Dialog
      title={metric ? t('metrics.edit_title') : t('metrics.add_title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span>{t('metrics.name')}</span>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>{t('metrics.unit')}</span>
            <input className="input" value={unit} maxLength={16} onChange={(e) => setUnit(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('metrics.type')}</span>
            <select
              className="input"
              value={type}
              disabled={!!metric}
              onChange={(e) => setType(e.target.value as MetricType)}
            >
              <option value="number">{t('metrics.type_number')}</option>
              <option value="scale">{t('metrics.type_scale')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('metrics.min')}</span>
            <input className="input" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('metrics.max')}</span>
            <input className="input" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
          </label>
        </div>
        <p className="help">{t('metrics.bounds_help')}</p>
        <label className="field">
          <span>{t('metrics.scale')}</span>
          <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {metric && presetIdOf(metric.color_scale) === 'custom' && <option value="custom">{t('metrics.preset_custom')}</option>}
            {COLOR_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {t(`metrics.preset_${p.id}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="scale-preview" style={{ background: gradientCss(previewScale) }} aria-hidden="true" />
        {(localError || error) && (
          <p className="error-text" role="alert">
            {localError ?? error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
