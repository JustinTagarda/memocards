'use client'

import { Modal } from './Modal'

interface SampleDataModalProps {
  loading: boolean
  error: string | null
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function SampleDataModal({ loading, error, onConfirm, onCancel }: SampleDataModalProps) {
  return (
    <Modal title="Add sample decks to explore?" onClose={onCancel} width="sm">
      <div className="confirmation-dialog">
        <p>
          Load 3 sample decks with ready-made cards so you can try spaced repetition, audio playback, and answer
          grading right away — no setup needed.
        </p>
        <p className="hint-text">They&apos;re just for exploring: edit, ignore, or delete them anytime.</p>
        {error ? <p className="hint-text hint-text--error">{error}</p> : null}
        <div className="modal-actions modal-actions--confirm">
          <button className="ghost-button" type="button" disabled={loading} onClick={onCancel}>
            Not now
          </button>
          <button className="primary-button" type="button" disabled={loading} onClick={() => void onConfirm()}>
            {loading ? 'Adding sample decks…' : 'Add sample decks'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
