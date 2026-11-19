import { describe, expect, it } from 'vitest'

import type { Measurement } from '../api/types'
import { projectFixture } from '../test/utils'
import { valueRanges } from './dataRange'

const metrics = projectFixture().metrics

function m(id: string, values: [string, number][], hidden = false): Measurement {
  return {
    id,
    lat: 49,
    lon: 12,
    measured_at: '2026-03-01T12:00:00Z',
    values: values.map(([metric_id, value]) => ({ metric_id, value })),
    author_name: null,
    note: null,
    source: 'anonymous',
    hidden,
  }
}

describe('Farbskala aus den Daten', () => {
  it('nimmt je Messgröße den kleinsten und größten vorhandenen Wert', () => {
    const ranges = valueRanges(
      [m('a', [['m-temp', 12.1]]), m('b', [['m-temp', 24.8], ['m-mood', 3]]), m('c', [['m-temp', 18]])],
      metrics,
    )
    expect(ranges['m-temp']).toEqual({ min: 12.1, max: 24.8 }) // nicht −30 … 50 wie die Plausibilitätsgrenzen
    expect(ranges['m-mood']).toEqual({ min: 3, max: 3 })
  })

  it('Messgrößen ohne Werte haben keinen Bereich', () => {
    expect(valueRanges([], metrics)).toEqual({ 'm-temp': null, 'm-mood': null })
    expect(valueRanges([m('a', [['m-temp', 5]])], metrics)['m-mood']).toBeNull()
  })

  it('ausgeblendete Messungen und unbekannte Messgrößen zählen nicht', () => {
    const ranges = valueRanges(
      [m('a', [['m-temp', 20]]), m('h', [['m-temp', 45]], true), m('x', [['fremd', 99]])],
      metrics,
    )
    expect(ranges['m-temp']).toEqual({ min: 20, max: 20 })
    expect(ranges).not.toHaveProperty('fremd')
  })

  it('ändert die übergebenen Messungen nicht', () => {
    const list = [m('a', [['m-temp', 1]]), m('b', [['m-temp', 2]])]
    const before = JSON.stringify(list)
    valueRanges(list, metrics)
    expect(JSON.stringify(list)).toBe(before)
  })
})
