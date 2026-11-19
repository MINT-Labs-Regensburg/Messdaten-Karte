import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { projectFixture } from '../test/utils'
import { EntrySheet } from './EntrySheet'

const project = projectFixture()
const inside = { lat: 49.0134, lon: 12.1016 }
const outside = { lat: 49.03, lon: 12.1016 } // gut 1,8 km nördlich

function setup(point = inside) {
  const onSubmit = vi.fn()
  render(<EntrySheet project={project} point={point} onSubmit={onSubmit} onClose={vi.fn()} />)
  return { onSubmit, user: userEvent.setup() }
}

const save = () => screen.getByRole('button', { name: 'Messung speichern' })

describe('Messung eintragen', () => {
  it('zeigt immer alle Messgrößen des Projekts', () => {
    setup()
    expect(screen.getByRole('textbox', { name: /Temperatur/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Wohlbefinden' })).toBeInTheDocument()
  })

  it('verlangt mindestens einen Wert', async () => {
    const { onSubmit, user } = setup()
    await user.click(save())
    expect(await screen.findByRole('alert')).toHaveTextContent('Bitte trage mindestens einen Wert ein.')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('sendet nur ausgefüllte Werte und versteht das Dezimalkomma', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByRole('textbox', { name: /Temperatur/ }), '21,4')
    await user.type(screen.getByRole('textbox', { name: /Name/ }), 'Anna')
    await user.click(save())
    expect(onSubmit).toHaveBeenCalledWith({
      values: [{ metric_id: 'm-temp', value: 21.4 }],
      author_name: 'Anna',
      note: null,
    })
  })

  it('übernimmt die Skalenwerte per Knopf und lässt sie wieder abwählen', async () => {
    const { onSubmit, user } = setup()
    await user.click(screen.getByRole('button', { name: '7' }))
    expect(screen.getByRole('button', { name: '7' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '7' }))
    await user.click(save())
    expect(onSubmit).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '4' }))
    await user.click(save())
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ values: [{ metric_id: 'm-mood', value: 4 }] }),
    )
  })

  it('lehnt Werte außerhalb der Grenzen und Unsinn ab', async () => {
    const { onSubmit, user } = setup()
    const field = screen.getByRole('textbox', { name: /Temperatur/ })
    await user.type(field, '60')
    await user.click(save())
    expect(await screen.findByRole('alert')).toHaveTextContent(/„Temperatur“ muss zwischen .* und 50 liegen/)

    await user.clear(field)
    await user.type(field, 'warm')
    await user.click(save())
    expect(await screen.findByRole('alert')).toHaveTextContent('„Temperatur“ ist keine gültige Zahl.')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('das Plus beim leeren Feld beginnt in der Mitte des erlaubten Bereichs', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Temperatur erhöhen' }))
    expect(screen.getByRole('textbox', { name: /Temperatur/ })).toHaveValue('10')
    await user.click(screen.getByRole('button', { name: 'Temperatur verringern' }))
    expect(screen.getByRole('textbox', { name: /Temperatur/ })).toHaveValue('9,5')
  })

  it('blockiert Punkte außerhalb des Messgebiets', async () => {
    const { onSubmit, user } = setup(outside)
    expect(screen.getByText('Punkt außerhalb des Gebiets')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /Temperatur/ }), '20')
    await user.click(save())
    expect(await screen.findByRole('alert')).toHaveTextContent('Der Punkt liegt außerhalb des Messgebiets.')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('im Bearbeiten-Modus sind die bisherigen Werte vorbelegt', async () => {
    const onSubmit = vi.fn()
    const existing = {
      id: 'x',
      lat: inside.lat,
      lon: inside.lon,
      measured_at: '2026-01-01T12:00:00Z',
      values: [{ metric_id: 'm-temp', value: 18.5 }],
      author_name: 'Bob',
      note: 'kühl',
      source: 'anonymous' as const,
      hidden: false,
    }
    render(<EntrySheet project={project} point={inside} existing={existing} onSubmit={onSubmit} onClose={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: /Temperatur/ })).toHaveValue('18,5')
    expect(screen.getByDisplayValue('Bob')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }))
    expect(onSubmit).toHaveBeenCalledWith({
      values: [{ metric_id: 'm-temp', value: 18.5 }],
      author_name: 'Bob',
      note: 'kühl',
    })
  })
})
