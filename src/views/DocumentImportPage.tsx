'use client'

import { ArrowLeft, Upload } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { DocumentImportComposer } from '../components/DocumentImportComposer'
import { useAuth } from '../hooks/useAuth'
import { useDeck, useUserProfile } from '../hooks/useMemoCards'
import { applyEntryDefaultsToDraft, loadDeckEntryMemory, saveDeckEntryMemory } from '../lib/cardEntry'
import { saveCard } from '../services/memocards'
import type { CardDraft } from '../types/models'

function createEmptyEntryMemory() {
  return {
    lastSavedDraft: null,
    lastCardType: null,
    lastTags: [],
  }
}

export function DocumentImportPage() {
  const params = useParams<{ deckId: string }>()
  const deckId = typeof params.deckId === 'string' ? params.deckId : undefined
  const { user } = useAuth()
  const { data: profile } = useUserProfile(user?.id)
  const { data: deck, loading: deckLoading } = useDeck(user?.id, deckId)
  const [entryMemory, setEntryMemory] = useState(() => (deckId ? loadDeckEntryMemory(deckId) : createEmptyEntryMemory()))

  useEffect(() => {
    setEntryMemory(deckId ? loadDeckEntryMemory(deckId) : createEmptyEntryMemory())
  }, [deckId])

  if (!user || !deckId) {
    return null
  }

  if (deckLoading || !profile) {
    return <div className="empty-panel">Loading import workspace...</div>
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
  const activeProfile = profile
  const activeDeck = deck
  const entryDefaults = activeDeck.preferences.entryDefaults
  const defaultTagsLabel = entryDefaults.tags.length > 0 ? entryDefaults.tags.join(', ') : 'No default tags'

  function rememberCreatedDraft(draft: CardDraft) {
    saveDeckEntryMemory(activeDeck.id, draft)
    setEntryMemory(loadDeckEntryMemory(activeDeck.id))
  }

  async function saveNewCard(draft: CardDraft) {
    const nextDraft = applyEntryDefaultsToDraft(draft, entryDefaults, entryMemory)
    await saveCard(activeUser.id, activeDeck.id, nextDraft, activeProfile.settings)
    rememberCreatedDraft(nextDraft)
  }

  return (
    <div className="page-stack page-stack--deck">
      <div className="page-breadcrumb">
        <Link className="ghost-button" href={`/app/decks/${activeDeck.id}`}>
          <ArrowLeft size={16} />
          Back to deck
        </Link>
      </div>

      <section className="dashboard-hero document-import-hero">
        <article className="hero-panel hero-panel--feature hero-panel--dashboard">
          <div className="hero-panel__copy">
            <p className="eyebrow">Document Import</p>
            <h1>Import notes into {activeDeck.title}</h1>
            <p>
              Upload a text document, let the rule-based parser build draft cards, then review, edit,
              or remove anything before saving to this deck.
            </p>
          </div>

          <div className="hero-panel__tools">
            <div className="hero-panel__actions hero-panel__actions--dashboard">
              <Link className="primary-button" href={`/app/decks/${activeDeck.id}`}>
                Back to deck
              </Link>
              <Link className="ghost-button" href={`/app/decks/${activeDeck.id}/study`}>
                Study deck
              </Link>
            </div>

            <div className="summary-grid summary-grid--dashboard">
              <article className="summary-card">
                <strong>{activeDeck.counts.totalCards}</strong>
                <span>cards now</span>
              </article>
              <article className="summary-card">
                <strong>{entryDefaults.cardType.replace('_', ' ')}</strong>
                <span>default type</span>
              </article>
              <article className="summary-card">
                <strong>{entryDefaults.tags.length}</strong>
                <span>default tags</span>
              </article>
            </div>
          </div>
        </article>

        <article className="side-panel side-panel--focus side-panel--today">
          <div className="panel-heading">
            <strong>Best Results</strong>
            <Upload size={16} />
          </div>
          <div className="list-stack">
            <div className="activity-item">
              <strong>Use text-based files</strong>
              <small>`.txt`, `.md`, `.markdown`, `.text`, and `.tsv` work best in this version.</small>
            </div>
            <div className="activity-item">
              <strong>Auto detect first</strong>
              <small>Switch to a fixed parser mode when your notes consistently use one pattern.</small>
            </div>
            <div className="activity-item">
              <strong>Defaults still apply</strong>
              <small>{defaultTagsLabel}</small>
            </div>
          </div>
        </article>
      </section>

      <DocumentImportComposer
        prepareDraft={(draft) => applyEntryDefaultsToDraft(draft, entryDefaults, entryMemory)}
        showHeader={false}
        onSave={async (draft) => {
          await saveNewCard(draft)
        }}
      />
    </div>
  )
}
