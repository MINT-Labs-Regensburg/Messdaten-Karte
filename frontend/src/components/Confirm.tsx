import { useTranslation } from 'react-i18next'

import { Dialog } from './Dialog'

interface ConfirmProps {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function Confirm({ title, message, confirmLabel, danger, busy, error, onConfirm, onCancel }: ConfirmProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
