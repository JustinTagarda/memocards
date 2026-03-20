'use client'

import { PencilLine, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { CardForm } from './forms'
import {
  getSupportedDocumentExtensions,
  parseDocumentText,
  supportsDocumentFile,
  type DocumentParseCandidate,
  type DocumentParseIssue,
  type DocumentParserMode,
} from '../lib/documentParser'
import { summarizeQuickAddDraft } from '../lib/quickAdd'
import type { CardDraft } from '../types/models'

interface DocumentImportComposerProps {
  prepareDraft?: (draft: CardDraft) => CardDraft
  showHeader?: boolean
  onSave: (draft: CardDraft) => Promise<void>
}

interface PendingCandidate extends DocumentParseCandidate {
  id: string
  selected: boolean
}

function createCandidateId(index: number) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `parsed-card-${Date.now()}-${index}`
}

function modeLabel(mode: DocumentParserMode) {
  switch (mode) {
    case 'auto':
      return 'Auto detect'
    case 'basic':
      return 'Basic'
    case 'term':
      return 'Term / Definition'
    case 'multiple_choice':
      return 'Multiple Choice'
    case 'explanation':
      return 'Explanation'
  }
}

export function DocumentImportComposer({
  prepareDraft = (draft) => draft,
  showHeader = true,
  onSave,
}: DocumentImportComposerProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [parserMode, setParserMode] = useState<DocumentParserMode>('auto')
  const [candidates, setCandidates] = useState<PendingCandidate[]>([])
  const [issues, setIssues] = useState<DocumentParseIssue[]>([])
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null)
  const editorRef = useRef<HTMLElement | null>(null)

  const supportedExtensions = useMemo(() => getSupportedDocumentExtensions(), [])
  const selectedCount = candidates.filter((candidate) => candidate.selected).length
  const editingCandidate = candidates.find((candidate) => candidate.id === editingCandidateId) ?? null

  useEffect(() => {
    if (!editingCandidate) {
      return
    }
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editingCandidate])

  function resetFeedback() {
    setError(null)
    setSuccess(null)
  }

  function clearPreview() {
    setCandidates([])
    setIssues([])
    setEditingCandidateId(null)
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
    clearPreview()
    resetFeedback()
  }

  async function handleParse() {
    if (!selectedFile) {
      setError('Choose a supported text document first.')
      return
    }

    if (!supportsDocumentFile(selectedFile.name)) {
      setError(`Unsupported file type. Use ${supportedExtensions.join(', ')}.`)
      return
    }

    setParsing(true)
    resetFeedback()

    try {
      const content = await selectedFile.text()
      const parsed = parseDocumentText(content, parserMode)

      setCandidates(
        parsed.candidates.map((candidate, index) => ({
          ...candidate,
          draft: prepareDraft(candidate.draft),
          id: createCandidateId(index),
          selected: true,
        })),
      )
      setIssues(parsed.issues)

      if (parsed.candidates.length === 0) {
        setSuccess(null)
        setError(
          parsed.issues.length > 0
            ? 'No card candidates were built from this document.'
            : 'This document did not contain any parseable study content.',
        )
        return
      }

      setSuccess(
        parsed.issues.length > 0
          ? `Built ${parsed.candidates.length} card candidate${parsed.candidates.length === 1 ? '' : 's'} with ${parsed.issues.length} section${parsed.issues.length === 1 ? '' : 's'} to review.`
          : `Built ${parsed.candidates.length} card candidate${parsed.candidates.length === 1 ? '' : 's'} from ${selectedFile.name}.`,
      )
    } catch (reason) {
      clearPreview()
      setError(reason instanceof Error ? reason.message : 'Unable to read this document.')
    } finally {
      setParsing(false)
    }
  }

  async function handleSaveSelected() {
    const selectedCandidates = candidates.filter((candidate) => candidate.selected)

    if (selectedCandidates.length === 0) {
      setError('Select at least one parsed card before saving.')
      return
    }

    setSaving(true)
    resetFeedback()

    const savedIds: string[] = []

    try {
      for (const candidate of selectedCandidates) {
        await onSave(candidate.draft)
        savedIds.push(candidate.id)
      }

      setCandidates((current) => current.filter((candidate) => !savedIds.includes(candidate.id)))
      setSuccess(`Saved ${savedIds.length} card${savedIds.length === 1 ? '' : 's'} to this deck.`)
    } catch (reason) {
      if (savedIds.length > 0) {
        setCandidates((current) => current.filter((candidate) => !savedIds.includes(candidate.id)))
      }
      setError(
        savedIds.length > 0
          ? `Saved ${savedIds.length} card${savedIds.length === 1 ? '' : 's'} before a save failed.`
          : reason instanceof Error
            ? reason.message
            : 'Unable to save the selected cards.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <section className="filters-card quick-add-card document-import-card">
        {showHeader && (
          <div className="section-heading">
            <div><h2>Import notes</h2></div>
          </div>
        )}

        <div className="field-grid">
          <label className="field">
            <span>Text document</span>
            <input
              accept={supportedExtensions.join(',')}
              type="file"
              onChange={handleFileChange}
            />
          </label>

          <label className="field">
            <span>Parser mode</span>
            <select
              value={parserMode}
              onChange={(event) => {
                setParserMode(event.target.value as DocumentParserMode)
                clearPreview()
                resetFeedback()
              }}
            >
              <option value="auto">Auto detect</option>
              <option value="basic">Basic</option>
              <option value="term">Term / Definition</option>
              <option value="explanation">Explanation</option>
              <option value="multiple_choice">Multiple Choice</option>
            </select>
          </label>
        </div>

        {selectedFile && (
          <div className="preview-card preview-card--accent document-import-summary">
            <strong>{selectedFile.name}</strong>
            <small>{modeLabel(parserMode)} mode</small>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
        {success && <p className="hint-text">{success}</p>}

        <div className="modal-actions quick-add-actions">
          <button
            className="primary-button"
            disabled={!selectedFile || parsing || saving}
            type="button"
            onClick={() => {
              void handleParse()
            }}
          >
            <Upload size={16} />
            {parsing ? 'Parsing...' : 'Build preview'}
          </button>

          {candidates.length > 0 && (
            <>
              <button
                className="ghost-button"
                disabled={saving || selectedCount === candidates.length}
                type="button"
                onClick={() => {
                  setCandidates((current) => current.map((candidate) => ({ ...candidate, selected: true })))
                }}
              >
                Select all
              </button>
              <button
                className="ghost-button"
                disabled={saving || selectedCount === 0}
                type="button"
                onClick={() => {
                  setCandidates((current) => current.map((candidate) => ({ ...candidate, selected: false })))
                }}
              >
                Clear selection
              </button>
            </>
          )}
        </div>

        {editingCandidate && (
          <section ref={editorRef} className="editor-shell editor-shell--inline">
            <div className="editor-shell__header">
              <div className="editor-shell__copy">
                <h2>Edit card</h2>
              </div>

              <div className="editor-shell__meta">
                <small className="editor-shell__meta-text">{editingCandidate.sourceLabel}</small>
                {editingCandidate.confidence !== 'high' || editingCandidate.warnings.length > 0 ? (
                  <small className="editor-shell__meta-text editor-shell__meta-text--warning">Needs review</small>
                ) : null}
              </div>
            </div>

            <div className="editor-shell__body">
              <CardForm
                initialValue={editingCandidate.draft}
                isEditing
                onCancel={() => setEditingCandidateId(null)}
                onSubmit={async (draft) => {
                  setCandidates((current) =>
                    current.map((candidate) =>
                      candidate.id === editingCandidate.id
                        ? { ...candidate, draft: prepareDraft(draft) }
                        : candidate,
                    ),
                  )
                  setEditingCandidateId(null)
                }}
              />
            </div>
          </section>
        )}

        {candidates.length > 0 && (
          <div className="quick-add-preview document-import-preview">
            <div className="panel-heading">
              <strong>Preview</strong>
              <small>{selectedCount} selected</small>
            </div>

            <div className="list-stack list-stack--scroll">
              {candidates.map((candidate) => {
                const summary = summarizeQuickAddDraft(candidate.draft)

                return (
                  <article key={candidate.id} className="activity-item document-import-item">
                    <div className="quick-add-preview__meta">
                      <strong>{candidate.sourceLabel}</strong>
                      <small>
                        {candidate.draft.type.replace('_', ' ')} · {candidate.confidence === 'high' ? 'Ready' : 'Review'}
                      </small>
                    </div>

                    <strong>{summary.heading}</strong>
                    <small>{summary.detail || 'No answer yet.'}</small>

                    {candidate.warnings.length > 0 && (
                      <p className="hint-text">{candidate.warnings.join(' ')}</p>
                    )}

                    <div className="document-import-item__actions">
                      <label className="checkbox-inline">
                        <input
                          checked={candidate.selected}
                          type="checkbox"
                          onChange={(event) => {
                            const checked = event.target.checked
                            setCandidates((current) =>
                              current.map((item) =>
                                item.id === candidate.id ? { ...item, selected: checked } : item,
                              ),
                            )
                          }}
                        />
                        Keep
                      </label>

                      <div className="inline-actions">
                        <button
                          className="ghost-button ghost-button--inline"
                          type="button"
                          onClick={() => setEditingCandidateId(candidate.id)}
                        >
                          <PencilLine size={16} />
                          Edit
                        </button>
                        <button
                          className="button-link button-link--danger"
                          type="button"
                          onClick={() => {
                            setCandidates((current) => current.filter((item) => item.id !== candidate.id))
                          }}
                        >
                          <Trash2 size={16} />
                          Remove
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}

        {issues.length > 0 && (
          <div className="quick-add-feedback document-import-feedback">
            <strong>Needs review</strong>
            <div className="list-stack">
              {issues.map((issue) => (
                <div key={`${issue.sourceLabel}:${issue.lineNumber}:${issue.content}`} className="activity-item">
                  <strong>{issue.sourceLabel}</strong>
                  <small>{issue.reason}</small>
                </div>
              ))}
            </div>
          </div>
        )}

        {candidates.length > 0 && (
          <div className="modal-actions quick-add-actions">
            <button
              className="primary-button"
              disabled={saving || selectedCount === 0}
              type="button"
              onClick={() => {
                void handleSaveSelected()
              }}
            >
              {saving
                ? 'Saving...'
                : `Save ${selectedCount} card${selectedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </section>

    </>
  )
}
