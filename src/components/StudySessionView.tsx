'use client'

import { Headphones, RotateCcw, Sparkles, Volume2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getCardAnswer, getCardPrompt } from '../lib/cardText'
import { formatSmartDate, pluralize, shuffleArray } from '../lib/utils'
import type { Card, Deck, SelfAssessment, SessionCardResult, StudyMode } from '../types/models'

interface StudySessionViewProps {
  deck: Deck
  cards: Card[]
  onReview: (
    card: Card,
    assessment: SelfAssessment,
    mode: StudyMode,
    responseText: string,
  ) => Promise<void>
  onComplete: (mode: StudyMode, startedAt: string, results: SessionCardResult[]) => Promise<void>
  onQueueEvaluation: (card: Card, submittedAnswer: string) => Promise<'queued' | 'disabled' | void>
  onPlayAudio: (card: Card, side: 'prompt' | 'answer') => Promise<void>
}

function buildStudyQueueIds(
  cards: Card[],
  mode: StudyMode,
  favoritesOnly: boolean,
  shuffle: boolean,
) {
  let nextQueue = cards.filter((card) => (favoritesOnly ? card.isFavorite : true))

  if (mode === 'review') {
    nextQueue = nextQueue.filter((card) => card.reviewState.dueAt <= new Date().toISOString())
  }

  if (mode === 'learn') {
    nextQueue = [...nextQueue].sort(
      (left, right) => left.studyStats.totalReviews - right.studyStats.totalReviews,
    )
  }

  if (shuffle) {
    nextQueue = shuffleArray(nextQueue)
  }

  return nextQueue.map((card) => card.id)
}

const assessments: Array<{ value: SelfAssessment; label: string; hint: string }> = [
  { value: 'again', label: 'Again', hint: 'Reset card' },
  { value: 'hard', label: 'Hard', hint: 'Sooner review' },
  { value: 'good', label: 'Good', hint: 'Normal spacing' },
  { value: 'easy', label: 'Easy', hint: 'Longer spacing' },
]

export function StudySessionView({
  deck,
  cards,
  onReview,
  onComplete,
  onQueueEvaluation,
  onPlayAudio,
}: StudySessionViewProps) {
  const [mode, setMode] = useState<StudyMode>(deck.preferences.defaultMode)
  const [shuffle, setShuffle] = useState(deck.preferences.shuffleByDefault)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [sessionQueueIds, setSessionQueueIds] = useState<string[]>(() =>
    buildStudyQueueIds(cards, deck.preferences.defaultMode, false, deck.preferences.shuffleByDefault),
  )
  const [revealed, setRevealed] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [startedAt, setStartedAt] = useState(new Date().toISOString())
  const [typedAnswer, setTypedAnswer] = useState('')
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null)
  const [results, setResults] = useState<SessionCardResult[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [evaluationStatus, setEvaluationStatus] = useState<string | null>(null)

  const cardsById = useMemo(
    () => new Map(cards.map((card) => [card.id, card])),
    [cards],
  )
  const studyQueue = useMemo(
    () => sessionQueueIds.map((cardId) => cardsById.get(cardId)).filter((card): card is Card => Boolean(card)),
    [cardsById, sessionQueueIds],
  )

  const currentCard = studyQueue[currentIndex] ?? null
  const progress = studyQueue.length === 0 ? 0 : Math.min(100, (currentIndex / studyQueue.length) * 100)
  const sessionFinished = studyQueue.length > 0 && currentIndex >= studyQueue.length

  useEffect(() => {
    setMode(deck.preferences.defaultMode)
    setShuffle(deck.preferences.shuffleByDefault)
    setFavoritesOnly(false)
    setSessionQueueIds(
      buildStudyQueueIds(cards, deck.preferences.defaultMode, false, deck.preferences.shuffleByDefault),
    )
    setStartedAt(new Date().toISOString())
    setRevealed(false)
    setCurrentIndex(0)
    setTypedAnswer('')
    setSelectedChoiceId(null)
    setResults([])
    setSaving(false)
    setSaved(false)
    setEvaluationStatus(null)
  }, [deck.id, deck.preferences.defaultMode, deck.preferences.shuffleByDefault])

  useEffect(() => {
    setSessionQueueIds(buildStudyQueueIds(cards, mode, favoritesOnly, shuffle))
    setCurrentIndex(0)
    setStartedAt(new Date().toISOString())
    setResults([])
    setRevealed(false)
    setTypedAnswer('')
    setSelectedChoiceId(null)
    setSaved(false)
    setEvaluationStatus(null)
  }, [mode, shuffle, favoritesOnly])

  async function handleFinish(completedResults = results) {
    if (saving || saved || completedResults.length === 0) {
      return
    }

    setSaving(true)
    try {
      await onComplete(mode, startedAt, completedResults)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  async function handleAssessment(assessment: SelfAssessment) {
    if (!currentCard) {
      return
    }

    const responseText =
      currentCard.type === 'multiple_choice'
        ? currentCard.choices.find((choice) => choice.id === selectedChoiceId)?.text ?? ''
        : typedAnswer

    await onReview(currentCard, assessment, mode, responseText)

    const nextResults = [
      ...results,
      {
        cardId: currentCard.id,
        assessment,
        wasCorrect: assessment !== 'again',
        responseText,
      },
    ]
    const nextIndex = currentIndex + 1

    setResults(nextResults)
    setCurrentIndex(nextIndex)
    setRevealed(false)
    setTypedAnswer('')
    setSelectedChoiceId(null)
    setEvaluationStatus(null)

    if (nextIndex >= studyQueue.length) {
      void handleFinish(nextResults)
    }
  }

  useEffect(() => {
    if (sessionFinished && results.length > 0 && !saved && !saving) {
      void handleFinish()
    }
  }, [results.length, saved, saving, sessionFinished])

  if (sessionFinished) {
    const accuracy =
      results.length === 0
        ? 0
        : Math.round((results.filter((result) => result.wasCorrect).length / results.length) * 100)
    return (
      <section className="session-summary">
        <p className="eyebrow">Session complete</p>
        <h2>{deck.title}</h2>
        <div className="summary-grid">
          <article>
            <strong>{results.length}</strong>
            <span>cards studied</span>
          </article>
          <article>
            <strong>{accuracy}%</strong>
            <span>accuracy</span>
          </article>
          <article>
            <strong>{mode}</strong>
            <span>mode</span>
          </article>
        </div>
        <p>{saved ? 'Saved to Supabase and streak updated.' : saving ? 'Saving session...' : 'Wrapping up.'}</p>
        <button
          className="ghost-button"
          type="button"
          onClick={() => {
            setSessionQueueIds(buildStudyQueueIds(cards, mode, favoritesOnly, shuffle))
            setStartedAt(new Date().toISOString())
            setCurrentIndex(0)
            setResults([])
            setRevealed(false)
            setSaved(false)
          }}
        >
          <RotateCcw size={16} />
          Study again
        </button>
      </section>
    )
  }

  if (studyQueue.length === 0) {
    return (
      <section className="study-empty">
        <div>
          <p className="eyebrow">Study mode</p>
          <h2>{mode === 'review' ? 'Nothing due right now' : 'No cards match this filter'}</h2>
          <p>
            {mode === 'review'
              ? 'Switch to Learn or Cram to keep going, or add more cards to the deck.'
              : 'Try turning off favorites-only or create more cards.'}
          </p>
        </div>
        <div className="study-toolbar">
          <select value={mode} onChange={(event) => setMode(event.target.value as StudyMode)}>
            <option value="review">Review due</option>
            <option value="learn">Learn all</option>
            <option value="cram">Cram</option>
          </select>
          <label>
            <input checked={shuffle} type="checkbox" onChange={(event) => setShuffle(event.target.checked)} />
            Shuffle
          </label>
          <label>
            <input
              checked={favoritesOnly}
              type="checkbox"
              onChange={(event) => setFavoritesOnly(event.target.checked)}
            />
            Favorites only
          </label>
        </div>
      </section>
    )
  }

  return (
    <section className="study-layout">
      <div className="study-header">
        <div>
          <p className="eyebrow">{deck.title}</p>
          <h2>{pluralize(studyQueue.length, 'card')} in this run</h2>
        </div>
        <div className="study-toolbar">
          <select value={mode} onChange={(event) => setMode(event.target.value as StudyMode)}>
            <option value="review">Review due</option>
            <option value="learn">Learn all</option>
            <option value="cram">Cram</option>
          </select>
          <label>
            <input checked={shuffle} type="checkbox" onChange={(event) => setShuffle(event.target.checked)} />
            Shuffle
          </label>
          <label>
            <input
              checked={favoritesOnly}
              type="checkbox"
              onChange={(event) => setFavoritesOnly(event.target.checked)}
            />
            Favorites only
          </label>
        </div>
      </div>

      <div aria-hidden="true" className="progress-track">
        <span className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="study-card">
        <div className="study-card__meta">
          <span>{currentIndex + 1} / {studyQueue.length}</span>
          <span>{currentCard ? formatSmartDate(currentCard.reviewState.dueAt) : ''}</span>
        </div>

        <div className="study-card__content">
          <div className="study-card__header">
            <span className="pill">{currentCard?.type.replace('_', ' ')}</span>
            <div className="inline-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  if (!currentCard) {
                    return
                  }
                  void onPlayAudio(currentCard, revealed ? 'answer' : 'prompt')
                }}
              >
                <Volume2 size={16} />
                Audio
              </button>
            </div>
          </div>

          <div className="study-face">
            <h3>{currentCard ? getCardPrompt(currentCard) : ''}</h3>
            {currentCard?.type === 'multiple_choice' && (
              <div className="choice-stack">
                {currentCard.choices.map((choice) => (
                  <button
                    key={choice.id}
                    className={
                      selectedChoiceId === choice.id
                        ? 'choice-pill choice-pill--selected'
                        : 'choice-pill'
                    }
                    type="button"
                    onClick={() => {
                      setSelectedChoiceId(choice.id)
                      setTypedAnswer(choice.text)
                    }}
                  >
                    <strong>{choice.id}</strong>
                    <span>{choice.text}</span>
                  </button>
                ))}
              </div>
            )}

            {currentCard?.type === 'explanation' && !revealed && (
              <label className="field">
                <span>Your answer</span>
                <textarea
                  rows={6}
                  placeholder="Type your explanation before revealing the model answer."
                  value={typedAnswer}
                  onChange={(event) => setTypedAnswer(event.target.value)}
                />
              </label>
            )}
          </div>

          {revealed ? (
            <div className="answer-panel">
              <div className="answer-panel__header">
                <Headphones size={18} />
                <strong>Answer</strong>
              </div>
              <p>{currentCard ? getCardAnswer(currentCard) : ''}</p>
              {currentCard?.explanation && <p className="hint-text">{currentCard.explanation}</p>}
              {currentCard?.type === 'explanation' && (
                <div className="ai-ready">
                  <div>
                    <Sparkles size={16} />
                    <span>Future AI evaluation hook is ready for this card.</span>
                  </div>
                  <button
                    className="ghost-button"
                    disabled={!typedAnswer.trim()}
                    type="button"
                    onClick={() => {
                      if (!currentCard || !typedAnswer.trim()) {
                        return
                      }
                      void onQueueEvaluation(currentCard, typedAnswer.trim()).then((status) => {
                        setEvaluationStatus(
                          status === 'queued'
                            ? 'AI evaluation request queued for future processing.'
                            : 'AI evaluation is not enabled yet.',
                        )
                      })
                    }}
                  >
                    Queue evaluation
                  </button>
                </div>
              )}
              {evaluationStatus && <p className="hint-text">{evaluationStatus}</p>}
            </div>
          ) : (
            <button
              className="primary-button"
              disabled={currentCard?.type === 'multiple_choice' && !selectedChoiceId}
              type="button"
              onClick={() => setRevealed(true)}
            >
              Reveal answer
            </button>
          )}
        </div>

        {revealed && (
          <div className="assessment-row">
            {assessments.map((assessment) => (
              <button
                key={assessment.value}
                className="assessment-button"
                type="button"
                onClick={() => {
                  void handleAssessment(assessment.value)
                }}
              >
                <strong>{assessment.label}</strong>
                <small>{assessment.hint}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
