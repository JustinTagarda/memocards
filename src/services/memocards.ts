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

const SAMPLE_DECK_DESCRIPTION = 'Sample deck — explore freely, delete anytime.'

function sampleExpectedAnswer(canonical: string, keywords: string[], rubric: string): CardDraft['expectedAnswer'] {
  return { canonical, acceptedVariants: [], keywords, rubric }
}

function sampleChoices(correctIndex: number, options: string[]): CardDraft['choices'] {
  return options.map((text, index) => ({
    id: `choice-${index + 1}`,
    text,
    isCorrect: index === correctIndex,
  }))
}

const SAMPLE_DECKS: { draft: DeckDraft; cards: CardDraft[] }[] = [
  {
    draft: {
      title: 'Sample: Spanish Basics',
      description: SAMPLE_DECK_DESCRIPTION,
      folderId: null,
      tags: ['sample'],
      preferences: {
        defaultMode: 'review',
        shuffleByDefault: false,
        autoPlayAudio: false,
        dailyGoal: DEFAULT_SETTINGS.dailyGoal,
        entryDefaults: { cardType: 'basic', tags: ['sample'] },
      },
      isSample: true,
    },
    cards: [
      { type: 'basic', front: 'Hola', back: 'Hello', prompt: 'Hola', answer: 'Hello', explanation: '', choices: [], expectedAnswer: sampleExpectedAnswer('', [], ''), tags: ['sample'], isFavorite: false },
      { type: 'basic', front: 'Gracias', back: 'Thank you', prompt: 'Gracias', answer: 'Thank you', explanation: '', choices: [], expectedAnswer: sampleExpectedAnswer('', [], ''), tags: ['sample'], isFavorite: false },
      { type: 'basic', front: 'Por favor', back: 'Please', prompt: 'Por favor', answer: 'Please', explanation: '', choices: [], expectedAnswer: sampleExpectedAnswer('', [], ''), tags: ['sample'], isFavorite: false },
      { type: 'basic', front: 'Buenos días', back: 'Good morning', prompt: 'Buenos días', answer: 'Good morning', explanation: '', choices: [], expectedAnswer: sampleExpectedAnswer('', [], ''), tags: ['sample'], isFavorite: false },
      { type: 'basic', front: 'Amigo', back: 'Friend', prompt: 'Amigo', answer: 'Friend', explanation: '', choices: [], expectedAnswer: sampleExpectedAnswer('', [], ''), tags: ['sample'], isFavorite: false },
    ],
  },
  {
    draft: {
      title: 'Sample: Cell Biology (Short Answer)',
      description: SAMPLE_DECK_DESCRIPTION,
      folderId: null,
      tags: ['sample'],
      preferences: {
        defaultMode: 'review',
        shuffleByDefault: false,
        autoPlayAudio: false,
        dailyGoal: DEFAULT_SETTINGS.dailyGoal,
        entryDefaults: { cardType: 'explanation', tags: ['sample'] },
      },
      isSample: true,
    },
    cards: [
      {
        type: 'explanation',
        front: 'What is the powerhouse of the cell?',
        back: 'The mitochondrion generates most of the cell’s ATP through cellular respiration.',
        prompt: 'What is the powerhouse of the cell, and why?',
        answer: 'The mitochondrion generates most of the cell’s ATP through cellular respiration.',
        explanation: 'Type a short answer — your response is graded against key concepts, not an exact match.',
        choices: [],
        expectedAnswer: sampleExpectedAnswer(
          'The mitochondrion produces ATP through cellular respiration.',
          ['mitochondria', 'ATP', 'cellular respiration'],
          'Award credit for identifying the mitochondrion and its role in energy production.',
        ),
        tags: ['sample'],
        isFavorite: false,
      },
      {
        type: 'explanation',
        front: 'What does the cell membrane do?',
        back: 'It regulates what enters and exits the cell, maintaining a stable internal environment.',
        prompt: 'What is the main function of the cell membrane?',
        answer: 'It regulates what enters and exits the cell, maintaining a stable internal environment.',
        explanation: 'Type a short answer — your response is graded against key concepts, not an exact match.',
        choices: [],
        expectedAnswer: sampleExpectedAnswer(
          'The cell membrane controls the movement of substances in and out of the cell.',
          ['selective permeability', 'membrane', 'homeostasis'],
          'Award credit for describing selective control of substances entering or leaving the cell.',
        ),
        tags: ['sample'],
        isFavorite: false,
      },
      {
        type: 'explanation',
        front: 'Where is genetic material stored in a eukaryotic cell?',
        back: 'DNA is stored in the nucleus, enclosed by the nuclear envelope.',
        prompt: 'Where is a eukaryotic cell’s genetic material stored?',
        answer: 'DNA is stored in the nucleus, enclosed by the nuclear envelope.',
        explanation: 'Type a short answer — your response is graded against key concepts, not an exact match.',
        choices: [],
        expectedAnswer: sampleExpectedAnswer(
          'DNA is stored in the nucleus.',
          ['nucleus', 'DNA', 'nuclear envelope'],
          'Award credit for naming the nucleus as the storage site of DNA.',
        ),
        tags: ['sample'],
        isFavorite: false,
      },
      {
        type: 'explanation',
        front: 'What is the role of ribosomes?',
        back: 'Ribosomes synthesize proteins by translating messenger RNA.',
        prompt: 'What do ribosomes do?',
        answer: 'Ribosomes synthesize proteins by translating messenger RNA.',
        explanation: 'Type a short answer — your response is graded against key concepts, not an exact match.',
        choices: [],
        expectedAnswer: sampleExpectedAnswer(
          'Ribosomes build proteins from mRNA.',
          ['protein synthesis', 'mRNA', 'translation'],
          'Award credit for connecting ribosomes to protein synthesis/translation.',
        ),
        tags: ['sample'],
        isFavorite: false,
      },
      {
        type: 'explanation',
        front: 'What distinguishes a plant cell from an animal cell?',
        back: 'Plant cells have a cell wall, chloroplasts, and a large central vacuole; animal cells do not.',
        prompt: 'Name two structures found in plant cells but not animal cells.',
        answer: 'Plant cells have a cell wall, chloroplasts, and a large central vacuole; animal cells do not.',
        explanation: 'Type a short answer — your response is graded against key concepts, not an exact match.',
        choices: [],
        expectedAnswer: sampleExpectedAnswer(
          'Plant cells have a cell wall and chloroplasts, which animal cells lack.',
          ['cell wall', 'chloroplast', 'vacuole'],
          'Award credit for naming at least one plant-specific structure such as cell wall or chloroplast.',
        ),
        tags: ['sample'],
        isFavorite: false,
      },
    ],
  },
  {
    draft: {
      title: 'Sample: World Capitals Quiz',
      description: SAMPLE_DECK_DESCRIPTION,
      folderId: null,
      tags: ['sample'],
      preferences: {
        defaultMode: 'review',
        shuffleByDefault: true,
        autoPlayAudio: true,
        dailyGoal: DEFAULT_SETTINGS.dailyGoal,
        entryDefaults: { cardType: 'multiple_choice', tags: ['sample'] },
      },
      isSample: true,
    },
    cards: [
      { type: 'multiple_choice', front: 'What is the capital of Japan?', back: 'Tokyo', prompt: 'What is the capital of Japan?', answer: 'Tokyo', explanation: '', choices: sampleChoices(0, ['Tokyo', 'Osaka', 'Kyoto', 'Nagoya']), expectedAnswer: sampleExpectedAnswer('', [], ''), tags: ['sample'], isFavorite: false },
      { type: 'multiple_choice', front: 'What is the capital of France?', back: 'Paris', prompt: 'What is the capital of France?', answer: 'Paris', explanation: '', choices: sampleChoices(1, ['Lyon', 'Paris', 'Marseille', 'Nice']), expectedAnswer: sampleExpectedAnswer('', [], ''), tags: ['sample'], isFavorite: false },
      { type: 'multiple_choice', front: 'What is the capital of Australia?', back: 'Canberra', prompt: 'What is the capital of Australia?', answer: 'Canberra', explanation: '', choices: sampleChoices(2, ['Sydney', 'Melbourne', 'Canberra', 'Perth']), expectedAnswer: sampleExpectedAnswer('', [], ''), tags: ['sample'], isFavorite: false },
      { type: 'multiple_choice', front: 'What is the capital of Brazil?', back: 'Brasília', prompt: 'What is the capital of Brazil?', answer: 'Brasília', explanation: '', choices: sampleChoices(3, ['Rio de Janeiro', 'São Paulo', 'Salvador', 'Brasília']), expectedAnswer: sampleExpectedAnswer('', [], ''), tags: ['sample'], isFavorite: false },
      { type: 'multiple_choice', front: 'What is the capital of Egypt?', back: 'Cairo', prompt: 'What is the capital of Egypt?', answer: 'Cairo', explanation: '', choices: sampleChoices(0, ['Cairo', 'Alexandria', 'Giza', 'Luxor']), expectedAnswer: sampleExpectedAnswer('', [], ''), tags: ['sample'], isFavorite: false },
    ],
  },
]

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
    isSample: row.is_sample ?? false,
  }
}

function normalizeReviewState(value: Json | null, createdAt: string): Card['reviewState'] {
  const fallback = createInitialReviewState(createdAt)
  const raw = jsonAs<Partial<Card['reviewState']>>(value, fallback)
  return {
    repetitions: typeof raw.repetitions === 'number' ? raw.repetitions : fallback.repetitions,
    easeFactor: typeof raw.easeFactor === 'number' ? raw.easeFactor : fallback.easeFactor,
    intervalDays: typeof raw.intervalDays === 'number' ? raw.intervalDays : fallback.intervalDays,
    lapses: typeof raw.lapses === 'number' ? raw.lapses : fallback.lapses,
    lastReviewedAt: typeof raw.lastReviewedAt === 'string' ? raw.lastReviewedAt : null,
    dueAt: typeof raw.dueAt === 'string' ? raw.dueAt : fallback.dueAt,
    mastery: typeof raw.mastery === 'number' ? raw.mastery : fallback.mastery,
  }
}

function normalizeStudyStats(value: Json | null): Card['studyStats'] {
  const raw = jsonAs<Partial<Card['studyStats']>>(value, {})
  return {
    totalReviews: typeof raw.totalReviews === 'number' ? raw.totalReviews : 0,
    correctReviews: typeof raw.correctReviews === 'number' ? raw.correctReviews : 0,
    incorrectReviews: typeof raw.incorrectReviews === 'number' ? raw.incorrectReviews : 0,
    lastMode: raw.lastMode ?? null,
    lastScore: typeof raw.lastScore === 'number' ? raw.lastScore : null,
    lastStudiedAt: typeof raw.lastStudiedAt === 'string' ? raw.lastStudiedAt : null,
  }
}

function normalizeCardAudio(value: Json | null): Card['audio'] {
  const raw = jsonAs<Partial<Card['audio']>>(value, {})
  const normalizeVariant = (variant?: Partial<AudioVariant>): AudioVariant => ({
    status: variant?.status ?? 'idle',
    storagePath: variant?.storagePath ?? null,
    textHash: variant?.textHash ?? null,
    updatedAt: variant?.updatedAt ?? null,
  })
  return {
    locale: typeof raw.locale === 'string' ? raw.locale : DEFAULT_SETTINGS.defaultLocale,
    voiceName: typeof raw.voiceName === 'string' ? raw.voiceName : DEFAULT_SETTINGS.defaultVoice,
    prompt: normalizeVariant(raw.prompt),
    answer: normalizeVariant(raw.answer),
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
    reviewState: normalizeReviewState(row.review_state, row.created_at),
    studyStats: normalizeStudyStats(row.study_stats),
    audio: normalizeCardAudio(row.audio),
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
    is_sample: draft.isSample ?? false,
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

const AUDIO_BUCKET = 'memocards-audio'

function collectCardAudioPaths(rows: Array<Pick<CardRow, 'audio'>>) {
  const paths: string[] = []
  for (const row of rows) {
    const audio = normalizeCardAudio(row.audio)
    for (const variant of [audio.prompt, audio.answer]) {
      if (variant.storagePath) {
        paths.push(variant.storagePath)
      }
    }
  }
  return paths
}

/** Best-effort removal of generated audio files; never blocks the delete that triggered it. */
async function removeAudioObjects(paths: string[]) {
  if (paths.length === 0) {
    return
  }
  try {
    const storage = supabase().storage.from(AUDIO_BUCKET)
    for (let index = 0; index < paths.length; index += 100) {
      await storage.remove(paths.slice(index, index + 100))
    }
  } catch {
    return
  }
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

  // Seed defaults only for brand-new users; an existing row must never be
  // overwritten here because this runs on every auth event (reload, token refresh).
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
      { onConflict: 'user_id', ignoreDuplicates: true },
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

  const audioRows = await assertNoError(
    memocardsSchema().from('cards').select('audio').eq('user_id', uid).eq('deck_id', deckId),
  )

  await assertNoError(memocardsSchema().from('cards').delete().eq('user_id', uid).eq('deck_id', deckId))
  await assertNoError(memocardsSchema().from('decks').delete().eq('user_id', uid).eq('id', deckId))
  await removeAudioObjects(collectCardAudioPaths(audioRows ?? []))
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
    await createActivity(uid, {
      type: 'card_imported',
      title: 'Card created',
      description: 'Saved 1 card',
      deckId,
      cardId: null,
    })
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

  const audioRow = await assertNoError(
    memocardsSchema()
      .from('cards')
      .select('audio')
      .eq('user_id', uid)
      .eq('deck_id', deckId)
      .eq('id', cardId)
      .maybeSingle(),
  )

  await assertNoError(
    memocardsSchema().from('cards').delete().eq('user_id', uid).eq('deck_id', deckId).eq('id', cardId),
  )
  await removeAudioObjects(collectCardAudioPaths(audioRow ? [audioRow] : []))
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
          lastStudiedAt: timestamp,
          lastScore: score,
        }),
        updated_at: timestamp,
      })
      .eq('user_id', uid)
      .eq('deck_id', deckId)
      .eq('id', card.id),
  )

  // Deck counts are adjusted incrementally instead of re-reading every card,
  // and no data-changed event fires here: broadcasting mid-session would make
  // every subscribed view refetch after each answer. recordStudySession
  // refreshes everything when the session ends.
  await adjustDeckCountsForReview(uid, deckId, card, reviewState, timestamp)
}

async function adjustDeckCountsForReview(
  uid: string,
  deckId: string,
  previousCard: Card,
  nextReviewState: Card['reviewState'],
  timestamp: string,
) {
  const deckRow = await assertNoError(
    memocardsSchema().from('decks').select('counts').eq('user_id', uid).eq('id', deckId).maybeSingle(),
  )
  if (!deckRow) {
    return
  }

  const counts = normalizeCounts(jsonAs<Partial<DeckCounts>>(deckRow.counts, {}))
  const wasDue = isDue(previousCard.reviewState.dueAt, timestamp)
  const nowDue = isDue(nextReviewState.dueAt, timestamp)
  const wasMastered = previousCard.reviewState.mastery >= 80
  const nowMastered = nextReviewState.mastery >= 80
  const wasNew = previousCard.studyStats.totalReviews === 0

  const nextCounts: DeckCounts = {
    ...counts,
    dueCards: Math.max(0, counts.dueCards + (nowDue ? 1 : 0) - (wasDue ? 1 : 0)),
    masteredCards: Math.max(0, counts.masteredCards + (nowMastered ? 1 : 0) - (wasMastered ? 1 : 0)),
    newCards: Math.max(0, counts.newCards - (wasNew ? 1 : 0)),
  }

  await assertNoError(
    memocardsSchema()
      .from('decks')
      .update({
        counts: toJson(nextCounts),
        updated_at: timestamp,
      })
      .eq('id', deckId)
      .eq('user_id', uid),
  )
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

async function performLoadSampleData(uid: string): Promise<void> {
  const existingDecks = await fetchDecks(uid)
  if (existingDecks.length > 0) {
    // Another tab/click already added decks for this account — nothing to do.
    return
  }

  const settings = isLocalDevBypassUserId(uid)
    ? DEFAULT_SETTINGS
    : normalizeSettings(await fetchSettingsRow(uid))
  const createdDeckIds: string[] = []
  try {
    for (const sampleDeck of SAMPLE_DECKS) {
      createdDeckIds.push(await importDeckBundle(uid, sampleDeck.draft, sampleDeck.cards, settings))
    }
  } catch (error) {
    await Promise.all(createdDeckIds.map((deckId) => deleteDeck(uid, deckId).catch(() => undefined)))
    throw error
  }

  // Never trust the creation loop alone: re-fetch and confirm every deck we
  // just created actually has cards before leaving it in place.
  const verifiedDecks = await fetchDecks(uid)
  const allSeededDecksHaveCards = createdDeckIds.every((deckId) => {
    const deck = verifiedDecks.find((item) => item.id === deckId)
    return deck !== undefined && deck.counts.totalCards > 0
  })

  if (!allSeededDecksHaveCards) {
    await Promise.all(createdDeckIds.map((deckId) => deleteDeck(uid, deckId).catch(() => undefined)))
    throw new Error('Sample deck setup failed. Please try again.')
  }
}

const inFlightSampleLoads = new Map<string, Promise<void>>()

export function loadSampleData(uid: string): Promise<void> {
  const inFlight = inFlightSampleLoads.get(uid)
  if (inFlight) {
    return inFlight
  }

  const attempt = performLoadSampleData(uid).finally(() => {
    inFlightSampleLoads.delete(uid)
  })
  inFlightSampleLoads.set(uid, attempt)
  return attempt
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
      submittedAnswer,
    }),
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
