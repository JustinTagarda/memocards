'use client'

import { PencilLine, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CardForm } from './forms'
import {
  parseDocumentText,
  type DocumentParseCandidate,
  type DocumentParseIssue,
  type DocumentParserMode,
} from '../lib/documentParser'
import { summarizeQuickAddDraft } from '../lib/quickAdd'
import type { CardDraft } from '../types/models'

interface BulkCardGeneratorProps {
  prepareDraft?: (draft: CardDraft) => CardDraft
  onComplete: () => void
  onSaveAll: (
    drafts: CardDraft[],
    onProgress: (progress: { percent: number; label: string }) => void,
  ) => Promise<void>
}

interface PendingCandidate extends DocumentParseCandidate {
  id: string
}

function createCandidateId(index: number) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `bulk-card-${Date.now()}-${index}`
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

export function BulkCardGenerator({
  prepareDraft = (draft) => draft,
  onComplete,
  onSaveAll,
}: BulkCardGeneratorProps) {
  const [sourceText, setSourceText] = useState('')
  const [parserMode, setParserMode] = useState<DocumentParserMode>('auto')
  const [candidates, setCandidates] = useState<PendingCandidate[]>([])
  const [issues, setIssues] = useState<DocumentParseIssue[]>([])
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ percent: number; label: string } | null>(null)
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null)
  const editorRef = useRef<HTMLElement | null>(null)

  const hasPreview = candidates.length > 0
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
    setProgress(null)
  }

  async function handleGenerate() {
    if (!sourceText.trim()) {
      setError('Paste some source text first.')
      return
    }

    setParsing(true)
    setProgress(null)
    resetFeedback()

    try {
      const parsed = parseDocumentText(sourceText, parserMode)
      setCandidates(
        parsed.candidates.map((candidate, index) => ({
          ...candidate,
          draft: prepareDraft(candidate.draft),
          id: createCandidateId(index),
        })),
      )
      setIssues(parsed.issues)
      setEditingCandidateId(null)

      if (parsed.candidates.length === 0) {
        setSuccess(null)
        setError(
          parsed.issues.length > 0
            ? 'No card candidates were generated from that text.'
            : 'This text did not contain any parseable question-and-answer content.',
        )
        return
      }

      setSuccess(
        parsed.issues.length > 0
          ? `Generated ${parsed.candidates.length} card draft${parsed.candidates.length === 1 ? '' : 's'} with ${parsed.issues.length} section${parsed.issues.length === 1 ? '' : 's'} to review.`
          : `Generated ${parsed.candidates.length} card draft${parsed.candidates.length === 1 ? '' : 's'} using ${modeLabel(parserMode)}.`,
      )
    } catch (reason) {
      clearPreview()
      setError(reason instanceof Error ? reason.message : 'Unable to parse this text.')
    } finally {
      setParsing(false)
    }
  }

  async function handleSaveAll() {
    if (candidates.length === 0) {
      setError('Generate at least one card before saving.')
      return
    }

    setSaving(true)
    resetFeedback()
    setProgress({
      percent: 5,
      label: `Preparing ${candidates.length} card${candidates.length === 1 ? '' : 's'}...`,
    })

    try {
      await onSaveAll(
        candidates.map((candidate) => candidate.draft),
        (nextProgress) => {
          setProgress(nextProgress)
        },
      )

      setCandidates([])
      setIssues([])
      setEditingCandidateId(null)
      setSuccess(`Saved ${candidates.length} card${candidates.length === 1 ? '' : 's'}. Returning to the deck...`)
      setProgress({
        percent: 100,
        label: `Saved ${candidates.length} card${candidates.length === 1 ? '' : 's'}. Returning to the deck...`,
      })
      await new Promise((resolve) => window.setTimeout(resolve, 450))
      onComplete()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save these cards.')
      setProgress(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="filters-card quick-add-card bulk-card-generator">
      {!hasPreview && (
        <>
          <label className="field bulk-card-generator__source">
            <span>Source text</span>
            <textarea
              placeholder="Paste copied text here..."
              rows={14}
              value={sourceText}
              onChange={(event) => {
                setSourceText(event.target.value)
                if (candidates.length > 0 || issues.length > 0) {
                  clearPreview()
                }
                resetFeedback()
              }}
            />
          </label>

          <div className="field-grid bulk-card-generator__controls">
            <label className="field quick-add-toolbar__type">
              <span>Parser mode</span>
              <select
                value={parserMode}
                onChange={(event) => {
                  setParserMode(event.target.value as DocumentParserMode)
                  if (candidates.length > 0 || issues.length > 0) {
                    clearPreview()
                  }
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
        </>
      )}

      {error && <p className="error-text">{error}</p>}
      {success && <p className="hint-text">{success}</p>}

      {progress && (
        <div className="preview-card preview-card--accent bulk-card-generator__progress">
          <div className="panel-heading">
            <strong>{progress.label}</strong>
            <small>{progress.percent}%</small>
          </div>
          <div className="progress-track" aria-hidden="true">
            <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}

      <div className="modal-actions quick-add-actions bulk-card-generator__actions bulk-card-generator__actions--top">
        <button
          className="primary-button"
          disabled={hasPreview || parsing || saving || !sourceText.trim()}
          type="button"
          onClick={() => {
            void handleGenerate()
          }}
        >
          <Sparkles size={16} />
          {parsing ? 'Generating...' : 'Generate cards'}
        </button>

        <button
          className="ghost-button"
          disabled={saving || (!sourceText.trim() && candidates.length === 0)}
          type="button"
          onClick={() => {
            setSourceText('')
            clearPreview()
            resetFeedback()
          }}
        >
          Clear
        </button>
      </div>

      {editingCandidate && (
        <section ref={editorRef} className="editor-shell editor-shell--inline">
          <div className="editor-shell__header">
            <div className="editor-shell__copy">
              <p className="eyebrow">Review draft</p>
              <h2>Edit generated card</h2>
              <p>Refine this draft before it goes into the batch save.</p>
            </div>

            <div className="editor-shell__meta">
              <span className="status-pill">{editingCandidate.draft.type.replace('_', ' ')}</span>
              <span className="status-pill">
                {editingCandidate.confidence === 'high' ? 'High confidence' : 'Needs review'}
              </span>
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
                      ? { ...candidate, draft }
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
            <strong>Preview cards</strong>
            <small>{candidates.length} ready to save</small>
          </div>

          <div className="list-stack list-stack--scroll">
            {candidates.map((candidate) => {
              const summary = summarizeQuickAddDraft(candidate.draft)

              return (
                <article key={candidate.id} className="activity-item document-import-item">
                  <div className="quick-add-preview__meta">
                    <small>
                      {candidate.draft.type.replace('_', ' ')} · {candidate.confidence === 'high' ? 'High confidence' : 'Review suggested'}
                    </small>
                  </div>

                  <div className="bulk-card-generator__summary">
                    <p className="bulk-card-generator__summary-line bulk-card-generator__summary-line--prompt">
                      {summary.heading}
                    </p>
                    <p className="bulk-card-generator__summary-line">
                      {summary.detail || 'No answer yet.'}
                    </p>
                  </div>

                  {candidate.warnings.length > 0 && (
                    <p className="hint-text">{candidate.warnings.join(' ')}</p>
                  )}

                  <div className="document-import-item__actions">
                    <div className="inline-actions">
                      <button
                        className="ghost-button ghost-button--inline"
                        disabled={saving}
                        type="button"
                        onClick={() => setEditingCandidateId(candidate.id)}
                      >
                        <PencilLine size={16} />
                        Edit
                      </button>
                      <button
                        className="button-link button-link--danger"
                        disabled={saving}
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
        <div className="modal-actions quick-add-actions bulk-card-generator__actions">
          <button
            className="primary-button"
            disabled={saving}
            type="button"
            onClick={() => {
              void handleSaveAll()
            }}
          >
            {saving
              ? 'Saving...'
              : `Save ${candidates.length} card${candidates.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </section>
  )
}
