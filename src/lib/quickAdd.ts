import { createEmptyCardDraft } from './importExport'
import type { QuickAddEntryType } from './cardEntry'
import type { CardChoice, CardDraft } from '../types/models'

export type QuickAddCardType = QuickAddEntryType

export interface QuickAddInvalidLine {
  content: string
  lineNumber: number
  reason: string
  label?: string
}

export interface QuickAddPreviewItem {
  draft: CardDraft
  sourceLabel: string
}

export interface QuickAddPreviewResult {
  drafts: QuickAddPreviewItem[]
  invalidLines: QuickAddInvalidLine[]
}

export interface QuickAddTypeMeta {
  description: string
  example: string
  help: string
  inputLabel: string
  placeholder: string
}

interface TextBlock {
  index: number
  startLine: number
  text: string
}

export const QUICK_ADD_TYPE_META: Record<QuickAddCardType, QuickAddTypeMeta> = {
  basic: {
    description: 'Prompt :: answer',
    example: 'What is the capital of France? :: Paris',
    help: 'Use double colons, tab-separated pairs, or blank-line front/back blocks.',
    inputLabel: 'Quick entry',
    placeholder: 'What is the capital of France? :: Paris',
  },
  term: {
    description: 'Term -> definition',
    example: 'Polymorphism -> The ability of objects to take many forms',
    help: 'Use an arrow, tab-separated pairs, or blank-line term/definition blocks.',
    inputLabel: 'Quick entry',
    placeholder: 'Polymorphism -> The ability of objects to take many forms',
  },
  multiple_choice: {
    description: 'Question | option 1 | option 2* | option 3',
    example: 'Capital of France? | Rome | Paris* | Madrid | Berlin',
    help: 'Keep one question per line and mark exactly one correct choice with a trailing *.',
    inputLabel: 'Quick entry',
    placeholder: 'Capital of France? | Rome | Paris* | Madrid | Berlin',
  },
  explanation: {
    description: 'Prompt ::: expected answer',
    example: 'Why does caching improve performance? ::: It reduces repeated expensive work',
    help: 'Use triple colons, tab-separated pairs, or blank-line prompt/answer blocks.',
    inputLabel: 'Quick entry',
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

function buildPairedDraft(type: Exclude<QuickAddCardType, 'multiple_choice'>, left: string, right: string) {
  const front = left.trim()
  const back = right.trim()

  if (!front || !back) {
    throw new Error('Both sides of the card are required.')
  }

  switch (type) {
    case 'basic':
      return {
        ...buildBaseDraft('basic'),
        front,
        back,
        prompt: front,
        answer: back,
      }
    case 'term':
      return {
        ...buildBaseDraft('term'),
        front,
        back,
        prompt: front,
        answer: back,
      }
    case 'explanation':
      return {
        ...buildBaseDraft('explanation'),
        front,
        back,
        prompt: front,
        answer: back,
        expectedAnswer: {
          canonical: back,
          acceptedVariants: [],
          keywords: [],
          rubric: '',
        },
      }
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

  return buildPairedDraft('basic', parts[0], parts[1])
}

function parseTermLine(line: string): CardDraft {
  const parts = splitOnce(line, '->')
  if (!parts) {
    throw new Error('Use term -> definition.')
  }

  return buildPairedDraft('term', parts[0], parts[1])
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

  return buildPairedDraft('explanation', parts[0], parts[1])
}

function parseTabSeparatedPair(line: string, type: Exclude<QuickAddCardType, 'multiple_choice'>) {
  const segments = line.split('\t').map((segment) => segment.trim()).filter(Boolean)
  if (segments.length < 2) {
    throw new Error('Use a tab between the front and back.')
  }

  return buildPairedDraft(type, segments[0] ?? '', segments.slice(1).join(' '))
}

function canParseInlineLine(line: string, type: QuickAddCardType) {
  switch (type) {
    case 'basic':
      return line.includes('::') || line.includes('\t')
    case 'term':
      return line.includes('->') || line.includes('\t')
    case 'multiple_choice':
      return line.includes('|')
    case 'explanation':
      return line.includes(':::') || line.includes('\t')
  }
}

function collectBlocks(input: string) {
  const blocks: TextBlock[] = []
  const lines = input.split(/\r?\n/)
  let buffer: string[] = []
  let startLine = 1

  lines.forEach((line, index) => {
    if (!line.trim()) {
      if (buffer.length > 0) {
        blocks.push({
          index: blocks.length + 1,
          startLine,
          text: buffer.join('\n').trim(),
        })
        buffer = []
      }
      startLine = index + 2
      return
    }

    if (buffer.length === 0) {
      startLine = index + 1
    }

    buffer.push(line)
  })

  if (buffer.length > 0) {
    blocks.push({
      index: blocks.length + 1,
      startLine,
      text: buffer.join('\n').trim(),
    })
  }

  return blocks
}

function parseBlockPairs(input: string, type: Exclude<QuickAddCardType, 'multiple_choice'>): QuickAddPreviewResult {
  const blocks = collectBlocks(input)
  const drafts: QuickAddPreviewItem[] = []
  const invalidLines: QuickAddInvalidLine[] = []

  for (let index = 0; index < blocks.length; index += 2) {
    const frontBlock = blocks[index]
    const backBlock = blocks[index + 1]

    if (!frontBlock) {
      continue
    }

    if (!backBlock) {
      invalidLines.push({
        content: frontBlock.text,
        lineNumber: frontBlock.startLine,
        label: `Block ${frontBlock.index}`,
        reason: 'This block is missing a matching answer block.',
      })
      continue
    }

    try {
      drafts.push({
        draft: buildPairedDraft(type, frontBlock.text, backBlock.text),
        sourceLabel: `Blocks ${frontBlock.index}-${backBlock.index}`,
      })
    } catch (reason) {
      invalidLines.push({
        content: `${frontBlock.text}\n\n${backBlock.text}`,
        lineNumber: frontBlock.startLine,
        label: `Blocks ${frontBlock.index}-${backBlock.index}`,
        reason: reason instanceof Error ? reason.message : 'Unable to parse these blocks.',
      })
    }
  }

  return { drafts, invalidLines }
}

function parseInlineLine(line: string, type: QuickAddCardType) {
  switch (type) {
    case 'basic':
      if (line.includes('\t') && !line.includes('::')) {
        return parseTabSeparatedPair(line, 'basic')
      }
      return parseBasicLine(line)
    case 'term':
      if (line.includes('\t') && !line.includes('->')) {
        return parseTabSeparatedPair(line, 'term')
      }
      return parseTermLine(line)
    case 'multiple_choice':
      return parseMultipleChoiceLine(line)
    case 'explanation':
      if (line.includes('\t') && !line.includes(':::')) {
        return parseTabSeparatedPair(line, 'explanation')
      }
      return parseExplanationLine(line)
  }
}

function parseSingleBlockDraft(input: string, type: Exclude<QuickAddCardType, 'multiple_choice'>) {
  const blocks = collectBlocks(input)
  if (blocks.length !== 2) {
    throw new Error('Use one prompt block, a blank line, then one answer block.')
  }

  return buildPairedDraft(type, blocks[0]?.text ?? '', blocks[1]?.text ?? '')
}

export function summarizeQuickAddDraft(draft: CardDraft) {
  switch (draft.type) {
    case 'basic':
    case 'term':
      return {
        heading: draft.front,
        detail: draft.back,
      }
    case 'multiple_choice':
      return {
        heading: draft.prompt,
        detail: draft.choices.map((choice) => `${choice.text}${choice.isCorrect ? ' *' : ''}`).join(' | '),
      }
    case 'explanation':
      return {
        heading: draft.prompt,
        detail: draft.expectedAnswer.canonical,
      }
  }
}

export function parseQuickAddLine(input: string, type: QuickAddCardType): CardDraft {
  const normalized = input.trim()
  if (!normalized) {
    throw new Error('Enter content to add.')
  }

  if (type !== 'multiple_choice' && /\r?\n\s*\r?\n/.test(normalized) && !canParseInlineLine(normalized, type)) {
    return parseSingleBlockDraft(normalized, type)
  }

  return parseInlineLine(normalized, type)
}

export function parseQuickAddInput(input: string, type: QuickAddCardType): QuickAddPreviewResult {
  const drafts: QuickAddPreviewItem[] = []
  const invalidLines: QuickAddInvalidLine[] = []
  const nonEmptyLines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const shouldUseBlockPairs =
    type !== 'multiple_choice' &&
    /\r?\n\s*\r?\n/.test(input) &&
    nonEmptyLines.length > 0 &&
    !nonEmptyLines.every((line) => canParseInlineLine(line, type))

  if (shouldUseBlockPairs) {
    return parseBlockPairs(input, type)
  }

  input.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line) {
      return
    }

    try {
      drafts.push({
        draft: parseInlineLine(line, type),
        sourceLabel: `Line ${index + 1}`,
      })
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
