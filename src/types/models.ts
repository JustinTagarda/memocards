export const CARD_TYPES = ['basic', 'term', 'multiple_choice', 'explanation'] as const
export const STUDY_MODES = ['review', 'learn', 'cram'] as const
export const SELF_ASSESSMENTS = ['again', 'hard', 'good', 'easy'] as const

export type CardType = (typeof CARD_TYPES)[number]
export type StudyMode = (typeof STUDY_MODES)[number]
export type SelfAssessment = (typeof SELF_ASSESSMENTS)[number]

export interface Folder {
  id: string
  name: string
  color: string
  createdAt: string
  updatedAt: string
}

export interface DeckCounts {
  totalCards: number
  dueCards: number
  masteredCards: number
  newCards: number
  favorites: number
}

export interface DeckStudyPreferences {
  defaultMode: StudyMode
  shuffleByDefault: boolean
  autoPlayAudio: boolean
  dailyGoal: number
}

export interface DeckExportConfig {
  enabled: boolean
  formatVersion: number
}

export interface DeckAiConfig {
  enabled: boolean
  provider: 'not_configured'
  rubricVersion: string
}

export interface Deck {
  id: string
  title: string
  description: string
  folderId: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
  lastStudiedAt: string | null
  counts: DeckCounts
  preferences: DeckStudyPreferences
  exportConfig: DeckExportConfig
  aiConfig: DeckAiConfig
}

export interface ReviewState {
  repetitions: number
  easeFactor: number
  intervalDays: number
  lapses: number
  lastReviewedAt: string | null
  dueAt: string
  mastery: number
}

export interface StudyStats {
  totalReviews: number
  correctReviews: number
  incorrectReviews: number
  lastMode: StudyMode | null
  lastScore: number | null
  lastStudiedAt: string | null
}

export interface AudioVariant {
  status: 'idle' | 'processing' | 'ready' | 'failed'
  storagePath: string | null
  textHash: string | null
  updatedAt: string | null
}

export interface CardAudio {
  locale: string
  voiceName: string
  prompt: AudioVariant
  answer: AudioVariant
}

export interface ExpectedAnswer {
  canonical: string
  acceptedVariants: string[]
  keywords: string[]
  rubric: string
}

export interface CardAiEvaluationConfig {
  status: 'not_configured' | 'ready_for_future_ai'
  minConfidence: number
  expectedConcepts: string[]
}

export interface CardAiEvaluationResult {
  score: number
  summary: string
  conceptsCovered: string[]
  missingConcepts: string[]
  evaluatedAt: string
}

export interface CardAiEvaluation {
  requestStatus: 'idle' | 'queued' | 'ready'
  config: CardAiEvaluationConfig
  lastResult: CardAiEvaluationResult | null
  lastRequestedAt: string | null
}

export interface CardChoice {
  id: string
  text: string
  isCorrect: boolean
}

export interface Card {
  id: string
  deckId: string
  type: CardType
  front: string
  back: string
  prompt: string
  answer: string
  explanation: string
  choices: CardChoice[]
  expectedAnswer: ExpectedAnswer
  tags: string[]
  isFavorite: boolean
  createdAt: string
  updatedAt: string
  reviewState: ReviewState
  studyStats: StudyStats
  audio: CardAudio
  aiEvaluation: CardAiEvaluation
}

export interface UserSummary {
  totalDecks: number
  totalCards: number
  dueToday: number
  masteredCards: number
  favorites: number
  studyStreak: number
  longestStreak: number
  lastStudyDate: string | null
  totalSessions: number
}

export interface UserSettings {
  dailyGoal: number
  defaultVoice: string
  defaultLocale: string
  autoPlayAudio: boolean
}

export interface UserProfile {
  uid: string
  email: string
  displayName: string
  photoURL: string
  createdAt: string
  updatedAt: string
  settings: UserSettings
  summary: UserSummary
}

export interface ActivityLog {
  id: string
  type:
    | 'deck_created'
    | 'deck_updated'
    | 'deck_deleted'
    | 'card_imported'
    | 'card_reviewed'
    | 'session_completed'
    | 'audio_generated'
    | 'folder_created'
  title: string
  description: string
  deckId: string | null
  cardId: string | null
  createdAt: string
}

export interface SessionCardResult {
  cardId: string
  assessment: SelfAssessment
  wasCorrect: boolean
  responseText: string
}

export interface StudySession {
  id: string
  deckId: string
  deckTitle: string
  mode: StudyMode
  startedAt: string
  endedAt: string
  cardsStudied: number
  correct: number
  incorrect: number
  durationSeconds: number
  results: SessionCardResult[]
}

export interface EvaluationRequest {
  id: string
  deckId: string
  cardId: string
  prompt: string
  expectedAnswer: ExpectedAnswer
  submittedAnswer: string
  status: 'pending' | 'disabled'
  createdAt: string
}

export interface DeckDraft {
  title: string
  description: string
  folderId: string | null
  tags: string[]
  preferences: DeckStudyPreferences
}

export interface CardDraft {
  type: CardType
  front: string
  back: string
  prompt: string
  answer: string
  explanation: string
  choices: CardChoice[]
  expectedAnswer: ExpectedAnswer
  tags: string[]
  isFavorite: boolean
}

export interface DeckExportBundle {
  formatVersion: number
  exportedAt: string
  deck: Omit<Deck, 'id' | 'counts' | 'createdAt' | 'updatedAt' | 'lastStudiedAt'>
  cards: CardDraft[]
}
