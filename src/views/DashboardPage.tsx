'use client'

import { BookOpen, FolderPlus, Import, Search, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Modal } from '../components/Modal'
import { DeckForm, FolderForm, ImportDialog } from '../components/forms'
import { useAuth } from '../hooks/useAuth'
import { useDecks, useFolders, useRecentActivity, useRecentSessions, useUserProfile } from '../hooks/useMemoCards'
import { formatCalendarDate, formatSmartDate } from '../lib/utils'
import { createFolder, deleteDeck, importDeckBundle, saveDeck } from '../services/memocards'
import type { Deck } from '../types/models'

export function DashboardPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { data: profile, loading: profileLoading } = useUserProfile(user?.id)
  const { data: folders } = useFolders(user?.id)
  const { data: decks, loading: decksLoading } = useDecks(user?.id)
  const { data: activity } = useRecentActivity(user?.id)
  const { data: sessions } = useRecentSessions(user?.id)

  const [search, setSearch] = useState('')
  const [folderFilter, setFolderFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null)
  const [showDeckModal, setShowDeckModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showFolderModal, setShowFolderModal] = useState(false)

  const tags = useMemo(
    () => Array.from(new Set(decks.flatMap((deck) => deck.tags))).sort((left, right) => left.localeCompare(right)),
    [decks],
  )

  const filteredDecks = useMemo(() => {
    const query = search.trim().toLowerCase()
    return decks.filter((deck) => {
      const searchMatch =
        !query ||
        [deck.title, deck.description, ...deck.tags].join(' ').toLowerCase().includes(query)
      const folderMatch = folderFilter === 'all' || deck.folderId === folderFilter
      const tagMatch = tagFilter === 'all' || deck.tags.includes(tagFilter)
      return searchMatch && folderMatch && tagMatch
    })
  }, [decks, folderFilter, search, tagFilter])

  const isLoading = profileLoading || decksLoading

  if (!user) {
    return null
  }

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div className="hero-panel__copy">
          <p className="eyebrow">Dashboard</p>
          <h1>{profile ? `Welcome back, ${profile.displayName.split(' ')[0]}` : 'Your study dashboard'}</h1>
          <p>
            Keep decks organized, review what is due now, and track progress without mixing data across
            accounts.
          </p>
        </div>

        <div className="hero-panel__actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              setEditingDeck(null)
              setShowDeckModal(true)
            }}
          >
            <BookOpen size={16} />
            New deck
          </button>
          <button className="ghost-button" type="button" onClick={() => setShowImportModal(true)}>
            <Import size={16} />
            Import deck
          </button>
          <button className="ghost-button" type="button" onClick={() => setShowFolderModal(true)}>
            <FolderPlus size={16} />
            New folder
          </button>
        </div>

        <div className="summary-grid">
          <article className="summary-card">
            <strong>{profile?.summary.totalDecks ?? 0}</strong>
            <span>decks</span>
          </article>
          <article className="summary-card">
            <strong>{profile?.summary.dueToday ?? 0}</strong>
            <span>due today</span>
          </article>
          <article className="summary-card">
            <strong>{profile?.summary.masteredCards ?? 0}</strong>
            <span>mastered</span>
          </article>
          <article className="summary-card">
            <strong>{profile?.summary.studyStreak ?? 0}</strong>
            <span>day streak</span>
          </article>
        </div>
      </section>

      <section className="dashboard-controls">
        <label className="search-box">
          <Search size={16} />
          <input
            placeholder="Search decks, tags, topics"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <select value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}>
          <option value="all">All folders</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>

        <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
          <option value="all">All tags</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </section>

      <section className="dashboard-grid">
        <div className="deck-grid">
          {isLoading && <article className="empty-panel">Loading your decks...</article>}
          {!isLoading && filteredDecks.length === 0 && (
            <article className="empty-panel">
              <strong>No decks yet</strong>
              <p>Create a deck or import one from JSON or CSV to get started.</p>
            </article>
          )}

          {filteredDecks.map((deck) => {
            const folder = folders.find((item) => item.id === deck.folderId)
            return (
              <article key={deck.id} className="deck-card">
                <div className="deck-card__header">
                  <div>
                    <span className="pill">{folder?.name ?? 'Private deck'}</span>
                    <h2>{deck.title}</h2>
                  </div>
                  <span className="muted-label">{deck.counts.dueCards} due</span>
                </div>

                <p>{deck.description || 'No description yet.'}</p>

                <div className="tag-row">
                  {deck.tags.map((tag) => (
                    <span key={tag} className="tag-pill">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="metrics-row">
                  <span>{deck.counts.totalCards} cards</span>
                  <span>{deck.counts.masteredCards} mastered</span>
                  <span>{deck.counts.favorites} favorites</span>
                </div>

                <div className="deck-card__footer">
                  <small>Updated {formatSmartDate(deck.updatedAt)}</small>
                  <div className="inline-actions">
                    <Link className="ghost-button" href={`/app/decks/${deck.id}`}>
                      Open
                    </Link>
                    <button className="ghost-button" type="button" onClick={() => router.push(`/app/decks/${deck.id}/study`)}>
                      Study
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        setEditingDeck(deck)
                        setShowDeckModal(true)
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="ghost-button danger-button"
                      type="button"
                      onClick={() => {
                        void deleteDeck(user.id, deck.id)
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>

        <aside className="dashboard-side">
          <article className="side-panel">
            <div className="panel-heading">
              <strong>Study momentum</strong>
              <Sparkles size={16} />
            </div>
            <p>{profile?.summary.totalSessions ?? 0} sessions logged so far.</p>
            <p>Last study day: {formatCalendarDate(profile?.summary.lastStudyDate ?? null)}</p>
          </article>

          <article className="side-panel">
            <div className="panel-heading">
              <strong>Recent sessions</strong>
            </div>
            <div className="list-stack">
              {sessions.length === 0 && <p className="hint-text">No sessions recorded yet.</p>}
              {sessions.map((session) => (
                <div key={session.id} className="activity-item">
                  <strong>{session.deckTitle}</strong>
                  <small>
                    {session.cardsStudied} cards · {session.mode} · {formatSmartDate(session.endedAt)}
                  </small>
                </div>
              ))}
            </div>
          </article>

          <article className="side-panel">
            <div className="panel-heading">
              <strong>Recent activity</strong>
            </div>
            <div className="list-stack">
              {activity.length === 0 && <p className="hint-text">Activity will appear here once you start.</p>}
              {activity.map((item) => (
                <div key={item.id} className="activity-item">
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </div>
              ))}
            </div>
          </article>
        </aside>
      </section>

      {showDeckModal && (
        <Modal
          title={editingDeck ? `Edit ${editingDeck.title}` : 'Create deck'}
          onClose={() => {
            setShowDeckModal(false)
            setEditingDeck(null)
          }}
          width="lg"
        >
          <DeckForm
            folders={folders}
            initialValue={
              editingDeck
                ? {
                    title: editingDeck.title,
                    description: editingDeck.description,
                    folderId: editingDeck.folderId,
                    tags: editingDeck.tags,
                    preferences: editingDeck.preferences,
                  }
                : undefined
            }
            onCancel={() => {
              setShowDeckModal(false)
              setEditingDeck(null)
            }}
            onSubmit={async (draft) => {
              const nextDeckId = await saveDeck(user.id, draft, editingDeck?.id)
              setShowDeckModal(false)
              setEditingDeck(null)
              if (!editingDeck) {
                router.push(`/app/decks/${nextDeckId}`)
              }
            }}
          />
        </Modal>
      )}

      {showFolderModal && (
        <Modal title="Create folder" onClose={() => setShowFolderModal(false)} width="sm">
          <FolderForm
            onCancel={() => setShowFolderModal(false)}
            onSubmit={async (name, color) => {
              await createFolder(user.id, name, color)
              setShowFolderModal(false)
            }}
          />
        </Modal>
      )}

      {showImportModal && profile && (
        <Modal title="Import deck" onClose={() => setShowImportModal(false)} width="md">
          <ImportDialog
            onCancel={() => setShowImportModal(false)}
            onSubmit={async ({ deck, cards }) => {
              const nextDeckId = await importDeckBundle(user.id, deck, cards, profile.settings)
              setShowImportModal(false)
              router.push(`/app/decks/${nextDeckId}`)
            }}
          />
        </Modal>
      )}
    </div>
  )
}
