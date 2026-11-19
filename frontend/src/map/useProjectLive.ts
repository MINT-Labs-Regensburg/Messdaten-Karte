import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { LiveEvent } from '../api/types'
import { applyMeasurementEvent, scheduleHeatmapRefresh } from './liveCache'

export type LiveStatus = 'connecting' | 'live' | 'offline'

const MAX_BACKOFF_MS = 15_000
const PING_MS = 30_000

/** WebSocket-Kanal des Projekts mit automatischem Wiederverbinden und Nachladen. */
export function useProjectLive(projectId: string | undefined): LiveStatus {
  const qc = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>('connecting')

  useEffect(() => {
    if (!projectId || typeof WebSocket === 'undefined') return
    let socket: WebSocket | null = null
    let closed = false
    let attempt = 0
    let hadConnection = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pingTimer: ReturnType<typeof setInterval> | undefined

    const connect = () => {
      setStatus('connecting')
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${scheme}://${location.host}/api/projects/${projectId}/ws`)

      socket.onopen = () => {
        attempt = 0
        setStatus('live')
        if (hadConnection) {
          // Nach einem Verbindungsabbruch alles nachladen, was verpasst wurde
          void qc.invalidateQueries({ queryKey: ['measurements', projectId] })
          void qc.invalidateQueries({ queryKey: ['heatmap', projectId] })
          void qc.invalidateQueries({ queryKey: ['project'] })
        }
        hadConnection = true
        pingTimer = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send('ping'), PING_MS)
      }

      socket.onmessage = (message) => {
        let event: LiveEvent
        try {
          event = JSON.parse(String(message.data)) as LiveEvent
        } catch {
          return
        }
        if (event.type.startsWith('measurement.')) {
          applyMeasurementEvent(qc, projectId, event)
          scheduleHeatmapRefresh(qc, projectId)
        } else {
          void qc.invalidateQueries({ queryKey: ['project'] })
          void qc.invalidateQueries({ queryKey: ['heatmap', projectId] })
        }
      }

      socket.onclose = (event) => {
        clearInterval(pingTimer)
        if (closed) return
        setStatus('offline')
        if (event.code === 1008) {
          // Zugriff entzogen (z. B. Projekt nicht mehr öffentlich): Projekt neu laden, nicht erneut verbinden
          void qc.invalidateQueries({ queryKey: ['project'] })
          return
        }
        attempt += 1
        retryTimer = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 4)))
      }
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retryTimer)
      clearInterval(pingTimer)
      socket?.close()
    }
  }, [projectId, qc])

  return status
}
