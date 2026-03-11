import { createEmptyCardDraft } from './importExport'
import type { CardDraft, CardType, DeckEntryDefaults } from '../types/models'

export type QuickAddMode = 'single' | 'bulk'
export type QuickAddEntryType = Extract<CardType, 'basic' | 'term' | 'multiple_choice' | 'explanation'>

interface DeckEntryMemory {
  lastSavedDraft: CardDraft | null
  lastCardType: CardType | null
  lastTags: string[]
}

interface QuickAddState {
  mode: QuickAddMode
  type: QuickAddEntryType
  singleValue: string
  bulkValue: string
}

const STORAGE_PREFIX = 'memocards:entry'

function getStorageItem<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      return fallback
    }
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function setStorageItem<T>(key: string, value: T) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

function removeStorageItem(key: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(key)
  } catch {
    return
  }
}

export function cloneCardDraft(draft: CardDraft): CardDraft {
  const base = createEmptyCardDraft()
  return {
    ...base,
    ...draft,
    tags: [...draft.tags],
    choices: draft.choices.map((choice) => ({ ...choice })),
    expectedAnswer: {
      ...base.expectedAnswer,
      ...draft.expectedAnswer,
      acceptedVariants: [...draft.expectedAnswer.acceptedVariants],
      keywords: [...draft.expectedAnswer.keywords],
    },
  }
}

function buildEmptyDraft(type: CardType, tags: string[]) {
  return {
    ...createEmptyCardDraft(),
    type,
    tags: [...tags],
  }
}

function deckCardDraftKey(deckId: string) {
  return `${STORAGE_PREFIX}:${deckId}:card-draft`
}

function deckQuickAddKey(deckId: string) {
  return `${STORAGE_PREFIX}:${deckId}:quick-add`
}

function deckEntryMemoryKey(deckId: string) {
  return `${STORAGE_PREFIX}:${deckId}:recent`
}

export function buildCreateCardDraft(
  entryDefaults: DeckEntryDefaults,
  recent?: Partial<DeckEntryMemory>,
) {
  const type = recent?.lastCardType ?? entryDefaults.cardType
  const tags = recent?.lastTags && recent.lastTags.length > 0 ? recent.lastTags : entryDefaults.tags
  return buildEmptyDraft(type, tags)
}

export function buildContinueCardDraft(
  previousDraft: CardDraft,
  entryDefaults: DeckEntryDefaults,
) {
  const nextTags = previousDraft.tags.length > 0 ? previousDraft.tags : entryDefaults.tags
  return buildEmptyDraft(previousDraft.type, nextTags)
}

export function applyEntryDefaultsToDraft(
  draft: CardDraft,
  entryDefaults: DeckEntryDefaults,
  recent?: Partial<DeckEntryMemory>,
) {
  const tags = draft.tags.length > 0
    ? draft.tags
    : recent?.lastTags && recent.lastTags.length > 0
      ? recent.lastTags
      : entryDefaults.tags

  return {
    ...cloneCardDraft(draft),
    tags: [...tags],
  }
}

export function loadCardDraft(deckId: string) {
  const stored = getStorageItem<CardDraft | null>(deckCardDraftKey(deckId), null)
  return stored ? cloneCardDraft(stored) : null
}

export function saveCardDraft(deckId: string, draft: CardDraft) {
  setStorageItem(deckCardDraftKey(deckId), cloneCardDraft(draft))
}

export function clearCardDraft(deckId: string) {
  removeStorageItem(deckCardDraftKey(deckId))
}

export function loadQuickAddState(deckId: string): QuickAddState {
  return getStorageItem<QuickAddState>(deckQuickAddKey(deckId), {
    mode: 'single',
    type: 'basic',
    singleValue: '',
    bulkValue: '',
  })
}

export function saveQuickAddState(deckId: string, state: QuickAddState) {
  setStorageItem(deckQuickAddKey(deckId), state)
}

export function clearQuickAddState(deckId: string) {
  removeStorageItem(deckQuickAddKey(deckId))
}

export function loadDeckEntryMemory(deckId: string): DeckEntryMemory {
  const stored = getStorageItem<DeckEntryMemory>(deckEntryMemoryKey(deckId), {
    lastSavedDraft: null,
    lastCardType: null,
    lastTags: [],
  })

  return {
    lastSavedDraft: stored.lastSavedDraft ? cloneCardDraft(stored.lastSavedDraft) : null,
    lastCardType: stored.lastCardType ?? null,
    lastTags: stored.lastTags ?? [],
  }
}

export function saveDeckEntryMemory(deckId: string, draft: CardDraft) {
  setStorageItem<DeckEntryMemory>(deckEntryMemoryKey(deckId), {
    lastSavedDraft: cloneCardDraft(draft),
    lastCardType: draft.type,
    lastTags: [...draft.tags],
  })
}
