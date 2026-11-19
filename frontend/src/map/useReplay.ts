import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { replayWindowMs } from '../lib/time'

export type ReplayMode = 'window' | 'cumulative'

const TICK_MS = 1000
const STEPS = 30

export interface Replay {
  /** Aktuelle Position im Bereich (ms) oder null = gesamter Bereich */
  position: number | null
  playing: boolean
  mode: ReplayMode
  setMode: (mode: ReplayMode) => void
  play: () => void
  pause: () => void
  seek: (fraction: number) => void
  /** Fraktion 0..1 der Position (1 = Ende) */
  fraction: number
  /** Effektiver Zeitbereich der Anzeige */
  effective: { from: Date; to: Date | undefined } | null
}

/**
 * Replay: Ein Fenster fester Breite gleitet über den Zeitbereich oder der Bereich wächst kumulativ.
 * Pro Sekunde ein Schritt, damit die Heatmap-Berechnung im Backend nicht überlastet wird.
 */
export function useReplay(spanFrom: Date | undefined, spanTo: Date | undefined): Replay {
  const [position, setPosition] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [mode, setMode] = useState<ReplayMode>('window')

  const from = spanFrom?.getTime()
  const to = spanTo?.getTime()
  const valid = from !== undefined && to !== undefined && to > from


  // Die Position wird zusätzlich in einem Ref geführt, damit mehrere Ticks hintereinander
  // (z. B. nach einem Tab-Wechsel) sauber aufeinander aufbauen und am Ende nicht neu starten.
  const positionRef = useRef<number | null>(null)
  const update = useCallback((value: number | null) => {
    positionRef.current = value
    setPosition(value)
  }, [])

  useEffect(() => {
    if (!playing || !valid) return
    let finished = false
    const id = setInterval(() => {
      if (finished) return
      const next = (positionRef.current ?? (from as number)) + ((to as number) - (from as number)) / STEPS
      if (next >= (to as number)) {
        finished = true
        update(null)
        setPlaying(false)
      } else {
        update(next)
      }
    }, TICK_MS)
    return () => clearInterval(id)
  }, [playing, valid, from, to, update])

  const play = useCallback(() => {
    if (!valid) return
    update(positionRef.current ?? (from as number))
    setPlaying(true)
  }, [valid, from, update])
  const pause = useCallback(() => setPlaying(false), [])
  const seek = useCallback(
    (fraction: number) => {
      if (!valid) return
      update(fraction >= 1 ? null : (from as number) + fraction * ((to as number) - (from as number)))
    },
    [valid, from, to, update],
  )

  // Neuer Zeitbereich: Wiedergabe zurücksetzen
  useEffect(() => {
    update(null)
    setPlaying(false)
  }, [from, to, update])

  const effective = useMemo(() => {
    if (!valid || position === null) return null
    const end = new Date(position)
    const start = mode === 'cumulative' ? new Date(from as number) : new Date(Math.max(from as number, position - replayWindowMs(new Date(from as number), new Date(to as number))))
    return { from: start, to: end }
  }, [valid, position, mode, from, to])

  const fraction = !valid || position === null ? 1 : (position - (from as number)) / ((to as number) - (from as number))

  return { position, playing, mode, setMode, play, pause, seek, fraction, effective }
}
