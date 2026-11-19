import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import i18n from '../i18n'

// Tests prüfen die deutschen Texte, unabhängig von der Sprache des Testrechners
await i18n.changeLanguage('de')

afterEach(() => {
  cleanup()
  localStorage.clear()
})
