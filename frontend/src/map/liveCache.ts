import type { QueryClient } from '@tanstack/react-query'

import type { LiveEvent, Measurement } from '../api/types'

type MeasurementKey = readonly ['measurements', string, string | undefined, string | undefined, boolean]

export function inRange(m: Measurement, from?: string, to?: string): boolean {
  const t = Date.parse(m.measured_at)
  if (from && t < Date.parse(from)) return false
  if (to && t >= Date.parse(to)) return false
  return true
}

const byTime = (a: Measurement, b: Measurement) => Date.parse(a.measured_at) - Date.parse(b.measured_at)

/**
 * Überträgt ein Live-Ereignis in die gecachten Messungslisten (jeweils für ihren Zeitbereich):
 * Neue Messungen erscheinen nur, wenn sie in den gewählten Zeitbereich fallen.
 */
export function applyMeasurementEvent(qc: QueryClient, projectId: string, event: LiveEvent): void {
  if (!event.type.startsWith('measurement.')) return
  for (const query of qc.getQueryCache().findAll({ queryKey: ['measurements', projectId] })) {
    const [, , from, to, includeHidden] = query.queryKey as unknown as MeasurementKey
    qc.setQueryData<Measurement[]>(query.queryKey, (old) => {
      if (!old) return old
      switch (event.type) {
        case 'measurement.created':
        case 'measurement.updated': {
          const m = event.measurement
          const rest = old.filter((x) => x.id !== m.id)
          if (!inRange(m, from, to) || (m.hidden && !includeHidden)) return rest
          return [...rest, m].sort(byTime)
        }
        case 'measurement.hidden':
          return includeHidden
            ? old.map((x) => (x.id === event.measurement_id ? { ...x, hidden: true } : x))
            : old.filter((x) => x.id !== event.measurement_id)
        case 'measurement.deleted':
          return old.filter((x) => x.id !== event.measurement_id)
        default:
          return old
      }
    })
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Heatmaps nach Änderungen höchstens alle paar Sekunden neu anfordern (entprellt). */
export function scheduleHeatmapRefresh(qc: QueryClient, projectId: string, delayMs = 1500): void {
  if (timers.has(projectId)) return
  timers.set(
    projectId,
    setTimeout(() => {
      timers.delete(projectId)
      void qc.invalidateQueries({ queryKey: ['heatmap', projectId] })
    }, delayMs),
  )
}
