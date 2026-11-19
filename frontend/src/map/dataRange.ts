import type { Measurement, Metric } from '../api/types'

export interface Range {
  min: number
  max: number
}

/**
 * Kleinster und größter Messwert je Messgröße im gewählten Zeitbereich. Daraus entsteht die Farbskala
 * dynamisch (statt aus den Plausibilitätsgrenzen der Messgröße); ausgeblendete Messungen zählen nicht.
 */
export function valueRanges(measurements: Measurement[], metrics: Metric[]): Record<string, Range | null> {
  const ranges: Record<string, Range | null> = Object.fromEntries(metrics.map((m) => [m.id, null]))
  for (const measurement of measurements) {
    if (measurement.hidden) continue
    for (const { metric_id, value } of measurement.values) {
      if (!(metric_id in ranges)) continue
      const range = ranges[metric_id]
      if (range === null) ranges[metric_id] = { min: value, max: value }
      else {
        if (value < range.min) range.min = value
        if (value > range.max) range.max = value
      }
    }
  }
  return ranges
}
