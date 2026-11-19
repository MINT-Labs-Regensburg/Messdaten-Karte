import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import de from './de.json'
import en from './en.json'

// Alle Oberflächentexte stehen in de.json/en.json; Sprache nach Browser, umschaltbar.
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { de: { translation: de }, en: { translation: en } },
    fallbackLng: 'de',
    supportedLngs: ['de', 'en'],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: 'mdk.lang', caches: ['localStorage'] },
  })

const applyLang = (lng: string) => {
  document.documentElement.lang = lng.slice(0, 2)
}
applyLang(i18n.language ?? 'de')
i18n.on('languageChanged', applyLang)

export default i18n
