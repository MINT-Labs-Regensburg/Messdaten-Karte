import { useTranslation } from 'react-i18next'

import { useTheme } from '../lib/theme'
import { Icon } from './Icon'

export function ThemeToggle() {
  const { t } = useTranslation()
  const { resolved, toggle } = useTheme()
  return (
    <button
      type="button"
      className="iconbtn"
      onClick={toggle}
      aria-label={resolved === 'dark' ? t('nav.theme_to_light') : t('nav.theme_to_dark')}
    >
      <Icon name="moon" size={20} />
    </button>
  )
}

export function LangToggle() {
  const { t, i18n } = useTranslation()
  const current = i18n.language.slice(0, 2) === 'en' ? 'en' : 'de'
  const next = current === 'de' ? 'en' : 'de'
  return (
    <button
      type="button"
      className="iconbtn iconbtn-text"
      onClick={() => void i18n.changeLanguage(next)}
      aria-label={t('nav.language', { language: t(`nav.language_${current}`) })}
    >
      {current.toUpperCase()}
    </button>
  )
}
