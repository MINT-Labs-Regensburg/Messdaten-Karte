import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/AuthContext'
import { Logo } from './Icon'
import { LangToggle, ThemeToggle } from './Toggles'

/** Rahmen der Verwaltungsseiten (die Kartenseite hat ihr eigenes Layout). */
export function Shell() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const onLogout = async () => {
    await logout()
    navigate('/')
  }

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-left">
          <Link to="/" className="brand">
            <Logo size={30} />
            <span className="disp">{t('app.name')}</span>
          </Link>
          {user && (
            <nav className="shell-nav" aria-label={t('nav.main')}>
              <NavLink to="/projects" className="nav-link">
                {t('nav.projects')}
              </NavLink>
              <NavLink to="/tokens" className="nav-link">
                {t('nav.tokens')}
              </NavLink>
              {user.is_admin && (
                <NavLink to="/admin" className="nav-link">
                  {t('nav.admin')}
                </NavLink>
              )}
            </nav>
          )}
        </div>
        <div className="shell-right">
          <LangToggle />
          <ThemeToggle />
          {user ? (
            <>
              <Link to="/profile" className="user-chip">
                <span className="avatar" aria-hidden="true">
                  {user.username.slice(0, 1).toUpperCase()}
                </span>
                <span>{user.username}</span>
              </Link>
              <button type="button" className="btn btn-secondary" onClick={onLogout}>
                {t('nav.logout')}
              </button>
            </>
          ) : (
            <>
              <Link to="/" className="btn btn-secondary">
                {t('nav.login')}
              </Link>
            </>
          )}
        </div>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  )
}
