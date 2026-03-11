'use client'

import { ClipboardPaste, Expand, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { loadQuickAddState, saveQuickAddState, type QuickAddMode } from '../lib/cardEntry'
import type { CardDraft } from '../types/models'
import {
  QUICK_ADD_TYPE_META,
  parseQuickAddInput,
  parseQuickAddLine,
  summarizeQuickAddDraft,
  type QuickAddCardType,
  type QuickAddPreviewResult,
} from '../lib/quickAdd'

interface QuickAddComposerProps {
  deckId: string
  disabled?: boolean
  preferredType?: QuickAddCardType
  footerAction?: ReactNode
  onExpand: (draft: CardDraft) => void
  onSave: (draft: CardDraft) => Promise<void>
}

export function QuickAddComposer({
  deckId,
  disabled = false,
  preferredType = 'basic',
  footerAction,
  onExpand,
  onSave,
}: QuickAddComposerProps) {
  const storedState = useMemo(() => loadQuickAddState(deckId), [deckId])
  const [mode, setMode] = useState<QuickAddMode>(storedState.mode)
  const [type, setType] = useState<QuickAddCardType>(storedState.type ?? preferredType)
  const [singleValue, setSingleValue] = useState(storedState.singleValue)
  const [bulkValue, setBulkValue] = useState(storedState.bulkValue)
  const [preview, setPreview] = useState<QuickAddPreviewResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [restoredDraft, setRestoredDraft] = useState(Boolean(storedState.singleValue || storedState.bulkValue))
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const meta = QUICK_ADD_TYPE_META[type]
  const currentValue = mode === 'single' ? singleValue : bulkValue

  useEffect(() => {
    saveQuickAddState(deckId, {
      mode,
      type,
      singleValue,
      bulkValue,
    })
  }, [bulkValue, deckId, mode, singleValue, type])

  useEffect(() => {
    if (!storedState.singleValue && !storedState.bulkValue) {
      setType(preferredType)
    }
  }, [preferredType, storedState.bulkValue, storedState.singleValue])

  const canExpand = useMemo(() => {
    if (mode !== 'single' || disabled) {
      return false
    }

    try {
      parseQuickAddLine(singleValue, type)
      return true
    } catch {
      return false
    }
  }, [disabled, mode, singleValue, type])

  function resetFeedback() {
    setError(null)
    setSuccess(null)
  }

  function clearPreview() {
    setPreview(null)
  }

  function updateValue(nextValue: string) {
    if (mode === 'single') {
      setSingleValue(nextValue)
    } else {
      setBulkValue(nextValue)
    }

    if (error || success || preview) {
      resetFeedback()
      clearPreview()
    }
  }

  async function saveSingle() {
    resetFeedback()
    clearPreview()

    let draft: CardDraft
    try {
      draft = parseQuickAddLine(singleValue, type)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to parse this card.')
      return
    }

    setSaving(true)
    try {
      await onSave(draft)
      setSingleValue('')
      setSuccess('Card added.')
      setRestoredDraft(false)
      inputRef.current?.focus()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save this card.')
    } finally {
      setSaving(false)
    }
  }

  function buildPreview() {
    resetFeedback()
    const nextPreview = parseQuickAddInput(bulkValue, type)
    setPreview(nextPreview)

    if (nextPreview.drafts.length === 0) {
      setError(nextPreview.invalidLines.length > 0 ? 'No valid cards found in this paste.' : 'Paste one or more cards first.')
      return null
    }

    if (nextPreview.invalidLines.length > 0) {
      setSuccess(`Found ${nextPreview.drafts.length} valid card${nextPreview.drafts.length === 1 ? '' : 's'} and ${nextPreview.invalidLines.length} issue${nextPreview.invalidLines.length === 1 ? '' : 's'}.`)
    } else {
      setSuccess(`Previewing ${nextPreview.drafts.length} card${nextPreview.drafts.length === 1 ? '' : 's'}.`)
    }

    return nextPreview
  }

  async function saveBulk() {
    const activePreview = preview ?? buildPreview()
    if (!activePreview || activePreview.drafts.length === 0) {
      return
    }

    setSaving(true)
    resetFeedback()

    let savedCount = 0
    try {
      for (const item of activePreview.drafts) {
        await onSave(item.draft)
        savedCount += 1
      }

      setBulkValue('')
      setPreview(null)
      setRestoredDraft(false)
      setSuccess(
        activePreview.invalidLines.length > 0
          ? `Added ${savedCount} card${savedCount === 1 ? '' : 's'}. ${activePreview.invalidLines.length} row${activePreview.invalidLines.length === 1 ? '' : 's'} still need attention.`
          : `Added ${savedCount} card${savedCount === 1 ? '' : 's'}.`,
      )
      inputRef.current?.focus()
    } catch (reason) {
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
      onExpand(parseQuickAddLine(singleValue, type))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to expand this card.')
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (disabled || saving) {
      return
    }

    if (mode === 'single' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void saveSingle()
      return
    }

    if (mode === 'bulk' && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (preview) {
        void saveBulk()
      } else {
        buildPreview()
      }
    }
  }

  return (
    <section className="filters-card quick-add-card">
      <div className="section-heading section-heading--toolbar">
        <div>
          <p className="eyebrow">Quick Add</p>
          <h2>Add cards faster</h2>
          <p className="quick-add-intro">Full editor stays available for tags, notes, and richer setup.</p>
        </div>
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
              clearPreview()
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
              clearPreview()
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
              clearPreview()
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
        <span>{mode === 'single' ? meta.inputLabel : 'Paste cards to preview before saving'}</span>
        <textarea
          ref={inputRef}
          rows={mode === 'single' ? 3 : 8}
          placeholder={mode === 'single' ? meta.placeholder : `${meta.example}\n${meta.example}`}
          value={currentValue}
          onChange={(event) => {
            updateValue(event.target.value)
            if (restoredDraft) {
              setRestoredDraft(false)
            }
          }}
          onKeyDown={handleKeyDown}
        />
      </label>

      <small className="hint-text">
        {mode === 'single'
          ? 'Press Enter to save quickly. Use Shift+Enter for a newline. Cmd/Ctrl+Enter also works in the full editor.'
          : 'Preview first, then save valid rows only. Cmd/Ctrl+Enter previews or confirms the current paste.'}
      </small>

      {restoredDraft && !error && !success && (
        <p className="hint-text">Restored your unsaved quick-entry draft on this device.</p>
      )}

      {error && <p className="error-text">{error}</p>}
      {success && <p className="hint-text">{success}</p>}

      {preview && (
        <div className="quick-add-preview">
          <div className="panel-heading">
            <strong>Preview</strong>
            <small>{preview.drafts.length} ready</small>
          </div>

          <div className="list-stack list-stack--scroll">
            {preview.drafts.map((item, index) => {
              const summary = summarizeQuickAddDraft(item.draft)
              return (
                <div key={`${item.sourceLabel}-${index}`} className="activity-item quick-add-preview__item">
                  <div className="quick-add-preview__meta">
                    <strong>{item.sourceLabel}</strong>
                    <small>{item.draft.type.replace('_', ' ')}</small>
                  </div>
                  <strong>{summary.heading}</strong>
                  <small>{summary.detail || 'No answer yet.'}</small>
                </div>
              )
            })}
          </div>

          {preview.invalidLines.length > 0 && (
            <div className="quick-add-feedback">
              <strong>Needs attention</strong>
              <div className="list-stack">
                {preview.invalidLines.map((item) => (
                  <div key={`${item.label ?? item.lineNumber}:${item.content}`} className="activity-item">
                    <strong>{item.label ?? `Line ${item.lineNumber}`}</strong>
                    <small>{item.reason}</small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="modal-actions quick-add-actions">
        <div className="quick-add-actions__main">
          {mode === 'single' ? (
            <>
              <button
                className="primary-button"
                disabled={disabled || saving || !singleValue.trim()}
                type="button"
                onClick={() => {
                  void saveSingle()
                }}
              >
                {saving ? 'Saving...' : 'Add card'}
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
            </>
          ) : (
            <>
              <button
                className="ghost-button"
                disabled={disabled || saving || !bulkValue.trim()}
                type="button"
                onClick={buildPreview}
              >
                {preview ? 'Refresh preview' : 'Preview cards'}
              </button>
              <button
                className="primary-button"
                disabled={disabled || saving || !(preview?.drafts.length ?? 0)}
                type="button"
                onClick={() => {
                  void saveBulk()
                }}
              >
                {saving
                  ? 'Saving...'
                  : `Save ${preview?.drafts.length ?? 0} card${preview?.drafts.length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </div>
        {footerAction && <div className="quick-add-actions__aside">{footerAction}</div>}
      </div>
    </section>
  )
}
