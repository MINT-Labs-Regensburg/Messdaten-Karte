export function formatNumber(value: number, lang: string): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(value)
}

export function formatDateTime(iso: string | Date | undefined | null, lang: string): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

export function formatTime(iso: string | Date, lang: string): string {
  return new Intl.DateTimeFormat(lang, { timeStyle: 'short' }).format(new Date(iso))
}

/** „21,4“ oder „21.4“ → 21.4; leer → null; Unsinn → NaN. */
export function parseDecimal(text: string): number | null {
  const cleaned = text.trim().replace(',', '.')
  if (cleaned === '') return null
  return /^[-+]?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : Number.NaN
}

export function formatCoord(value: number, lang: string): string {
  return new Intl.NumberFormat(lang, { minimumFractionDigits: 5, maximumFractionDigits: 5 }).format(value)
}
