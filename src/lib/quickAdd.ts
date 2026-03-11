import { createEmptyCardDraft } from './importExport'
import type { CardChoice, CardDraft, CardType } from '../types/models'

export type QuickAddCardType = Extract<CardType, 'basic' | 'term' | 'multiple_choice' | 'explanation'>

export interface QuickAddInvalidLine {
  content: string
  lineNumber: number
  reason: string
}

export interface QuickAddTypeMeta {
  description: string
  example: string
  help: string
  inputLabel: string
  placeholder: string
}

export const QUICK_ADD_TYPE_META: Record<QuickAddCardType, QuickAddTypeMeta> = {
  basic: {
    description: 'Prompt :: answer',
    example: 'What is the capital of France? :: Paris',
    help: 'Use double colons to split the front and back.',
    inputLabel: 'Quick line',
    placeholder: 'What is the capital of France? :: Paris',
  },
  term: {
    description: 'Term -> definition',
    example: 'Polymorphism -> The ability of objects to take many forms',
    help: 'Use an arrow to split the term from its definition.',
    inputLabel: 'Quick line',
    placeholder: 'Polymorphism -> The ability of objects to take many forms',
  },
  multiple_choice: {
    description: 'Question | option 1 | option 2* | option 3',
    example: 'Capital of France? | Rome | Paris* | Madrid | Berlin',
    help: 'Mark exactly one correct choice with a trailing *.',
    inputLabel: 'Quick line',
    placeholder: 'Capital of France? | Rome | Paris* | Madrid | Berlin',
  },
  explanation: {
    description: 'Prompt ::: expected answer',
    example: 'Why does caching improve performance? ::: It reduces repeated expensive work',
    help: 'Use triple colons for explanation cards so it does not clash with basic cards.',
    inputLabel: 'Quick line',
    placeholder: 'Why does caching improve performance? ::: It reduces repeated expensive work',
  },
}

function splitOnce(value: string, delimiter: string) {
  const index = value.indexOf(delimiter)
  if (index === -1) {
    return null
  }

  return [value.slice(0, index), value.slice(index + delimiter.length)] as const
}

function createChoice(id: string, text: string, isCorrect: boolean): CardChoice {
  return {
    id,
    text,
    isCorrect,
  }
}

function buildBaseDraft(type: QuickAddCardType) {
  return {
    ...createEmptyCardDraft(),
    type,
  }
}

function parseBasicLine(line: string): CardDraft {
  if (line.includes(':::')) {
    throw new Error('Use ::: for explanation cards.')
  }

  const parts = splitOnce(line, '::')
  if (!parts) {
    throw new Error('Use prompt :: answer.')
  }

  const [front, back] = parts.map((part) => part.trim())
  if (!front || !back) {
    throw new Error('Both prompt and answer are required.')
  }

  return {
    ...buildBaseDraft('basic'),
    front,
    back,
    prompt: front,
    answer: back,
  }
}

function parseTermLine(line: string): CardDraft {
  const parts = splitOnce(line, '->')
  if (!parts) {
    throw new Error('Use term -> definition.')
  }

  const [front, back] = parts.map((part) => part.trim())
  if (!front || !back) {
    throw new Error('Both term and definition are required.')
  }

  return {
    ...buildBaseDraft('term'),
    front,
    back,
    prompt: front,
    answer: back,
  }
}

function parseMultipleChoiceLine(line: string): CardDraft {
  const parts = line.split('|').map((part) => part.trim())
  if (parts.length < 3) {
    throw new Error('Use question | option 1 | option 2* | option 3.')
  }

  const [prompt, ...rawChoices] = parts
  if (!prompt) {
    throw new Error('A question is required.')
  }

  const choices = rawChoices.reduce<CardChoice[]>((result, rawChoice, index) => {
    if (!rawChoice) {
      return result
    }

    const isCorrect = rawChoice.endsWith('*')
    const text = isCorrect ? rawChoice.slice(0, -1).trim() : rawChoice.trim()
    result.push(createChoice(String.fromCharCode(65 + index), text, isCorrect))
    return result
  }, [])

  if (choices.length < 2) {
    throw new Error('Add at least two answer choices.')
  }

  if (choices.some((choice) => !choice.text)) {
    throw new Error('Choices cannot be empty.')
  }

  const correctChoices = choices.filter((choice) => choice.isCorrect)
  if (correctChoices.length !== 1) {
    throw new Error('Mark exactly one correct choice with *.')
  }

  const answer = correctChoices[0]?.text ?? ''

  return {
    ...buildBaseDraft('multiple_choice'),
    front: prompt,
    back: answer,
    prompt,
    answer,
    choices,
  }
}

function parseExplanationLine(line: string): CardDraft {
  const parts = splitOnce(line, ':::')
  if (!parts) {
    throw new Error('Use prompt ::: expected answer.')
  }

  const [prompt, canonical] = parts.map((part) => part.trim())
  if (!prompt || !canonical) {
    throw new Error('Both prompt and expected answer are required.')
  }

  return {
    ...buildBaseDraft('explanation'),
    front: prompt,
    back: canonical,
    prompt,
    answer: canonical,
    expectedAnswer: {
      canonical,
      acceptedVariants: [],
      keywords: [],
      rubric: '',
    },
  }
}

export function parseQuickAddLine(line: string, type: QuickAddCardType): CardDraft {
  const normalized = line.trim()
  if (!normalized) {
    throw new Error('Enter a line to add.')
  }

  switch (type) {
    case 'basic':
      return parseBasicLine(normalized)
    case 'term':
      return parseTermLine(normalized)
    case 'multiple_choice':
      return parseMultipleChoiceLine(normalized)
    case 'explanation':
      return parseExplanationLine(normalized)
  }
}

export function parseQuickAddInput(input: string, type: QuickAddCardType) {
  const drafts: CardDraft[] = []
  const invalidLines: QuickAddInvalidLine[] = []

  input.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line) {
      return
    }

    try {
      drafts.push(parseQuickAddLine(line, type))
    } catch (reason) {
      invalidLines.push({
        content: rawLine,
        lineNumber: index + 1,
        reason: reason instanceof Error ? reason.message : 'Unable to parse this line.',
      })
    }
  })

  return { drafts, invalidLines }
}
