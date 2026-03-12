'use client'

import { BookOpen, FolderPlus, Import, Search, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
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
  const firstName = profile?.displayName.split(' ')[0] ?? 'there'
  const dueToday = profile?.summary.dueToday ?? 0
  const totalSessions = profile?.summary.totalSessions ?? 0
  const dailyGoal = profile?.settings.dailyGoal ?? 20
  if (!user) {
    return null
  }

  return (
    <div className="page-stack page-stack--dashboard">
      <section className="dashboard-hero">
        <article className="hero-panel hero-panel--feature hero-panel--dashboard">
          <div className="hero-panel__copy">
            <p className="eyebrow">Study home</p>
            <h1>{dueToday > 0 ? `Ready to review, ${firstName}?` : `Keep going, ${firstName}.`}</h1>
            <p>
              {dueToday > 0
                ? `You have ${dueToday} card${dueToday === 1 ? '' : 's'} due today. Pick a deck and start where you left off.`
                : 'Your due list is clear. Open a deck or try Learn mode to make a little progress today.'}
            </p>
          </div>

          <div className="hero-panel__tools">
            <div className="hero-panel__actions hero-panel__actions--dashboard">
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

            <div className="summary-grid summary-grid--dashboard">
              <article className="summary-card">
                <strong>{profile?.summary.totalDecks ?? 0}</strong>
                <span>decks</span>
              </article>
              <article className="summary-card">
                <strong>{dueToday}</strong>
                <span>due today</span>
              </article>
              <article className="summary-card">
                <strong>{profile?.summary.masteredCards ?? 0}</strong>
                <span>learned well</span>
              </article>
            </div>
          </div>
        </article>

        <article className="side-panel side-panel--focus side-panel--today">
          <div className="panel-heading">
            <strong>Today</strong>
            <Sparkles size={16} />
          </div>
          <div className="today-grid">
            <div className="today-stat">
              <small>Daily goal</small>
              <strong>{dailyGoal} cards</strong>
            </div>
            <div className="today-stat">
              <small>Due today</small>
              <strong>{dueToday}</strong>
            </div>
            <div className="today-stat">
              <small>Streak</small>
              <strong>{profile?.summary.studyStreak ?? 0} day{profile?.summary.studyStreak === 1 ? '' : 's'}</strong>
            </div>
            <div className="today-stat">
              <small>Sessions</small>
              <strong>{totalSessions}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="filters-card filters-card--dashboard">
        <div className="section-heading section-heading--toolbar">
          <div>
            <p className="eyebrow">Find a deck</p>
            <h2>Search and filter</h2>
          </div>
          <small>{filteredDecks.length} showing</small>
        </div>

        <div className="filters-grid">
          <label className="field filter-field">
            <span>Search</span>
            <div className="search-box">
              <Search size={16} />
              <input
                aria-label="Search decks"
                placeholder="Search decks, tags, topics"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </label>

          <label className="field filter-field">
            <span>Folder</span>
            <select aria-label="Filter decks by folder" value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}>
              <option value="all">All folders</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field filter-field">
            <span>Tag</span>
            <select aria-label="Filter decks by tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="all">All tags</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="deck-grid deck-grid--dashboard">
          <div className="section-heading section-heading--toolbar">
            <div>
              <p className="eyebrow">Your decks</p>
              <h2>Study sets</h2>
            </div>
            <small>{profile?.summary.totalDecks ?? 0} total</small>
          </div>

          {isLoading && <article className="empty-panel">Loading your decks...</article>}
          {!isLoading && filteredDecks.length === 0 && (
            <article className="empty-panel">
              <strong>No decks yet</strong>
              <p>Create a deck or import one to start studying here.</p>
            </article>
          )}

          {filteredDecks.map((deck) => {
            const folder = folders.find((item) => item.id === deck.folderId)
            const mastery = deck.counts.totalCards === 0
              ? 0
              : Math.round((deck.counts.masteredCards / deck.counts.totalCards) * 100)

            return (
              <article key={deck.id} className="deck-card deck-card--dashboard">
                <div className="deck-card__header">
                  <div className="deck-card__identity">
                    <span className="folder-chip" style={{ '--folder-color': folder?.color ?? '#f26a2e' } as CSSProperties}>
                      {folder?.name ?? 'Private deck'}
                    </span>
                    <h2>{deck.title}</h2>
                    <p>{deck.description || 'Add a short note so this deck is easier to spot later.'}</p>
                  </div>
                  <div className="deck-card__status">
                    <span className="muted-label">{deck.counts.dueCards} due</span>
                    <small>Updated {formatSmartDate(deck.updatedAt)}</small>
                  </div>
                </div>

                <div className="deck-card__progress">
                  <div aria-hidden="true" className="progress-track">
                    <span className="progress-fill" style={{ width: `${mastery}%` }} />
                  </div>
                  <div className="metrics-row">
                    <span>{deck.counts.totalCards} cards</span>
                    <span>{mastery}% learned</span>
                    <span>{deck.counts.favorites} favorites</span>
                  </div>
                </div>

                <div className="deck-card__footer deck-card__footer--dashboard">
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
                  <div className="deck-card__actions">
                    <div className="deck-card__actions-main">
                      <Link className="ghost-button" href={`/app/decks/${deck.id}`}>
                        Open
                      </Link>
                      <button
                        className="primary-button primary-button--compact"
                        type="button"
                        onClick={() => router.push(`/app/decks/${deck.id}/study`)}
                      >
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
                    </div>
                    <button
                      className="button-link button-link--danger deck-card__delete"
                      type="button"
                      onClick={() => {
                        void deleteDeck(user.id, deck.id)
                      }}
                    >
                      <Trash2 size={15} />
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>

        <aside className="dashboard-side">
          <article className="side-panel side-panel--compact">
            <div className="panel-heading">
              <strong>Study pace</strong>
              <Sparkles size={16} />
            </div>
            <p>{totalSessions} session{totalSessions === 1 ? '' : 's'} logged so far.</p>
            <p>Last study day: {formatCalendarDate(profile?.summary.lastStudyDate ?? null)}</p>
          </article>

          <article className="side-panel side-panel--compact">
            <div className="panel-heading">
              <strong>Recent study</strong>
            </div>
            <div className="list-stack">
              {sessions.length === 0 && <p className="hint-text">Your recent sessions will show here.</p>}
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

          <article className="side-panel side-panel--compact">
            <div className="panel-heading">
              <strong>Latest activity</strong>
            </div>
            <div className="list-stack list-stack--scroll">
              {activity.length === 0 && <p className="hint-text">Activity will show up after your first study session.</p>}
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
