'use client'

import { ArrowLeft } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CardForm } from '../components/forms'
import { useAuth } from '../hooks/useAuth'
import { useCards, useDeck, useUserProfile } from '../hooks/useMemoCards'
import {
  applyEntryDefaultsToDraft,
  buildContinueCardDraft,
  buildCreateCardDraft,
  loadDeckEntryMemory,
  saveDeckEntryMemory,
} from '../lib/cardEntry'
import { cardToDraft } from '../lib/formDrafts'
import { getCardPrompt } from '../lib/cardText'
import { saveCard } from '../services/memocards'
import type { CardDraft } from '../types/models'

interface CardEditorPageProps {
  mode: 'create' | 'edit'
}

function createEmptyEntryMemory() {
  return {
    lastSavedDraft: null,
    lastCardType: null,
    lastTags: [],
  }
}

export function CardEditorPage({ mode }: CardEditorPageProps) {
  const params = useParams<{ deckId: string; cardId: string }>()
  const deckId = typeof params.deckId === 'string' ? params.deckId : undefined
  const cardId = typeof params.cardId === 'string' ? params.cardId : undefined
  const router = useRouter()
  const { user } = useAuth()
  const { data: profile, loading: profileLoading } = useUserProfile(user?.id)
  const { data: deck, loading: deckLoading } = useDeck(user?.id, deckId)
  const { data: cards, loading: cardsLoading } = useCards(user?.id, mode === 'edit' ? deckId : undefined)
  const [entryMemory, setEntryMemory] = useState(() => (deckId ? loadDeckEntryMemory(deckId) : createEmptyEntryMemory()))

  useEffect(() => {
    if (mode === 'create') {
      setEntryMemory(deckId ? loadDeckEntryMemory(deckId) : createEmptyEntryMemory())
    }
  }, [deckId, mode])

  if (!user || !deckId) {
    return null
  }

  if (profileLoading || deckLoading || cardsLoading) {
    return <div className="empty-panel">Loading card editor...</div>
  }

  if (!profile) {
    return (
      <div className="empty-panel">
        <strong>Profile not ready</strong>
        <p>Refresh and try again once your study profile loads.</p>
      </div>
    )
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

  const editingCard = mode === 'edit' ? cards.find((card) => card.id === cardId) ?? null : null

  if (mode === 'edit' && !editingCard) {
    return (
      <div className="empty-panel">
        <strong>Card not found</strong>
        <Link className="ghost-button" href={`/app/decks/${deck.id}` as Route}>
          Back to deck
        </Link>
      </div>
    )
  }

  const activeDeck = deck
  const activeUser = user
  const activeProfile = profile
  const backHref = `/app/decks/${activeDeck.id}`
  const entryDefaults = activeDeck.preferences.entryDefaults
  const createCardFallback = buildCreateCardDraft(entryDefaults, entryMemory)
  const heading = editingCard ? 'Edit card' : `Add a card to ${activeDeck.title}`
  const metaText = editingCard
    ? `${activeDeck.title} · ${editingCard.tags.length} tag${editingCard.tags.length === 1 ? '' : 's'}`
    : `${activeDeck.title} · ${activeDeck.counts.totalCards} card${activeDeck.counts.totalCards === 1 ? '' : 's'}`

  function rememberCreatedDraft(draft: CardDraft) {
    saveDeckEntryMemory(activeDeck.id, draft)
    setEntryMemory(loadDeckEntryMemory(activeDeck.id))
  }

  async function saveNewCard(draft: CardDraft) {
    const nextDraft = applyEntryDefaultsToDraft(draft, entryDefaults, entryMemory)
    await saveCard(activeUser.id, activeDeck.id, nextDraft, activeProfile.settings)
    rememberCreatedDraft(nextDraft)
    return nextDraft
  }

  return (
    <div className="page-stack page-stack--editor">
      <div className="page-breadcrumb">
        <Link className="ghost-button" href={backHref as Route}>
          <ArrowLeft size={16} />
          Back to deck
        </Link>
      </div>

      <section className="editor-shell editor-shell--card">
        <div className="editor-shell__header">
          <div className="editor-shell__copy">
            <h1>{heading}</h1>
          </div>

          <div className="editor-shell__meta">
            <small className="editor-shell__meta-text">{metaText}</small>
          </div>
        </div>

        {editingCard ? (
          <div className="editor-shell__note">
            <small>Editing</small>
            <strong>{getCardPrompt(editingCard)}</strong>
          </div>
        ) : null}

        <div className="editor-shell__body">
          <CardForm
            fallbackValue={!editingCard ? createCardFallback : undefined}
            initialValue={editingCard ? cardToDraft(editingCard) : undefined}
            isEditing={Boolean(editingCard)}
            lastSavedDraft={entryMemory.lastSavedDraft}
            storageKey={!editingCard ? activeDeck.id : undefined}
            onCreateMultiple={
              editingCard
                ? undefined
                : () => {
                    router.push(`/app/decks/${activeDeck.id}/questions/generate` as Route)
                  }
            }
            onCancel={() => router.push(backHref as Route)}
            onSubmit={async (draft) => {
              if (editingCard) {
                await saveCard(activeUser.id, activeDeck.id, draft, activeProfile.settings, editingCard)
              } else {
                await saveNewCard(draft)
              }
              router.push(backHref as Route)
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
        </div>
      </section>
    </div>
  )
}
