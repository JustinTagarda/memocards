'use client'

import { Headphones, RotateCcw, SlidersHorizontal, Sparkles, Volume2 } from 'lucide-react'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { getCardAnswer, getCardPrompt } from '../lib/cardText'
import { formatSmartDate, pluralize, shuffleArray } from '../lib/utils'
import type { Card, Deck, SelfAssessment, SessionCardResult, StudyMode } from '../types/models'

const studyModeLabels: Record<StudyMode, string> = {
  review: 'Review due',
  learn: 'Learn all',
  cram: 'Cram',
}

interface StudySessionViewProps {
  deck: Deck
  cards: Card[]
  autoPlayAudio: boolean
  autoPlayAudioDisabled?: boolean
  onReview: (
    card: Card,
    assessment: SelfAssessment,
    mode: StudyMode,
    responseText: string,
  ) => Promise<void>
  onComplete: (mode: StudyMode, startedAt: string, results: SessionCardResult[]) => Promise<void>
  onAutoPlayAudioChange: (enabled: boolean) => Promise<void> | void
  onQueueEvaluation: (card: Card, submittedAnswer: string) => Promise<'queued' | 'disabled' | void>
  onPlayAudio: (card: Card, side: 'prompt' | 'answer') => Promise<void>
  onWarmAudio?: (card: Card, side: 'prompt' | 'answer') => Promise<void> | void
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

const assessments: Array<{ value: SelfAssessment; label: string; hint: string; tooltip: string }> = [
  {
    value: 'again',
    label: 'Again',
    hint: 'Reset card',
    tooltip: 'Choose Again if you missed it or were mostly guessing. The card will come back soon so you can rebuild it.',
  },
  {
    value: 'hard',
    label: 'Hard',
    hint: 'Sooner review',
    tooltip: 'Choose Hard if you got it, but only with effort. The card stays in rotation and returns sooner than normal.',
  },
  {
    value: 'good',
    label: 'Good',
    hint: 'Normal spacing',
    tooltip: 'Choose Good if you remembered it correctly without much trouble. This is the normal successful review option.',
  },
  {
    value: 'easy',
    label: 'Easy',
    hint: 'Longer spacing',
    tooltip: 'Choose Easy if the answer was immediate and obvious. The card will be scheduled farther out than usual.',
  },
]

export function StudySessionView({
  deck,
  cards,
  autoPlayAudio,
  autoPlayAudioDisabled = false,
  onReview,
  onComplete,
  onAutoPlayAudioChange,
  onQueueEvaluation,
  onPlayAudio,
  onWarmAudio,
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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [evaluationStatus, setEvaluationStatus] = useState<string | null>(null)
  const [mobileOptionsOpen, setMobileOptionsOpen] = useState(false)

  const cardsById = useMemo(
    () => new Map(cards.map((card) => [card.id, card])),
    [cards],
  )
  const studyQueue = useMemo(
    () => sessionQueueIds.map((cardId) => cardsById.get(cardId)).filter((card): card is Card => Boolean(card)),
    [cardsById, sessionQueueIds],
  )

  const currentCard = studyQueue[currentIndex] ?? null
  const nextCard = studyQueue[currentIndex + 1] ?? null
  const progress = studyQueue.length === 0 ? 0 : Math.min(100, (currentIndex / studyQueue.length) * 100)
  const mobileOptionsSummary = [
    studyModeLabels[mode],
    shuffle ? 'Shuffled' : 'In order',
    favoritesOnly ? 'Favorites only' : 'All cards',
  ].join(' · ')
  const sessionFinished = studyQueue.length > 0 && currentIndex >= studyQueue.length
  const noCardsInDeck = cards.length === 0
  const emptyTitle = noCardsInDeck
    ? 'This deck has no cards yet'
    : mode === 'review'
      ? 'Nothing is due right now'
      : 'No cards match these filters'
  const emptyMessage = noCardsInDeck
    ? 'Add a few cards in this deck, then come back when you want to study.'
    : mode === 'review'
      ? 'Switch to Learn or Cram if you still want to study today.'
      : 'Try turning off favorites only or switch modes to keep going.'
  const playAudioForCard = useEffectEvent(onPlayAudio)
  const warmAudioForCard = useEffectEvent(onWarmAudio ?? (() => undefined))

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
    setSaveError(null)
    setEvaluationStatus(null)
    setMobileOptionsOpen(false)
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
    setSaveError(null)
    setEvaluationStatus(null)
    setMobileOptionsOpen(false)
  }, [mode, shuffle, favoritesOnly])

  async function handleFinish(completedResults = results) {
    if (saving || saved || completedResults.length === 0) {
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      await onComplete(mode, startedAt, completedResults)
      setSaved(true)
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'Unable to save this session.')
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

    setReviewError(null)
    try {
      await onReview(currentCard, assessment, mode, responseText)
    } catch (reason) {
      setReviewError(reason instanceof Error ? reason.message : 'Unable to save that review. Try again.')
      return
    }

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
    // saveError intentionally blocks auto-retry: a persistent failure would
    // otherwise loop forever. The summary screen offers a manual retry.
    if (sessionFinished && results.length > 0 && !saved && !saving && !saveError) {
      void handleFinish()
    }
  }, [results.length, saved, saveError, saving, sessionFinished])

  useEffect(() => {
    if (!autoPlayAudio || revealed || !currentCard) {
      return
    }

    void playAudioForCard(currentCard, 'prompt')
  }, [autoPlayAudio, currentCard?.id, revealed])

  useEffect(() => {
    if (!currentCard) {
      return
    }

    void warmAudioForCard(currentCard, 'prompt')
    void warmAudioForCard(currentCard, 'answer')

    if (nextCard) {
      void warmAudioForCard(nextCard, 'prompt')
    }
  }, [currentCard?.id, nextCard?.id])

  const canReveal =
    Boolean(currentCard) && !revealed && !(currentCard?.type === 'multiple_choice' && !selectedChoiceId)

  const handleShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || sessionFinished || !currentCard) {
      return
    }

    const target = event.target as HTMLElement | null
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return
    }

    if ((event.key === ' ' || event.key === 'Enter') && canReveal) {
      event.preventDefault()
      setRevealed(true)
      return
    }

    if (revealed && event.key >= '1' && event.key <= '4') {
      const assessment = assessments[Number(event.key) - 1]
      if (assessment) {
        event.preventDefault()
        void handleAssessment(assessment.value)
      }
    }
  })

  useEffect(() => {
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  if (sessionFinished) {
    const accuracy =
      results.length === 0
        ? 0
        : Math.round((results.filter((result) => result.wasCorrect).length / results.length) * 100)
    return (
      <section className="session-summary">
        <h2>{deck.title}</h2>
        <div className="summary-grid">
          <article>
            <strong>{results.length}</strong>
            <span>cards studied</span>
          </article>
          <article>
            <strong>{accuracy}%</strong>
            <span>correct</span>
          </article>
          <article>
            <strong>{mode}</strong>
            <span>mode</span>
          </article>
        </div>
        <small className="hint-text">{saved ? 'Saved.' : saving ? 'Saving...' : saveError ?? 'Wrapping up.'}</small>
        {saveError && !saved && (
          <button
            className="primary-button"
            disabled={saving}
            type="button"
            onClick={() => {
              void handleFinish()
            }}
          >
            Retry saving session
          </button>
        )}
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
            setSaveError(null)
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
      <section className="study-empty study-empty--clear">
        <div className="study-empty__top">
          <div className="study-empty__intro">
            <h2>{emptyTitle}</h2>
            <p>{emptyMessage}</p>
          </div>
          {!noCardsInDeck && (
            <div className="study-empty__actions">
              {mode !== 'learn' && (
                <button className="primary-button" type="button" onClick={() => setMode('learn')}>
                  Study all cards
                </button>
              )}
              {mode !== 'cram' && (
                <button className="ghost-button" type="button" onClick={() => setMode('cram')}>
                  Start cram mode
                </button>
              )}
              {favoritesOnly && (
                <button className="ghost-button" type="button" onClick={() => setFavoritesOnly(false)}>
                  Show all cards
                </button>
              )}
            </div>
          )}
        </div>
        <div className="study-toolbar study-toolbar--empty">
          <label className="inline-field">
            <span>Mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as StudyMode)}>
              <option value="review">Review due</option>
              <option value="learn">Learn all</option>
              <option value="cram">Cram</option>
            </select>
          </label>
          <label className="filter-toggle">
            <input checked={shuffle} type="checkbox" onChange={(event) => setShuffle(event.target.checked)} />
            Shuffle
          </label>
          <label className="filter-toggle">
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
        <div className="study-header__copy">
          <h2>{deck.title}</h2>
          <p className="hint-text">{pluralize(studyQueue.length, 'card')} in this run</p>
        </div>
        <div className="study-header__mobile-toggle">
          <span className="study-header__summary">{mobileOptionsSummary}</span>
          <button
            aria-controls="study-session-options"
            aria-expanded={mobileOptionsOpen}
            className="ghost-button study-header__options-toggle"
            type="button"
            onClick={() => setMobileOptionsOpen((open) => !open)}
          >
            <SlidersHorizontal size={16} />
            Session options
          </button>
        </div>
        <div
          id="study-session-options"
          className={
            mobileOptionsOpen
              ? 'study-toolbar study-toolbar--active study-toolbar--mobile-open'
              : 'study-toolbar study-toolbar--active study-toolbar--mobile-collapsed'
          }
        >
          <label className="inline-field">
            <span>Mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as StudyMode)}>
              <option value="review">Review due</option>
              <option value="learn">Learn all</option>
              <option value="cram">Cram</option>
            </select>
          </label>
          <label className="filter-toggle">
            <input checked={shuffle} type="checkbox" onChange={(event) => setShuffle(event.target.checked)} />
            Shuffle
          </label>
          <label className="filter-toggle">
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
          <span>{currentCard ? `Due ${formatSmartDate(currentCard.reviewState.dueAt)}` : ''}</span>
        </div>

        <div className={revealed ? 'study-card__content study-card__content--revealed' : 'study-card__content'}>
          <div className="study-card__header">
            <div className="inline-actions inline-actions--study">
              <label className="filter-toggle">
                <input
                  disabled={autoPlayAudioDisabled}
                  checked={autoPlayAudio}
                  type="checkbox"
                  onChange={(event) => {
                    void onAutoPlayAudioChange(event.target.checked)
                  }}
                />
                <Volume2 size={16} />
                Auto-play audio
              </label>
            </div>
          </div>

          <div className={revealed ? 'study-face study-face--revealed' : 'study-face'}>
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
                  placeholder="Write your answer before you reveal the model answer."
                  value={typedAnswer}
                  onChange={(event) => setTypedAnswer(event.target.value)}
                />
              </label>
            )}
          </div>

          {revealed && (
            <div className="answer-panel">
              <div className="answer-panel__header">
                <Headphones size={18} />
                <strong>Model answer</strong>
              </div>
              <p>{currentCard ? getCardAnswer(currentCard) : ''}</p>
              {currentCard?.explanation && <p className="hint-text">{currentCard.explanation}</p>}
              {currentCard?.type === 'explanation' && (
                <div className="ai-ready">
                  <div>
                    <Sparkles size={16} />
                    <span>Save your answer for later.</span>
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
                            ? 'Saved for later review.'
                            : 'Extra review is not turned on yet.',
                        )
                      })
                    }}
                  >
                    Save for later
                  </button>
                </div>
              )}
              {evaluationStatus && <p className="hint-text">{evaluationStatus}</p>}
            </div>
          )}
        </div>

        <div className={revealed ? 'study-card__actions study-card__actions--revealed' : 'study-card__actions'}>
          {reviewError && <p className="error-text">{reviewError}</p>}
          {revealed ? (
            <div className="assessment-row">
              {assessments.map((assessment, index) => (
                <button
                  key={assessment.value}
                  aria-describedby={`assessment-tip-${assessment.value}`}
                  className="assessment-button"
                  title={assessment.tooltip}
                  type="button"
                  onClick={() => {
                    void handleAssessment(assessment.value)
                  }}
                >
                  <kbd aria-hidden="true" className="assessment-button__key">{index + 1}</kbd>
                  <strong>{assessment.label}</strong>
                  <small>{assessment.hint}</small>
                  <span id={`assessment-tip-${assessment.value}`} className="assessment-button__tooltip" role="tooltip">
                    {assessment.tooltip}
                  </span>
                </button>
              ))}
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
          <small className="study-shortcut-hint" aria-hidden="true">
            {revealed ? 'Press 1–4 to rate this card' : 'Press Space to reveal the answer'}
          </small>
        </div>
      </div>
    </section>
  )
}
