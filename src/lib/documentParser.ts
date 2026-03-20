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

interface ParsedBlockLine {
  raw: string
  normalized: string
  lineNumber: number
}

type MarkerKind = 'question' | 'answer' | 'term' | 'definition'

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

function stripListPrefix(line: string) {
  return line.replace(/^\d+\s*[.)]\s*/, '').trimStart()
}

function normalizeMarkerLine(line: string) {
  return line
    .replace(
      /^(question|q|answer|a|term|definition|meaning|description)\s*[:\-]\s*/i,
      (_match, marker: string) => `${marker}: `,
    )
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function normalizeLine(line: string) {
  return normalizeMarkerLine(
    stripListPrefix(
      line
        .trim()
        .replace(/^#{1,6}\s+/, '')
        .replace(/^>\s+/, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/^`+/, '')
        .replace(/`+$/, '')
        .replace(/^\*\*(.+)\*\*$/, '$1')
        .replace(/^__(.+)__$/, '$1')
        .trim(),
    ),
  )
}

function toParsedBlockLines(block: DocumentBlock): ParsedBlockLine[] {
  return block.text
    .split('\n')
    .map((raw, index) => ({
      raw,
      normalized: normalizeLine(raw),
      lineNumber: block.startLine + index,
    }))
    .filter((line) => Boolean(line.normalized))
}

function getMarkerKind(line: string): MarkerKind | null {
  if (/^(?:q|question):\s*/i.test(line)) {
    return 'question'
  }

  if (/^(?:a|answer):\s*/i.test(line)) {
    return 'answer'
  }

  if (/^term:\s*/i.test(line)) {
    return 'term'
  }

  if (/^(?:definition|meaning|description):\s*/i.test(line)) {
    return 'definition'
  }

  return null
}

function removeMarkerPrefix(line: string, markerKind: MarkerKind) {
  switch (markerKind) {
    case 'question':
      return line.replace(/^(?:q|question):\s*/i, '').trim()
    case 'answer':
      return line.replace(/^(?:a|answer):\s*/i, '').trim()
    case 'term':
      return line.replace(/^term:\s*/i, '').trim()
    case 'definition':
      return line.replace(/^(?:definition|meaning|description):\s*/i, '').trim()
  }
}

function looksLikeStandaloneHeader(line: string) {
  if (!line || getMarkerKind(line) || /[.:?!]/.test(line)) {
    return false
  }

  const words = line.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 4) {
    return false
  }

  return words.every((word) => /^[A-Z][A-Za-z0-9'&/-]*$/.test(word) || /^[A-Z]{2,}[A-Za-z0-9'&/-]*$/.test(word))
}

function looksLikeQuestionLine(line: string) {
  const normalized = normalizeMarkerLine(stripListPrefix(line))
  if (!normalized || getMarkerKind(normalized)) {
    return false
  }

  if (normalized.endsWith('?')) {
    return true
  }

  return /^(who|what|when|where|why|how|which|name|define|describe|compare|explain)\b/i.test(normalized)
}

function isSectionHeader(line: string, nextLine = '') {
  if (!looksLikeStandaloneHeader(line) || looksLikeQuestionLine(line)) {
    return false
  }

  const words = line.split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    return true
  }

  return Boolean(nextLine) && (getMarkerKind(nextLine) !== null || looksLikeQuestionLine(nextLine))
}

function splitInlineMarkedContent(content: string, markerKinds: MarkerKind[]) {
  const markerPattern = markerKinds.includes('answer')
    ? /(?:^|\s)(?:a|answer):\s*/i
    : /(?:^|\s)(?:definition|meaning|description):\s*/i
  const match = markerPattern.exec(content)

  if (!match || typeof match.index !== 'number') {
    return null
  }

  const left = content.slice(0, match.index).trim()
  const right = content.slice(match.index).replace(markerPattern, '').trim()

  if (!left || !right) {
    return null
  }

  return { left, right }
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

function buildCandidateFromPair(
  left: string,
  right: string,
  sourceLabel: string,
  confidence: 'high' | 'medium',
  warnings: string[] = [],
  draftFactory: (leftValue: string, rightValue: string) => CardDraft = (leftValue, rightValue) =>
    createPairedDraft(inferPairedType(leftValue, rightValue), leftValue, rightValue),
) {
  try {
    return buildCandidate(draftFactory(left, right), sourceLabel, confidence, warnings)
  } catch {
    return null
  }
}

function extractSequentialMarkedPairs(
  block: DocumentBlock,
  leftKinds: MarkerKind[],
  rightKinds: MarkerKind[],
  draftFactory: (leftValue: string, rightValue: string) => CardDraft,
) {
  const lines = toParsedBlockLines(block)
  const candidates: DocumentParseCandidate[] = []
  let leftParts: string[] = []
  let rightParts: string[] = []
  let pairStartLine = block.startLine
  let activeSide: 'left' | 'right' | null = null

  function flushCurrentPair() {
    const left = leftParts.join('\n').trim()
    const right = rightParts.join('\n').trim()
    if (!left || !right) {
      leftParts = []
      rightParts = []
      activeSide = null
      return
    }

    const candidate = buildCandidateFromPair(left, right, `Line ${pairStartLine}`, 'high', [], draftFactory)
    if (candidate) {
      candidates.push(candidate)
    }

    leftParts = []
    rightParts = []
    activeSide = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index]
    if (!current) {
      continue
    }

    const nextLine = lines[index + 1]?.normalized ?? ''
    const markerKind = getMarkerKind(current.normalized)

    if (markerKind && leftKinds.includes(markerKind)) {
      flushCurrentPair()

      const leftContent = removeMarkerPrefix(current.normalized, markerKind)
      const inlinePair = splitInlineMarkedContent(leftContent, rightKinds)
      if (inlinePair) {
        const candidate = buildCandidateFromPair(
          inlinePair.left,
          inlinePair.right,
          `Line ${current.lineNumber}`,
          'high',
          [],
          draftFactory,
        )
        if (candidate) {
          candidates.push(candidate)
        }
        continue
      }

      leftParts = leftContent ? [leftContent] : []
      rightParts = []
      pairStartLine = current.lineNumber
      activeSide = 'left'
      continue
    }

    if (markerKind && rightKinds.includes(markerKind)) {
      if (activeSide === null && leftParts.length === 0) {
        continue
      }

      const rightContent = removeMarkerPrefix(current.normalized, markerKind)
      rightParts = rightContent ? [rightContent] : []
      activeSide = 'right'
      continue
    }

    const sectionHeader = isSectionHeader(current.normalized, nextLine)
    if (sectionHeader && activeSide === null) {
      continue
    }

    if (sectionHeader && activeSide === 'right' && rightParts.length > 0) {
      flushCurrentPair()
      continue
    }

    if (activeSide === 'left') {
      leftParts.push(current.normalized)
      continue
    }

    if (activeSide === 'right') {
      rightParts.push(current.normalized)
    }
  }

  flushCurrentPair()
  return candidates
}

function extractSequentialLabeledPairs(block: DocumentBlock) {
  return extractSequentialMarkedPairs(
    block,
    ['question'],
    ['answer'],
    (left, right) => createPairedDraft(inferPairedType(left, right), left, right),
  )
}

function extractSequentialTermDefinitionPairs(block: DocumentBlock) {
  return extractSequentialMarkedPairs(block, ['term'], ['definition'], (left, right) => createPairedDraft('term', left, right))
}

function extractAlternatingUnlabeledPairs(block: DocumentBlock) {
  const lines = toParsedBlockLines(block)
  const candidates: DocumentParseCandidate[] = []
  let questionParts: string[] = []
  let answerParts: string[] = []
  let questionLine = block.startLine

  function flushCurrentPair() {
    const question = questionParts.join('\n').trim()
    const answer = answerParts.join('\n').trim()
    if (!question || !answer) {
      questionParts = []
      answerParts = []
      return
    }

    const candidate = buildCandidateFromPair(
      question,
      answer,
      `Line ${questionLine}`,
      'medium',
      ['Built by pairing a question line with the following answer. Review before saving.'],
    )
    if (candidate) {
      candidates.push(candidate)
    }

    questionParts = []
    answerParts = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index]
    if (!current || getMarkerKind(current.normalized)) {
      return []
    }

    const nextLine = lines[index + 1]?.normalized ?? ''
    if (questionParts.length === 0) {
      if (isSectionHeader(current.normalized, nextLine)) {
        continue
      }

      if (looksLikeQuestionLine(current.normalized)) {
        questionParts = [current.normalized]
        answerParts = []
        questionLine = current.lineNumber
      }
      continue
    }

    if (answerParts.length > 0 && isSectionHeader(current.normalized, nextLine)) {
      flushCurrentPair()
      continue
    }

    if (looksLikeQuestionLine(current.normalized)) {
      flushCurrentPair()
      questionParts = [current.normalized]
      answerParts = []
      questionLine = current.lineNumber
      continue
    }

    answerParts.push(current.normalized)
  }

  flushCurrentPair()
  return candidates
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
  const lines = toParsedBlockLines(block).map((line) => line.normalized)
  while (lines.length > 0 && isSectionHeader(lines[0] ?? '', lines[1] ?? '')) {
    lines.shift()
  }

  if (lines.length < 2) {
    return null
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

function parseBlockWithStrategies(block: DocumentBlock) {
  const lines = toParsedBlockLines(block)
  if (lines.length === 0) {
    return []
  }

  const inlineDrafts = lines.map((line) => tryParseAutoInlineLine(line.normalized))
  const allInline = inlineDrafts.length > 0 && inlineDrafts.every((draft) => Boolean(draft))
  if (allInline) {
    return inlineDrafts.flatMap((draft, index) =>
      draft ? [buildCandidate(draft, `Line ${lines[index]?.lineNumber ?? block.startLine}`, 'high')] : [],
    )
  }

  const labeledCandidates = extractSequentialLabeledPairs(block)
  if (labeledCandidates.length > 0) {
    return labeledCandidates
  }

  const termCandidates = extractSequentialTermDefinitionPairs(block)
  if (termCandidates.length > 0) {
    return termCandidates
  }

  const alternatingCandidates = extractAlternatingUnlabeledPairs(block)
  if (alternatingCandidates.length > 0) {
    return alternatingCandidates
  }

  const structuredCard = parseBlockAsStructuredCard(block)
  return structuredCard ? [structuredCard] : []
}

function canUseAsPendingBlock(block: DocumentBlock) {
  const lines = toParsedBlockLines(block)
  if (lines.length !== 1) {
    return false
  }

  const onlyLine = lines[0]
  if (!onlyLine) {
    return false
  }

  return !getMarkerKind(onlyLine.normalized) && !looksLikeStandaloneHeader(onlyLine.normalized)
}

function getPendingPairText(block: DocumentBlock) {
  const lines = toParsedBlockLines(block)
  if (lines.length === 0) {
    return ''
  }

  if (lines.length === 1 && looksLikeStandaloneHeader(lines[0]?.normalized ?? '')) {
    return ''
  }

  while (lines.length > 0 && isSectionHeader(lines[0]?.normalized ?? '', lines[1]?.normalized ?? '')) {
    lines.shift()
  }

  return lines.map((line) => line.normalized).join('\n').trim()
}

function parseAutoMode(content: string): DocumentParseResult {
  const blocks = collectBlocks(content)
  const candidates: DocumentParseCandidate[] = []
  const issues: DocumentParseIssue[] = []
  let pendingBlock: DocumentBlock | null = null

  for (const block of blocks) {
    const lines = toParsedBlockLines(block)

    if (lines.length === 0) {
      continue
    }

    const nextCandidates = parseBlockWithStrategies(block)

    if (pendingBlock) {
      if (nextCandidates.length === 0) {
        const left = getPendingPairText(pendingBlock)
        const right = getPendingPairText(block)
        const pairedCandidate =
          left && right
            ? buildCandidateFromPair(
                left,
                right,
                `Blocks ${pendingBlock.index}-${block.index}`,
                'medium',
                ['Built by pairing neighboring sections. Review before saving.'],
              )
            : null

        if (pairedCandidate) {
          candidates.push(pairedCandidate)
          pendingBlock = null
          continue
        }
      }

      issues.push({
        sourceLabel: `Block ${pendingBlock.index}`,
        lineNumber: pendingBlock.startLine,
        content: pendingBlock.text,
        reason: 'This section needs a matching answer block or a supported delimiter.',
      })
      pendingBlock = null
    }

    if (nextCandidates.length > 0) {
      candidates.push(...nextCandidates)
      continue
    }

    if (canUseAsPendingBlock(block)) {
      pendingBlock = {
        ...block,
        text: lines[0]?.normalized ?? block.text,
      }
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
