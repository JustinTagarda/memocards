'use client'

import { ArrowLeft, BookOpen, Files } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { BulkCardGenerator } from '../components/BulkCardGenerator'
import { useAuth } from '../hooks/useAuth'
import { useDeck, useUserProfile } from '../hooks/useMemoCards'
import { applyEntryDefaultsToDraft, loadDeckEntryMemory, saveDeckEntryMemory } from '../lib/cardEntry'
import { saveCardsBatch } from '../services/memocards'
import type { CardDraft } from '../types/models'

function createEmptyEntryMemory() {
  return {
    lastSavedDraft: null,
    lastCardType: null,
    lastTags: [],
  }
}

export function BulkCardGeneratorPage() {
  const params = useParams<{ deckId: string }>()
  const deckId = typeof params.deckId === 'string' ? params.deckId : undefined
  const router = useRouter()
  const { user } = useAuth()
  const { data: profile, loading: profileLoading } = useUserProfile(user?.id)
  const { data: deck, loading: deckLoading } = useDeck(user?.id, deckId)
  const [entryMemory, setEntryMemory] = useState(() => (deckId ? loadDeckEntryMemory(deckId) : createEmptyEntryMemory()))

  useEffect(() => {
    setEntryMemory(deckId ? loadDeckEntryMemory(deckId) : createEmptyEntryMemory())
  }, [deckId])

  if (!user || !deckId) {
    return null
  }

  if (profileLoading || deckLoading) {
    return <div className="empty-panel">Loading bulk card generator...</div>
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

  const activeDeck = deck
  const activeUser = user
  const activeProfile = profile
  const backHref = `/app/decks/${activeDeck.id}`
  const entryDefaults = activeDeck.preferences.entryDefaults

  function rememberLastDraft(draft: CardDraft) {
    saveDeckEntryMemory(activeDeck.id, draft)
    setEntryMemory(loadDeckEntryMemory(activeDeck.id))
  }

  return (
    <div className="page-stack page-stack--editor">
      <div className="page-breadcrumb">
        <Link className="ghost-button" href={backHref as Route}>
          <ArrowLeft size={16} />
          Back to deck
        </Link>
      </div>

      <section className="editor-shell editor-shell--deck editor-shell--bulk">
        <div className="editor-shell__header">
          <div className="editor-shell__copy">
            <p className="eyebrow">Card</p>
            <h1>Create multiple cards for {activeDeck.title}</h1>
          </div>

          <div className="editor-shell__meta">
            <span className="status-pill">
              <Files size={14} />
              Auto detect
            </span>
            <span className="status-pill">
              <BookOpen size={14} />
              {entryDefaults.cardType.replace('_', ' ')}
            </span>
            <span className="status-pill">
              {activeDeck.counts.totalCards} card{activeDeck.counts.totalCards === 1 ? '' : 's'} in deck
            </span>
          </div>
        </div>

        <div className="editor-shell__body">
          <BulkCardGenerator
            prepareDraft={(draft) => applyEntryDefaultsToDraft(draft, entryDefaults, entryMemory)}
            onComplete={() => router.push(backHref as Route)}
            onSaveAll={async (drafts, onProgress) => {
              await saveCardsBatch(activeUser.id, activeDeck.id, drafts, activeProfile.settings, onProgress)
              if (drafts.length > 0) {
                rememberLastDraft(drafts[drafts.length - 1]!)
              }
            }}
          />
        </div>
      </section>
    </div>
  )
}
