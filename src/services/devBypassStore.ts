import { createInitialReviewState, applySpacedRepetition, isDue } from '../lib/spacedRepetition'
import { LOCAL_DEV_BYPASS_USER_ID } from '../lib/devBypass'
import { nowIso, startOfLocalDayKey } from '../lib/utils'
import type {
  ActivityLog,
  AudioVariant,
  Card,
  CardAiEvaluation,
  CardDraft,
  Deck,
  DeckDraft,
  Folder,
  SelfAssessment,
  SessionCardResult,
  StudyMode,
  StudySession,
  UserProfile,
  UserSettings,
} from '../types/models'

const DEFAULT_SETTINGS: UserSettings = {
  dailyGoal: 25,
  defaultVoice: 'en-US-Neural2-F',
  defaultLocale: 'en-US',
  autoPlayAudio: false,
}

const DEFAULT_AUDIO_VARIANT: AudioVariant = {
  status: 'idle',
  storagePath: null,
  textHash: null,
  updatedAt: null,
}

const DEFAULT_AI_EVALUATION: CardAiEvaluation = {
  requestStatus: 'idle',
  config: {
    status: 'ready_for_future_ai',
    minConfidence: 0.72,
    expectedConcepts: [],
  },
  lastResult: null,
  lastRequestedAt: null,
}

interface DevStoreState {
  profile: Omit<UserProfile, 'settings' | 'summary'>
  settings: UserSettings
  folders: Folder[]
  decks: Deck[]
  cards: Card[]
  activity: ActivityLog[]
  sessions: StudySession[]
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function buildAudio(settings: UserSettings) {
  return {
    locale: settings.defaultLocale,
    voiceName: settings.defaultVoice,
    prompt: { ...DEFAULT_AUDIO_VARIANT },
    answer: { ...DEFAULT_AUDIO_VARIANT },
  }
}

function computeDeckCounts(cards: Card[]) {
  return {
    totalCards: cards.length,
    dueCards: cards.filter((card) => isDue(card.reviewState.dueAt)).length,
    masteredCards: cards.filter((card) => card.reviewState.mastery >= 80).length,
    newCards: cards.filter((card) => card.studyStats.totalReviews === 0).length,
    favorites: cards.filter((card) => card.isFavorite).length,
  }
}

function uniqueStudyDays(sessions: StudySession[]) {
  return Array.from(new Set(sessions.map((session) => startOfLocalDayKey(session.endedAt)))).sort(
    (left, right) => Date.parse(right) - Date.parse(left),
  )
}

function computeStreaks(sessions: StudySession[]) {
  const days = uniqueStudyDays(sessions)
  if (days.length === 0) {
    return { studyStreak: 0, longestStreak: 0 }
  }

  let currentStreak = 1
  for (let index = 1; index < days.length; index += 1) {
    const previous = Date.parse(days[index - 1]!)
    const next = Date.parse(days[index]!)
    if (previous - next === 86400000) {
      currentStreak += 1
      continue
    }
    break
  }

  let longestStreak = 1
  let running = 1
  for (let index = 1; index < days.length; index += 1) {
    const previous = Date.parse(days[index - 1]!)
    const next = Date.parse(days[index]!)
    running = previous - next === 86400000 ? running + 1 : 1
    longestStreak = Math.max(longestStreak, running)
  }

  return { studyStreak: currentStreak, longestStreak }
}

function seedStore(): DevStoreState {
  const now = Date.now()
  const createdAt = new Date(now - 10 * 86400000).toISOString()
  const threeDaysAgo = new Date(now - 3 * 86400000).toISOString()
  const twoDaysAgo = new Date(now - 2 * 86400000).toISOString()
  const yesterday = new Date(now - 86400000).toISOString()

  const deck: Deck = {
    id: 'deck-science-1',
    title: '4th Quarter exam - Science',
    description: 'This is a sample deck only',
    folderId: null,
    tags: [],
    createdAt,
    updatedAt: yesterday,
    lastStudiedAt: twoDaysAgo,
    counts: {
      totalCards: 0,
      dueCards: 0,
      masteredCards: 0,
      newCards: 0,
      favorites: 0,
    },
    preferences: {
      defaultMode: 'review',
      shuffleByDefault: false,
      autoPlayAudio: false,
      dailyGoal: DEFAULT_SETTINGS.dailyGoal,
      entryDefaults: {
        cardType: 'basic',
        tags: [],
      },
    },
    exportConfig: {
      enabled: true,
      formatVersion: 1,
    },
    aiConfig: {
      enabled: false,
      provider: 'not_configured',
      rubricVersion: 'future-v1',
    },
  }

  const card: Card = {
    id: 'card-dog-name-1',
    deckId: deck.id,
    type: 'basic',
    front: 'What is the name of my dog?',
    back: "The dog's name is Jack",
    prompt: 'What is the name of my dog?',
    answer: "The dog's name is Jack",
    explanation: '',
    choices: [],
    expectedAnswer: {
      canonical: "The dog's name is Jack",
      acceptedVariants: ['Jack'],
      keywords: ['dog', 'jack'],
      rubric: '',
    },
    tags: ['hard', 'lecture 2'],
    isFavorite: false,
    createdAt,
    updatedAt: yesterday,
    reviewState: {
      ...createInitialReviewState(createdAt),
      dueAt: yesterday,
      mastery: 0,
    },
    studyStats: {
      totalReviews: 0,
      correctReviews: 0,
      incorrectReviews: 0,
      lastMode: null,
      lastScore: null,
      lastStudiedAt: null,
    },
    audio: buildAudio(DEFAULT_SETTINGS),
    aiEvaluation: clone(DEFAULT_AI_EVALUATION),
  }

  const sessions: StudySession[] = [
    {
      id: 'session-science-2',
      deckId: deck.id,
      deckTitle: deck.title,
      mode: 'review',
      startedAt: new Date(now - 2 * 86400000 - 900000).toISOString(),
      endedAt: twoDaysAgo,
      cardsStudied: 1,
      correct: 1,
      incorrect: 0,
      durationSeconds: 900,
      results: [
        {
          cardId: card.id,
          assessment: 'good',
          wasCorrect: true,
          responseText: "The dog's name is Jack",
        },
      ],
    },
    {
      id: 'session-science-1',
      deckId: deck.id,
      deckTitle: deck.title,
      mode: 'learn',
      startedAt: new Date(now - 3 * 86400000 - 780000).toISOString(),
      endedAt: threeDaysAgo,
      cardsStudied: 1,
      correct: 1,
      incorrect: 0,
      durationSeconds: 780,
      results: [
        {
          cardId: card.id,
          assessment: 'good',
          wasCorrect: true,
          responseText: "The dog's name is Jack",
        },
      ],
    },
  ]

  const activity: ActivityLog[] = [
    {
      id: 'activity-session-2',
      type: 'session_completed',
      title: 'Study session completed',
      description: `1 cards in ${deck.title}`,
      deckId: deck.id,
      cardId: null,
      createdAt: twoDaysAgo,
    },
    {
      id: 'activity-review-1',
      type: 'card_reviewed',
      title: 'Card reviewed',
      description: 'Reviewed flashcard',
      deckId: deck.id,
      cardId: card.id,
      createdAt: twoDaysAgo,
    },
    {
      id: 'activity-deck-1',
      type: 'deck_created',
      title: 'Deck created',
      description: `Created ${deck.title}`,
      deckId: deck.id,
      cardId: null,
      createdAt,
    },
  ]

  deck.counts = computeDeckCounts([card])

  return {
    profile: {
      uid: LOCAL_DEV_BYPASS_USER_ID,
      email: 'dev@local.memocards',
      displayName: 'Justiniano Tagarda',
      photoURL: '',
      createdAt,
      updatedAt: nowIso(),
    },
    settings: clone(DEFAULT_SETTINGS),
    folders: [],
    decks: [deck],
    cards: [card],
    activity,
    sessions,
  }
}

let store = seedStore()

function refreshDerivedState() {
  store.decks = store.decks.map((deck) => {
    const deckCards = store.cards.filter((card) => card.deckId === deck.id)
    return {
      ...deck,
      counts: computeDeckCounts(deckCards),
    }
  })
  store.activity.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  store.sessions.sort((left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt))
}

function buildProfile(): UserProfile {
  refreshDerivedState()
  const totalCards = store.cards.length
  const dueToday = store.cards.filter((card) => isDue(card.reviewState.dueAt)).length
  const masteredCards = store.cards.filter((card) => card.reviewState.mastery >= 80).length
  const favorites = store.cards.filter((card) => card.isFavorite).length
  const lastStudyDate = store.sessions[0]?.endedAt ?? null
  const { studyStreak, longestStreak } = computeStreaks(store.sessions)

  return {
    ...store.profile,
    updatedAt: nowIso(),
    settings: clone(store.settings),
    summary: {
      totalDecks: store.decks.length,
      totalCards,
      dueToday,
      masteredCards,
      favorites,
      studyStreak,
      longestStreak,
      lastStudyDate,
      totalSessions: store.sessions.length,
    },
  }
}

function addActivity(entry: Omit<ActivityLog, 'id' | 'createdAt'> & { createdAt?: string }) {
  store.activity.unshift({
    id: createId('activity'),
    createdAt: entry.createdAt ?? nowIso(),
    ...entry,
  })
}

function makeDeckFromDraft(draft: DeckDraft, deckId: string, timestamp: string): Deck {
  return {
    id: deckId,
    title: draft.title.trim(),
    description: draft.description.trim(),
    folderId: draft.folderId,
    tags: clone(draft.tags),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastStudiedAt: null,
    counts: {
      totalCards: 0,
      dueCards: 0,
      masteredCards: 0,
      newCards: 0,
      favorites: 0,
    },
    preferences: clone(draft.preferences),
    exportConfig: {
      enabled: true,
      formatVersion: 1,
    },
    aiConfig: {
      enabled: false,
      provider: 'not_configured',
      rubricVersion: 'future-v1',
    },
  }
}

function makeCardFromDraft(deckId: string, draft: CardDraft, settings: UserSettings, timestamp: string): Card {
  return {
    id: createId('card'),
    deckId,
    type: draft.type,
    front: draft.front.trim(),
    back: draft.back.trim(),
    prompt: draft.prompt.trim(),
    answer: draft.answer.trim(),
    explanation: draft.explanation.trim(),
    choices: clone(draft.choices),
    expectedAnswer: {
      canonical: draft.expectedAnswer.canonical.trim(),
      acceptedVariants: clone(draft.expectedAnswer.acceptedVariants),
      keywords: clone(draft.expectedAnswer.keywords),
      rubric: draft.expectedAnswer.rubric.trim(),
    },
    tags: clone(draft.tags),
    isFavorite: draft.isFavorite,
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewState: createInitialReviewState(timestamp),
    studyStats: {
      totalReviews: 0,
      correctReviews: 0,
      incorrectReviews: 0,
      lastMode: null,
      lastScore: null,
      lastStudiedAt: null,
    },
    audio: buildAudio(settings),
    aiEvaluation: {
      ...clone(DEFAULT_AI_EVALUATION),
      config: {
        ...clone(DEFAULT_AI_EVALUATION).config,
        expectedConcepts: clone(draft.expectedAnswer.keywords),
      },
    },
  }
}

export async function ensureProfile() {
  return
}

export async function fetchUserProfile() {
  return clone(buildProfile())
}

export async function fetchFolders() {
  return clone(store.folders)
}

export async function fetchDecks() {
  refreshDerivedState()
  return clone(store.decks)
}

export async function fetchDeck(deckId: string) {
  refreshDerivedState()
  return clone(store.decks.find((deck) => deck.id === deckId) ?? null)
}

export async function fetchCards(deckId: string) {
  return clone(store.cards.filter((card) => card.deckId === deckId))
}

export async function fetchRecentActivity() {
  refreshDerivedState()
  return clone(store.activity.slice(0, 8))
}

export async function fetchRecentSessions() {
  refreshDerivedState()
  return clone(store.sessions.slice(0, 6))
}

export async function saveDeck(draft: DeckDraft, deckId?: string) {
  const timestamp = nowIso()
  if (deckId) {
    store.decks = store.decks.map((deck) =>
      deck.id === deckId
        ? {
            ...deck,
            title: draft.title.trim(),
            description: draft.description.trim(),
            folderId: draft.folderId,
            tags: clone(draft.tags),
            preferences: clone(draft.preferences),
            updatedAt: timestamp,
          }
        : deck,
    )
    addActivity({
      type: 'deck_updated',
      title: 'Deck updated',
      description: `Updated ${draft.title.trim()}`,
      deckId,
      cardId: null,
    })
    return deckId
  }

  const nextDeckId = createId('deck')
  store.decks.unshift(makeDeckFromDraft(draft, nextDeckId, timestamp))
  addActivity({
    type: 'deck_created',
    title: 'Deck created',
    description: `Created ${draft.title.trim()}`,
    deckId: nextDeckId,
    cardId: null,
  })
  return nextDeckId
}

export async function deleteDeck(deckId: string) {
  const deck = store.decks.find((item) => item.id === deckId)
  store.cards = store.cards.filter((card) => card.deckId !== deckId)
  store.decks = store.decks.filter((item) => item.id !== deckId)
  addActivity({
    type: 'deck_deleted',
    title: 'Deck deleted',
    description: deck ? `Removed ${deck.title} and its cards` : 'Removed a deck and its cards',
    deckId: null,
    cardId: null,
  })
}

export async function createFolder(name: string, color: string) {
  const timestamp = nowIso()
  store.folders.unshift({
    id: createId('folder'),
    name: name.trim(),
    color,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  addActivity({
    type: 'folder_created',
    title: 'Folder created',
    description: `Created ${name.trim()}`,
    deckId: null,
    cardId: null,
  })
}

export async function deleteFolder(folderId: string) {
  store.folders = store.folders.filter((folder) => folder.id !== folderId)
  store.decks = store.decks.map((deck) =>
    deck.folderId === folderId
      ? {
          ...deck,
          folderId: null,
          updatedAt: nowIso(),
        }
      : deck,
  )
}

export async function saveCard(deckId: string, draft: CardDraft, userSettings: UserSettings, existingCard?: Card) {
  const timestamp = nowIso()

  if (existingCard) {
    store.cards = store.cards.map((card) =>
      card.id === existingCard.id
        ? {
            ...card,
            type: draft.type,
            front: draft.front.trim(),
            back: draft.back.trim(),
            prompt: draft.prompt.trim(),
            answer: draft.answer.trim(),
            explanation: draft.explanation.trim(),
            choices: clone(draft.choices),
            expectedAnswer: {
              canonical: draft.expectedAnswer.canonical.trim(),
              acceptedVariants: clone(draft.expectedAnswer.acceptedVariants),
              keywords: clone(draft.expectedAnswer.keywords),
              rubric: draft.expectedAnswer.rubric.trim(),
            },
            tags: clone(draft.tags),
            isFavorite: draft.isFavorite,
            updatedAt: timestamp,
            audio: buildAudio(userSettings),
            aiEvaluation: {
              ...card.aiEvaluation,
              config: {
                ...card.aiEvaluation.config,
                expectedConcepts: clone(draft.expectedAnswer.keywords),
              },
            },
          }
        : card,
    )
    return
  }

  store.cards.unshift(makeCardFromDraft(deckId, draft, userSettings, timestamp))
}

export async function saveCardsBatch(
  deckId: string,
  drafts: CardDraft[],
  userSettings: UserSettings,
  onProgress?: (progress: { percent: number; label: string }) => void,
) {
  if (drafts.length === 0) {
    return
  }

  const batchSize = drafts.length
  const baseTimestamp = Date.now()

  onProgress?.({
    percent: 15,
    label: `Preparing ${batchSize} card${batchSize === 1 ? '' : 's'}...`,
  })

  const createdCards = drafts.map((draft, index) =>
    makeCardFromDraft(deckId, draft, userSettings, new Date(baseTimestamp + index).toISOString()),
  )

  onProgress?.({
    percent: 55,
    label: `Saving ${batchSize} card${batchSize === 1 ? '' : 's'}...`,
  })

  store.cards.unshift(...createdCards)

  onProgress?.({
    percent: 82,
    label: 'Updating deck totals...',
  })

  addActivity({
    type: 'card_imported',
    title: batchSize === 1 ? 'Card created' : 'Cards created',
    description: `Saved ${batchSize} card${batchSize === 1 ? '' : 's'}`,
    deckId,
    cardId: null,
  })

  onProgress?.({
    percent: 100,
    label: `Saved ${batchSize} card${batchSize === 1 ? '' : 's'}.`,
  })
}

export async function deleteCard(deckId: string, cardId: string) {
  store.cards = store.cards.filter((card) => !(card.deckId === deckId && card.id === cardId))
}

export async function toggleCardFavorite(cardId: string) {
  store.cards = store.cards.map((card) =>
    card.id === cardId
      ? {
          ...card,
          isFavorite: !card.isFavorite,
          updatedAt: nowIso(),
        }
      : card,
  )
}

export async function reviewCard(
  deckId: string,
  card: Card,
  assessment: SelfAssessment,
  mode: StudyMode,
  responseText: string,
) {
  const timestamp = nowIso()
  const reviewState = applySpacedRepetition(card.reviewState, assessment, timestamp)
  const wasCorrect = assessment !== 'again'
  const totalReviews = card.studyStats.totalReviews + 1
  const correctReviews = card.studyStats.correctReviews + (wasCorrect ? 1 : 0)
  const incorrectReviews = card.studyStats.incorrectReviews + (wasCorrect ? 0 : 1)
  const score = Math.round((correctReviews / totalReviews) * 100)

  store.cards = store.cards.map((item) =>
    item.id === card.id
      ? {
          ...item,
          reviewState,
          updatedAt: timestamp,
          studyStats: {
            totalReviews,
            correctReviews,
            incorrectReviews,
            lastMode: mode,
            lastScore: score,
            lastStudiedAt: timestamp,
          },
        }
      : item,
  )

  addActivity({
    type: 'card_reviewed',
    title: 'Card reviewed',
    description: responseText ? 'Reviewed with typed answer' : 'Reviewed flashcard',
    deckId,
    cardId: card.id,
  })
}

export async function recordStudySession(
  deck: Deck,
  mode: StudyMode,
  startedAt: string,
  results: SessionCardResult[],
) {
  const endedAt = nowIso()
  const correct = results.filter((result) => result.wasCorrect).length
  const incorrect = results.length - correct
  const durationSeconds = Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000))

  store.sessions.unshift({
    id: createId('session'),
    deckId: deck.id,
    deckTitle: deck.title,
    mode,
    startedAt,
    endedAt,
    cardsStudied: results.length,
    correct,
    incorrect,
    durationSeconds,
    results: clone(results),
  })

  store.decks = store.decks.map((item) =>
    item.id === deck.id
      ? {
          ...item,
          lastStudiedAt: endedAt,
          updatedAt: endedAt,
        }
      : item,
  )

  addActivity({
    type: 'session_completed',
    title: 'Study session completed',
    description: `${results.length} cards in ${deck.title}`,
    deckId: deck.id,
    cardId: null,
    createdAt: endedAt,
  })
}

export async function fetchDeckExport(deckId: string) {
  const deck = store.decks.find((item) => item.id === deckId)
  if (!deck) {
    throw new Error('Deck not found.')
  }
  return {
    deck: clone(deck),
    cards: clone(store.cards.filter((card) => card.deckId === deckId)),
  }
}

export async function importDeckBundle(draft: DeckDraft, cards: CardDraft[], settings: UserSettings) {
  const deckId = await saveDeck(draft)
  const timestamp = nowIso()

  for (const cardDraft of cards) {
    store.cards.unshift(makeCardFromDraft(deckId, cardDraft, settings, timestamp))
  }

  addActivity({
    type: 'card_imported',
    title: 'Deck imported',
    description: `Imported ${cards.length} cards into ${draft.title.trim()}`,
    deckId,
    cardId: null,
  })

  return deckId
}

export async function requestCardAudio(): Promise<{ signedUrl: string; storagePath: string }> {
  throw new Error('Audio generation is disabled while local dev bypass is enabled.')
}

export async function queueAnswerEvaluation() {
  return 'disabled' as const
}
