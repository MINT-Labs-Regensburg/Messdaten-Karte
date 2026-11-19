// Zeitbereich der Karte: Teil der URL (teilbar) und der API-Abfragen.

export type Preset = '1h' | 'day' | 'week' | 'all' | 'custom'
export const PRESETS: Preset[] = ['1h', 'day', 'week', 'all']

const DURATION: Record<string, number> = {
  '1h': 3600_000,
  day: 24 * 3600_000,
  week: 7 * 24 * 3600_000,
}

export interface ParsedRange {
  preset: Preset
  customFrom?: Date
  customTo?: Date
}

export interface ResolvedRange {
  from?: Date
  to?: Date
}

export function snapToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000)
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Liest den Zeitbereich aus den URL-Parametern `r`, `from`, `to`. */
export function parseRange(params: URLSearchParams): ParsedRange {
  const customFrom = parseDate(params.get('from'))
  const customTo = parseDate(params.get('to'))
  if (customFrom || customTo) return { preset: 'custom', customFrom, customTo }
  const preset = params.get('r')
  return { preset: PRESETS.includes(preset as Preset) ? (preset as Preset) : 'all' }
}

/** Schreibt den Zeitbereich in eine Kopie der Parameter (Standard „alles“ bleibt weg). */
export function applyRange(params: URLSearchParams, range: ParsedRange): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete('r')
  next.delete('from')
  next.delete('to')
  if (range.preset === 'custom') {
    if (range.customFrom) next.set('from', range.customFrom.toISOString())
    if (range.customTo) next.set('to', range.customTo.toISOString())
  } else if (range.preset !== 'all') {
    next.set('r', range.preset)
  }
  return next
}

/** Wandelt Voreinstellungen (relativ zu `now`) in konkrete Grenzen um. */
export function resolveRange(range: ParsedRange, now: Date): ResolvedRange {
  if (range.preset === 'custom') return { from: range.customFrom, to: range.customTo }
  if (range.preset === 'all') return {}
  return { from: new Date(snapToMinute(now).getTime() - DURATION[range.preset]) }
}

/** `datetime-local`-Wert (lokale Zeit) aus einem Datum. */
export function toLocalInput(date: Date | undefined): string {
  if (!date) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromLocalInput(value: string): Date | undefined {
  return parseDate(value)
}

export const iso = (date: Date | undefined): string | undefined => date?.toISOString()

/** Fenster beim Abspielen: ein Sechstel des Bereichs, mindestens fünf Minuten. */
export function replayWindowMs(from: Date, to: Date): number {
  return Math.max(5 * 60_000, (to.getTime() - from.getTime()) / 6)
}
