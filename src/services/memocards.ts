import type { User } from '@supabase/supabase-js'
import { getCardAudioText } from '../lib/cardText'
import { isLocalDevBypassEnabled, isLocalDevBypassUserId } from '../lib/devBypass'
import { getSupabaseBrowserClient } from '../lib/supabase/browser'
import { createInitialReviewState, isDue, applySpacedRepetition } from '../lib/spacedRepetition'
import { hashText, nowIso, startOfLocalDayKey } from '../lib/utils'
import * as devBypassStore from './devBypassStore'
import type { Database, Json } from '../types/database'
import type {
  ActivityLog,
  AudioVariant,
  Card,
  CardAiEvaluation,
  CardDraft,
  Deck,
  DeckCounts,
  DeckDraft,
  EvaluationRequest,
  Folder,
  SelfAssessment,
  SessionCardResult,
  StudyMode,
  StudySession,
  UserProfile,
  UserSettings,
  UserSummary,
} from '../types/models'

const DATA_CHANGED_EVENT = 'memocards:data-changed'

const DEFAULT_SETTINGS: UserSettings = {
  dailyGoal: 25,
  defaultVoice: 'en-US-Neural2-F',
  defaultLocale: 'en-US',
  autoPlayAudio: false,
}

const DEFAULT_SUMMARY: UserSummary = {
  totalDecks: 0,
  totalCards: 0,
  dueToday: 0,
  masteredCards: 0,
  favorites: 0,
  studyStreak: 0,
  longestStreak: 0,
  lastStudyDate: null,
  totalSessions: 0,
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

type ProfileRow = Database['common']['Tables']['profiles']['Row']
type UserSettingsRow = Database['memocards']['Tables']['user_settings']['Row']
type FolderRow = Database['memocards']['Tables']['folders']['Row']
type DeckRow = Database['memocards']['Tables']['decks']['Row']
type CardRow = Database['memocards']['Tables']['cards']['Row']
type ActivityRow = Database['memocards']['Tables']['activity']['Row']
type SessionRow = Database['memocards']['Tables']['sessions']['Row']

function supabase() {
  return getSupabaseBrowserClient()
}

function memocardsSchema() {
  return supabase().schema('memocards')
}

function commonSchema() {
  return supabase().schema('common')
}

function notifyDataChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT))
  }
}

export function subscribeToDataChanged(onChange: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }
  window.addEventListener(DATA_CHANGED_EVENT, onChange)
  return () => window.removeEventListener(DATA_CHANGED_EVENT, onChange)
}

function defaultAudioVariant(): AudioVariant {
  return {
    status: 'idle',
    storagePath: null,
    textHash: null,
    updatedAt: null,
  }
}

function jsonAs<T>(value: Json | null, fallback: T): T {
  if (!value) {
    return fallback
  }
  return value as T
}

function toJson<T>(value: T): Json {
  return value as Json
}

function normalizeCounts(counts?: Partial<DeckCounts>): DeckCounts {
  return {
    totalCards: counts?.totalCards ?? 0,
    dueCards: counts?.dueCards ?? 0,
    masteredCards: counts?.masteredCards ?? 0,
    newCards: counts?.newCards ?? 0,
    favorites: counts?.favorites ?? 0,
  }
}

function normalizeDeck(row: DeckRow): Deck {
  const counts = jsonAs<DeckCounts>(row.counts, normalizeCounts())
  const rawPreferences = jsonAs<Deck['preferences']>(row.preferences, {
    defaultMode: 'review',
    shuffleByDefault: false,
    autoPlayAudio: false,
    dailyGoal: DEFAULT_SETTINGS.dailyGoal,
    entryDefaults: {
      cardType: 'basic',
      tags: [],
    },
  })
  const preferences: Deck['preferences'] = {
    defaultMode: rawPreferences.defaultMode,
    shuffleByDefault: rawPreferences.shuffleByDefault,
    autoPlayAudio: rawPreferences.autoPlayAudio,
    dailyGoal: rawPreferences.dailyGoal,
    entryDefaults: {
      cardType: rawPreferences.entryDefaults?.cardType ?? 'basic',
      tags: rawPreferences.entryDefaults?.tags ?? [],
    },
  }
  const exportConfig = jsonAs<Deck['exportConfig']>(row.export_config, {
    enabled: true,
    formatVersion: 1,
  })
  const aiConfig = jsonAs<Deck['aiConfig']>(row.ai_config, {
    enabled: false,
    provider: 'not_configured',
    rubricVersion: 'future-v1',
  })

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    folderId: row.folder_id,
    tags: row.tags ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastStudiedAt: row.last_studied_at,
    counts: normalizeCounts(counts),
    preferences,
    exportConfig,
    aiConfig,
  }
}

function normalizeCard(row: CardRow): Card {
  return {
    id: row.id,
    deckId: row.deck_id,
    type: row.type as Card['type'],
    front: row.front,
    back: row.back,
    prompt: row.prompt,
    answer: row.answer,
    explanation: row.explanation,
    choices: jsonAs<Card['choices']>(row.choices, []),
    expectedAnswer: jsonAs<Card['expectedAnswer']>(row.expected_answer, {
      canonical: '',
      acceptedVariants: [],
      keywords: [],
      rubric: '',
    }),
    tags: row.tags ?? [],
    isFavorite: row.is_favorite,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewState: jsonAs<Card['reviewState']>(row.review_state, createInitialReviewState(row.created_at)),
    studyStats: jsonAs<Card['studyStats']>(row.study_stats, {
      totalReviews: 0,
      correctReviews: 0,
      incorrectReviews: 0,
      lastMode: null,
      lastScore: null,
      lastStudiedAt: null,
    }),
    audio: jsonAs<Card['audio']>(row.audio, {
      locale: DEFAULT_SETTINGS.defaultLocale,
      voiceName: DEFAULT_SETTINGS.defaultVoice,
      prompt: defaultAudioVariant(),
      answer: defaultAudioVariant(),
    }),
    aiEvaluation: {
      ...DEFAULT_AI_EVALUATION,
      ...jsonAs<CardAiEvaluation>(row.ai_evaluation, DEFAULT_AI_EVALUATION),
      config: {
        ...DEFAULT_AI_EVALUATION.config,
        ...jsonAs<CardAiEvaluation>(row.ai_evaluation, DEFAULT_AI_EVALUATION).config,
      },
    },
  }
}

function normalizeFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeActivity(row: ActivityRow): ActivityLog {
  return {
    id: row.id,
    type: row.type as ActivityLog['type'],
    title: row.title,
    description: row.description,
    deckId: row.deck_id,
    cardId: row.card_id,
    createdAt: row.created_at,
  }
}

function normalizeSession(row: SessionRow): StudySession {
  return {
    id: row.id,
    deckId: row.deck_id,
    deckTitle: row.deck_title,
    mode: row.mode as StudyMode,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    cardsStudied: row.cards_studied,
    correct: row.correct,
    incorrect: row.incorrect,
    durationSeconds: row.duration_seconds,
    results: jsonAs<SessionCardResult[]>(row.results, []),
  }
}

function normalizeSettings(row: UserSettingsRow | null): UserSettings {
  if (!row) {
    return DEFAULT_SETTINGS
  }

  return {
    dailyGoal: row.daily_goal,
    defaultVoice: row.default_voice,
    defaultLocale: row.default_locale,
    autoPlayAudio: row.auto_play_audio,
  }
}

function computeSummaryFromDecks(decks: Deck[], settingsRow: UserSettingsRow | null): UserSummary {
  return decks.reduce<UserSummary>(
    (summary, deck) => ({
      ...summary,
      totalDecks: summary.totalDecks + 1,
      totalCards: summary.totalCards + deck.counts.totalCards,
      dueToday: summary.dueToday + deck.counts.dueCards,
      masteredCards: summary.masteredCards + deck.counts.masteredCards,
      favorites: summary.favorites + deck.counts.favorites,
    }),
    {
      ...DEFAULT_SUMMARY,
      studyStreak: settingsRow?.study_streak ?? 0,
      longestStreak: settingsRow?.longest_streak ?? 0,
      lastStudyDate: settingsRow?.last_study_date ?? null,
      totalSessions: settingsRow?.total_sessions ?? 0,
    },
  )
}

function normalizeProfile(profileRow: ProfileRow | null, settingsRow: UserSettingsRow | null, decks: Deck[]): UserProfile | null {
  if (!profileRow) {
    return null
  }

  return {
    uid: profileRow.id,
    email: profileRow.email ?? '',
    displayName: profileRow['full_name'] ?? 'Student',
    photoURL: profileRow['avatar_url'] ?? '',
    createdAt: profileRow.created_at,
    updatedAt: profileRow.updated_at,
    settings: normalizeSettings(settingsRow),
    summary: computeSummaryFromDecks(decks, settingsRow),
  }
}

function createDeckRecord(uid: string, draft: DeckDraft, timestamp = nowIso()): Database['memocards']['Tables']['decks']['Insert'] {
  return {
    user_id: uid,
    title: draft.title.trim(),
    description: draft.description.trim(),
    folder_id: draft.folderId,
    tags: draft.tags,
    counts: toJson(normalizeCounts()),
    preferences: toJson(draft.preferences),
    export_config: toJson({
      enabled: true,
      formatVersion: 1,
    }),
    ai_config: toJson({
      enabled: false,
      provider: 'not_configured',
      rubricVersion: 'future-v1',
    }),
    created_at: timestamp,
    updated_at: timestamp,
    last_studied_at: null,
  }
}

function createCardRecord(
  uid: string,
  deckId: string,
  draft: CardDraft,
  settings: UserSettings,
  timestamp = nowIso(),
): Database['memocards']['Tables']['cards']['Insert'] {
  return {
    user_id: uid,
    deck_id: deckId,
    type: draft.type,
    front: draft.front.trim(),
    back: draft.back.trim(),
    prompt: draft.prompt.trim(),
    answer: draft.answer.trim(),
    explanation: draft.explanation.trim(),
    choices: toJson(draft.choices),
    expected_answer: toJson({
      canonical: draft.expectedAnswer.canonical.trim(),
      acceptedVariants: draft.expectedAnswer.acceptedVariants,
      keywords: draft.expectedAnswer.keywords,
      rubric: draft.expectedAnswer.rubric.trim(),
    }),
    tags: draft.tags,
    is_favorite: draft.isFavorite,
    review_state: toJson(createInitialReviewState(timestamp)),
    study_stats: toJson({
      totalReviews: 0,
      correctReviews: 0,
      incorrectReviews: 0,
      lastMode: null,
      lastScore: null,
      lastStudiedAt: null,
    }),
    audio: toJson({
      locale: settings.defaultLocale,
      voiceName: settings.defaultVoice,
      prompt: defaultAudioVariant(),
      answer: defaultAudioVariant(),
    }),
    ai_evaluation: toJson({
      ...DEFAULT_AI_EVALUATION,
      config: {
        ...DEFAULT_AI_EVALUATION.config,
        expectedConcepts: draft.expectedAnswer.keywords,
      },
    }),
    created_at: timestamp,
    updated_at: timestamp,
  }
}

function computeDeckCounts(cards: Card[]): DeckCounts {
  return cards.reduce<DeckCounts>(
    (counts, card) => ({
      totalCards: counts.totalCards + 1,
      dueCards: counts.dueCards + (isDue(card.reviewState.dueAt) ? 1 : 0),
      masteredCards: counts.masteredCards + (card.reviewState.mastery >= 80 ? 1 : 0),
      newCards: counts.newCards + (card.studyStats.totalReviews === 0 ? 1 : 0),
      favorites: counts.favorites + (card.isFavorite ? 1 : 0),
    }),
    normalizeCounts(),
  )
}

async function assertNoError<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const result = await promise
  if (result.error) {
    throw new Error(result.error.message)
  }
  return result.data
}

async function createActivity(
  uid: string,
  entry: Omit<ActivityLog, 'id' | 'createdAt'> & { createdAt?: string },
) {
  await assertNoError(
    memocardsSchema().from('activity').insert({
      user_id: uid,
      type: entry.type,
      title: entry.title,
      description: entry.description,
      deck_id: entry.deckId,
      card_id: entry.cardId,
      created_at: entry.createdAt ?? nowIso(),
    }),
  )
}

async function fetchSettingsRow(uid: string) {
  const data = await assertNoError(
    memocardsSchema()
      .from('user_settings')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle(),
  )
  return data
}

async function syncDeckCounts(uid: string, deckId: string) {
  const cards = await fetchCards(uid, deckId)
  const counts = computeDeckCounts(cards)
  await assertNoError(
    memocardsSchema()
      .from('decks')
      .update({
        counts: toJson(counts),
        updated_at: nowIso(),
      })
      .eq('id', deckId)
      .eq('user_id', uid),
  )
  notifyDataChanged()
}

export async function ensureUserProfile(user: User) {
  if (isLocalDevBypassUserId(user.id)) {
    await devBypassStore.ensureProfile()
    return
  }

  const timestamp = nowIso()
  const fullName =
    user.user_metadata['full_name'] ??
    user.user_metadata['name'] ??
    user.email?.split('@')[0] ??
    'Student'
  const avatarUrl =
    user.user_metadata['avatar_url'] ??
    user.user_metadata['picture'] ??
    null

  await assertNoError(
    commonSchema().from('profiles').upsert(
      {
        id: user.id,
        email: user.email ?? null,
        full_name: fullName,
        avatar_url: avatarUrl,
        updated_at: timestamp,
      },
      { onConflict: 'id' },
    ),
  )

  await assertNoError(
    memocardsSchema().from('user_settings').upsert(
      {
        user_id: user.id,
        daily_goal: DEFAULT_SETTINGS.dailyGoal,
        default_voice: DEFAULT_SETTINGS.defaultVoice,
        default_locale: DEFAULT_SETTINGS.defaultLocale,
        auto_play_audio: DEFAULT_SETTINGS.autoPlayAudio,
        updated_at: timestamp,
      },
      { onConflict: 'user_id', ignoreDuplicates: false },
    ),
  )
}

export async function fetchUserProfile(uid: string) {
  if (isLocalDevBypassUserId(uid)) {
    return devBypassStore.fetchUserProfile()
  }

  const [profileRow, settingsRow, deckRows] = await Promise.all([
    assertNoError(commonSchema().from('profiles').select('*').eq('id', uid).maybeSingle()),
    fetchSettingsRow(uid),
    assertNoError(memocardsSchema().from('decks').select('*').eq('user_id', uid)),
  ])

  const decks = (deckRows ?? []).map(normalizeDeck)
  return normalizeProfile(profileRow, settingsRow, decks)
}

export async function updateUserAutoPlayAudio(uid: string, autoPlayAudio: boolean) {
  if (isLocalDevBypassUserId(uid)) {
    await devBypassStore.updateUserAutoPlayAudio(autoPlayAudio)
    notifyDataChanged()
    return
  }

  await assertNoError(
    memocardsSchema()
      .from('user_settings')
      .update({
        auto_play_audio: autoPlayAudio,
        updated_at: nowIso(),
      })
      .eq('user_id', uid),
  )

  notifyDataChanged()
}

export async function fetchFolders(uid: string) {
  if (isLocalDevBypassUserId(uid)) {
    return devBypassStore.fetchFolders()
  }

  const rows = await assertNoError(
    memocardsSchema().from('folders').select('*').eq('user_id', uid).order('name', { ascending: true }),
  )
  return (rows ?? []).map(normalizeFolder)
}

export async function fetchDecks(uid: string) {
  if (isLocalDevBypassUserId(uid)) {
    return devBypassStore.fetchDecks()
  }

  const rows = await assertNoError(
    memocardsSchema().from('decks').select('*').eq('user_id', uid).order('updated_at', { ascending: false }),
  )
  return (rows ?? []).map(normalizeDeck)
}

export async function fetchDeck(uid: string, deckId: string) {
  if (isLocalDevBypassUserId(uid)) {
    return devBypassStore.fetchDeck(deckId)
  }

  const row = await assertNoError(
    memocardsSchema().from('decks').select('*').eq('user_id', uid).eq('id', deckId).maybeSingle(),
  )
  return row ? normalizeDeck(row) : null
}

export async function fetchCards(uid: string, deckId: string) {
  if (isLocalDevBypassUserId(uid)) {
    return devBypassStore.fetchCards(deckId)
  }

  const rows = await assertNoError(
    memocardsSchema()
      .from('cards')
      .select('*')
      .eq('user_id', uid)
      .eq('deck_id', deckId)
      .order('created_at', { ascending: true }),
  )
  return (rows ?? []).map(normalizeCard)
}

export async function fetchRecentActivity(uid: string) {
  if (isLocalDevBypassUserId(uid)) {
    return devBypassStore.fetchRecentActivity()
  }

  const rows = await assertNoError(
    memocardsSchema()
      .from('activity')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(8),
  )
  return (rows ?? []).map(normalizeActivity)
}

export async function fetchRecentSessions(uid: string) {
  if (isLocalDevBypassUserId(uid)) {
    return devBypassStore.fetchRecentSessions()
  }

  const rows = await assertNoError(
    memocardsSchema()
      .from('sessions')
      .select('*')
      .eq('user_id', uid)
      .order('ended_at', { ascending: false })
      .limit(6),
  )
  return (rows ?? []).map(normalizeSession)
}

export async function saveDeck(uid: string, draft: DeckDraft, deckId?: string) {
  if (isLocalDevBypassUserId(uid)) {
    const nextDeckId = await devBypassStore.saveDeck(draft, deckId)
    notifyDataChanged()
    return nextDeckId
  }

  const timestamp = nowIso()

  if (deckId) {
    await assertNoError(
      memocardsSchema()
        .from('decks')
        .update({
          title: draft.title.trim(),
          description: draft.description.trim(),
          folder_id: draft.folderId,
          tags: draft.tags,
          preferences: toJson(draft.preferences),
          updated_at: timestamp,
        })
        .eq('id', deckId)
        .eq('user_id', uid),
    )
    await createActivity(uid, {
      type: 'deck_updated',
      title: 'Deck updated',
      description: `Updated ${draft.title.trim()}`,
      deckId,
      cardId: null,
    })
    notifyDataChanged()
    return deckId
  }

  const inserted = await assertNoError(
    memocardsSchema().from('decks').insert(createDeckRecord(uid, draft, timestamp)).select('id').single(),
  )
  if (!inserted) {
    throw new Error('Unable to create deck.')
  }
  await createActivity(uid, {
    type: 'deck_created',
    title: 'Deck created',
    description: `Created ${draft.title.trim()}`,
    deckId: inserted.id,
    cardId: null,
  })
  notifyDataChanged()
  return inserted.id
}

export async function deleteDeck(uid: string, deckId: string) {
  if (isLocalDevBypassUserId(uid)) {
    await devBypassStore.deleteDeck(deckId)
    notifyDataChanged()
    return
  }

  const deckRow = await assertNoError(
    memocardsSchema()
      .from('decks')
      .select('title')
      .eq('user_id', uid)
      .eq('id', deckId)
      .maybeSingle(),
  )

  await assertNoError(memocardsSchema().from('cards').delete().eq('user_id', uid).eq('deck_id', deckId))
  await assertNoError(memocardsSchema().from('decks').delete().eq('user_id', uid).eq('id', deckId))
  await createActivity(uid, {
    type: 'deck_deleted',
    title: 'Deck deleted',
    description: deckRow?.title ? `Removed ${deckRow.title} and its cards` : 'Removed a deck and its cards',
    deckId: null,
    cardId: null,
  })
  notifyDataChanged()
}

export async function createFolder(uid: string, name: string, color: string) {
  if (isLocalDevBypassUserId(uid)) {
    await devBypassStore.createFolder(name, color)
    notifyDataChanged()
    return
  }

  const timestamp = nowIso()
  await assertNoError(
    memocardsSchema().from('folders').insert({
      user_id: uid,
      name: name.trim(),
      color,
      created_at: timestamp,
      updated_at: timestamp,
    }),
  )
  await createActivity(uid, {
    type: 'folder_created',
    title: 'Folder created',
    description: `Created ${name.trim()}`,
    deckId: null,
    cardId: null,
  })
  notifyDataChanged()
}

export async function deleteFolder(uid: string, folderId: string) {
  if (isLocalDevBypassUserId(uid)) {
    await devBypassStore.deleteFolder(folderId)
    notifyDataChanged()
    return
  }

  await assertNoError(
    memocardsSchema().from('decks').update({ folder_id: null, updated_at: nowIso() }).eq('user_id', uid).eq('folder_id', folderId),
  )
  await assertNoError(memocardsSchema().from('folders').delete().eq('user_id', uid).eq('id', folderId))
  notifyDataChanged()
}

export async function saveCard(
  uid: string,
  deckId: string,
  draft: CardDraft,
  userSettings: UserSettings,
  existingCard?: Card,
) {
  if (isLocalDevBypassUserId(uid)) {
    await devBypassStore.saveCard(deckId, draft, userSettings, existingCard)
    notifyDataChanged()
    return
  }

  const timestamp = nowIso()

  if (existingCard) {
    await assertNoError(
      memocardsSchema()
        .from('cards')
        .update({
          type: draft.type,
          front: draft.front.trim(),
          back: draft.back.trim(),
          prompt: draft.prompt.trim(),
          answer: draft.answer.trim(),
          explanation: draft.explanation.trim(),
          choices: toJson(draft.choices),
          expected_answer: toJson({
            canonical: draft.expectedAnswer.canonical.trim(),
            acceptedVariants: draft.expectedAnswer.acceptedVariants,
            keywords: draft.expectedAnswer.keywords,
            rubric: draft.expectedAnswer.rubric.trim(),
          }),
          tags: draft.tags,
          is_favorite: draft.isFavorite,
          ai_evaluation: toJson({
            ...existingCard.aiEvaluation,
            config: {
              ...existingCard.aiEvaluation.config,
              expectedConcepts: draft.expectedAnswer.keywords,
            },
          }),
          updated_at: timestamp,
        })
        .eq('user_id', uid)
        .eq('deck_id', deckId)
        .eq('id', existingCard.id),
    )
  } else {
    await assertNoError(
      memocardsSchema().from('cards').insert(createCardRecord(uid, deckId, draft, userSettings, timestamp)),
    )
  }

  await syncDeckCounts(uid, deckId)
  void requestAudioQueueProcessing(deckId)
}

export async function saveCardsBatch(
  uid: string,
  deckId: string,
  drafts: CardDraft[],
  userSettings: UserSettings,
  onProgress?: (progress: { percent: number; label: string }) => void,
) {
  if (drafts.length === 0) {
    return
  }

  if (isLocalDevBypassUserId(uid)) {
    await devBypassStore.saveCardsBatch(deckId, drafts, userSettings, onProgress)
    notifyDataChanged()
    return
  }

  const batchSize = drafts.length
  const baseTimestamp = Date.now()

  onProgress?.({
    percent: 15,
    label: `Preparing ${batchSize} card${batchSize === 1 ? '' : 's'}...`,
  })

  const records = drafts.map((draft, index) =>
    createCardRecord(uid, deckId, draft, userSettings, new Date(baseTimestamp + index).toISOString()),
  )

  onProgress?.({
    percent: 55,
    label: `Saving ${batchSize} card${batchSize === 1 ? '' : 's'}...`,
  })

  await assertNoError(memocardsSchema().from('cards').insert(records))

  onProgress?.({
    percent: 82,
    label: 'Updating deck totals...',
  })

  await createActivity(uid, {
    type: 'card_imported',
    title: batchSize === 1 ? 'Card created' : 'Cards created',
    description: `Saved ${batchSize} card${batchSize === 1 ? '' : 's'}`,
    deckId,
    cardId: null,
  })

  await syncDeckCounts(uid, deckId)
  void requestAudioQueueProcessing(deckId)

  onProgress?.({
    percent: 100,
    label: `Saved ${batchSize} card${batchSize === 1 ? '' : 's'}.`,
  })
}

export async function deleteCard(uid: string, deckId: string, cardId: string) {
  if (isLocalDevBypassUserId(uid)) {
    await devBypassStore.deleteCard(deckId, cardId)
    notifyDataChanged()
    return
  }

  await assertNoError(
    memocardsSchema().from('cards').delete().eq('user_id', uid).eq('deck_id', deckId).eq('id', cardId),
  )
  await syncDeckCounts(uid, deckId)
}

export async function toggleCardFavorite(uid: string, deckId: string, card: Card) {
  if (isLocalDevBypassUserId(uid)) {
    await devBypassStore.toggleCardFavorite(card.id)
    notifyDataChanged()
    return
  }

  await assertNoError(
    memocardsSchema()
      .from('cards')
      .update({
        is_favorite: !card.isFavorite,
        updated_at: nowIso(),
      })
      .eq('user_id', uid)
      .eq('deck_id', deckId)
      .eq('id', card.id),
  )
  await syncDeckCounts(uid, deckId)
}

export async function reviewCard(
  uid: string,
  deckId: string,
  card: Card,
  assessment: SelfAssessment,
  mode: StudyMode,
  responseText: string,
) {
  if (isLocalDevBypassUserId(uid)) {
    await devBypassStore.reviewCard(deckId, card, assessment, mode, responseText)
    notifyDataChanged()
    return
  }

  const timestamp = nowIso()
  const reviewState = applySpacedRepetition(card.reviewState, assessment, timestamp)
  const wasCorrect = assessment !== 'again'
  const totalReviews = card.studyStats.totalReviews + 1
  const correctReviews = card.studyStats.correctReviews + (wasCorrect ? 1 : 0)
  const incorrectReviews = card.studyStats.incorrectReviews + (wasCorrect ? 0 : 1)
  const score = Math.round((correctReviews / totalReviews) * 100)

  await assertNoError(
    memocardsSchema()
      .from('cards')
      .update({
        review_state: toJson(reviewState),
        study_stats: toJson({
          totalReviews,
          correctReviews,
          incorrectReviews,
          lastMode: mode,
          lastScore: score,
          lastStudiedAt: timestamp,
        }),
        updated_at: timestamp,
      })
      .eq('user_id', uid)
      .eq('deck_id', deckId)
      .eq('id', card.id),
  )

  await createActivity(uid, {
    type: 'card_reviewed',
    title: 'Card reviewed',
    description: responseText ? 'Reviewed with typed answer' : 'Reviewed flashcard',
    deckId,
    cardId: card.id,
  })

  await syncDeckCounts(uid, deckId)
}

export async function recordStudySession(
  uid: string,
  deck: Deck,
  mode: StudyMode,
  startedAt: string,
  results: SessionCardResult[],
) {
  if (isLocalDevBypassUserId(uid)) {
    await devBypassStore.recordStudySession(deck, mode, startedAt, results)
    notifyDataChanged()
    return
  }

  const endedAt = nowIso()
  const correct = results.filter((result) => result.wasCorrect).length
  const incorrect = results.length - correct
  const durationSeconds = Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000))

  await assertNoError(
    memocardsSchema().from('sessions').insert({
      user_id: uid,
      deck_id: deck.id,
      deck_title: deck.title,
      mode,
      started_at: startedAt,
      ended_at: endedAt,
      cards_studied: results.length,
      correct,
      incorrect,
      duration_seconds: durationSeconds,
      results: toJson(results),
    }),
  )

  const settingsRow = await fetchSettingsRow(uid)
  const todayKey = startOfLocalDayKey(endedAt)
  const previousKey = settingsRow?.last_study_date ? startOfLocalDayKey(settingsRow.last_study_date) : null

  const streakIncrement =
    !previousKey
      ? 1
      : previousKey === todayKey
        ? 0
        : new Date(todayKey).getTime() - new Date(previousKey).getTime() <= 86400000
          ? 1
          : -(settingsRow?.study_streak ?? 0) + 1

  const studyStreak =
    streakIncrement === 0 ? settingsRow?.study_streak ?? 0 : Math.max(1, (settingsRow?.study_streak ?? 0) + streakIncrement)
  const longestStreak = Math.max(settingsRow?.longest_streak ?? 0, studyStreak)

  await assertNoError(
    memocardsSchema()
      .from('user_settings')
      .update({
        study_streak: studyStreak,
        longest_streak: longestStreak,
        last_study_date: endedAt,
        total_sessions: (settingsRow?.total_sessions ?? 0) + 1,
        updated_at: endedAt,
      })
      .eq('user_id', uid),
  )

  await assertNoError(
    memocardsSchema()
      .from('decks')
      .update({
        last_studied_at: endedAt,
        updated_at: endedAt,
      })
      .eq('user_id', uid)
      .eq('id', deck.id),
  )

  await createActivity(uid, {
    type: 'session_completed',
    title: 'Study session completed',
    description: `${results.length} cards in ${deck.title}`,
    deckId: deck.id,
    cardId: null,
    createdAt: endedAt,
  })

  notifyDataChanged()
}

export async function fetchDeckExport(uid: string, deckId: string) {
  if (isLocalDevBypassUserId(uid)) {
    return devBypassStore.fetchDeckExport(deckId)
  }

  const [deckRow, cardRows] = await Promise.all([
    assertNoError(
      memocardsSchema().from('decks').select('*').eq('user_id', uid).eq('id', deckId).maybeSingle(),
    ),
    assertNoError(
      memocardsSchema().from('cards').select('*').eq('user_id', uid).eq('deck_id', deckId),
    ),
  ])

  if (!deckRow) {
    throw new Error('Deck not found.')
  }

  return {
    deck: normalizeDeck(deckRow),
    cards: (cardRows ?? []).map(normalizeCard),
  }
}

export async function importDeckBundle(
  uid: string,
  draft: DeckDraft,
  cards: CardDraft[],
  settings: UserSettings,
) {
  if (isLocalDevBypassUserId(uid)) {
    const deckId = await devBypassStore.importDeckBundle(draft, cards, settings)
    notifyDataChanged()
    return deckId
  }

  const deckId = await saveDeck(uid, draft)
  const timestamp = nowIso()

  await assertNoError(
    memocardsSchema().from('cards').insert(
      cards.map((cardDraft) => createCardRecord(uid, deckId, cardDraft, settings, timestamp)),
    ),
  )

  await createActivity(uid, {
    type: 'card_imported',
    title: 'Deck imported',
    description: `Imported ${cards.length} cards into ${draft.title.trim()}`,
    deckId,
    cardId: null,
  })

  await syncDeckCounts(uid, deckId)
  void requestAudioQueueProcessing(deckId)
  return deckId
}

export interface ExtractedImageTextPage {
  id: string
  name: string
  text: string
  confidence: number
  wordCount: number
}

export interface ExtractedImageTextResult {
  requestId?: string
  combinedText: string
  pages: ExtractedImageTextPage[]
  warnings: string[]
}

export interface GeneratedLessonCard {
  question: string
  answer: string
  tags: string[]
  confidence: 'high' | 'medium'
  note: string
}

export interface GeneratedLessonCardsResult {
  requestId?: string
  cards: GeneratedLessonCard[]
  warnings: string[]
}

interface ExtractTextFromImagesOptions {
  timeoutMs?: number
  requestId?: string
}

interface GenerateCardsFromLessonOptions {
  timeoutMs?: number
  requestId?: string
  deckTitle?: string
  requestedCardCount?: number
}

interface ExtractTextFromImagesErrorResponse {
  error?: string
  requestId?: string
  stage?: string
}

export function createOcrRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function logOcrClientInfo(requestId: string, message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[ocr-client:${requestId}] ${message}`, details)
    return
  }

  console.info(`[ocr-client:${requestId}] ${message}`)
}

function logOcrClientError(requestId: string, message: string, details?: unknown) {
  if (typeof details === 'undefined') {
    console.error(`[ocr-client:${requestId}] ${message}`)
    return
  }

  console.error(`[ocr-client:${requestId}] ${message}`, details)
}

export async function extractTextFromImages(
  files: File[],
  { timeoutMs = 120000, requestId = createOcrRequestId() }: ExtractTextFromImagesOptions = {},
) {
  if (files.length === 0) {
    throw new Error('Add at least one image before generating cards.')
  }

  const requestStartedAt = Date.now()
  const formData = new FormData()
  files.forEach((file) => {
    formData.append('images', file, file.name)
  })

  logOcrClientInfo(requestId, `Starting OCR upload for ${files.length} image(s).`, {
    timeoutMs,
    files: files.map((file, index) => ({
      index: index + 1,
      name: file.name,
      type: file.type,
      size: file.size,
    })),
  })

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch('/api/cards/extract-from-images', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      headers: {
        'x-ocr-request-id': requestId,
      },
    })
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') {
      logOcrClientError(
        requestId,
        `OCR request aborted after ${Date.now() - requestStartedAt}ms.`,
        {
          timeoutMs,
          fileCount: files.length,
        },
      )
      throw new Error(
        'Text extraction took too long. Try a clearer photo, crop the page tighter, or use fewer images.',
      )
    }
    logOcrClientError(
      requestId,
      `OCR request failed before a response after ${Date.now() - requestStartedAt}ms.`,
      reason,
    )
    throw reason
  } finally {
    window.clearTimeout(timeoutId)
  }

  logOcrClientInfo(requestId, `OCR response received in ${Date.now() - requestStartedAt}ms.`, {
    status: response.status,
    ok: response.ok,
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ExtractTextFromImagesErrorResponse | null
    logOcrClientError(
      requestId,
      `OCR request failed with status ${response.status}.`,
      {
        stage: error?.stage ?? null,
        serverRequestId: error?.requestId ?? null,
        error: error?.error ?? null,
      },
    )
    throw new Error(error?.error ?? 'Unable to extract text from these images.')
  }

  const result = (await response.json()) as ExtractedImageTextResult
  logOcrClientInfo(requestId, `OCR completed in ${Date.now() - requestStartedAt}ms.`, {
    serverRequestId: result.requestId ?? null,
    pages: result.pages.length,
    warnings: result.warnings.length,
    combinedLength: result.combinedText.length,
  })
  return result
}

export async function generateCardsFromLessonText(
  sourceText: string,
  {
    timeoutMs = 120000,
    requestId = createOcrRequestId(),
    deckTitle,
    requestedCardCount,
  }: GenerateCardsFromLessonOptions = {},
) {
  const normalizedSource = sourceText.trim()
  if (!normalizedSource) {
    throw new Error('Add some lesson text before generating cards.')
  }

  const requestStartedAt = Date.now()
  logOcrClientInfo(requestId, 'Starting lesson-card generation request.', {
    timeoutMs,
    sourceLength: normalizedSource.length,
    deckTitle: deckTitle ?? null,
    requestedCardCount: requestedCardCount ?? null,
  })

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch('/api/cards/generate-from-lesson', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-card-generation-request-id': requestId,
      },
      body: JSON.stringify({
        sourceText: normalizedSource,
        deckTitle,
        requestedCardCount,
      }),
    })
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') {
      logOcrClientError(requestId, `Lesson-card generation aborted after ${Date.now() - requestStartedAt}ms.`, {
        timeoutMs,
        sourceLength: normalizedSource.length,
      })
      throw new Error('AI card generation took too long. Try a shorter lesson excerpt or fewer pages.')
    }
    logOcrClientError(
      requestId,
      `Lesson-card generation failed before a response after ${Date.now() - requestStartedAt}ms.`,
      reason,
    )
    throw reason
  } finally {
    window.clearTimeout(timeoutId)
  }

  logOcrClientInfo(requestId, `Lesson-card response received in ${Date.now() - requestStartedAt}ms.`, {
    status: response.status,
    ok: response.ok,
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ExtractTextFromImagesErrorResponse | null
    logOcrClientError(
      requestId,
      `Lesson-card generation failed with status ${response.status}.`,
      {
        stage: error?.stage ?? null,
        serverRequestId: error?.requestId ?? null,
        error: error?.error ?? null,
      },
    )
    throw new Error(error?.error ?? 'Unable to generate cards from this lesson.')
  }

  const result = (await response.json()) as GeneratedLessonCardsResult
  logOcrClientInfo(requestId, `Lesson-card generation completed in ${Date.now() - requestStartedAt}ms.`, {
    serverRequestId: result.requestId ?? null,
    cards: result.cards.length,
    warnings: result.warnings.length,
  })
  return result
}

export async function requestCardAudio(
  deckId: string,
  cardId: string,
  side: 'prompt' | 'answer',
) {
  if (isLocalDevBypassEnabled) {
    return devBypassStore.requestCardAudio()
  }

  const response = await fetch('/api/audio/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deckId, cardId, side }),
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(error?.error ?? 'Unable to generate audio.')
  }

  return (await response.json()) as { signedUrl: string; storagePath: string }
}

export async function requestAudioQueueProcessing(deckId?: string) {
  if (isLocalDevBypassEnabled || typeof window === 'undefined') {
    return
  }

  try {
    await fetch('/api/audio/process-queue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deckId,
      }),
      keepalive: true,
    })
  } catch {
    return
  }
}

export async function queueAnswerEvaluation(
  deckId: string,
  card: Card,
  submittedAnswer: string,
) {
  if (isLocalDevBypassEnabled) {
    return devBypassStore.queueAnswerEvaluation()
  }

  const response = await fetch('/api/answer-evaluations/queue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      deckId,
      cardId: card.id,
      prompt: card.prompt,
      expectedAnswer: card.expectedAnswer,
      submittedAnswer,
    } satisfies Omit<EvaluationRequest, 'id' | 'status' | 'createdAt'>),
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(error?.error ?? 'Unable to queue answer evaluation.')
  }

  const data = (await response.json()) as { status: 'queued' | 'disabled' }
  notifyDataChanged()
  return data.status
}

export function buildCachedAudioKey(card: Card, side: 'prompt' | 'answer') {
  const audioText = getCardAudioText(card, side)
  return `${side}-${hashText(`${audioText}:${card.audio.voiceName}:${card.audio.locale}`)}`
}
