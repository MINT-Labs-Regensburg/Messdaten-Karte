import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [prefix + key] : flatten(value, `${prefix}${key}.`),
  )
}

const deKeys = new Set(flatten(de as Tree))
const enKeys = new Set(flatten(en as Tree))

// Quelltexte aller Komponenten (Vite lädt sie als Rohtext)
const sources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Prüft einen Schlüssel einschließlich Plural-Endungen von i18next. */
const has = (keys: Set<string>, key: string) => keys.has(key) || keys.has(`${key}_one`) || keys.has(`${key}_other`)

describe('Übersetzungen', () => {
  it('Deutsch und Englisch haben genau dieselben Schlüssel', () => {
    expect([...deKeys].filter((k) => !enKeys.has(k))).toEqual([])
    expect([...enKeys].filter((k) => !deKeys.has(k))).toEqual([])
  })

  it('jeder im Code verwendete Schlüssel existiert in beiden Sprachen', () => {
    const used = new Set<string>()
    for (const [file, source] of Object.entries(sources)) {
      if (file.includes('.test.')) continue
      for (const match of source.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) used.add(match[1])
    }
    expect(used.size).toBeGreaterThan(100)
    expect([...used].filter((k) => !has(deKeys, k))).toEqual([])
    expect([...used].filter((k) => !has(enKeys, k))).toEqual([])
  })

  it('Schlüssel, die zur Laufzeit zusammengesetzt werden, sind vollständig vorhanden', () => {
    const dynamic = [
      ...['mine', 'public', 'all'].map((s) => `projects.scope_${s}`),
      ...['1h', 'day', 'week', 'all', 'custom'].map((p) => `time.preset_${p}`),
      ...['1h', 'day', 'week', 'all'].map((p) => `time.summary_${p}`),
      ...['csv', 'geojson', 'svg', 'png', 'jpeg'].map((f) => `export.format_${f}`),
      ...['anonymous', 'user', 'api_token'].map((s) => `card.source_${s}`),
      ...['connecting', 'live', 'offline'].map((s) => `map.live_${s}`),
      ...['earth_sky', 'forest', 'viridis', 'plasma', 'coolwarm', 'rdylgn', 'rdylgn_r', 'custom'].map((p) => `metrics.preset_${p}`),
      ...['temperature', 'humidity', 'particulates', 'wellbeing'].map((p) => `metrics.template_${p}`),
      ...['number', 'scale'].map((p) => `metrics.type_${p}`),
      ...['owner', 'editor'].map((r) => `roles.${r}`),
      ...['de', 'en'].map((l) => `nav.language_${l}`),
      'map.geo_denied',
      'map.geo_failed',
    ]
    expect(dynamic.filter((k) => !deKeys.has(k) || !enKeys.has(k))).toEqual([])
  })

  it('jeder Fehlercode des Backends hat eine Übersetzung', () => {
    const codes = [
      'unauthorized', 'invalid_credentials', 'account_disabled', 'forbidden', 'csrf_failed', 'insufficient_scope',
      'token_project_restricted', 'token_project_mismatch', 'session_required', 'invalid_token', 'registration_disabled',
      'username_taken', 'project_not_found', 'not_found', 'project_archived', 'project_not_editable',
      'measurement_limit_reached', 'measurement_not_found', 'point_outside_circle', 'value_out_of_range',
      'value_not_integer', 'unknown_metric', 'duplicate_metric', 'measured_at_not_allowed', 'measured_at_in_future',
      'edit_window_expired', 'hide_not_allowed', 'slug_taken', 'invalid_slug', 'radius_too_large',
      'measurements_outside_circle', 'metric_name_taken', 'metric_not_found', 'values_out_of_range', 'invalid_range',
      'last_owner', 'last_admin', 'already_member', 'user_not_found', 'member_not_found', 'token_not_found',
      'expires_in_past', 'unknown_project', 'invalid_time_range', 'invalid_cursor', 'format_not_supported',
      'basemap_not_supported', 'heatmap_failed', 'rate_limited', 'validation_error', 'network_error',
    ]
    expect(codes.filter((c) => !deKeys.has(`errors.${c}`))).toEqual([])
  })
})
