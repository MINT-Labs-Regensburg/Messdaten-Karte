import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '../api/client'
import type { ApiToken, ApiTokenCreated, ProjectList, TokenScope } from '../api/types'
import { Confirm } from '../components/Confirm'
import { Dialog } from '../components/Dialog'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { errorMessage } from '../lib/errors'
import { formatDateTime } from '../lib/format'

export default function TokensPage() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [scope, setScope] = useState<TokenScope>('measurements:write')
  const [projectId, setProjectId] = useState('')
  const [expires, setExpires] = useState('')
  const [created, setCreated] = useState<ApiTokenCreated | null>(null)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)

  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => api.get<ApiToken[]>('/tokens') })
  const projects = useQuery({
    queryKey: ['projects', 'mine', false],
    queryFn: () => api.get<ProjectList>('/projects', { scope: 'mine', archived: false, limit: 200 }),
  })

  const create = useMutation({
    mutationFn: () =>
      api.post<ApiTokenCreated>('/tokens', {
        name: name.trim(),
        scope,
        project_id: projectId || null,
        expires_at: expires ? new Date(expires).toISOString() : null,
      }),
    onSuccess: (token) => {
      setCreated(token)
      setName('')
      setExpires('')
      void qc.invalidateQueries({ queryKey: ['tokens'] })
    },
  })

  const revoke = useMutation({
    mutationFn: (token: ApiToken) => api.delete(`/tokens/${token.id}`),
    onSuccess: () => {
      setRevoking(null)
      toast.show(t('tokens.revoked'))
      void qc.invalidateQueries({ queryKey: ['tokens'] })
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }

  return (
    <div className="container stack-lg">
      <div>
        <h1 className="disp">{t('tokens.title')}</h1>
        <p className="help">{t('tokens.intro')}</p>
      </div>

      <section className="card card-pad" aria-labelledby="tok-new">
        <h2 id="tok-new">{t('tokens.create')}</h2>
        <form className="form-grid" onSubmit={onSubmit}>
          <label className="field">
            <span>{t('tokens.name')}</span>
            <input
              className="input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('tokens.name_placeholder')}
              required
            />
          </label>
          <label className="field">
            <span>{t('tokens.scope')}</span>
            <select className="input" value={scope} onChange={(e) => setScope(e.target.value as TokenScope)}>
              <option value="measurements:write">{t('tokens.scope_write')}</option>
              <option value="full">{t('tokens.scope_full')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('tokens.project')}</span>
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t('tokens.project_any')}</option>
              {projects.data?.items.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('tokens.expires')}</span>
            <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
          <div className="form-grid-full row">
            <button className="btn btn-primary" type="submit" disabled={create.isPending}>
              {t('tokens.create_button')}
            </button>
            {create.error && (
              <span className="error-text" role="alert">
                {errorMessage(t, create.error)}
              </span>
            )}
          </div>
        </form>
      </section>

      <section className="card card-pad" aria-labelledby="tok-list">
        <h2 id="tok-list">{t('tokens.existing')}</h2>
        {tokens.isPending && <Spinner />}
        {tokens.data && tokens.data.length === 0 && <p className="help">{t('tokens.empty')}</p>}
        {tokens.data && tokens.data.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('tokens.name')}</th>
                  <th>{t('tokens.scope')}</th>
                  <th>{t('tokens.last_used')}</th>
                  <th>{t('tokens.expires')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.data.map((token) => (
                  <tr key={token.id}>
                    <td>
                      <strong>{token.name}</strong> <code>{token.prefix}…</code>
                    </td>
                    <td>{token.scope === 'full' ? t('tokens.scope_full_short') : t('tokens.scope_write_short')}</td>
                    <td>{token.last_used_at ? formatDateTime(token.last_used_at, i18n.language) : t('tokens.never')}</td>
                    <td>{token.expires_at ? formatDateTime(token.expires_at, i18n.language) : t('tokens.no_expiry')}</td>
                    <td className="right">
                      <button type="button" className="btn btn-secondary" onClick={() => setRevoking(token)}>
                        {t('tokens.revoke')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card-pad stack" aria-labelledby="tok-doc">
        <h2 id="tok-doc">{t('tokens.examples')}</h2>
        <p className="help">{t('tokens.examples_intro')}</p>
        <h3>curl</h3>
        <pre className="code">{CURL_EXAMPLE}</pre>
        <h3>ESP32 (Arduino)</h3>
        <pre className="code">{ESP32_EXAMPLE}</pre>
      </section>

      {created && (
        <Dialog title={t('tokens.created_title')} onClose={() => setCreated(null)}>
          <div className="stack">
            <p>{t('tokens.created_hint')}</p>
            <code className="token-box">{created.token}</code>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(created.token)
                toast.show(t('common.copied'))
              }}
            >
              {t('common.copy')}
            </button>
          </div>
        </Dialog>
      )}

      {revoking && (
        <Confirm
          title={t('tokens.revoke_title')}
          message={t('tokens.revoke_message', { name: revoking.name })}
          confirmLabel={t('tokens.revoke')}
          danger
          busy={revoke.isPending}
          error={revoke.error ? errorMessage(t, revoke.error) : null}
          onConfirm={() => revoke.mutate(revoking)}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  )
}

const CURL_EXAMPLE = `curl -X POST https://<host>/api/projects/<projekt-id>/measurements \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"lat": 49.0134, "lon": 12.1016,
       "values": [{"metric_id": "<messgroessen-id>", "value": 21.4}]}'`

const ESP32_EXAMPLE = `#include <HTTPClient.h>
#include <WiFiClientSecure.h>

void sendMeasurement(float temperature) {
  WiFiClientSecure client;
  client.setCACert(ROOT_CA);            // oder setInsecure() nur zum Testen
  HTTPClient http;
  http.begin(client, "https://<host>/api/projects/<projekt-id>/measurements");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer <token>");
  String body = String("{\\"lat\\":49.0134,\\"lon\\":12.1016,\\"values\\":[{\\"metric_id\\":\\"<messgroessen-id>\\",\\"value\\":") + temperature + "}]}";
  int status = http.POST(body);         // 201 = angelegt
  http.end();
}`
