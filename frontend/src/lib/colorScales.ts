import type { ColorScale, ColorStop } from '../api/types'

// Annäherungen der benannten Skalen der API (siehe openapi.yaml, ColorScale)
const NAMED: Record<string, ColorStop[]> = {
  viridis: stops(['#440154', '#3B528B', '#21908C', '#5DC863', '#FDE725']),
  plasma: stops(['#0D0887', '#7E03A8', '#CC4678', '#F89441', '#F0F921']),
  coolwarm: stops(['#3B4CC0', '#8DB0FE', '#DDDDDD', '#F4987A', '#B40426']),
  rdylgn: stops(['#A50026', '#F46D43', '#FFFFBF', '#A6D96A', '#006837']),
  rdylgn_r: stops(['#006837', '#A6D96A', '#FFFFBF', '#F46D43', '#A50026']),
}

function stops(colors: string[]): ColorStop[] {
  return colors.map((color, i) => ({ at: i / (colors.length - 1), color }))
}

export interface ColorPreset {
  id: string
  scale: ColorScale
}

/** Auswahl im Formular. „Erde–Himmel“ und „Wald“ sind `custom`-Skalen (siehe Design-Konzept). */
export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'earth_sky',
    scale: {
      name: 'custom',
      stops: [
        { at: 0, color: '#2F6F9F' },
        { at: 0.25, color: '#8FB7CF' },
        { at: 0.5, color: '#EFEBD9' },
        { at: 0.75, color: '#F0B36A' },
        { at: 1, color: '#C8501E' },
      ],
    },
  },
  {
    id: 'forest',
    scale: {
      name: 'custom',
      stops: [
        { at: 0, color: '#F0EFD8' },
        { at: 0.35, color: '#A9C98B' },
        { at: 0.7, color: '#4E8F5C' },
        { at: 1, color: '#1E4A35' },
      ],
    },
  },
  { id: 'viridis', scale: { name: 'viridis' } },
  { id: 'plasma', scale: { name: 'plasma' } },
  { id: 'coolwarm', scale: { name: 'coolwarm' } },
  { id: 'rdylgn', scale: { name: 'rdylgn' } },
  { id: 'rdylgn_r', scale: { name: 'rdylgn_r' } },
]

export function presetIdOf(scale: ColorScale): string {
  if (scale.name !== 'custom') return scale.name
  const key = JSON.stringify(scale.stops)
  return COLOR_PRESETS.find((p) => JSON.stringify(p.scale.stops) === key)?.id ?? 'custom'
}

export function stopsFor(scale: ColorScale): ColorStop[] {
  const list = scale.name === 'custom' ? scale.stops : NAMED[scale.name]
  const usable = list && list.length >= 2 ? list : NAMED.viridis
  return [...usable].sort((a, b) => a.at - b.at)
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Farbe der Skala an Position t (0..1) als [r, g, b]. */
export function rgbAt(scale: ColorScale, t: number): [number, number, number] {
  const list = stopsFor(scale)
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
  if (x <= list[0].at) return hexToRgb(list[0].color)
  for (let i = 1; i < list.length; i += 1) {
    if (x <= list[i].at) {
      const a = list[i - 1]
      const b = list[i]
      const f = (x - a.at) / (b.at - a.at || 1)
      const ca = hexToRgb(a.color)
      const cb = hexToRgb(b.color)
      return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * f)) as [number, number, number]
    }
  }
  return hexToRgb(list[list.length - 1].color)
}

export function colorAt(scale: ColorScale, t: number): string {
  const [r, g, b] = rgbAt(scale, t)
  return `rgb(${r}, ${g}, ${b})`
}

export function gradientCss(scale: ColorScale): string {
  const parts = stopsFor(scale).map((s) => `${s.color} ${Math.round(s.at * 100)}%`)
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

/** Normiert einen Messwert auf 0..1 innerhalb von [min, max]; sind alle Werte gleich, gilt die Skalenmitte. */
export function normalize(value: number, min: number, max: number): number {
  return max > min ? (value - min) / (max - min) : 0.5
}
