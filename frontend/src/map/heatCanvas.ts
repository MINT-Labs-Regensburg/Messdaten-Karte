import type { ColorScale, Heatmap } from '../api/types'
import { normalize, rgbAt } from '../lib/colorScales'
import type { Range } from './dataRange'

/**
 * Zeichnet das Kriging-Gitter in ein kleines Canvas (eine Zelle = ein Pixel) und gibt es als
 * Data-URL zurück. Der Browser skaliert das Bild beim Darstellen weich auf Kartengröße.
 */
export function renderHeatmapDataUrl(heat: Heatmap, scale: ColorScale, range: Range | null): string | null {
  const grid = heat.grid
  const colorRange = range ?? heat.value_range
  if (heat.status !== 'ok' || !grid || !colorRange) return null
  const canvas = document.createElement('canvas')
  canvas.width = grid.cols
  canvas.height = grid.rows
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const image = ctx.createImageData(grid.cols, grid.rows)
  const { min, max } = colorRange
  grid.values.forEach((row, y) => {
    row.forEach((value, x) => {
      const offset = (y * grid.cols + x) * 4
      if (value === null) return // außerhalb des Kreises: transparent
      const [r, g, b] = rgbAt(scale, normalize(value, min, max))
      image.data[offset] = r
      image.data[offset + 1] = g
      image.data[offset + 2] = b
      image.data[offset + 3] = 255
    })
  })
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}
