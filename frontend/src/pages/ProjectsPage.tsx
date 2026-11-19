import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { Project, ProjectList } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Spinner } from '../components/Spinner'
import { errorMessage } from '../lib/errors'

type Scope = 'mine' | 'public' | 'all'

export default function ProjectsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [scope, setScope] = useState<Scope>('mine')
  const [archived, setArchived] = useState(false)

  const query = useQuery({
    queryKey: ['projects', scope, archived],
    queryFn: () => api.get<ProjectList>('/projects', { scope, archived, limit: 200 }),
  })

  const scopes: Scope[] = user?.is_admin ? ['mine', 'public', 'all'] : ['mine', 'public']

  return (
    <div className="container stack-lg">
      <div className="between wrap">
        <h1 className="disp">{t('projects.title')}</h1>
        <Link className="btn btn-primary" to="/projects/new">
          {t('projects.new')}
        </Link>
      </div>

      <div className="between wrap">
        <div className="seg-group" role="group" aria-label={t('projects.scope')}>
          {scopes.map((s) => (
            <button
              key={s}
              type="button"
              className={`seg ${scope === s ? 'on' : ''}`}
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
            >
              {t(`projects.scope_${s}`)}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          <span>{t('projects.show_archived')}</span>
        </label>
      </div>

      {query.isPending && <Spinner />}
      {query.error && (
        <p className="error-text" role="alert">
          {errorMessage(t, query.error)}
        </p>
      )}
      {query.data && query.data.items.length === 0 && <p className="help">{t('projects.empty')}</p>}
      <div className="project-grid">
        {query.data?.items.map((project) => (
          <ProjectCard key={project.id} project={project} isAdmin={!!user?.is_admin} />
        ))}
      </div>
    </div>
  )
}

function ProjectCard({ project, isAdmin }: { project: Project; isAdmin: boolean }) {
  const { t } = useTranslation()
  const canManage = !!project.my_role || isAdmin
  return (
    <article className="card card-pad project-card">
      <div className="stack-sm">
        <h2 className="disp">{project.name}</h2>
        {project.description && <p className="help">{project.description}</p>}
        <div className="badges">
          <span className="badge">{project.is_public ? t('projects.public') : t('projects.private')}</span>
          {project.archived && <span className="badge badge-muted">{t('projects.archived')}</span>}
          {project.my_role && <span className="badge badge-muted">{t(`roles.${project.my_role}`)}</span>}
        </div>
        <p className="help">
          {t('projects.measurements', { count: project.measurement_count ?? 0 })} · {t('projects.radius', { m: project.radius_m })}
        </p>
      </div>
      <div className="row wrap">
        <Link className="btn btn-primary" to={`/p/${project.slug}`}>
          {t('projects.open_map')}
        </Link>
        {canManage && (
          <Link className="btn btn-secondary" to={`/projects/${project.id}/settings`}>
            {t('projects.settings')}
          </Link>
        )}
      </div>
    </article>
  )
}
