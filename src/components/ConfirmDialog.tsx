'use client'

import { Modal } from './Modal'

interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  note?: string
}

export function ConfirmDialog({ title, description, confirmLabel, note, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onCancel} width="sm">
      <div className="confirmation-dialog">
        <p>{description}</p>
        {note ? <p className="hint-text">{note}</p> : null}
        <div className="modal-actions modal-actions--confirm">
          <button className="ghost-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="ghost-button danger-button" type="button" onClick={() => void onConfirm()}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
