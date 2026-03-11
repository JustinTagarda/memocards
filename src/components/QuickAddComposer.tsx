'use client'

import { ClipboardPaste, Expand, Plus } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { CardDraft } from '../types/models'
import {
  QUICK_ADD_TYPE_META,
  parseQuickAddInput,
  parseQuickAddLine,
  type QuickAddCardType,
  type QuickAddInvalidLine,
} from '../lib/quickAdd'

interface QuickAddComposerProps {
  disabled?: boolean
  onExpand: (draft: CardDraft) => void
  onSave: (draft: CardDraft) => Promise<void>
}

type QuickAddMode = 'single' | 'bulk'

function hasMultipleEntries(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length > 1
}

export function QuickAddComposer({ disabled = false, onExpand, onSave }: QuickAddComposerProps) {
  const [mode, setMode] = useState<QuickAddMode>('single')
  const [type, setType] = useState<QuickAddCardType>('basic')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [invalidLines, setInvalidLines] = useState<QuickAddInvalidLine[]>([])
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const meta = QUICK_ADD_TYPE_META[type]

  const canExpand = useMemo(() => {
    if (mode !== 'single' || disabled) {
      return false
    }

    if (hasMultipleEntries(value)) {
      return false
    }

    try {
      parseQuickAddLine(value, type)
      return true
    } catch {
      return false
    }
  }, [disabled, mode, type, value])

  function resetFeedback() {
    setError(null)
    setSuccess(null)
    setInvalidLines([])
  }

  async function saveSingle() {
    resetFeedback()

    if (hasMultipleEntries(value)) {
      setError('Single entry saves one line at a time. Switch to Paste many for batches.')
      return
    }

    let draft: CardDraft
    try {
      draft = parseQuickAddLine(value, type)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to parse this card.')
      return
    }

    setSaving(true)
    try {
      await onSave(draft)
      setValue('')
      setSuccess('Card added.')
      inputRef.current?.focus()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save this card.')
    } finally {
      setSaving(false)
    }
  }

  async function saveBulk() {
    resetFeedback()
    const { drafts, invalidLines: parseErrors } = parseQuickAddInput(value, type)

    if (drafts.length === 0) {
      setError(parseErrors.length > 0 ? 'No valid lines to add.' : 'Paste one or more lines first.')
      setInvalidLines(parseErrors)
      return
    }

    setSaving(true)
    let savedCount = 0

    try {
      for (const draft of drafts) {
        await onSave(draft)
        savedCount += 1
      }

      setValue('')
      setInvalidLines(parseErrors)
      setSuccess(
        parseErrors.length > 0
          ? `Added ${savedCount} card${savedCount === 1 ? '' : 's'}. ${parseErrors.length} line${parseErrors.length === 1 ? '' : 's'} skipped.`
          : `Added ${savedCount} card${savedCount === 1 ? '' : 's'}.`,
      )
      inputRef.current?.focus()
    } catch (reason) {
      setInvalidLines(parseErrors)
      setError(
        savedCount > 0
          ? `Saved ${savedCount} card${savedCount === 1 ? '' : 's'} before a save failed.`
          : reason instanceof Error
            ? reason.message
            : 'Unable to save these cards.',
      )
    } finally {
      setSaving(false)
    }
  }

  function handleExpand() {
    resetFeedback()

    try {
      onExpand(parseQuickAddLine(value, type))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to expand this card.')
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mode !== 'single' || disabled || saving) {
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void saveSingle()
    }
  }

  return (
    <section className="filters-card quick-add-card">
      <div className="section-heading section-heading--toolbar">
        <div>
          <p className="eyebrow">Quick Add</p>
          <h2>Add cards faster</h2>
        </div>
        <small>Full editor stays available for tags, notes, and richer setup.</small>
      </div>

      <div className="quick-add-toolbar">
        <div className="quick-add-mode" role="tablist" aria-label="Quick add mode">
          <button
            aria-selected={mode === 'single'}
            className={mode === 'single' ? 'nav-link nav-link--active' : 'nav-link'}
            role="tab"
            type="button"
            onClick={() => {
              setMode('single')
              resetFeedback()
            }}
          >
            <Plus size={16} />
            Single
          </button>
          <button
            aria-selected={mode === 'bulk'}
            className={mode === 'bulk' ? 'nav-link nav-link--active' : 'nav-link'}
            role="tab"
            type="button"
            onClick={() => {
              setMode('bulk')
              resetFeedback()
            }}
          >
            <ClipboardPaste size={16} />
            Paste many
          </button>
        </div>

        <label className="field quick-add-toolbar__type">
          <span>Type</span>
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as QuickAddCardType)
              resetFeedback()
            }}
          >
            <option value="basic">Basic</option>
            <option value="term">Term / Definition</option>
            <option value="multiple_choice">Multiple Choice</option>
            <option value="explanation">Explanation</option>
          </select>
        </label>
      </div>

      <div className="quick-add-meta">
        <span className="muted-label">{meta.description}</span>
        <small>{meta.help}</small>
      </div>

      <label className="field">
        <span>{mode === 'single' ? meta.inputLabel : 'Paste one card per line'}</span>
        <textarea
          ref={inputRef}
          rows={mode === 'single' ? 2 : 7}
          placeholder={mode === 'single' ? meta.placeholder : `${meta.example}\n${meta.example}`}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (error || success || invalidLines.length > 0) {
              resetFeedback()
            }
          }}
          onKeyDown={handleKeyDown}
        />
      </label>

      <small className="hint-text">
        {mode === 'single'
          ? 'Press Enter to save quickly. Use Shift+Enter for a new line.'
          : 'Each non-empty line is parsed on its own. Invalid lines are skipped and reported below.'}
      </small>

      {error && <p className="error-text">{error}</p>}
      {success && <p className="hint-text">{success}</p>}

      {invalidLines.length > 0 && (
        <div className="quick-add-feedback">
          <strong>Skipped lines</strong>
          <div className="list-stack">
            {invalidLines.map((item) => (
              <div key={`${item.lineNumber}:${item.content}`} className="activity-item">
                <strong>Line {item.lineNumber}</strong>
                <small>{item.reason}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="modal-actions quick-add-actions">
        <button
          className="primary-button"
          disabled={disabled || saving || !value.trim()}
          type="button"
          onClick={() => {
            void (mode === 'single' ? saveSingle() : saveBulk())
          }}
        >
          {saving
            ? 'Saving...'
            : mode === 'single'
              ? 'Add card'
              : 'Add valid lines'}
        </button>
        <button
          className="ghost-button"
          disabled={!canExpand || saving}
          type="button"
          onClick={handleExpand}
        >
          <Expand size={16} />
          Expand
        </button>
      </div>
    </section>
  )
}
