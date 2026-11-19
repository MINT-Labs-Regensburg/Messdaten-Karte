import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { Measurement } from '../api/types'
import { applyMeasurementEvent, inRange } from './liveCache'

function m(id: string, at: string, hidden = false): Measurement {
  return {
    id,
    lat: 49,
    lon: 12,
    measured_at: at,
    values: [{ metric_id: 'm1', value: 1 }],
    author_name: null,
    note: null,
    source: 'anonymous',
    hidden,
  }
}

const key = (from?: string, to?: string, hidden = false) => ['measurements', 'p1', from, to, hidden] as const

function setup() {
  const qc = new QueryClient()
  const ids = (k: ReturnType<typeof key>) => qc.getQueryData<Measurement[]>(k)?.map((x) => x.id)
  return { qc, ids }
}

describe('Live-Ereignisse im Cache', () => {
  it('neue Messungen erscheinen nur im passenden Zeitbereich und bleiben sortiert', () => {
    const { qc, ids } = setup()
    qc.setQueryData(key(), [m('a', '2026-03-01T10:00:00Z'), m('c', '2026-03-01T12:00:00Z')])
    qc.setQueryData(key('2026-03-01T11:30:00Z'), [m('c', '2026-03-01T12:00:00Z')])
    qc.setQueryData(['measurements', 'p2', undefined, undefined, false], [])

    applyMeasurementEvent(qc, 'p1', { type: 'measurement.created', measurement: m('b', '2026-03-01T11:00:00Z') })

    expect(ids(key())).toEqual(['a', 'b', 'c'])
    expect(ids(key('2026-03-01T11:30:00Z'))).toEqual(['c']) // 11:00 liegt vor dem Bereich
    expect(qc.getQueryData(['measurements', 'p2', undefined, undefined, false])).toEqual([]) // anderes Projekt
  })

  it('das Ende des Zeitbereichs ist exklusiv', () => {
    expect(inRange(m('x', '2026-03-01T12:00:00Z'), undefined, '2026-03-01T12:00:00Z')).toBe(false)
    expect(inRange(m('x', '2026-03-01T12:00:00Z'), '2026-03-01T12:00:00Z', undefined)).toBe(true)
  })

  it('Änderungen ersetzen die vorhandene Messung', () => {
    const { qc } = setup()
    qc.setQueryData(key(), [m('a', '2026-03-01T10:00:00Z')])
    const changed = { ...m('a', '2026-03-01T10:00:00Z'), note: 'neu' }
    applyMeasurementEvent(qc, 'p1', { type: 'measurement.updated', measurement: changed })
    expect(qc.getQueryData<Measurement[]>(key())?.[0].note).toBe('neu')
  })

  it('Löschen entfernt die Messung überall', () => {
    const { qc, ids } = setup()
    qc.setQueryData(key(), [m('a', '2026-03-01T10:00:00Z')])
    qc.setQueryData(key(undefined, undefined, true), [m('a', '2026-03-01T10:00:00Z')])
    applyMeasurementEvent(qc, 'p1', { type: 'measurement.deleted', measurement_id: 'a' })
    expect(ids(key())).toEqual([])
    expect(ids(key(undefined, undefined, true))).toEqual([])
  })

  it('Ausblenden: verschwindet normal, bleibt (markiert) in Listen mit Ausgeblendeten', () => {
    const { qc } = setup()
    qc.setQueryData(key(), [m('a', '2026-03-01T10:00:00Z')])
    qc.setQueryData(key(undefined, undefined, true), [m('a', '2026-03-01T10:00:00Z')])
    applyMeasurementEvent(qc, 'p1', { type: 'measurement.hidden', measurement_id: 'a' })
    expect(qc.getQueryData<Measurement[]>(key())).toEqual([])
    expect(qc.getQueryData<Measurement[]>(key(undefined, undefined, true))?.[0].hidden).toBe(true)
  })

  it('eine ausgeblendete Messung taucht in normalen Listen nicht auf', () => {
    const { qc, ids } = setup()
    qc.setQueryData(key(), [])
    qc.setQueryData(key(undefined, undefined, true), [])
    applyMeasurementEvent(qc, 'p1', { type: 'measurement.updated', measurement: m('h', '2026-03-01T10:00:00Z', true) })
    expect(ids(key())).toEqual([])
    expect(ids(key(undefined, undefined, true))).toEqual(['h'])
  })

  it('ignoriert Ereignisse ohne zugehörige Liste und Nicht-Messungs-Ereignisse', () => {
    const { qc } = setup()
    expect(() =>
      applyMeasurementEvent(qc, 'p1', { type: 'measurement.created', measurement: m('a', '2026-03-01T10:00:00Z') }),
    ).not.toThrow()
    qc.setQueryData(key(), [m('a', '2026-03-01T10:00:00Z')])
    applyMeasurementEvent(qc, 'p1', { type: 'project.archived' })
    expect(qc.getQueryData<Measurement[]>(key())).toHaveLength(1)
  })
})
