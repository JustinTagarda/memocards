import Papa from 'papaparse'
import type { Card, CardChoice, CardDraft, Deck, DeckDraft, DeckExportBundle } from '../types/models'
import { nowIso, parseTags } from './utils'

function parseChoices(row: Record<string, string>) {
  const choiceKeys = ['choiceA', 'choiceB', 'choiceC', 'choiceD']
  const correct = new Set(
    (row['correctChoices'] ?? '')
      .split('|')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  )

  return choiceKeys.reduce<CardChoice[]>((choices, key, index) => {
    const text = row[key]
    if (!text) {
      return choices
    }
    const id = String.fromCharCode(65 + index)
    choices.push({
      id,
      text: text.trim(),
      isCorrect: correct.has(id),
    })
    return choices
  }, [])
}

export function createEmptyCardDraft(): CardDraft {
  return {
    type: 'basic',
    front: '',
    back: '',
    prompt: '',
    answer: '',
    explanation: '',
    choices: [],
    expectedAnswer: {
      canonical: '',
      acceptedVariants: [],
      keywords: [],
      rubric: '',
    },
    tags: [],
    isFavorite: false,
  }
}

export function createEmptyDeckDraft(): DeckDraft {
  return {
    title: '',
    description: '',
    folderId: null,
    tags: [],
    preferences: {
      defaultMode: 'review',
      shuffleByDefault: false,
      autoPlayAudio: false,
      dailyGoal: 25,
      entryDefaults: {
        cardType: 'basic',
        tags: [],
      },
    },
  }
}

function normalizeDeckPreferences(preferences?: Partial<DeckDraft['preferences']>): DeckDraft['preferences'] {
  const base = createEmptyDeckDraft().preferences
  return {
    ...base,
    ...preferences,
    entryDefaults: {
      ...base.entryDefaults,
      ...preferences?.entryDefaults,
      tags: preferences?.entryDefaults?.tags ?? base.entryDefaults.tags,
    },
  }
}

function normalizeCardDraft(card: Partial<CardDraft>): CardDraft {
  const base = createEmptyCardDraft()
  return {
    ...base,
    ...card,
    choices: card.choices ?? base.choices,
    tags: card.tags ?? base.tags,
    expectedAnswer: {
      ...base.expectedAnswer,
      ...card.expectedAnswer,
      acceptedVariants: card.expectedAnswer?.acceptedVariants ?? base.expectedAnswer.acceptedVariants,
      keywords: card.expectedAnswer?.keywords ?? base.expectedAnswer.keywords,
    },
  }
}

export function buildDeckExportBundle(deck: Deck, cards: Card[]): DeckExportBundle {
  return {
    formatVersion: 1,
    exportedAt: nowIso(),
    deck: {
      title: deck.title,
      description: deck.description,
      folderId: null,
      tags: deck.tags,
      preferences: deck.preferences,
      exportConfig: deck.exportConfig,
      aiConfig: deck.aiConfig,
      isSample: false,
    },
    cards: cards.map((card) => ({
      type: card.type,
      front: card.front,
      back: card.back,
      prompt: card.prompt,
      answer: card.answer,
      explanation: card.explanation,
      choices: card.choices,
      expectedAnswer: card.expectedAnswer,
      tags: card.tags,
      isFavorite: card.isFavorite,
    })),
  }
}

export function bundleToDeckDraft(bundle: DeckExportBundle): DeckDraft {
  return {
    title: bundle.deck.title,
    description: bundle.deck.description,
    folderId: null,
    tags: bundle.deck.tags,
    preferences: normalizeDeckPreferences(bundle.deck.preferences),
  }
}

export function parseImportFile(content: string, fileName: string) {
  if (fileName.toLowerCase().endsWith('.json')) {
    const bundle = JSON.parse(content) as DeckExportBundle
    if (!bundle.deck || !bundle.cards) {
      throw new Error('Invalid MemoCards JSON export.')
    }
    return {
      deck: bundleToDeckDraft(bundle),
      cards: bundle.cards.map((card) => normalizeCardDraft(card)),
    }
  }

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
  })

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? 'Unable to parse the CSV file.')
  }

  const cards = parsed.data.map((row) =>
    normalizeCardDraft({
      type: (row['type'] as CardDraft['type']) || 'basic',
      front: row['front'] ?? row['term'] ?? '',
      back: row['back'] ?? row['definition'] ?? '',
      prompt: row['prompt'] ?? row['question'] ?? row['front'] ?? row['term'] ?? '',
      answer: row['answer'] ?? row['back'] ?? row['definition'] ?? '',
      explanation: row['explanation'] ?? '',
      choices: parseChoices(row),
      expectedAnswer: {
        canonical: row['expectedAnswer'] ?? row['answer'] ?? '',
        acceptedVariants: (row['acceptedVariants'] ?? '')
          .split('|')
          .map((value) => value.trim())
          .filter(Boolean),
        keywords: (row['keywords'] ?? '')
          .split('|')
          .map((value) => value.trim())
          .filter(Boolean),
        rubric: row['rubric'] ?? '',
      },
      tags: parseTags(row['tags'] ?? ''),
      isFavorite: (row['favorite'] ?? '').toLowerCase() === 'true',
    }),
  )

  const inferredDeckTitle = fileName.replace(/\.[^/.]+$/, '')
  return {
    deck: {
      ...createEmptyDeckDraft(),
      title: inferredDeckTitle,
      description: 'Imported from CSV',
    },
    cards,
  }
}

export function buildDeckCsv(cards: Card[]) {
  return Papa.unparse(
    cards.map((card) => ({
      type: card.type,
      front: card.front,
      back: card.back,
      prompt: card.prompt,
      answer: card.answer,
      explanation: card.explanation,
      choiceA: card.choices[0]?.text ?? '',
      choiceB: card.choices[1]?.text ?? '',
      choiceC: card.choices[2]?.text ?? '',
      choiceD: card.choices[3]?.text ?? '',
      correctChoices: card.choices
        .filter((choice) => choice.isCorrect)
        .map((choice) => choice.id)
        .join('|'),
      expectedAnswer: card.expectedAnswer.canonical,
      acceptedVariants: card.expectedAnswer.acceptedVariants.join('|'),
      keywords: card.expectedAnswer.keywords.join('|'),
      rubric: card.expectedAnswer.rubric,
      tags: card.tags.join(','),
      favorite: String(card.isFavorite),
    })),
  )
}
