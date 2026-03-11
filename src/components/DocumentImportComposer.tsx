'use client'

import { PencilLine, Trash2, Upload } from 'lucide-react'
import { useMemo, useState, type ChangeEvent } from 'react'
import { Modal } from './Modal'
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

  const supportedExtensions = useMemo(() => getSupportedDocumentExtensions(), [])
  const selectedCount = candidates.filter((candidate) => candidate.selected).length
  const editingCandidate = candidates.find((candidate) => candidate.id === editingCandidateId) ?? null

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
            <div>
              <p className="eyebrow">Document Import</p>
              <h2>Upload notes and build cards</h2>
              <p className="quick-add-intro">
                Rule-based parsing only for now. Use auto detect for mixed notes, or force a card type when your document follows one pattern.
              </p>
            </div>
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

        <small className="hint-text">
          Supports {supportedExtensions.join(', ')}. Text-based documents only in this version.
        </small>

        {selectedFile && (
          <div className="preview-card preview-card--accent document-import-summary">
            <strong>{selectedFile.name}</strong>
            <p>
              Ready to parse with <strong>{modeLabel(parserMode)}</strong>. Build a preview, edit or remove any card, then save only what you want.
            </p>
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
                        {candidate.draft.type.replace('_', ' ')} · {candidate.confidence === 'high' ? 'High confidence' : 'Review suggested'}
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
                        Save this card
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

      {editingCandidate && (
        <Modal
          title={`Edit ${editingCandidate.draft.type.replace('_', ' ')} card`}
          onClose={() => setEditingCandidateId(null)}
          width="lg"
        >
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
        </Modal>
      )}
    </>
  )
}
