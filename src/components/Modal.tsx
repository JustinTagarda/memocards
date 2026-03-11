'use client'

import { X } from 'lucide-react'
import { useEffect, type PropsWithChildren } from 'react'

interface ModalProps extends PropsWithChildren {
  title: string
  onClose: () => void
  width?: 'sm' | 'md' | 'lg'
}

export function Modal({ children, title, onClose, width = 'md' }: ModalProps) {
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        aria-modal="true"
        aria-label={title}
        className={`modal-card modal-card--${width}`}
        role="dialog"
        onClick={(event) => {
          event.stopPropagation()
        }}
        >
        <div className="modal-header">
          <h2>{title}</h2>
          <button aria-label="Close dialog" className="modal-close" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-content">{children}</div>
      </div>
    </div>
  )
}
