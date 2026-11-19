import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from './Dialog'
import { useToast } from './Toast'

interface ShareDialogProps {
  /** Link auf die Karte ohne und mit dem aktuellen Zeitbereich/der Messgröße */
  plainUrl: string
  viewUrl: string
  onClose: () => void
}

export function ShareDialog({ plainUrl, viewUrl, onClose }: ShareDialogProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [withView, setWithView] = useState(false)
  const url = withView ? viewUrl : plainUrl

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.show(t('common.copied'))
    } catch {
      toast.show(t('share.copy_failed'), 'error')
    }
  }

  return (
    <Dialog title={t('share.title')} onClose={onClose}>
      <div className="stack share">
        <div className="qr-box">
          <QRCodeSVG value={url} size={200} level="M" bgColor="#ffffff" fgColor="#14281d" marginSize={2} title={t('share.qr_label')} />
        </div>
        <label className="field">
          <span>{t('share.link')}</span>
          <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        </label>
        {plainUrl !== viewUrl && (
          <label className="check">
            <input type="checkbox" checked={withView} onChange={(e) => setWithView(e.target.checked)} />
            <span>{t('share.with_view')}</span>
          </label>
        )}
        <button type="button" className="btn btn-primary" onClick={copy}>
          {t('common.copy')}
        </button>
      </div>
    </Dialog>
  )
}
