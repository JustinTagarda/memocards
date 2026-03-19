import { createEmptyCardDraft } from './importExport'
import { parseQuickAddInput, parseQuickAddLine, type QuickAddCardType } from './quickAdd'
import type { CardDraft } from '../types/models'

export type DocumentParserMode = 'auto' | QuickAddCardType

export interface DocumentParseCandidate {
  draft: CardDraft
  sourceLabel: string
  confidence: 'high' | 'medium'
  method: 'rule' | 'ai'
  warnings: string[]
}

export interface DocumentParseIssue {
  sourceLabel: string
  lineNumber: number
  content: string
  reason: string
}

export interface DocumentParseResult {
  candidates: DocumentParseCandidate[]
  issues: DocumentParseIssue[]
}

interface DocumentBlock {
  index: number
  startLine: number
  text: string
}

interface LabeledPair {
  left: string
  right: string
}

const SUPPORTED_DOCUMENT_EXTENSIONS = ['.txt', '.md', '.markdown', '.text', '.tsv'] as const
const EXPLANATION_PROMPT_PATTERN =
  /^(why|how|describe|explain|compare|contrast|discuss|summarize|outline|analyze|analyse|what happens|what is the process|give an example)/i

export function getSupportedDocumentExtensions() {
  return [...SUPPORTED_DOCUMENT_EXTENSIONS]
}

export function supportsDocumentFile(fileName: string) {
  const normalized = fileName.trim().toLowerCase()
  return SUPPORTED_DOCUMENT_EXTENSIONS.some((extension) => normalized.endsWith(extension))
}

function createPairedDraft(type: Exclude<QuickAddCardType, 'multiple_choice'>, left: string, right: string): CardDraft {
  const prompt = left.trim()
  const answer = right.trim()

  if (!prompt || !answer) {
    throw new Error('Both sides of the card need content.')
  }

  const base = createEmptyCardDraft()

  if (type === 'explanation') {
    return {
      ...base,
      type,
      front: prompt,
      back: answer,
      prompt,
      answer,
      expectedAnswer: {
        canonical: answer,
        acceptedVariants: [],
        keywords: [],
        rubric: '',
      },
    }
  }

  return {
    ...base,
    type,
    front: prompt,
    back: answer,
    prompt,
    answer,
  }
}

function normalizeDocumentText(content: string) {
  return content.replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').trim()
}

function normalizeLine(line: string) {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^`+/, '')
    .replace(/`+$/, '')
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .replace(/^__(.+)__$/, '$1')
    .trim()
}

function collectBlocks(input: string) {
  const blocks: DocumentBlock[] = []
  const lines = input.split('\n')
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

function getNormalizedLines(text: string) {
  return text
    .split('\n')
    .map(normalizeLine)
    .filter(Boolean)
}

function inferPairedType(left: string, right: string): Exclude<QuickAddCardType, 'multiple_choice'> {
  const prompt = left.trim()
  const answer = right.trim()
  const answerWordCount = answer.split(/\s+/).filter(Boolean).length
  const answerLooksLong =
    answer.includes('\n') ||
    answer.length >= 160 ||
    answerWordCount >= 28 ||
    /[.!?].+[.!?]/.test(answer)

  if (EXPLANATION_PROMPT_PATTERN.test(prompt) || (prompt.endsWith('?') && answerLooksLong)) {
    return 'explanation'
  }

  const promptWordCount = prompt.split(/\s+/).filter(Boolean).length
  const promptLooksLikeTerm =
    promptWordCount > 0 &&
    promptWordCount <= 8 &&
    prompt.length <= 60 &&
    !/[?!]/.test(prompt)

  return promptLooksLikeTerm ? 'term' : 'basic'
}

function tryParseTabSeparatedLine(line: string) {
  const segments = line.split('\t').map(normalizeLine).filter(Boolean)
  if (segments.length < 2) {
    return null
  }

  const left = segments[0] ?? ''
  const right = segments.slice(1).join(' ').trim()
  return createPairedDraft(inferPairedType(left, right), left, right)
}

function tryParseAutoInlineLine(line: string) {
  const normalized = normalizeLine(line)

  if (!normalized) {
    return null
  }

  try {
    if (normalized.includes(':::')) {
      return parseQuickAddLine(normalized, 'explanation')
    }
    if (normalized.includes('::')) {
      return parseQuickAddLine(normalized, 'basic')
    }
    if (normalized.includes('->')) {
      return parseQuickAddLine(normalized, 'term')
    }
    if (normalized.includes('|')) {
      return parseQuickAddLine(normalized, 'multiple_choice')
    }
    if (normalized.includes('\t')) {
      return tryParseTabSeparatedLine(normalized)
    }
  } catch {
    return null
  }

  return null
}

function findLabeledPair(
  lines: string[],
  leftPattern: RegExp,
  rightPattern: RegExp,
): LabeledPair | null {
  const leftIndex = lines.findIndex((line) => leftPattern.test(line))
  const rightIndex = lines.findIndex((line, index) => index > leftIndex && rightPattern.test(line))

  if (leftIndex === -1 || rightIndex === -1 || rightIndex <= leftIndex) {
    return null
  }

  const left = [
    lines[leftIndex]?.replace(leftPattern, '').trim() ?? '',
    ...lines.slice(leftIndex + 1, rightIndex),
  ]
    .join('\n')
    .trim()
  const right = [
    lines[rightIndex]?.replace(rightPattern, '').trim() ?? '',
    ...lines.slice(rightIndex + 1),
  ]
    .join('\n')
    .trim()

  if (!left || !right) {
    return null
  }

  return { left, right }
}

function tryParseLabeledBlock(lines: string[]) {
  const questionPair = findLabeledPair(lines, /^q(?:uestion)?[:\-]\s*/i, /^a(?:nswer)?[:\-]\s*/i)
  if (questionPair) {
    return {
      draft: createPairedDraft(inferPairedType(questionPair.left, questionPair.right), questionPair.left, questionPair.right),
      confidence: 'high' as const,
      warnings: [] as string[],
    }
  }

  const termPair = findLabeledPair(lines, /^term[:\-]\s*/i, /^(definition|meaning|description)[:\-]\s*/i)
  if (termPair) {
    return {
      draft: createPairedDraft('term', termPair.left, termPair.right),
      confidence: 'high' as const,
      warnings: [] as string[],
    }
  }

  return null
}

function buildCandidate(
  draft: CardDraft,
  sourceLabel: string,
  confidence: 'high' | 'medium',
  warnings: string[] = [],
): DocumentParseCandidate {
  return {
    draft,
    sourceLabel,
    confidence,
    method: 'rule',
    warnings,
  }
}

function parseForcedMode(content: string, mode: QuickAddCardType): DocumentParseResult {
  const preview = parseQuickAddInput(content, mode)

  return {
    candidates: preview.drafts.map((item) => buildCandidate(item.draft, item.sourceLabel, 'high')),
    issues: preview.invalidLines.map((item) => ({
      sourceLabel: item.label ?? `Line ${item.lineNumber}`,
      lineNumber: item.lineNumber,
      content: item.content,
      reason: item.reason,
    })),
  }
}

function parseBlockAsStructuredCard(block: DocumentBlock) {
  const lines = getNormalizedLines(block.text)
  if (lines.length < 2) {
    return null
  }

  const labeled = tryParseLabeledBlock(lines)
  if (labeled) {
    return buildCandidate(labeled.draft, `Block ${block.index}`, labeled.confidence, labeled.warnings)
  }

  const prompt = lines[0] ?? ''
  const answer = lines.slice(1).join('\n').trim()
  if (!prompt || !answer) {
    return null
  }

  return buildCandidate(
    createPairedDraft(inferPairedType(prompt, answer), prompt, answer),
    `Block ${block.index}`,
    'medium',
    ['Built from a heading and the following text. Review before saving.'],
  )
}

function parseAutoMode(content: string): DocumentParseResult {
  const blocks = collectBlocks(content)
  const candidates: DocumentParseCandidate[] = []
  const issues: DocumentParseIssue[] = []
  let pendingBlock: DocumentBlock | null = null

  for (const block of blocks) {
    const lines = getNormalizedLines(block.text)

    if (lines.length === 0) {
      continue
    }

    const inlineDrafts = lines.map((line) => tryParseAutoInlineLine(line))
    const allInline = inlineDrafts.every((draft) => Boolean(draft))

    if (allInline && lines.length > 1) {
      inlineDrafts.forEach((draft, index) => {
        if (!draft) {
          return
        }
        candidates.push(buildCandidate(draft, `Line ${block.startLine + index}`, 'high'))
      })
      continue
    }

    if (pendingBlock) {
      try {
        candidates.push(
          buildCandidate(
            createPairedDraft(
              inferPairedType(pendingBlock.text, block.text),
              normalizeLine(pendingBlock.text),
              block.text.trim(),
            ),
            `Blocks ${pendingBlock.index}-${block.index}`,
            'medium',
            ['Built by pairing neighboring sections. Review before saving.'],
          ),
        )
      } catch (reason) {
        issues.push({
          sourceLabel: `Blocks ${pendingBlock.index}-${block.index}`,
          lineNumber: pendingBlock.startLine,
          content: `${pendingBlock.text}\n\n${block.text}`,
          reason: reason instanceof Error ? reason.message : 'Unable to parse these sections.',
        })
      }
      pendingBlock = null
      continue
    }

    if (lines.length === 1) {
      const inlineDraft = inlineDrafts[0]
      if (inlineDraft) {
        candidates.push(buildCandidate(inlineDraft, `Line ${block.startLine}`, 'high'))
        continue
      }

      pendingBlock = {
        ...block,
        text: lines[0] ?? block.text,
      }
      continue
    }

    const structuredCard = parseBlockAsStructuredCard(block)
    if (structuredCard) {
      candidates.push(structuredCard)
      continue
    }

    issues.push({
      sourceLabel: `Block ${block.index}`,
      lineNumber: block.startLine,
      content: block.text,
      reason: 'Could not match this section to a supported card pattern.',
    })
  }

  if (pendingBlock) {
    issues.push({
      sourceLabel: `Block ${pendingBlock.index}`,
      lineNumber: pendingBlock.startLine,
      content: pendingBlock.text,
      reason: 'This section needs a matching answer block or a supported delimiter.',
    })
  }

  return {
    candidates,
    issues,
  }
}

export function parseDocumentText(content: string, mode: DocumentParserMode): DocumentParseResult {
  const normalized = normalizeDocumentText(content)

  if (!normalized) {
    return {
      candidates: [],
      issues: [],
    }
  }

  return mode === 'auto' ? parseAutoMode(normalized) : parseForcedMode(normalized, mode)
}
