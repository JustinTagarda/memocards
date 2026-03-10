'use client'

import { ArrowLeft, Plus, Search, Star, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Modal } from '../components/Modal'
import { CardForm, DeckForm, ExportMenu } from '../components/forms'
import { useAuth } from '../hooks/useAuth'
import { useCards, useDeck, useFolders, useUserProfile } from '../hooks/useMemoCards'
import { getCardPrompt, getCardSearchText } from '../lib/cardText'
import { formatSmartDate } from '../lib/utils'
import { deleteCard, deleteDeck, saveCard, saveDeck, toggleCardFavorite } from '../services/memocards'
import type { Card } from '../types/models'

export function DeckPage() {
  const params = useParams<{ deckId: string }>()
  const deckId = typeof params.deckId === 'string' ? params.deckId : undefined
  const router = useRouter()
  const { user } = useAuth()
  const { data: profile } = useUserProfile(user?.id)
  const { data: folders } = useFolders(user?.id)
  const { data: deck, loading: deckLoading } = useDeck(user?.id, deckId)
  const { data: cards, loading: cardsLoading } = useCards(user?.id, deckId)

  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('all')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [showDeckModal, setShowDeckModal] = useState(false)
  const [showCardModal, setShowCardModal] = useState(false)
  const [editingCard, setEditingCard] = useState<Card | null>(null)

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
          Back to dashboard
        </Link>
      </div>
    )
  }

  const folder = folders.find((item) => item.id === deck.folderId)

  return (
    <div className="page-stack">
      <div className="page-breadcrumb">
        <Link className="ghost-button" href="/app">
          <ArrowLeft size={16} />
          Back
        </Link>
      </div>

      <section className="deck-detail-hero">
        <div>
          <p className="eyebrow">{folder?.name ?? 'Private deck'}</p>
          <h1>{deck.title}</h1>
          <p>{deck.description || 'Use this deck page to edit cards, manage tags, and export safely.'}</p>
          <div className="tag-row">
            {deck.tags.map((tag) => (
              <span key={tag} className="tag-pill">
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="hero-panel__actions">
          <button className="primary-button" type="button" onClick={() => router.push(`/app/decks/${deck.id}/study`)}>
            Study deck
          </button>
          <button className="ghost-button" type="button" onClick={() => setShowDeckModal(true)}>
            Edit deck
          </button>
          <button
            className="ghost-button danger-button"
            type="button"
            onClick={() => {
              void deleteDeck(user.id, deck.id).then(() => router.push('/app'))
            }}
          >
            Delete
          </button>
          <ExportMenu deck={deck} cards={cards} />
        </div>
      </section>

      <section className="summary-grid">
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
          <span>mastered</span>
        </article>
        <article className="summary-card">
          <strong>{deck.preferences.dailyGoal}</strong>
          <span>daily goal</span>
        </article>
      </section>

      <section className="dashboard-controls">
        <label className="search-box">
          <Search size={16} />
          <input
            placeholder="Search cards, keywords, prompts"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
          <option value="all">All tags</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>

        <label className="checkbox-inline">
          <input checked={favoritesOnly} type="checkbox" onChange={(event) => setFavoritesOnly(event.target.checked)} />
          Favorites only
        </label>

        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setEditingCard(null)
            setShowCardModal(true)
          }}
        >
          <Plus size={16} />
          Add card
        </button>
      </section>

      <section className="deck-workspace">
        <div className="card-list">
          {filteredCards.length === 0 && (
            <article className="empty-panel">
              <strong>No cards match this filter</strong>
              <p>Add a new card or clear the filters.</p>
            </article>
          )}

          {filteredCards.map((card) => (
            <article key={card.id} className="card-row">
              <div className="card-row__copy">
                <div className="inline-actions">
                  <span className="pill">{card.type.replace('_', ' ')}</span>
                  {card.isFavorite && <Star size={16} className="favorite-icon" />}
                </div>
                <h2>{getCardPrompt(card)}</h2>
                <p>{card.answer || card.expectedAnswer.canonical || 'No answer yet.'}</p>
                <div className="tag-row">
                  {card.tags.map((tag) => (
                    <span key={tag} className="tag-pill">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="card-row__meta">
                <small>Due {formatSmartDate(card.reviewState.dueAt)}</small>
                <small>{card.reviewState.mastery}% mastery</small>
                <small>{card.studyStats.totalReviews} reviews</small>
                <div className="inline-actions">
                  <button className="ghost-button" type="button" onClick={() => void toggleCardFavorite(user.id, deck.id, card)}>
                    {card.isFavorite ? 'Unfavorite' : 'Favorite'}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setEditingCard(card)
                      setShowCardModal(true)
                    }}
                  >
                    Edit
                  </button>
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteCard(user.id, deck.id, card.id)}>
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        <aside className="dashboard-side">
          <article className="side-panel">
            <div className="panel-heading">
              <strong>Future AI evaluation</strong>
            </div>
            <p>
              Explanation cards already store keywords, rubrics, and an evaluation request queue. The app
              uses self-assessment today and is ready for server-side scoring later.
            </p>
          </article>

          <article className="side-panel">
            <div className="panel-heading">
              <strong>Audio setup</strong>
            </div>
            <p>
              Prompt and answer audio are generated through Next.js API routes with Google Text-to-Speech,
              then stored privately in the MemoCards Supabase bucket.
            </p>
          </article>

          <article className="side-panel">
            <div className="panel-heading">
              <strong>User defaults</strong>
            </div>
            <p>Voice: {profile?.settings.defaultVoice ?? 'Not configured'}</p>
            <p>Auto-play: {profile?.settings.autoPlayAudio ? 'On' : 'Off'}</p>
          </article>
        </aside>
      </section>

      {showDeckModal && (
        <Modal title={`Edit ${deck.title}`} onClose={() => setShowDeckModal(false)} width="lg">
          <DeckForm
            folders={folders}
            initialValue={{
              title: deck.title,
              description: deck.description,
              folderId: deck.folderId,
              tags: deck.tags,
              preferences: deck.preferences,
            }}
            onCancel={() => setShowDeckModal(false)}
            onSubmit={async (draft) => {
              await saveDeck(user.id, draft, deck.id)
              setShowDeckModal(false)
            }}
          />
        </Modal>
      )}

      {showCardModal && profile && (
        <Modal title={editingCard ? 'Edit card' : 'Create card'} onClose={() => setShowCardModal(false)} width="lg">
          <CardForm
            initialValue={
              editingCard
                ? {
                    type: editingCard.type,
                    front: editingCard.front,
                    back: editingCard.back,
                    prompt: editingCard.prompt,
                    answer: editingCard.answer,
                    explanation: editingCard.explanation,
                    choices: editingCard.choices,
                    expectedAnswer: editingCard.expectedAnswer,
                    tags: editingCard.tags,
                    isFavorite: editingCard.isFavorite,
                  }
                : undefined
            }
            onCancel={() => {
              setShowCardModal(false)
              setEditingCard(null)
            }}
            onSubmit={async (draft) => {
              await saveCard(user.id, deck.id, draft, profile.settings, editingCard ?? undefined)
              setShowCardModal(false)
              setEditingCard(null)
            }}
          />
        </Modal>
      )}
    </div>
  )
}
