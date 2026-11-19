import type { TFunction } from 'i18next'

import { ApiError } from '../api/client'

/** Übersetzt einen API-Fehler anhand seines Codes (Schlüssel `errors.<code>`). */
export function errorMessage(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'rate_limited' && error.retryAfter) {
      return t('errors.rate_limited_after', { seconds: error.retryAfter })
    }
    return t(`errors.${error.code}`, { defaultValue: t('errors.unknown') })
  }
  return t('errors.unknown')
}

/** Übersetzter Fehlertext zu einem Feld (aus `details`), falls vorhanden. */
export function fieldError(error: unknown, field: string): string | null {
  if (!(error instanceof ApiError)) return null
  return error.details.find((d) => d.field === field || d.field?.startsWith(`${field}.`))?.code ?? null
}
