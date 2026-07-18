'use client'

import { ArrowLeft, BookOpen, PencilLine, Plus, Search, Sparkles, Star, Trash2, Volume2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Route } from 'next'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ExportMenu } from '../components/forms'
import { useAuth } from '../hooks/useAuth'
import { firstResourceError, useAutoPlayAudioPreference, useCards, useDeck, useFolders } from '../hooks/useMemoCards'
import { getCardPrompt, getCardSearchText } from '../lib/cardText'
import { formatSmartDate } from '../lib/utils'
import { deleteCard, deleteDeck, toggleCardFavorite } from '../services/memocards'
import type { Card } from '../types/models'

export function DeckPage() {
  const params = useParams<{ deckId: string }>()
  const deckId = typeof params.deckId === 'string' ? params.deckId : undefined
  const router = useRouter()
  const { user } = useAuth()
  const { data: folders } = useFolders(user?.id)
  const { data: deck, loading: deckLoading, error: deckError } = useDeck(user?.id, deckId)
  const { data: cards, loading: cardsLoading, error: cardsError } = useCards(user?.id, deckId)
  const loadError = firstResourceError(deckError, cardsError)
  const {
    autoPlayAudio,
    loading: autoPlayAudioLoading,
    saving: autoPlayAudioSaving,
    setAutoPlayAudio,
  } = useAutoPlayAudioPreference(user?.id)

  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('all')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [showDeleteDeckDialog, setShowDeleteDeckDialog] = useState(false)
  const [cardToDelete, setCardToDelete] = useState<Card | null>(null)
  const [audioPreferenceMessage, setAudioPreferenceMessage] = useState<string | null>(null)

  const tags = useMemo(
    () => Array.from(new Set(cards.flatMap((card) => card.tags))).sort((left, right) => left.localeCompare(right)),
    [cards],
  )

  const filteredCards = useMemo(() => {
    const query = search.trim().toLowerCase()
    return cards.filter((card) => {
      const searchMatch = !query || getCardSearchText(card).includes(query)
      const tagMatch = tagFilter === 'all' || card.tags.includes(tagFilter)
      const favoriteMatch = !favoritesOnly || card.isFavorite
      return searchMatch && tagMatch && favoriteMatch
    })
  }, [cards, favoritesOnly, search, tagFilter])

  if (!user || !deckId) {
    return null
  }

  if (deckLoading || cardsLoading) {
    return <div className="empty-panel">Loading deck...</div>
  }

  if (!deck) {
    return (
      <div className="empty-panel">
        <strong>Deck not found</strong>
        <Link className="ghost-button" href="/app">
          Back home
        </Link>
      </div>
    )
  }

  const folder = folders.find((item) => item.id === deck.folderId)
  const mastery = deck.counts.totalCards === 0
    ? 0
    : Math.round((deck.counts.masteredCards / deck.counts.totalCards) * 100)

  return (
    <div className="page-stack page-stack--deck">
      <div className="page-breadcrumb">
        <Link className="ghost-button" href="/app">
          <ArrowLeft size={16} />
          Back
        </Link>
      </div>

      <section className="deck-detail-hero deck-detail-hero--focus">
        <div className="deck-detail-hero__content">
          {(folder || deck.tags.length > 0) ? (
            <small className="deck-detail-hero__meta-line">
              {[folder?.name, deck.tags.length > 0 ? deck.tags.join(', ') : null].filter(Boolean).join(' · ')}
            </small>
          ) : null}
          <h1>{deck.title}</h1>
          {deck.description ? <p>{deck.description}</p> : null}
          <div className="deck-detail-hero__utilities">
            <label className="filter-toggle deck-detail-hero__audio-toggle">
              <input
                checked={autoPlayAudio}
                disabled={autoPlayAudioLoading || autoPlayAudioSaving}
                type="checkbox"
                onChange={(event) => {
                  setAudioPreferenceMessage(null)
                  void setAutoPlayAudio(event.target.checked).catch((reason) => {
                    setAudioPreferenceMessage(
                      reason instanceof Error
                        ? reason.message
                        : 'Unable to update the audio preference right now.',
                    )
                  })
                }}
              />
              <Volume2 size={16} />
              Auto-play audio
            </label>
          </div>
        </div>
        <div className="deck-detail-hero__actions">
          <div className="deck-detail-hero__actions-grid">
            <Link className="primary-button" href={`/app/decks/${deck.id}/study`}>
              <BookOpen size={16} />
              Study deck
            </Link>
            <Link className="primary-button" href={`/app/decks/${deck.id}/cards/new`}>
              <Plus size={16} />
              Add card
            </Link>
            <Link className="ghost-button" href={`/app/decks/${deck.id}/edit`}>
              <PencilLine size={16} />
              Edit deck
            </Link>
            <Link className="ghost-button" href={`/app/decks/${deck.id}/questions/generate` as Route}>
              <Sparkles size={16} />
              Generate questions
            </Link>
            <ExportMenu deck={deck} cards={cards} />
            <button
              className="ghost-button deck-detail-hero__delete"
              type="button"
              onClick={() => {
                setShowDeleteDeckDialog(true)
              }}
            >
              <Trash2 size={16} />
              Delete deck
            </button>
          </div>
        </div>
      </section>

      {loadError && <div className="warning-banner">Some of this deck failed to load: {loadError}</div>}
      {audioPreferenceMessage && <div className="warning-banner">{audioPreferenceMessage}</div>}

      <section className="summary-grid summary-grid--deck">
        <article className="summary-card">
          <strong>{deck.counts.totalCards}</strong>
          <span>cards</span>
        </article>
        <article className="summary-card">
          <strong>{deck.counts.dueCards}</strong>
          <span>due now</span>
        </article>
        <article className="summary-card">
          <strong>{deck.counts.masteredCards}</strong>
          <span>learned well</span>
        </article>
        <article className="summary-card">
          <strong>{mastery}%</strong>
          <span>learned</span>
        </article>
      </section>

      <section className="filters-card filters-card--deck">
        <div className="filters-grid">
          <label className="field filter-field">
            <span>Search</span>
            <div className="search-box">
              <Search size={16} />
              <input
                aria-label="Search cards"
                placeholder="Search cards, keywords, prompts"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </label>

          <label className="field filter-field">
            <span>Tag</span>
            <select aria-label="Filter cards by tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="all">All tags</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-toggle">
            <input checked={favoritesOnly} type="checkbox" onChange={(event) => setFavoritesOnly(event.target.checked)} />
            Favorites only
          </label>
        </div>
      </section>

      <section className="deck-workspace deck-workspace--single">
        <div className="card-list card-list--deck">
          {cards.length === 0 && (
            <article className="empty-panel empty-panel--onboarding">
              <strong>Add your first card</strong>
              <p>This deck is empty. Write a card yourself, or generate a batch from lesson text or photos.</p>
              <div className="empty-panel__actions">
                <Link className="primary-button" href={`/app/decks/${deck.id}/cards/new`}>
                  <Plus size={16} />
                  Add a card
                </Link>
                <Link className="ghost-button" href={`/app/decks/${deck.id}/questions/generate` as Route}>
                  <Sparkles size={16} />
                  Generate from a lesson
                </Link>
              </div>
            </article>
          )}
          {cards.length > 0 && filteredCards.length === 0 && (
            <article className="empty-panel">
              <strong>No cards match this filter</strong>
              <p>Try another search or clear a filter.</p>
              <div className="empty-panel__actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setTagFilter('all')
                    setFavoritesOnly(false)
                  }}
                >
                  Clear filters
                </button>
              </div>
            </article>
          )}

          {filteredCards.map((card) => (
            <article key={card.id} className="card-row card-row--deck">
              <div className="card-row__copy">
                <div className="card-row__body">
                  <small className="card-row__kicker">{card.type.replace('_', ' ')}</small>
                  <h2>{getCardPrompt(card)}</h2>
                  <div className="card-row__answerline">
                    <p>{card.answer || card.expectedAnswer.canonical || 'No answer yet.'}</p>
                  </div>
                </div>
              </div>
              <div className="card-row__meta card-row__meta--deck">
                <div className="card-row__stats">
                  <small>Due {formatSmartDate(card.reviewState.dueAt)}</small>
                  <small>{card.reviewState.mastery}% learned</small>
                  <small>{card.studyStats.totalReviews} reviews</small>
                  {card.tags.length > 0 ? <small>Tags: {card.tags.join(', ')}</small> : null}
                </div>
                <div className="card-row__actions card-row__actions--single">
                  <button
                    aria-label={card.isFavorite ? 'Unfavorite card' : 'Favorite card'}
                    className={
                      card.isFavorite
                        ? 'ghost-button ghost-button--icon card-row__icon-button card-row__icon-button--active'
                        : 'ghost-button ghost-button--icon card-row__icon-button'
                    }
                    title={card.isFavorite ? 'Unfavorite' : 'Favorite'}
                    type="button"
                    onClick={() => void toggleCardFavorite(user.id, deck.id, card)}
                  >
                    <Star size={15} />
                  </button>
                  <Link
                    aria-label="Edit card"
                    className="ghost-button ghost-button--icon card-row__icon-button"
                    href={`/app/decks/${deck.id}/cards/${card.id}/edit`}
                    title="Edit"
                  >
                    <PencilLine size={15} />
                  </Link>
                  <button
                    aria-label="Delete card"
                    className="ghost-button ghost-button--icon card-row__icon-button card-row__icon-button--danger"
                    title="Delete"
                    type="button"
                    onClick={() => setCardToDelete(card)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {showDeleteDeckDialog && (
        <ConfirmDialog
          title={`Delete ${deck.title}?`}
          description={`Delete this deck and remove all ${deck.counts.totalCards} card${deck.counts.totalCards === 1 ? '' : 's'} from it.`}
          note="This also removes study progress for this deck and cannot be undone."
          confirmLabel="Delete deck"
          onCancel={() => setShowDeleteDeckDialog(false)}
          onConfirm={async () => {
            setShowDeleteDeckDialog(false)
            await deleteDeck(user.id, deck.id)
            router.push('/app')
          }}
        />
      )}

      {cardToDelete && (
        <ConfirmDialog
          title="Delete this card?"
          description={`Remove "${getCardPrompt(cardToDelete)}" from ${deck.title}.`}
          note="This card's study progress will be lost and cannot be undone."
          confirmLabel="Delete card"
          onCancel={() => setCardToDelete(null)}
          onConfirm={async () => {
            const targetCard = cardToDelete
            setCardToDelete(null)
            await deleteCard(user.id, deck.id, targetCard.id)
          }}
        />
      )}
    </div>
  )
}
