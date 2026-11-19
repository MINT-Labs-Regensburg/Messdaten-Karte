import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Icon } from './Icon'

interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** `sheet`: unten angedockt (Handy) bzw. als Seitenpanel (Desktop) */
  variant?: 'modal' | 'sheet'
  footer?: ReactNode
}

export function Dialog({ title, onClose, children, variant = 'modal', footer }: DialogProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [onClose])

  return createPortal(
    <div className={`dialog-backdrop dialog-${variant}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
