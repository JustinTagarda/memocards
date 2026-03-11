'use client'

import { ArrowLeft, Plus, Search, Star, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Route } from 'next'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Modal } from '../components/Modal'
import { QuickAddComposer } from '../components/QuickAddComposer'
import { CardForm, DeckForm, ExportMenu } from '../components/forms'
import { useAuth } from '../hooks/useAuth'
import { useCards, useDeck, useFolders, useUserProfile } from '../hooks/useMemoCards'
import {
  applyEntryDefaultsToDraft,
  buildContinueCardDraft,
  buildCreateCardDraft,
  loadDeckEntryMemory,
  saveDeckEntryMemory,
} from '../lib/cardEntry'
import { getCardPrompt, getCardSearchText } from '../lib/cardText'
import { formatSmartDate } from '../lib/utils'
import { deleteCard, deleteDeck, saveCard, saveDeck, toggleCardFavorite } from '../services/memocards'
import type { Card, CardDraft } from '../types/models'

function createEmptyEntryMemory() {
  return {
    lastSavedDraft: null,
    lastCardType: null,
    lastTags: [],
  }
}

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
  const [quickAddDraft, setQuickAddDraft] = useState<CardDraft | null>(null)
  const [entryMemory, setEntryMemory] = useState(() => (deckId ? loadDeckEntryMemory(deckId) : createEmptyEntryMemory()))

  useEffect(() => {
    setEntryMemory(deckId ? loadDeckEntryMemory(deckId) : createEmptyEntryMemory())
  }, [deckId])

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
  const existingQuestions = useMemo(() => cards.map((card) => getCardPrompt(card)), [cards])

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

  const activeUser = user
  const activeDeck = deck
  const folder = folders.find((item) => item.id === deck.folderId)
  const mastery = deck.counts.totalCards === 0
    ? 0
    : Math.round((deck.counts.masteredCards / deck.counts.totalCards) * 100)
  const entryDefaults = deck.preferences.entryDefaults
  const createCardFallback = buildCreateCardDraft(entryDefaults, entryMemory)
  const quickAddPreferredType = entryMemory.lastCardType ?? entryDefaults.cardType

  function rememberCreatedDraft(draft: CardDraft) {
    saveDeckEntryMemory(activeDeck.id, draft)
    setEntryMemory(loadDeckEntryMemory(activeDeck.id))
  }

  async function saveNewCard(draft: CardDraft) {
    if (!profile) {
      throw new Error('Profile not ready yet.')
    }

    const nextDraft = applyEntryDefaultsToDraft(draft, entryDefaults, entryMemory)
    await saveCard(activeUser.id, activeDeck.id, nextDraft, profile.settings)
    rememberCreatedDraft(nextDraft)
    return nextDraft
  }

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
          <span className="folder-chip" style={{ '--folder-color': folder?.color ?? '#f26a2e' } as CSSProperties}>
            {folder?.name ?? 'Private deck'}
          </span>
          <h1>{deck.title}</h1>
          <p>{deck.description || 'Add cards, keep things tidy, and jump into study whenever you are ready.'}</p>
          <div className="tag-row">
            {deck.tags.length > 0 ? (
              deck.tags.map((tag) => (
                <span key={tag} className="tag-pill">
                  {tag}
                </span>
              ))
            ) : (
              <span className="muted-label">No tags yet</span>
            )}
          </div>
        </div>
        <div className="deck-detail-hero__actions">
          <div className="deck-detail-hero__actions-grid">
            <button className="primary-button" type="button" onClick={() => router.push(`/app/decks/${deck.id}/study`)}>
              Study deck
            </button>
            <button className="ghost-button" type="button" onClick={() => setShowDeckModal(true)}>
              Edit deck
            </button>
            <ExportMenu deck={deck} cards={cards} />
          </div>
          <div className="deck-detail-hero__actions-delete">
            <button
              className="button-link button-link--danger deck-detail-hero__delete"
              type="button"
              onClick={() => {
                void deleteDeck(user.id, deck.id).then(() => router.push('/app'))
              }}
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        </div>
      </section>

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
        <div className="section-heading">
          <div>
            <p className="eyebrow">Find a card</p>
            <h2>Search this deck</h2>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              setEditingCard(null)
              setQuickAddDraft(null)
              setShowCardModal(true)
            }}
          >
            <Plus size={16} />
            Add card
          </button>
        </div>

        <div className="filters-grid">
          <label className="field filter-field">
            <span>Search</span>
            <div className="search-box">
              <Search size={16} />
              <input
                placeholder="Search cards, keywords, prompts"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </label>

          <label className="field filter-field">
            <span>Tag</span>
            <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
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

      {profile && (
        <QuickAddComposer
          deckId={deck.id}
          existingQuestions={existingQuestions}
          footerAction={
            <Link className="ghost-button" href={`/app/decks/${deck.id}/import` as Route}>
              <Upload size={16} />
              Import notes
            </Link>
          }
          preferredType={quickAddPreferredType}
          onExpand={(draft) => {
            setEditingCard(null)
            setQuickAddDraft(applyEntryDefaultsToDraft(draft, entryDefaults, entryMemory))
            setShowCardModal(true)
          }}
          onSave={async (draft) => {
            await saveNewCard(draft)
          }}
        />
      )}

      <section className="deck-workspace">
        <div className="card-list">
          {filteredCards.length === 0 && (
            <article className="empty-panel">
              <strong>No cards match this filter</strong>
              <p>Try another search, clear a filter, or add a new card.</p>
            </article>
          )}

          {filteredCards.map((card) => (
            <article key={card.id} className="card-row card-row--deck">
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
              <div className="card-row__meta card-row__meta--deck">
                <div className="card-row__stats">
                  <small>Due {formatSmartDate(card.reviewState.dueAt)}</small>
                  <small>{card.reviewState.mastery}% learned</small>
                  <small>{card.studyStats.totalReviews} reviews</small>
                </div>
                <div className="card-row__actions">
                  <div className="card-row__actions-main">
                    <button className="ghost-button" type="button" onClick={() => void toggleCardFavorite(user.id, deck.id, card)}>
                      {card.isFavorite ? 'Unfavorite' : 'Favorite'}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        setEditingCard(card)
                        setQuickAddDraft(null)
                        setShowCardModal(true)
                      }}
                    >
                      Edit
                    </button>
                  </div>
                  <button className="button-link button-link--danger card-row__delete" type="button" onClick={() => void deleteCard(user.id, deck.id, card.id)}>
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        <aside className="dashboard-side">
          <article className="side-panel side-panel--compact">
            <div className="panel-heading">
              <strong>Long-answer cards</strong>
            </div>
            <p>
              Longer response cards can store keywords, model answers, and extra notes so you can review
              them more clearly later.
            </p>
          </article>

          <article className="side-panel side-panel--compact">
            <div className="panel-heading">
              <strong>Audio</strong>
            </div>
            <p>
              Tap audio on a study card when you want to hear the question or answer out loud.
            </p>
          </article>

          <article className="side-panel side-panel--compact">
            <div className="panel-heading">
              <strong>Your settings</strong>
            </div>
            <p>Voice: {profile?.settings.defaultVoice ?? 'Not set'}</p>
            <p>Auto-play setting: {profile?.settings.autoPlayAudio ? 'On' : 'Off'}</p>
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
        <Modal
          title={editingCard ? 'Edit card' : 'Create card'}
          onClose={() => {
            setShowCardModal(false)
            setEditingCard(null)
            setQuickAddDraft(null)
          }}
          width="lg"
        >
          <CardForm
            fallbackValue={!editingCard ? createCardFallback : undefined}
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
                : quickAddDraft ?? undefined
            }
            isEditing={Boolean(editingCard)}
            lastSavedDraft={entryMemory.lastSavedDraft}
            storageKey={!editingCard ? deck.id : undefined}
            onCancel={() => {
              setShowCardModal(false)
              setEditingCard(null)
              setQuickAddDraft(null)
            }}
            onSubmit={async (draft) => {
              if (editingCard) {
                await saveCard(user.id, deck.id, draft, profile.settings, editingCard)
              } else {
                await saveNewCard(draft)
              }
              setShowCardModal(false)
              setEditingCard(null)
              setQuickAddDraft(null)
            }}
            onSubmitAndContinue={
              editingCard
                ? undefined
                : async (draft) => {
                    const savedDraft = await saveNewCard(draft)
                    return buildContinueCardDraft(savedDraft, entryDefaults)
                  }
            }
          />
        </Modal>
      )}
    </div>
  )
}
