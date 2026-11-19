import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { projectFixture } from '../test/utils'
import { Legend } from './Legend'
import { MetricPicker } from './MetricPicker'

const [temp, mood] = projectFixture().metrics

describe('Legende', () => {
  it('zeigt Minimum, Mitte und Maximum der Daten, nicht die Grenzen der Messgröße', () => {
    render(<Legend metric={temp} range={{ min: 12.1, max: 24.8 }} pointCount={26} />)
    expect(screen.getByText('12,1 °C')).toBeInTheDocument()
    expect(screen.getByText('18,45')).toBeInTheDocument()
    expect(screen.getByText('24,8 °C')).toBeInTheDocument()
    expect(screen.queryByText(/50/)).not.toBeInTheDocument() // obere Plausibilitätsgrenze
    expect(screen.getByText('26 Messungen im Zeitraum')).toBeInTheDocument()
  })

  it('bei gleichen Werten steht nur dieser eine Wert da', () => {
    render(<Legend metric={temp} range={{ min: 21, max: 21 }} pointCount={3} />)
    expect(screen.getByText('Alle Messwerte sind gleich: 21 °C')).toBeInTheDocument()
  })

  it('ohne Messwerte gibt es einen Hinweis statt einer Skala', () => {
    render(<Legend metric={mood} range={null} pointCount={0} />)
    expect(screen.getByText('Noch keine Messwerte im gewählten Zeitraum.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('weist auf zu wenige Punkte für die Heatmap hin', () => {
    render(
      <Legend
        metric={temp}
        range={{ min: 1, max: 2 }}
        pointCount={2}
        heatmap={{ status: 'insufficient_data', metric_id: temp.id }}
      />,
    )
    expect(screen.getByText(/mindestens vier verschiedene Orte/)).toBeInTheDocument()
  })
})

describe('Messgrößen-Auswahl', () => {
  it('zeigt je Messgröße den vorhandenen Wertebereich', () => {
    render(
      <MetricPicker
        variant="cards"
        metrics={[temp, mood]}
        selectedId={temp.id}
        onSelect={() => undefined}
        ranges={{ [temp.id]: { min: 12.1, max: 24.8 }, [mood.id]: null }}
      />,
    )
    expect(screen.getByText('12,1 – 24,8 °C')).toBeInTheDocument()
    expect(screen.getByText('keine Werte')).toBeInTheDocument()
  })
})
