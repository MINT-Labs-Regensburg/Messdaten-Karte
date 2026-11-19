import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useReplay } from './useReplay'

const FROM = new Date('2026-03-01T00:00:00Z')
const TO = new Date('2026-03-01T06:00:00Z')
const SPAN = TO.getTime() - FROM.getTime()

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Replay', () => {
  it('startet ohne Position (ganzer Bereich sichtbar)', () => {
    const { result } = renderHook(() => useReplay(FROM, TO))
    expect(result.current.position).toBeNull()
    expect(result.current.effective).toBeNull()
    expect(result.current.fraction).toBe(1)
  })

  it('spielt pro Sekunde einen Schritt ab und endet mit dem ganzen Bereich', () => {
    const { result } = renderHook(() => useReplay(FROM, TO))
    act(() => result.current.play())
    expect(result.current.playing).toBe(true)
    expect(result.current.position).toBe(FROM.getTime())

    act(() => void vi.advanceTimersByTime(1000))
    expect(result.current.position).toBeCloseTo(FROM.getTime() + SPAN / 30)

    act(() => void vi.advanceTimersByTime(40_000))
    expect(result.current.playing).toBe(false)
    expect(result.current.position).toBeNull()
  })

  it('Fenster-Modus zeigt ein gleitendes Fenster, kumulativ alles seit dem Beginn', () => {
    const { result } = renderHook(() => useReplay(FROM, TO))
    act(() => result.current.seek(0.5))
    const middle = FROM.getTime() + SPAN / 2
    expect(result.current.effective?.to?.getTime()).toBe(middle)
    expect(result.current.effective?.from.getTime()).toBe(middle - SPAN / 6)

    act(() => result.current.setMode('cumulative'))
    expect(result.current.effective?.from.getTime()).toBe(FROM.getTime())
  })

  it('das Fenster beginnt nie vor dem Zeitbereich', () => {
    const { result } = renderHook(() => useReplay(FROM, TO))
    act(() => result.current.seek(0.05))
    expect(result.current.effective?.from.getTime()).toBe(FROM.getTime())
  })

  it('seek(1) zeigt wieder den ganzen Bereich', () => {
    const { result } = renderHook(() => useReplay(FROM, TO))
    act(() => result.current.seek(0.3))
    act(() => result.current.seek(1))
    expect(result.current.position).toBeNull()
  })

  it('ohne gültigen Bereich passiert nichts', () => {
    const { result } = renderHook(() => useReplay(undefined, undefined))
    act(() => result.current.play())
    expect(result.current.playing).toBe(false)
    act(() => result.current.seek(0.5))
    expect(result.current.position).toBeNull()
  })

  it('ein neuer Zeitbereich setzt die Wiedergabe zurück', () => {
    const { result, rerender } = renderHook(({ to }) => useReplay(FROM, to), { initialProps: { to: TO } })
    act(() => result.current.play())
    rerender({ to: new Date('2026-03-01T12:00:00Z') })
    expect(result.current.playing).toBe(false)
    expect(result.current.position).toBeNull()
  })
})
