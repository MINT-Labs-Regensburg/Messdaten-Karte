import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ParsedRange } from '../lib/time'
import { TimeControls } from './TimeControls'
import type { Replay } from './useReplay'

function replayStub(overrides: Partial<Replay> = {}): Replay {
  return {
    position: null,
    playing: false,
    mode: 'window',
    setMode: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    fraction: 1,
    effective: null,
    ...overrides,
  }
}

function setup(range: ParsedRange, replay = replayStub(), replayEnabled = true) {
  const onChange = vi.fn()
  render(
    <TimeControls
      range={range}
      resolved={{ from: range.customFrom, to: range.customTo }}
      onChange={onChange}
      replay={replay}
      replayEnabled={replayEnabled}
      spanTo={new Date('2026-03-01T12:00:00Z')}
    />,
  )
  return { onChange, replay }
}

describe('Zeitbereich wählen', () => {
  it('Schnellwahl meldet die Voreinstellung', async () => {
    const { onChange } = setup({ preset: 'day' })
    expect(screen.getByRole('button', { name: 'Tag' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Woche' }))
    expect(onChange).toHaveBeenCalledWith({ preset: 'week' })
    await userEvent.click(screen.getByRole('button', { name: 'Alles' }))
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'all' })
  })

  it('„Eigener“ startet mit einem sinnvollen Zeitraum', async () => {
    const { onChange } = setup({ preset: 'day' })
    await userEvent.click(screen.getByRole('button', { name: 'Eigener' }))
    const arg = onChange.mock.calls[0][0] as ParsedRange
    expect(arg.preset).toBe('custom')
    expect(arg.customFrom).toBeInstanceOf(Date)
  })

  it('benutzerdefinierte Grenzen werden eingelesen und weitergegeben', () => {
    const from = new Date(2026, 2, 1, 8, 0)
    const { onChange } = setup({ preset: 'custom', customFrom: from })
    expect(screen.getByLabelText('Von')).toHaveValue('2026-03-01T08:00')
    fireEvent.change(screen.getByLabelText('Bis'), { target: { value: '2026-03-01T14:30' } })
    const arg = onChange.mock.calls[0][0] as ParsedRange
    expect(arg).toMatchObject({ preset: 'custom', customFrom: from })
    expect(arg.customTo?.getTime()).toBe(new Date(2026, 2, 1, 14, 30).getTime())
  })

  it('zeigt Replay-Bedienung und gibt Aktionen weiter', async () => {
    const { replay } = setup({ preset: 'all' })
    await userEvent.click(screen.getByRole('button', { name: 'Verlauf abspielen' }))
    expect(replay.play).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Kumulativ' }))
    expect(replay.setMode).toHaveBeenCalledWith('cumulative')
    fireEvent.change(screen.getByRole('slider', { name: 'Zeitpunkt im Verlauf' }), { target: { value: '250' } })
    expect(replay.seek).toHaveBeenCalledWith(0.25)
  })

  it('während der Wiedergabe gibt es „Pause“', async () => {
    const { replay } = setup({ preset: 'all' }, replayStub({ playing: true, position: 1, fraction: 0.4 }))
    await userEvent.click(screen.getByRole('button', { name: 'Wiedergabe anhalten' }))
    expect(replay.pause).toHaveBeenCalled()
  })

  it('ohne genug Daten ist das Replay deaktiviert', () => {
    setup({ preset: 'all' }, replayStub(), false)
    expect(screen.getByRole('button', { name: 'Verlauf abspielen' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Kumulativ' })).not.toBeInTheDocument()
  })
})
