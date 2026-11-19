import { useTranslation } from 'react-i18next'

import { formatDateTime } from '../lib/format'
import { PRESETS, fromLocalInput, snapToMinute, toLocalInput, type ParsedRange, type Preset, type ResolvedRange } from '../lib/time'
import type { Replay } from './useReplay'

interface TimeControlsProps {
  range: ParsedRange
  resolved: ResolvedRange
  onChange: (range: ParsedRange) => void
  replay: Replay
  replayEnabled: boolean
  /** Ende des Bereichs für die Anzeige, wenn das Replay nicht läuft */
  spanTo?: Date
}

export function TimeControls({ range, resolved, onChange, replay, replayEnabled, spanTo }: TimeControlsProps) {
  const { t, i18n } = useTranslation()
  const presets: Preset[] = [...PRESETS, 'custom']

  const select = (preset: Preset) => {
    if (preset !== 'custom') return onChange({ preset })
    const to = range.customTo ?? resolved.to
    const from = range.customFrom ?? resolved.from ?? new Date(snapToMinute(new Date()).getTime() - 24 * 3600_000)
    onChange({ preset: 'custom', customFrom: from, customTo: to })
  }

  const summary =
    range.preset === 'custom'
      ? t('time.custom_summary', {
          from: resolved.from ? formatDateTime(resolved.from, i18n.language) : t('time.open'),
          to: resolved.to ? formatDateTime(resolved.to, i18n.language) : t('time.open'),
        })
      : t(`time.summary_${range.preset}`)

  const positionLabel =
    replay.position !== null
      ? formatDateTime(new Date(replay.position), i18n.language)
      : spanTo
        ? formatDateTime(spanTo, i18n.language)
        : ''

  return (
    <div className="time-controls stack-sm">
      <div className="between">
        <span className="lbl">{t('time.title')}</span>
        <strong className="time-summary">{summary}</strong>
      </div>

      <div className="seg-group" role="group" aria-label={t('time.title')}>
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`seg ${range.preset === preset ? 'on' : ''}`}
            aria-pressed={range.preset === preset}
            onClick={() => select(preset)}
          >
            {t(`time.preset_${preset}`)}
          </button>
        ))}
      </div>

      {range.preset === 'custom' && (
        <div className="form-grid">
          <label className="field">
            <span>{t('time.from')}</span>
            <input
              className="input"
              type="datetime-local"
              value={toLocalInput(range.customFrom)}
              onChange={(e) => onChange({ preset: 'custom', customFrom: fromLocalInput(e.target.value), customTo: range.customTo })}
            />
          </label>
          <label className="field">
            <span>{t('time.to')}</span>
            <input
              className="input"
              type="datetime-local"
              value={toLocalInput(range.customTo)}
              onChange={(e) => onChange({ preset: 'custom', customFrom: range.customFrom, customTo: fromLocalInput(e.target.value) })}
            />
          </label>
        </div>
      )}

      <div className="replay-row">
        <button
          type="button"
          className="iconbtn iconbtn-soft"
          disabled={!replayEnabled}
          aria-label={replay.playing ? t('time.pause') : t('time.play')}
          onClick={replay.playing ? replay.pause : replay.play}
        >
          {replay.playing ? (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <input
          type="range"
          className="range"
          min={0}
          max={1000}
          value={Math.round(replay.fraction * 1000)}
          disabled={!replayEnabled}
          aria-label={t('time.slider')}
          style={{ ['--p' as string]: `${replay.fraction * 100}%` }}
          onChange={(e) => replay.seek(Number(e.target.value) / 1000)}
        />
        <span className="replay-pos">{positionLabel}</span>
      </div>

      {replayEnabled && (
        <div className="seg-group" role="group" aria-label={t('time.replay_mode')}>
          <button
            type="button"
            className={`seg ${replay.mode === 'window' ? 'on' : ''}`}
            aria-pressed={replay.mode === 'window'}
            onClick={() => replay.setMode('window')}
          >
            {t('time.mode_window')}
          </button>
          <button
            type="button"
            className={`seg ${replay.mode === 'cumulative' ? 'on' : ''}`}
            aria-pressed={replay.mode === 'cumulative'}
            onClick={() => replay.setMode('cumulative')}
          >
            {t('time.mode_cumulative')}
          </button>
        </div>
      )}
    </div>
  )
}
