'use client'

import { Modal } from './Modal'
import { useAuth } from '../hooks/useAuth'

export function SampleDataModal() {
  const { dismissSampleNotice } = useAuth()

  return (
    <Modal title="Sample decks added to help you explore" onClose={dismissSampleNotice} width="sm">
      <div className="confirmation-dialog">
        <p>
          We added 3 sample decks with ready-made cards so you can try spaced repetition, audio playback, and answer
          grading right away — no setup needed.
        </p>
        <p className="hint-text">
          They&apos;re just for exploring: edit, ignore, or delete them anytime. Your own decks are never affected.
        </p>
        <div className="modal-actions modal-actions--confirm">
          <button className="primary-button" type="button" onClick={dismissSampleNotice}>
            Got it
          </button>
        </div>
      </div>
    </Modal>
  )
}
