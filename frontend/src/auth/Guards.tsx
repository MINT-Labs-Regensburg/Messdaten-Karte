import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { Spinner } from '../components/Spinner'
import { useAuth } from './AuthContext'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/" state={{ from: location.pathname + location.search }} replace />
  return <Outlet />
}

export function RequireAdmin() {
  const { user } = useAuth()
  if (!user?.is_admin) return <Navigate to="/projects" replace />
  return <Outlet />
}
