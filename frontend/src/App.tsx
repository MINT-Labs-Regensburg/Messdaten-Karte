import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'

import { RequireAdmin, RequireAuth } from './auth/Guards'
import { Shell } from './components/Shell'
import { Spinner } from './components/Spinner'
import HomePage from './pages/HomePage'
import NotFoundPage from './pages/NotFoundPage'
import RegisterPage from './pages/RegisterPage'

// Seiten mit Karte oder viel Code werden erst bei Bedarf geladen (spart Datenverbrauch)
const MapPage = lazy(() => import('./pages/MapPage'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const ProjectCreatePage = lazy(() => import('./pages/ProjectCreatePage'))
const ProjectSettingsPage = lazy(() => import('./pages/ProjectSettingsPage'))
const TokensPage = lazy(() => import('./pages/TokensPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/p/:slug" element={<MapPage />} />
        <Route element={<Shell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/new" element={<ProjectCreatePage />} />
            <Route path="/projects/:id/settings" element={<ProjectSettingsPage />} />
            <Route path="/tokens" element={<TokensPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
