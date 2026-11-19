import { describe, expect, it } from 'vitest'

import { applyRange, parseRange, replayWindowMs, resolveRange, snapToMinute, toLocalInput } from './time'

const NOW = new Date('2026-03-01T12:34:56Z')

describe('Zeitbereich in der URL', () => {
  it('Standard ist „alles“ und bleibt unsichtbar in der URL', () => {
    expect(parseRange(new URLSearchParams(''))).toEqual({ preset: 'all' })
    expect(applyRange(new URLSearchParams('m=abc'), { preset: 'all' }).toString()).toBe('m=abc')
  })

  it('Voreinstellungen werden als r=… geschrieben und gelesen', () => {
    const params = applyRange(new URLSearchParams('m=abc'), { preset: 'week' })
    expect(params.get('r')).toBe('week')
    expect(params.get('m')).toBe('abc') // andere Parameter bleiben
    expect(parseRange(params)).toEqual({ preset: 'week' })
  })

  it('eigene Grenzen werden als ISO-Zeit geschrieben und wieder gelesen', () => {
    const from = new Date('2026-02-01T08:00:00Z')
    const to = new Date('2026-02-02T08:00:00Z')
    const params = applyRange(new URLSearchParams('r=day'), { preset: 'custom', customFrom: from, customTo: to })
    expect(params.get('r')).toBeNull()
    expect(params.get('from')).toBe('2026-02-01T08:00:00.000Z')
    const parsed = parseRange(params)
    expect(parsed.preset).toBe('custom')
    expect(parsed.customFrom?.getTime()).toBe(from.getTime())
    expect(parsed.customTo?.getTime()).toBe(to.getTime())
  })

  it('ignoriert ungültige Angaben', () => {
    expect(parseRange(new URLSearchParams('r=jahr'))).toEqual({ preset: 'all' })
    expect(parseRange(new URLSearchParams('from=gestern'))).toEqual({ preset: 'all' })
  })
})

describe('Zeitbereich auflösen', () => {
  it('relative Voreinstellungen reichen bis jetzt (offenes Ende), auf die Minute gerundet', () => {
    const day = resolveRange({ preset: 'day' }, NOW)
    expect(day.to).toBeUndefined()
    expect(day.from?.toISOString()).toBe('2026-02-28T12:34:00.000Z')
    expect(resolveRange({ preset: '1h' }, NOW).from?.toISOString()).toBe('2026-03-01T11:34:00.000Z')
    expect(resolveRange({ preset: 'week' }, NOW).from?.toISOString()).toBe('2026-02-22T12:34:00.000Z')
  })

  it('„alles“ hat keine Grenzen, eigene Grenzen bleiben unverändert', () => {
    expect(resolveRange({ preset: 'all' }, NOW)).toEqual({})
    const from = new Date('2026-01-01T00:00:00Z')
    expect(resolveRange({ preset: 'custom', customFrom: from }, NOW)).toEqual({ from, to: undefined })
  })

  it('snapToMinute entfernt Sekunden und Millisekunden', () => {
    expect(snapToMinute(NOW).toISOString()).toBe('2026-03-01T12:34:00.000Z')
  })
})

describe('Hilfen', () => {
  it('das Replay-Fenster ist ein Sechstel, mindestens fünf Minuten', () => {
    const t0 = new Date('2026-03-01T00:00:00Z')
    expect(replayWindowMs(t0, new Date('2026-03-01T06:00:00Z'))).toBe(3600_000)
    expect(replayWindowMs(t0, new Date('2026-03-01T00:10:00Z'))).toBe(5 * 60_000)
  })

  it('datetime-local-Wert in lokaler Zeit', () => {
    expect(toLocalInput(new Date(2026, 2, 1, 8, 5))).toBe('2026-03-01T08:05')
    expect(toLocalInput(undefined)).toBe('')
  })
})
