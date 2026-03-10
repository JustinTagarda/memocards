'use client'

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { buildDeckCsv, buildDeckExportBundle, createEmptyCardDraft, createEmptyDeckDraft, parseImportFile } from '../lib/importExport'
import { parseTags, triggerDownload } from '../lib/utils'
import type { Card, CardChoice, CardDraft, Deck, DeckDraft, Folder } from '../types/models'

interface DeckFormProps {
  initialValue?: DeckDraft
  folders: Folder[]
  onCancel: () => void
  onSubmit: (draft: DeckDraft) => Promise<void>
}

interface FolderFormProps {
  onCancel: () => void
  onSubmit: (name: string, color: string) => Promise<void>
}

interface CardFormProps {
  initialValue?: CardDraft
  onCancel: () => void
  onSubmit: (draft: CardDraft) => Promise<void>
}

interface ImportDialogProps {
  onCancel: () => void
  onSubmit: (payload: { deck: DeckDraft; cards: CardDraft[] }) => Promise<void>
}

interface ExportMenuProps {
  deck: Deck
  cards: Card[]
}

const folderColors = ['#f97316', '#facc15', '#10b981', '#0ea5e9', '#8b5cf6', '#ef4444']

function createChoice(id: string): CardChoice {
  return {
    id,
    text: '',
    isCorrect: id === 'A',
  }
}

function ensureMultipleChoiceChoices(choices: CardChoice[]) {
  const base = choices.length > 0 ? choices : ['A', 'B', 'C', 'D'].map(createChoice)
  while (base.length < 4) {
    const nextId = String.fromCharCode(65 + base.length)
    base.push(createChoice(nextId))
  }
  return base
}

export function DeckForm({ initialValue, folders, onCancel, onSubmit }: DeckFormProps) {
  const [draft, setDraft] = useState<DeckDraft>(initialValue ?? createEmptyDeckDraft())
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      await onSubmit({
        ...draft,
        title: draft.title.trim(),
        description: draft.description.trim(),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>Deck title</span>
        <input
          required
          maxLength={80}
          value={draft.title}
          onChange={(event) => {
            setDraft((current) => ({ ...current, title: event.target.value }))
          }}
        />
      </label>

      <label className="field">
        <span>Description</span>
        <textarea
          rows={4}
          value={draft.description}
          onChange={(event) => {
            setDraft((current) => ({ ...current, description: event.target.value }))
          }}
        />
      </label>

      <div className="field-grid">
        <label className="field">
          <span>Folder</span>
          <select
            value={draft.folderId ?? ''}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                folderId: event.target.value || null,
              }))
            }}
          >
            <option value="">No folder</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Default study mode</span>
          <select
            value={draft.preferences.defaultMode}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                preferences: {
                  ...current.preferences,
                  defaultMode: event.target.value as DeckDraft['preferences']['defaultMode'],
                },
              }))
            }}
          >
            <option value="review">Review due cards</option>
            <option value="learn">Learn all cards</option>
            <option value="cram">Cram mode</option>
          </select>
        </label>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Tags</span>
          <input
            placeholder="biology, exam 1"
            value={draft.tags.join(', ')}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                tags: parseTags(event.target.value),
              }))
            }}
          />
        </label>

        <label className="field">
          <span>Daily goal</span>
          <input
            min={5}
            max={100}
            type="number"
            value={draft.preferences.dailyGoal}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                preferences: {
                  ...current.preferences,
                  dailyGoal: Number(event.target.value),
                },
              }))
            }}
          />
        </label>
      </div>

      <div className="checkbox-row">
        <label>
          <input
            checked={draft.preferences.shuffleByDefault}
            type="checkbox"
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                preferences: {
                  ...current.preferences,
                  shuffleByDefault: event.target.checked,
                },
              }))
            }}
          />
          Shuffle by default
        </label>

        <label>
          <input
            checked={draft.preferences.autoPlayAudio}
            type="checkbox"
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                preferences: {
                  ...current.preferences,
                  autoPlayAudio: event.target.checked,
                },
              }))
            }}
          />
          Auto-play audio while studying
        </label>
      </div>

      <div className="modal-actions">
        <button className="ghost-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" disabled={saving || !draft.title.trim()} type="submit">
          {saving ? 'Saving...' : 'Save deck'}
        </button>
      </div>
    </form>
  )
}

export function FolderForm({ onCancel, onSubmit }: FolderFormProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(folderColors[0]!)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      await onSubmit(name, color)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>Folder name</span>
        <input required maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
      </label>

      <div className="color-picks" role="radiogroup" aria-label="Folder color">
        {folderColors.map((swatch) => (
          <button
            key={swatch}
            aria-label={`Choose ${swatch}`}
            className={color === swatch ? 'color-pick color-pick--active' : 'color-pick'}
            style={{ '--swatch': swatch } as CSSProperties}
            type="button"
            onClick={() => setColor(swatch)}
          />
        ))}
      </div>

      <div className="modal-actions">
        <button className="ghost-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" disabled={saving || !name.trim()} type="submit">
          {saving ? 'Saving...' : 'Create folder'}
        </button>
      </div>
    </form>
  )
}

export function CardForm({ initialValue, onCancel, onSubmit }: CardFormProps) {
  const [draft, setDraft] = useState<CardDraft>(initialValue ?? createEmptyCardDraft())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (draft.type === 'multiple_choice') {
      setDraft((current) => ({
        ...current,
        choices: ensureMultipleChoiceChoices(current.choices),
      }))
    }
  }, [draft.type])

  const typeLabels = useMemo(
    () =>
      ({
        basic: { first: 'Front', second: 'Back' },
        term: { first: 'Term', second: 'Definition' },
        multiple_choice: { first: 'Question', second: 'Correct answer' },
        explanation: { first: 'Prompt', second: 'Expected answer' },
      }) as const,
    [],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const normalizedChoices =
        draft.type === 'multiple_choice'
          ? draft.choices.filter((choice) => choice.text.trim())
          : []
      const correctChoiceText =
        draft.type === 'multiple_choice'
          ? normalizedChoices.find((choice) => choice.isCorrect)?.text.trim() ?? ''
          : draft.answer

      await onSubmit({
        ...draft,
        front:
          draft.type === 'basic' || draft.type === 'term'
            ? draft.front
            : draft.type === 'multiple_choice'
              ? draft.prompt
              : draft.prompt,
        back:
          draft.type === 'basic' || draft.type === 'term'
            ? draft.back
            : draft.type === 'multiple_choice'
              ? correctChoiceText
              : draft.expectedAnswer.canonical,
        prompt: draft.type === 'basic' || draft.type === 'term' ? draft.front : draft.prompt,
        answer:
          draft.type === 'basic' || draft.type === 'term'
            ? draft.back
            : draft.type === 'multiple_choice'
              ? correctChoiceText
              : draft.expectedAnswer.canonical,
        choices: normalizedChoices,
        tags: draft.tags,
        expectedAnswer: {
          ...draft.expectedAnswer,
          canonical:
            draft.type === 'explanation' ? draft.expectedAnswer.canonical : correctChoiceText || draft.answer,
        },
      })
    } finally {
      setSaving(false)
    }
  }

  function updateChoice(index: number, nextChoice: Partial<CardChoice>) {
    setDraft((current) => ({
      ...current,
      choices: current.choices.map((choice, choiceIndex) => {
        if (choiceIndex !== index) {
          return nextChoice.isCorrect
            ? {
                ...choice,
                isCorrect: false,
              }
            : choice
        }
        return {
          ...choice,
          ...nextChoice,
        }
      }),
    }))
  }

  const labelPair = typeLabels[draft.type]

  return (
    <form className="stack-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>Card type</span>
        <select
          value={draft.type}
          onChange={(event) => {
            setDraft((current) => ({
              ...current,
              type: event.target.value as CardDraft['type'],
            }))
          }}
        >
          <option value="basic">Basic Q/A</option>
          <option value="term">Term / definition</option>
          <option value="multiple_choice">Multiple choice</option>
          <option value="explanation">Explanation-based</option>
        </select>
      </label>

      {(draft.type === 'basic' || draft.type === 'term') && (
        <div className="field-grid">
          <label className="field">
            <span>{labelPair.first}</span>
            <textarea
              required
              rows={4}
              value={draft.front}
              onChange={(event) => {
                setDraft((current) => ({ ...current, front: event.target.value }))
              }}
            />
          </label>
          <label className="field">
            <span>{labelPair.second}</span>
            <textarea
              required
              rows={4}
              value={draft.back}
              onChange={(event) => {
                setDraft((current) => ({ ...current, back: event.target.value }))
              }}
            />
          </label>
        </div>
      )}

      {draft.type === 'multiple_choice' && (
        <>
          <label className="field">
            <span>{labelPair.first}</span>
            <textarea
              required
              rows={3}
              value={draft.prompt}
              onChange={(event) => {
                setDraft((current) => ({ ...current, prompt: event.target.value }))
              }}
            />
          </label>

          <div className="choice-list">
            {ensureMultipleChoiceChoices(draft.choices).map((choice, index) => (
              <label key={choice.id} className="choice-item">
                <span>{choice.id}</span>
                <input
                  required={index < 2}
                  placeholder={`Choice ${choice.id}`}
                  value={choice.text}
                  onChange={(event) => {
                    updateChoice(index, { text: event.target.value })
                  }}
                />
                <input
                  aria-label={`Mark choice ${choice.id} as correct`}
                  checked={choice.isCorrect}
                  type="radio"
                  name="correct-choice"
                  onChange={() => {
                    updateChoice(index, { isCorrect: true })
                  }}
                />
              </label>
            ))}
          </div>

          <label className="field">
            <span>Why this is correct</span>
            <textarea
              rows={3}
              value={draft.explanation}
              onChange={(event) => {
                setDraft((current) => ({ ...current, explanation: event.target.value }))
              }}
            />
          </label>
        </>
      )}

      {draft.type === 'explanation' && (
        <>
          <label className="field">
            <span>{labelPair.first}</span>
            <textarea
              required
              rows={4}
              value={draft.prompt}
              onChange={(event) => {
                setDraft((current) => ({ ...current, prompt: event.target.value }))
              }}
            />
          </label>
          <div className="field-grid">
            <label className="field">
              <span>{labelPair.second}</span>
              <textarea
                required
                rows={4}
                value={draft.expectedAnswer.canonical}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    expectedAnswer: {
                      ...current.expectedAnswer,
                      canonical: event.target.value,
                    },
                  }))
                }}
              />
            </label>
            <label className="field">
              <span>Keywords</span>
              <textarea
                rows={4}
                placeholder="osmosis, membrane, water concentration"
                value={draft.expectedAnswer.keywords.join(', ')}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    expectedAnswer: {
                      ...current.expectedAnswer,
                      keywords: parseTags(event.target.value),
                    },
                  }))
                }}
              />
            </label>
          </div>

          <label className="field">
            <span>Rubric for future AI evaluation</span>
            <textarea
              rows={3}
              value={draft.expectedAnswer.rubric}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  expectedAnswer: {
                    ...current.expectedAnswer,
                    rubric: event.target.value,
                  },
                }))
              }}
            />
          </label>
        </>
      )}

      <label className="field">
        <span>Tags</span>
        <input
          placeholder="hard, lecture 2"
          value={draft.tags.join(', ')}
          onChange={(event) => {
            setDraft((current) => ({ ...current, tags: parseTags(event.target.value) }))
          }}
        />
      </label>

      <label className="checkbox-inline">
        <input
          checked={draft.isFavorite}
          type="checkbox"
          onChange={(event) => {
            setDraft((current) => ({ ...current, isFavorite: event.target.checked }))
          }}
        />
        Mark as favorite
      </label>

      <div className="modal-actions">
        <button className="ghost-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" disabled={saving} type="submit">
          {saving ? 'Saving...' : 'Save card'}
        </button>
      </div>
    </form>
  )
}

export function ImportDialog({ onCancel, onSubmit }: ImportDialogProps) {
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<{ deck: DeckDraft; cards: CardDraft[] } | null>(null)

  async function handleFile(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (!file) {
      return
    }

    setParsing(true)
    setError(null)
    try {
      const content = await file.text()
      setPayload(parseImportFile(content, file.name))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to import that file.')
    } finally {
      setParsing(false)
    }
  }

  return (
    <div className="stack-form">
      <label className="field">
        <span>Choose a `.json` or `.csv` file</span>
        <input accept=".json,.csv,text/csv,application/json" type="file" onInput={handleFile} />
      </label>

      {parsing && <p className="hint-text">Parsing your deck...</p>}
      {error && <p className="error-text">{error}</p>}

      {payload && (
        <div className="preview-card">
          <strong>{payload.deck.title || 'Imported deck'}</strong>
          <p>{payload.deck.description || 'No description provided.'}</p>
          <p>{payload.cards.length} cards detected.</p>
        </div>
      )}

      <div className="modal-actions">
        <button className="ghost-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={!payload}
          type="button"
          onClick={() => {
            if (!payload) {
              return
            }
            void onSubmit(payload)
          }}
        >
          Import deck
        </button>
      </div>
    </div>
  )
}

export function ExportMenu({ deck, cards }: ExportMenuProps) {
  return (
    <div className="inline-actions">
      <button
        className="ghost-button"
        type="button"
        onClick={() => {
          const bundle = buildDeckExportBundle(deck, cards)
          triggerDownload(
            `${deck.title.replace(/\s+/g, '-').toLowerCase()}.json`,
            JSON.stringify(bundle, null, 2),
            'application/json',
          )
        }}
      >
        Export JSON
      </button>
      <button
        className="ghost-button"
        type="button"
        onClick={() => {
          triggerDownload(
            `${deck.title.replace(/\s+/g, '-').toLowerCase()}.csv`,
            buildDeckCsv(cards),
            'text/csv;charset=utf-8;',
          )
        }}
      >
        Export CSV
      </button>
    </div>
  )
}
