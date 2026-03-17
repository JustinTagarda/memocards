'use client'

import { ArrowLeft, BookOpen, PencilLine } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { DeckForm } from '../components/forms'
import { useAuth } from '../hooks/useAuth'
import { useDeck, useFolders } from '../hooks/useMemoCards'
import { deckToDraft } from '../lib/formDrafts'
import { saveDeck } from '../services/memocards'

interface DeckEditorPageProps {
  mode: 'create' | 'edit'
}

export function DeckEditorPage({ mode }: DeckEditorPageProps) {
  const params = useParams<{ deckId: string }>()
  const deckId = typeof params.deckId === 'string' ? params.deckId : undefined
  const router = useRouter()
  const { user } = useAuth()
  const { data: folders, loading: foldersLoading } = useFolders(user?.id)
  const { data: deck, loading: deckLoading } = useDeck(user?.id, mode === 'edit' ? deckId : undefined)

  if (!user) {
    return null
  }

  if (foldersLoading || (mode === 'edit' && deckLoading)) {
    return <div className="empty-panel">Loading deck editor...</div>
  }

  if (mode === 'edit' && !deck) {
    return (
      <div className="empty-panel">
        <strong>Deck not found</strong>
        <Link className="ghost-button" href="/app">
          Back home
        </Link>
      </div>
    )
  }

  const activeDeck = mode === 'edit' ? deck : null
  const activeUser = user
  const backHref = activeDeck ? `/app/decks/${activeDeck.id}` : '/app'
  const heading = activeDeck ? `Edit ${activeDeck.title}` : 'Create a new deck'
  const intro = activeDeck
    ? 'Update the deck details, study setup, and card defaults without working inside a modal.'
    : 'Set up the deck basics, study defaults, and card entry defaults before you start adding cards.'

  return (
    <div className="page-stack page-stack--editor">
      <div className="page-breadcrumb">
        <Link className="ghost-button" href={backHref as Route}>
          <ArrowLeft size={16} />
          {activeDeck ? 'Back to deck' : 'Back home'}
        </Link>
      </div>

      <section className="editor-shell editor-shell--deck">
        <div className="editor-shell__header">
          <div className="editor-shell__copy">
            <p className="eyebrow">Deck</p>
            <h1>{heading}</h1>
            <p>{intro}</p>
          </div>

          <div className="editor-shell__meta">
            <span className="status-pill">
              {activeDeck ? <PencilLine size={14} /> : <BookOpen size={14} />}
              {activeDeck ? `${activeDeck.counts.totalCards} cards` : 'New deck'}
            </span>
            <span className="status-pill">{activeDeck ? `${activeDeck.counts.dueCards} due now` : 'Choose defaults once'}</span>
            <span className="status-pill">
              {activeDeck ? `Mode: ${activeDeck.preferences.defaultMode}` : 'Mobile-friendly editor'}
            </span>
          </div>
        </div>

        <div className="editor-shell__body">
          <DeckForm
            folders={folders}
            initialValue={activeDeck ? deckToDraft(activeDeck) : undefined}
            onCancel={() => router.push(backHref as Route)}
            onSubmit={async (draft) => {
              const nextDeckId = await saveDeck(activeUser.id, draft, activeDeck?.id)
              router.push((activeDeck ? `/app/decks/${activeDeck.id}` : `/app/decks/${nextDeckId}`) as Route)
            }}
          />
        </div>
      </section>
    </div>
  )
}
