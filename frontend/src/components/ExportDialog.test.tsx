import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { projectFixture } from '../test/utils'
import { ExportDialog } from './ExportDialog'

const project = projectFixture()

function setup() {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path: String(input), body: JSON.parse(String(init?.body)) })
      return new Response('x', {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="testgebiet.png"' },
      })
    }),
  )
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ExportDialog project={project} canModerate={false} defaultMetricId="m-temp" onClose={onClose} />
    </QueryClientProvider>,
  )
  return { calls, onClose, user: userEvent.setup() }
}

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Export', () => {
  it('Bilder enthalten standardmäßig die Straßenkarte', async () => {
    const { calls, user, onClose } = setup()
    await user.selectOptions(screen.getByLabelText('Format'), 'png')
    expect(screen.getByLabelText('Hintergrundkarte')).toHaveValue('osm')
    await user.click(screen.getByRole('button', { name: 'Herunterladen' }))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls[0].path).toBe('/api/projects/p1/exports')
    expect(calls[0].body).toMatchObject({
      format: 'png',
      image: { metric_id: 'm-temp', basemap: 'osm', width_px: 1600, height_px: 1600 },
    })
  })

  it('Satellit und „ohne Karte“ lassen sich wählen', async () => {
    const { calls, user, onClose } = setup()
    await user.selectOptions(screen.getByLabelText('Format'), 'jpeg')
    await user.selectOptions(screen.getByLabelText('Hintergrundkarte'), 'satellite')
    await user.click(screen.getByRole('button', { name: 'Herunterladen' }))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls[0].body).toMatchObject({ format: 'jpeg', image: { basemap: 'satellite' } })
  })

  it('SVG kennt keine Hintergrundkarte und sendet immer „none“', async () => {
    const { calls, user, onClose } = setup()
    await user.selectOptions(screen.getByLabelText('Format'), 'svg')
    expect(screen.queryByLabelText('Hintergrundkarte')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Herunterladen' }))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls[0].body).toMatchObject({ format: 'svg', image: { basemap: 'none' } })
  })

  it('CSV hat keine Bildoptionen', async () => {
    const { calls, user, onClose } = setup()
    expect(screen.queryByLabelText('Hintergrundkarte')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Herunterladen' }))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls[0].body).toMatchObject({ format: 'csv' })
    expect(calls[0].body.image).toBeUndefined()
  })
})
