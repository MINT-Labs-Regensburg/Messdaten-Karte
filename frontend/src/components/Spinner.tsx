import { useTranslation } from 'react-i18next'

export function Spinner() {
  const { t } = useTranslation()
  return (
    <div className="center-block" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  )
}
