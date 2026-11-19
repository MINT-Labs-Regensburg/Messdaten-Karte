import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="container narrow">
      <section className="card card-pad stack">
        <h1 className="disp">{t('notfound.title')}</h1>
        <p>{t('notfound.text')}</p>
        <Link className="btn btn-primary" to="/">
          {t('notfound.home')}
        </Link>
      </section>
    </div>
  )
}
