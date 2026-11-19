// Kleine Hilfen für localStorage (kann in privaten Fenstern fehlen oder werfen).

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ohne Speicher läuft die App weiter
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignorieren
  }
}

// ---- Edit-Token anonymer Messungen (nur dieser Browser kennt sie)

interface StoredEdit {
  token: string
  expiresAt: string | null
}

const editKey = (id: string) => `mdk.edit.${id}`

export function saveEditToken(id: string, token: string, expiresAt: string | null | undefined): void {
  writeJson(editKey(id), { token, expiresAt: expiresAt ?? null } satisfies StoredEdit)
}

/** Gibt den Token nur zurück, solange das Änderungsfenster offen ist. */
export function getEditToken(id: string, now: Date = new Date()): string | null {
  const stored = readJson<StoredEdit | null>(editKey(id), null)
  if (!stored) return null
  if (stored.expiresAt && new Date(stored.expiresAt) <= now) {
    removeKey(editKey(id))
    return null
  }
  return stored.token
}

export function forgetEditToken(id: string): void {
  removeKey(editKey(id))
}

// ---- Eigene Messungen angemeldeter Nutzer (Autor darf unbegrenzt ändern)

const OWN_KEY = 'mdk.own'

export function rememberOwn(id: string): void {
  const ids = readJson<string[]>(OWN_KEY, [])
  if (!ids.includes(id)) writeJson(OWN_KEY, [...ids.slice(-199), id])
}

export function isOwn(id: string): boolean {
  return readJson<string[]>(OWN_KEY, []).includes(id)
}

// ---- Zuletzt benutzter Anzeigename

const NAME_KEY = 'mdk.authorName'

export const getAuthorName = (): string => readJson<string>(NAME_KEY, '')
export const setAuthorName = (name: string): void => writeJson(NAME_KEY, name)
