import { describe, expect, it } from 'vitest'

import { COLOR_PRESETS, colorAt, gradientCss, normalize, presetIdOf, rgbAt, stopsFor } from './colorScales'
import { parseDecimal } from './format'
import { haversineM, inCircle } from './geo'
import { forgetEditToken, getEditToken, isOwn, readJson, rememberOwn, saveEditToken } from './storage'

describe('Farbskalen', () => {
  it('liefern an den Enden die Randfarben und dazwischen Mischfarben', () => {
    expect(rgbAt({ name: 'viridis' }, 0)).toEqual([68, 1, 84])
    expect(rgbAt({ name: 'viridis' }, 1)).toEqual([253, 231, 37])
    const custom = { name: 'custom' as const, stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }] }
    expect(rgbAt(custom, 0.5)).toEqual([128, 128, 128])
    expect(colorAt(custom, 0.25)).toBe('rgb(64, 64, 64)')
  })

  it('begrenzen Werte außerhalb von 0..1 und fangen NaN ab', () => {
    expect(rgbAt({ name: 'plasma' }, -5)).toEqual(rgbAt({ name: 'plasma' }, 0))
    expect(rgbAt({ name: 'plasma' }, 7)).toEqual(rgbAt({ name: 'plasma' }, 1))
    expect(rgbAt({ name: 'plasma' }, Number.NaN)).toEqual(rgbAt({ name: 'plasma' }, 0))
  })

  it('eine unbrauchbare eigene Skala fällt auf Viridis zurück', () => {
    expect(stopsFor({ name: 'custom', stops: [{ at: 0, color: '#123456' }] })).toEqual(stopsFor({ name: 'viridis' }))
  })

  it('rdylgn_r ist die Umkehrung von rdylgn', () => {
    expect(rgbAt({ name: 'rdylgn_r' }, 0)).toEqual(rgbAt({ name: 'rdylgn' }, 1))
  })

  it('erzeugt einen CSS-Verlauf und erkennt die Voreinstellungen wieder', () => {
    expect(gradientCss({ name: 'viridis' })).toMatch(/^linear-gradient\(90deg, #440154 0%.*#FDE725 100%\)$/)
    for (const preset of COLOR_PRESETS) expect(presetIdOf(preset.scale)).toBe(preset.id)
    expect(presetIdOf({ name: 'custom', stops: [{ at: 0, color: '#111111' }, { at: 1, color: '#222222' }] })).toBe('custom')
  })

  it('normalisiert Werte auf den Bereich der Messgröße', () => {
    expect(normalize(10, -30, 50)).toBe(0.5)
    expect(normalize(5, 5, 5)).toBe(0)
  })
})

describe('Zahlen', () => {
  it('liest Dezimalkomma und -punkt, leer und Unsinn', () => {
    expect(parseDecimal('21,4')).toBe(21.4)
    expect(parseDecimal(' -3.5 ')).toBe(-3.5)
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('   ')).toBeNull()
    expect(parseDecimal('1e3')).toBeNaN()
    expect(parseDecimal('abc')).toBeNaN()
    expect(parseDecimal('1,2,3')).toBeNaN()
  })
})

describe('Geometrie', () => {
  it('berechnet Entfernungen und prüft den Kreis (Rand inklusive)', () => {
    const d = haversineM(49, 12, 49.001, 12)
    expect(d).toBeCloseTo(111.19, 1)
    expect(inCircle({ lat: 49.001, lon: 12 }, { lat: 49, lon: 12 }, d)).toBe(true)
    expect(inCircle({ lat: 49.001, lon: 12 }, { lat: 49, lon: 12 }, d - 0.01)).toBe(false)
  })
})

describe('Browser-Speicher', () => {
  it('Edit-Token gilt nur im Änderungsfenster und wird danach vergessen', () => {
    saveEditToken('m1', 'tok', '2026-03-01T12:15:00Z')
    expect(getEditToken('m1', new Date('2026-03-01T12:14:59Z'))).toBe('tok')
    expect(getEditToken('m1', new Date('2026-03-01T12:15:00Z'))).toBeNull()
    expect(localStorage.getItem('mdk.edit.m1')).toBeNull()
  })

  it('Edit-Token ohne Ablauf bleibt gültig, bis er vergessen wird', () => {
    saveEditToken('m2', 'tok2', null)
    expect(getEditToken('m2')).toBe('tok2')
    forgetEditToken('m2')
    expect(getEditToken('m2')).toBeNull()
  })

  it('merkt sich eigene Messungen', () => {
    expect(isOwn('x')).toBe(false)
    rememberOwn('x')
    rememberOwn('x')
    expect(isOwn('x')).toBe(true)
    expect(readJson<string[]>('mdk.own', [])).toEqual(['x'])
  })

  it('kaputte Speicherinhalte führen zum Standardwert', () => {
    localStorage.setItem('mdk.broken', '{nicht json')
    expect(readJson('mdk.broken', 'fallback')).toBe('fallback')
  })
})
