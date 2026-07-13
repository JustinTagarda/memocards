'use client'

import {
  ArrowDown,
  ArrowUp,
  Camera,
  Crop,
  ImagePlus,
  PencilLine,
  RotateCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { prepareDocumentImage, type DocumentCropRect } from '../lib/documentImages'
import { createEmptyCardDraft } from '../lib/importExport'
import {
  parseDocumentText,
  type DocumentParseCandidate,
  type DocumentParseIssue,
  type DocumentParserMode,
  type DocumentParseResult,
  supportsDocumentFile,
} from '../lib/documentParser'
import { summarizeQuickAddDraft } from '../lib/quickAdd'
import {
  createOcrRequestId,
  extractTextFromImages,
  type ExtractedImageTextPage,
  generateCardsFromLessonText,
  type GeneratedLessonCard,
} from '../services/memocards'
import type { CardDraft } from '../types/models'
import { CardForm } from './forms'

interface BulkCardGeneratorProps {
  deckTitle?: string
  prepareDraft?: (draft: CardDraft) => CardDraft
  onComplete: () => void
  onSaveAll: (
    drafts: CardDraft[],
    onProgress: (progress: { percent: number; label: string }) => void,
  ) => Promise<void>
}

interface PendingCandidate extends DocumentParseCandidate {
  id: string
}

interface PendingImage {
  id: string
  file: File
  originalPreviewUrl: string
  previewUrl: string
  rotation: number
  manualCrop: DocumentCropRect | null
  enhanceScan: boolean
  trimMargins: boolean
}

type BulkSourceMode = 'text' | 'images'
type BulkGenerationMode = 'lesson' | 'parse'
type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se'
type ReviewFilter = 'all' | 'clean' | 'needs_review' | 'warnings'

interface ActiveImageCrop {
  imageId: string
  rect: DocumentCropRect
}

interface CropDragState {
  handle: CropHandle
  frameWidth: number
  frameHeight: number
  startX: number
  startY: number
  startRect: DocumentCropRect
}

const MIN_CROP_SIZE = 0.12
const LABELED_CARD_LINE_PATTERN =
  /^(q(?:uestion)?|a(?:nswer)?|term|definition|meaning|description)\s*[:\-]\s*/i

function normalizeBulkSourceText(content: string) {
  return content.replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').trim()
}

function lineLooksLikeStructuredCard(line: string) {
  const normalized = line.trim()
  if (!normalized) {
    return false
  }

  if (
    LABELED_CARD_LINE_PATTERN.test(normalized) ||
    normalized.includes(':::') ||
    normalized.includes('::') ||
    normalized.includes('->') ||
    normalized.includes('\t')
  ) {
    return true
  }

  return normalized.includes('|') && normalized.split('|').map((segment) => segment.trim()).filter(Boolean).length >= 4
}

function detectTextGenerationMode(content: string, parsed: DocumentParseResult): BulkGenerationMode {
  const normalized = normalizeBulkSourceText(content)
  if (!normalized) {
    return 'lesson'
  }

  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
  const blocks = normalized.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean)
  const structuredLineCount = lines.filter((line) => lineLooksLikeStructuredCard(line)).length
  const labeledLineCount = lines.filter((line) => LABELED_CARD_LINE_PATTERN.test(line)).length
  const highConfidenceCount = parsed.candidates.filter(
    (candidate) => candidate.confidence === 'high' && candidate.warnings.length === 0,
  ).length
  const mediumConfidenceCount = parsed.candidates.filter((candidate) => candidate.confidence === 'medium').length
  const alternatingQuestionBlocks = blocks.filter((block, index) => {
    if (index % 2 !== 0) {
      return false
    }

    const firstLine = block.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
    return firstLine.endsWith('?')
  }).length

  if (structuredLineCount >= 2 || highConfidenceCount >= 2) {
    return 'parse'
  }

  if (highConfidenceCount === 1 && parsed.candidates.length === 1 && parsed.issues.length === 0 && structuredLineCount >= 1) {
    return 'parse'
  }

  if (highConfidenceCount >= 1 && labeledLineCount >= 2) {
    return 'parse'
  }

  if (
    parsed.candidates.length > 0 &&
    highConfidenceCount === 0 &&
    mediumConfidenceCount === parsed.candidates.length &&
    parsed.issues.length === 0 &&
    blocks.length === parsed.candidates.length * 2 &&
    alternatingQuestionBlocks === parsed.candidates.length
  ) {
    return 'parse'
  }

  return 'lesson'
}

function createItemId(prefix: string, index: number) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${index}`
}

function modeLabel(mode: DocumentParserMode) {
  switch (mode) {
    case 'auto':
      return 'Auto detect'
    case 'basic':
      return 'Basic'
    case 'term':
      return 'Term / Definition'
    case 'multiple_choice':
      return 'Multiple Choice'
    case 'explanation':
      return 'Explanation'
  }
}

function createPendingImage(file: File, index: number): PendingImage {
  const originalPreviewUrl = URL.createObjectURL(file)
  return {
    id: createItemId('bulk-image', index),
    file,
    originalPreviewUrl,
    previewUrl: originalPreviewUrl,
    rotation: 0,
    manualCrop: null,
    enhanceScan: true,
    trimMargins: true,
  }
}

function createDefaultCropRect(): DocumentCropRect {
  return {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  }
}

function summarizeImageSettings(image: PendingImage) {
  const parts: string[] = []
  if (image.rotation !== 0) {
    parts.push(`${image.rotation}°`)
  }
  if (image.manualCrop) {
    parts.push('Cropped')
  }
  if (image.enhanceScan) {
    parts.push('Enhanced')
  }
  if (image.trimMargins) {
    parts.push('Trimmed')
  }
  return parts.join(' · ')
}

function normalizeCropRect(rect: DocumentCropRect): DocumentCropRect {
  const left = Math.min(Math.max(rect.x, 0), 1)
  const top = Math.min(Math.max(rect.y, 0), 1)
  const right = Math.min(Math.max(left + rect.width, left + MIN_CROP_SIZE), 1)
  const bottom = Math.min(Math.max(top + rect.height, top + MIN_CROP_SIZE), 1)

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

function isDefaultCropRect(rect: DocumentCropRect) {
  const normalized = normalizeCropRect(rect)
  return (
    normalized.x <= 0.001 &&
    normalized.y <= 0.001 &&
    normalized.width >= 0.999 &&
    normalized.height >= 0.999
  )
}

function applyCropDrag(
  startRect: DocumentCropRect,
  handle: CropHandle,
  deltaX: number,
  deltaY: number,
): DocumentCropRect {
  let left = startRect.x
  let top = startRect.y
  let right = startRect.x + startRect.width
  let bottom = startRect.y + startRect.height

  if (handle === 'move') {
    const nextWidth = right - left
    const nextHeight = bottom - top
    left = Math.min(Math.max(left + deltaX, 0), 1 - nextWidth)
    top = Math.min(Math.max(top + deltaY, 0), 1 - nextHeight)
    right = left + nextWidth
    bottom = top + nextHeight
  } else {
    if (handle === 'nw' || handle === 'sw') {
      left = Math.min(Math.max(left + deltaX, 0), right - MIN_CROP_SIZE)
    }

    if (handle === 'ne' || handle === 'se') {
      right = Math.max(Math.min(right + deltaX, 1), left + MIN_CROP_SIZE)
    }

    if (handle === 'nw' || handle === 'ne') {
      top = Math.min(Math.max(top + deltaY, 0), bottom - MIN_CROP_SIZE)
    }

    if (handle === 'sw' || handle === 'se') {
      bottom = Math.max(Math.min(bottom + deltaY, 1), top + MIN_CROP_SIZE)
    }
  }

  return normalizeCropRect({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  })
}

function getImagePreviewUrls(item: PendingImage) {
  return item.previewUrl === item.originalPreviewUrl
    ? [item.originalPreviewUrl]
    : [item.originalPreviewUrl, item.previewUrl]
}

function revokeUnusedPreviewUrls(previousItems: PendingImage[], nextItems: PendingImage[]) {
  const activeUrls = new Set<string>()

  nextItems.forEach((item) => {
    getImagePreviewUrls(item).forEach((url) => activeUrls.add(url))
  })

  previousItems.forEach((item) => {
    Array.from(new Set(getImagePreviewUrls(item))).forEach((url) => {
      if (!activeUrls.has(url)) {
        URL.revokeObjectURL(url)
      }
    })
  })
}

function revokePreviewUrls(items: PendingImage[]) {
  revokeUnusedPreviewUrls(items, [])
}

function buildParsedMessage(
  candidateCount: number,
  parserMode: DocumentParserMode,
  issueCount: number,
  sourceLabel: string,
) {
  if (issueCount > 0) {
    return `Generated ${candidateCount} card draft${candidateCount === 1 ? '' : 's'} from ${sourceLabel} with ${issueCount} item${issueCount === 1 ? '' : 's'} to review.`
  }

  return `Generated ${candidateCount} card draft${candidateCount === 1 ? '' : 's'} from ${sourceLabel} using ${modeLabel(parserMode)}.`
}

function buildLessonMessage(candidateCount: number, sourceLabel: string, issueCount: number) {
  if (issueCount > 0) {
    return `Generated ${candidateCount} lesson card draft${candidateCount === 1 ? '' : 's'} from ${sourceLabel} with ${issueCount} item${issueCount === 1 ? '' : 's'} to review.`
  }

  return `Generated ${candidateCount} lesson card draft${candidateCount === 1 ? '' : 's'} from ${sourceLabel} with Gemini Flash Lite.`
}

function buildOcrIssues(warnings: string[]): DocumentParseIssue[] {
  return warnings.map((warning, index) => ({
    sourceLabel: `OCR note ${index + 1}`,
    lineNumber: index + 1,
    content: '',
    reason: warning,
  }))
}

function buildGeneratedDraft(card: GeneratedLessonCard): CardDraft {
  const base = createEmptyCardDraft()
  const question = card.question.trim()
  const answer = card.answer.trim()

  return {
    ...base,
    type: 'basic',
    front: question,
    back: answer,
    prompt: question,
    answer,
    tags: card.tags,
  }
}

function logBulkOcrInfo(requestId: string, message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[bulk-ocr:${requestId}] ${message}`, details)
    return
  }

  console.info(`[bulk-ocr:${requestId}] ${message}`)
}

function logBulkOcrError(requestId: string, message: string, details?: unknown) {
  if (typeof details === 'undefined') {
    console.error(`[bulk-ocr:${requestId}] ${message}`)
    return
  }

  console.error(`[bulk-ocr:${requestId}] ${message}`, details)
}

export function BulkCardGenerator({
  deckTitle,
  prepareDraft = (draft) => draft,
  onComplete,
  onSaveAll,
}: BulkCardGeneratorProps) {
  const [sourceMode, setSourceMode] = useState<BulkSourceMode>('text')
  const [sourceText, setSourceText] = useState('')
  const [candidates, setCandidates] = useState<PendingCandidate[]>([])
  const [issues, setIssues] = useState<DocumentParseIssue[]>([])
  const [ocrPages, setOcrPages] = useState<ExtractedImageTextPage[]>([])
  const [imageItems, setImageItems] = useState<PendingImage[]>([])
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [applyingCrop, setApplyingCrop] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ percent: number; label: string } | null>(null)
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null)
  const [generatedCount, setGeneratedCount] = useState(0)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [cropEditor, setCropEditor] = useState<ActiveImageCrop | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const cropStageRef = useRef<HTMLDivElement | null>(null)
  const imageItemsRef = useRef<PendingImage[]>([])
  const extractionProgressTimerRef = useRef<number | null>(null)
  const cropDragRef = useRef<CropDragState | null>(null)

  useEffect(() => {
    imageItemsRef.current = imageItems
  }, [imageItems])

  useEffect(
    () => () => {
      revokePreviewUrls(imageItemsRef.current)
      if (extractionProgressTimerRef.current) {
        window.clearInterval(extractionProgressTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (!cropEditor) {
      return
    }

    const imageStillExists = imageItems.some((item) => item.id === cropEditor.imageId)
    if (!imageStillExists) {
      setCropEditor(null)
    }
  }, [cropEditor, imageItems])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const dragState = cropDragRef.current
      if (!dragState) {
        return
      }

      const deltaX = (event.clientX - dragState.startX) / dragState.frameWidth
      const deltaY = (event.clientY - dragState.startY) / dragState.frameHeight

      setCropEditor((current) =>
        current
          ? {
              ...current,
              rect: applyCropDrag(dragState.startRect, dragState.handle, deltaX, deltaY),
            }
          : current,
      )
    }

    function handlePointerUp() {
      cropDragRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [])

  const hasPreview = candidates.length > 0
  const editingCandidate = candidates.find((candidate) => candidate.id === editingCandidateId) ?? null
  const canGenerate =
    sourceMode === 'text' ? Boolean(sourceText.trim()) : imageItems.length > 0 && !cropEditor
  const canClear =
    Boolean(sourceText.trim()) ||
    imageItems.length > 0 ||
    candidates.length > 0 ||
    issues.length > 0 ||
    ocrPages.length > 0
  const batchCount = Math.max(generatedCount, candidates.length)
  const warningCount = candidates.filter((candidate) => candidate.warnings.length > 0).length
  const needsReviewCount = candidates.filter(
    (candidate) => candidate.confidence === 'medium' || candidate.warnings.length > 0,
  ).length
  const cleanCount = candidates.length - needsReviewCount
  const skippedCount = Math.max(batchCount - candidates.length, 0)
  const hasAttentionCards = needsReviewCount > 0
  const reviewStats = hasAttentionCards
    ? [
        { id: 'generated', value: batchCount, label: 'Generated' },
        { id: 'clean', value: cleanCount, label: 'Clean' },
        { id: 'needs_review', value: needsReviewCount, label: 'Review' },
        ...(warningCount > 0 ? [{ id: 'warnings', value: warningCount, label: 'Warnings' }] : []),
      ]
    : [
        { id: 'generated', value: batchCount, label: 'Generated' },
        { id: 'ready', value: candidates.length, label: 'Ready' },
      ]
  const reviewFilters: Array<{ id: ReviewFilter; label: string; count: number }> = hasAttentionCards
    ? [
        { id: 'all', label: 'All', count: candidates.length },
        { id: 'clean', label: 'Clean', count: cleanCount },
        { id: 'needs_review', label: 'Review', count: needsReviewCount },
        ...(warningCount > 0 ? [{ id: 'warnings' as const, label: 'Warnings', count: warningCount }] : []),
      ]
    : []
  const reviewIntro = hasAttentionCards
    ? 'Check flagged cards.'
    : ''
  const isImageBusy = parsing || saving || applyingCrop
  const filteredCandidates = candidates.filter((candidate) => {
    if (reviewFilter === 'clean') {
      return candidate.confidence === 'high' && candidate.warnings.length === 0
    }

    if (reviewFilter === 'needs_review') {
      return candidate.confidence === 'medium' || candidate.warnings.length > 0
    }

    if (reviewFilter === 'warnings') {
      return candidate.warnings.length > 0
    }

    return true
  })

  useEffect(() => {
    if (!editingCandidateId) {
      return
    }

    if (!filteredCandidates.some((candidate) => candidate.id === editingCandidateId)) {
      setEditingCandidateId(null)
    }
  }, [editingCandidateId, filteredCandidates])

  useEffect(() => {
    if (reviewFilter === 'needs_review' && needsReviewCount === 0) {
      setReviewFilter('all')
      return
    }

    if (reviewFilter === 'warnings' && warningCount === 0) {
      setReviewFilter('all')
    }
  }, [needsReviewCount, reviewFilter, warningCount])

  function resetFeedback() {
    setError(null)
    setSuccess(null)
  }

  function updateImageItem(
    imageId: string,
    updater: (image: PendingImage) => PendingImage,
  ) {
    replaceImageItems(
      imageItemsRef.current.map((item) => (item.id === imageId ? updater(item) : item)),
    )
  }

  function clearPreview() {
    setCandidates([])
    setIssues([])
    setOcrPages([])
    setEditingCandidateId(null)
    setGeneratedCount(0)
    setReviewFilter('all')
    setProgress(null)
  }

  function stopExtractionProgress() {
    if (!extractionProgressTimerRef.current) {
      return
    }
    window.clearInterval(extractionProgressTimerRef.current)
    extractionProgressTimerRef.current = null
  }

  function startExtractionProgress(pageCount: number) {
    stopExtractionProgress()
    setProgress({
      percent: 48,
      label: pageCount === 1 ? 'Initializing OCR for 1 image...' : `Initializing OCR for ${pageCount} images...`,
    })

    extractionProgressTimerRef.current = window.setInterval(() => {
      setProgress((current) => {
        const currentPercent = current?.percent ?? 48
        const nextPercent = Math.min(currentPercent + 4, 82)
        const nextLabel =
          nextPercent < 62
            ? pageCount === 1
              ? 'Reading text from 1 image...'
              : `Reading text from ${pageCount} images...`
            : pageCount === 1
              ? 'OCR is still processing 1 image...'
              : `OCR is still processing ${pageCount} images...`

        return {
          percent: nextPercent,
          label: nextLabel,
        }
      })
    }, 1400)
  }

  function clearAll() {
    replaceImageItems([])
    setSourceText('')
    setCropEditor(null)
    clearPreview()
    resetFeedback()
  }

  function openCropEditor(image: PendingImage) {
    setCropEditor({
      imageId: image.id,
      rect: image.manualCrop ?? createDefaultCropRect(),
    })
    resetFeedback()
  }

  function startCropDrag(handle: CropHandle, event: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>) {
    if (!cropEditor || !cropStageRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const bounds = cropStageRef.current.getBoundingClientRect()
    cropDragRef.current = {
      handle,
      frameWidth: Math.max(bounds.width, 1),
      frameHeight: Math.max(bounds.height, 1),
      startX: event.clientX,
      startY: event.clientY,
      startRect: cropEditor.rect,
    }
  }

  async function createCroppedPreviewUrl(image: PendingImage, cropRect: DocumentCropRect) {
    const prepared = await prepareDocumentImage(image.file, {
      rotation: 0,
      enhanceScan: false,
      trimMargins: false,
      manualCrop: cropRect,
      maxDimension: 1600,
      minDimension: 0,
    })

    return URL.createObjectURL(prepared.blob)
  }

  async function applyCropSelection() {
    if (!cropEditor) {
      return
    }

    const currentImage = imageItemsRef.current.find((item) => item.id === cropEditor.imageId)
    if (!currentImage) {
      setCropEditor(null)
      return
    }

    const normalizedRect = normalizeCropRect(cropEditor.rect)
    const nextManualCrop = isDefaultCropRect(normalizedRect) ? null : normalizedRect

    setApplyingCrop(true)
    resetFeedback()

    try {
      const nextPreviewUrl = nextManualCrop
        ? await createCroppedPreviewUrl(currentImage, nextManualCrop)
        : currentImage.originalPreviewUrl

      updateImageItem(cropEditor.imageId, (item) => ({
        ...item,
        manualCrop: nextManualCrop,
        previewUrl: nextPreviewUrl,
      }))
      setCropEditor(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to apply this crop.')
    } finally {
      setApplyingCrop(false)
    }
  }

  function applyParsedCandidates(
    parsed: ReturnType<typeof parseDocumentText>,
    sourceLabel: string,
    extraIssues: DocumentParseIssue[] = [],
    appliedParserMode: DocumentParserMode = 'auto',
  ) {
    const nextIssues = [...extraIssues, ...parsed.issues]
    setGeneratedCount(parsed.candidates.length)
    setReviewFilter('all')
    setCandidates(
      parsed.candidates.map((candidate, index) => ({
        ...candidate,
        draft: prepareDraft(candidate.draft),
        id: createItemId('bulk-card', index),
      })),
    )
    setIssues(nextIssues)
    setEditingCandidateId(null)

    if (parsed.candidates.length === 0) {
      setSuccess(null)
      setError(
        nextIssues.length > 0
          ? 'No card candidates were generated from that source.'
          : 'This source did not contain any parseable question-and-answer content.',
      )
      return
    }

    setSuccess(buildParsedMessage(parsed.candidates.length, appliedParserMode, nextIssues.length, sourceLabel))
  }

  function applyGeneratedCandidates(
    generatedCards: GeneratedLessonCard[],
    sourceLabel: string,
    extraIssues: DocumentParseIssue[] = [],
  ) {
    const nextCandidates = generatedCards.map((card, index) => ({
      id: createItemId('bulk-card', index),
      sourceLabel: `Generated card ${index + 1}`,
      confidence: (card.confidence === 'medium' ? 'medium' : 'high') as 'high' | 'medium',
      method: 'ai' as const,
      warnings: card.note ? [card.note] : [],
      draft: prepareDraft(buildGeneratedDraft(card)),
    }))

    setGeneratedCount(nextCandidates.length)
    setReviewFilter('all')
    setCandidates(nextCandidates)
    setIssues(extraIssues)
    setEditingCandidateId(null)

    if (nextCandidates.length === 0) {
      setSuccess(null)
      setError(
        extraIssues.length > 0
          ? 'No usable AI-generated cards were produced from that source.'
          : 'The lesson did not produce any usable flashcards.',
      )
      return
    }

    setSuccess(buildLessonMessage(nextCandidates.length, sourceLabel, extraIssues.length))
  }

  async function handleGenerateFromText() {
    if (!sourceText.trim()) {
      setError('Paste some source text first.')
      return
    }

    setParsing(true)
    resetFeedback()

    try {
      setProgress({
        percent: 14,
        label: 'Detecting pasted text format...',
      })

      const parsed = parseDocumentText(sourceText, 'auto')
      const detectedMode = detectTextGenerationMode(sourceText, parsed)

      if (detectedMode === 'parse') {
        setProgress({
          percent: 68,
          label: 'Parsing detected Q&A text...',
        })

        applyParsedCandidates(parsed, 'the pasted Q&A text', [], 'auto')
        setProgress(null)
        return
      }

      const requestId = createOcrRequestId()

      logBulkOcrInfo(requestId, 'Starting lesson-card generation from pasted text.', {
        deckTitle: deckTitle ?? null,
        sourceLength: sourceText.trim().length,
      })

      setProgress({
        percent: 20,
        label: 'Analyzing lesson text...',
      })

      const generated = await generateCardsFromLessonText(sourceText, {
        requestId,
        deckTitle,
        timeoutMs: 120000,
      })

      setProgress({
        percent: 86,
        label: 'Preparing AI-generated cards...',
      })

      applyGeneratedCandidates(
        generated.cards,
        'the pasted lesson text',
        buildOcrIssues(generated.warnings),
      )
      logBulkOcrInfo(requestId, 'Applied lesson-generated cards from pasted text.', {
        cardCount: generated.cards.length,
        warningCount: generated.warnings.length,
      })
      setProgress(null)
    } catch (reason) {
      clearPreview()
      setProgress(null)
      setError(reason instanceof Error ? reason.message : 'Unable to process this pasted text.')
    } finally {
      setParsing(false)
    }
  }

  async function buildPreparedFiles(requestId: string) {
    const prepared: File[] = []

    for (const [index, image] of imageItems.entries()) {
      const percent = Math.round(10 + (index / Math.max(1, imageItems.length)) * 28)
      setProgress({
        percent,
        label: `Preparing page ${index + 1} of ${imageItems.length}...`,
      })

      const pageStartedAt = Date.now()
      const nextImage = await prepareDocumentImage(image.file, {
        rotation: image.rotation,
        manualCrop: image.manualCrop,
        enhanceScan: image.enhanceScan,
        trimMargins: image.trimMargins,
      })

      const fileName = image.file.name.replace(/\.[^.]+$/, '') || `document-page-${index + 1}`
      const preparedFile = new File([nextImage.blob], `${fileName}-ocr.png`, {
        type: nextImage.blob.type || 'image/png',
        lastModified: Date.now(),
      })
      prepared.push(preparedFile)
      logBulkOcrInfo(requestId, `Prepared page ${index + 1}/${imageItems.length}.`, {
        sourceName: image.file.name,
        sourceSize: image.file.size,
        preparedName: preparedFile.name,
        preparedSize: preparedFile.size,
        width: nextImage.width,
        height: nextImage.height,
        rotation: image.rotation,
        manualCrop: image.manualCrop,
        enhanceScan: image.enhanceScan,
        trimMargins: image.trimMargins,
        elapsedMs: Date.now() - pageStartedAt,
      })
    }

    return prepared
  }

  async function handleGenerateFromImages() {
    if (imageItems.length === 0) {
      setError('Take a photo or upload at least one image first.')
      return
    }

    const requestId = createOcrRequestId()
    setParsing(true)
    resetFeedback()
    clearPreview()

    try {
      logBulkOcrInfo(requestId, `Starting OCR generation for ${imageItems.length} image(s).`, {
        images: imageItems.map((image, index) => ({
          index: index + 1,
          name: image.file.name,
          size: image.file.size,
          type: image.file.type,
          rotation: image.rotation,
          manualCrop: image.manualCrop,
          enhanceScan: image.enhanceScan,
          trimMargins: image.trimMargins,
        })),
      })

      setProgress({
        percent: 8,
        label: `Preparing ${imageItems.length} image${imageItems.length === 1 ? '' : 's'}...`,
      })

      const preparedFiles = await buildPreparedFiles(requestId)

      startExtractionProgress(preparedFiles.length)
      const extracted = await extractTextFromImages(preparedFiles, {
        requestId,
        timeoutMs: Math.min(170000, 100000 + preparedFiles.length * 30000),
      })
      stopExtractionProgress()
      logBulkOcrInfo(requestId, 'Received OCR extraction result.', {
        serverRequestId: extracted.requestId ?? null,
        pageCount: extracted.pages.length,
        warningCount: extracted.warnings.length,
        combinedLength: extracted.combinedText.length,
      })
      setOcrPages(extracted.pages)
      setSourceText(extracted.combinedText)

      setProgress({
        percent: 72,
        label: 'Detecting extracted text format...',
      })

      const parsed = parseDocumentText(extracted.combinedText, 'auto')
      const detectedMode = detectTextGenerationMode(extracted.combinedText, parsed)

      if (detectedMode === 'lesson') {
        setProgress({
          percent: 74,
          label: 'Generating cards from lesson text...',
        })

        const generated = await generateCardsFromLessonText(extracted.combinedText, {
          requestId,
          deckTitle,
          timeoutMs: Math.min(170000, 110000 + preparedFiles.length * 30000),
        })

        setProgress({
          percent: 90,
          label: 'Preparing AI-generated cards...',
        })

        applyGeneratedCandidates(
          generated.cards,
          `${preparedFiles.length} image${preparedFiles.length === 1 ? '' : 's'}`,
          buildOcrIssues([...extracted.warnings, ...generated.warnings]),
        )
        logBulkOcrInfo(requestId, 'Applied lesson-generated cards from OCR text.', {
          cardCount: generated.cards.length,
          warningCount: extracted.warnings.length + generated.warnings.length,
        })
      } else {
        setProgress({
          percent: 74,
          label: 'Parsing detected Q&A text...',
        })

        applyParsedCandidates(
          parsed,
          `${preparedFiles.length} image${preparedFiles.length === 1 ? '' : 's'}`,
          buildOcrIssues(extracted.warnings),
          'auto',
        )
        logBulkOcrInfo(requestId, 'Parsed OCR text into card drafts.', {
          candidateCount: parsed.candidates.length,
          issueCount: parsed.issues.length + extracted.warnings.length,
        })
      }
      setProgress(null)
    } catch (reason) {
      stopExtractionProgress()
      clearPreview()
      logBulkOcrError(requestId, 'Image-based card generation failed.', reason)
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to process these images.',
      )
    } finally {
      stopExtractionProgress()
      setParsing(false)
    }
  }

  async function handleGenerate() {
    if (sourceMode === 'images') {
      await handleGenerateFromImages()
      return
    }

    await handleGenerateFromText()
  }

  async function handleSaveAll() {
    if (candidates.length === 0) {
      setError('Generate at least one card before saving.')
      return
    }

    setSaving(true)
    resetFeedback()
    setProgress({
      percent: 5,
      label: `Preparing ${candidates.length} card${candidates.length === 1 ? '' : 's'}...`,
    })

    try {
      await onSaveAll(
        candidates.map((candidate) => candidate.draft),
        (nextProgress) => {
          setProgress(nextProgress)
        },
      )

      const savedCount = candidates.length
      clearAll()
      setSuccess(`Saved ${savedCount} card${savedCount === 1 ? '' : 's'}. Returning to the deck...`)
      setProgress({
        percent: 100,
        label: `Saved ${savedCount} card${savedCount === 1 ? '' : 's'}. Returning to the deck...`,
      })
      await new Promise((resolve) => window.setTimeout(resolve, 450))
      onComplete()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save these cards.')
      setProgress(null)
    } finally {
      setSaving(false)
    }
  }

  function replaceImageItems(nextItems: PendingImage[]) {
    revokeUnusedPreviewUrls(imageItemsRef.current, nextItems)
    imageItemsRef.current = nextItems
    setImageItems(nextItems)
  }

  function appendImageFiles(files: FileList | File[]) {
    const currentItems = imageItemsRef.current
    const incoming = Array.from(files).filter((file) => file.type.startsWith('image/'))

    if (incoming.length === 0) {
      setError('Only image files can be used for document capture.')
      return
    }

    const nextTotal = currentItems.length + incoming.length
    if (nextTotal > 12) {
      setError('Use up to 12 images at a time.')
      return
    }

    resetFeedback()
    clearPreview()
    setSourceMode('images')
    replaceImageItems([
      ...currentItems,
      ...incoming.map((file, index) => createPendingImage(file, currentItems.length + index)),
    ])
  }

  function isSupportedTextFile(file: File) {
    return file.type.startsWith('text/') || supportsDocumentFile(file.name)
  }

  async function handleGenericFileLoad(files: FileList | File[]) {
    const incoming = Array.from(files).filter((file) => Boolean(file))

    if (incoming.length === 0) {
      setError('Choose a file to load.')
      return
    }

    const imageFiles = incoming.filter((file) => file.type.startsWith('image/'))
    const textFiles = incoming.filter((file) => isSupportedTextFile(file))
    const unsupportedFiles = incoming.filter((file) => !file.type.startsWith('image/') && !isSupportedTextFile(file))

    if (unsupportedFiles.length > 0) {
      setError(
        `Unsupported file type${unsupportedFiles.length === 1 ? '' : 's'}: ${unsupportedFiles
          .map((file) => file.name)
          .join(', ')}. Use text documents or images.`,
      )
      return
    }

    if (imageFiles.length > 0 && textFiles.length > 0) {
      setError('Load either text documents or images in one batch.')
      return
    }

    if (imageFiles.length > 0) {
      appendImageFiles(imageFiles)
      return
    }

    const [file] = textFiles
    if (!file) {
      setError('Choose a text document or image file.')
      return
    }

    try {
      const content = await file.text()
      if (!content.trim()) {
        setError('That file is empty.')
        return
      }

      resetFeedback()
      clearPreview()
      replaceImageItems([])
      setCropEditor(null)
      setSourceMode('text')
      setSourceText(content)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to read that file.')
    }
  }

  return (
    <section
      className={`filters-card quick-add-card bulk-card-generator${
        hasPreview ? ' bulk-card-generator--has-preview' : ''
      }`}
    >
      {!hasPreview && (
        <>
          <div className="bulk-card-generator__source-mode">
            <button
              aria-pressed={sourceMode === 'text'}
              className={sourceMode === 'text' ? 'choice-pill choice-pill--selected' : 'choice-pill'}
              type="button"
              onClick={() => {
                setSourceMode('text')
                setCropEditor(null)
                resetFeedback()
              }}
            >
              Paste text / Q&amp;A
            </button>
              <button
                aria-pressed={sourceMode === 'images'}
                className={sourceMode === 'images' ? 'choice-pill choice-pill--selected' : 'choice-pill'}
                type="button"
                onClick={() => {
                setSourceMode('images')
                setCropEditor(null)
                resetFeedback()
              }}
            >
              Photos / Images
            </button>
          </div>

          {sourceMode === 'text' ? (
            <>
              <label className="field bulk-card-generator__source">
                <span>Source text</span>
                <textarea
                  placeholder="Paste lesson notes or existing Q&A here..."
                  rows={14}
                  value={sourceText}
                  onChange={(event) => {
                    setSourceText(event.target.value)
                    if (candidates.length > 0 || issues.length > 0 || ocrPages.length > 0) {
                      clearPreview()
                    }
                    resetFeedback()
                  }}
                />
              </label>
              <small className="hint-text">
                Paste notes or Q&amp;A. The app detects the format.
              </small>
            </>
          ) : (
            <div className="bulk-card-generator__image-source">
              <input
                ref={cameraInputRef}
                accept="image/*"
                capture="environment"
                className="bulk-card-generator__hidden-input"
                type="file"
                onChange={(event) => {
                  if (event.target.files) {
                    appendImageFiles(event.target.files)
                  }
                  event.currentTarget.value = ''
                }}
              />
              <input
                ref={imageInputRef}
                accept="image/*"
                className="bulk-card-generator__hidden-input"
                multiple
                type="file"
                onChange={(event) => {
                  if (event.target.files) {
                    appendImageFiles(event.target.files)
                  }
                  event.currentTarget.value = ''
                }}
              />

              <div className="bulk-card-generator__image-toolbar">
                <input
                  ref={fileInputRef}
                  accept=".txt,.md,.markdown,.text,.tsv,image/*"
                  className="bulk-card-generator__hidden-input"
                  multiple
                  type="file"
                  onChange={(event) => {
                    if (event.target.files) {
                      void handleGenericFileLoad(event.target.files)
                    }
                    event.currentTarget.value = ''
                  }}
                />
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus size={16} />
                  Load file
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <Camera size={16} />
                  {imageItems.length > 0 ? 'Add photo' : 'Take photo'}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImagePlus size={16} />
                  {imageItems.length > 0 ? 'Add images' : 'Upload images'}
                </button>
              </div>

              <small className="hint-text">
                Load text documents or images. Text files go straight into the parser, and images go through OCR.
              </small>

              {imageItems.length > 0 ? (
                <>
                  <div className="bulk-card-generator__image-list">
                    {imageItems.map((image, index) => {
                      if (cropEditor?.imageId === image.id) {
                        return (
                          <article key={image.id} className="preview-card bulk-card-generator__crop-editor">
                            <div className="panel-heading">
                              <strong>Crop page {index + 1}</strong>
                              <small>{image.file.name}</small>
                            </div>

                            <div className="bulk-card-generator__crop-stage" ref={cropStageRef}>
                              <img alt={`Crop page ${index + 1}`} src={image.originalPreviewUrl} />

                              <div
                                className="bulk-card-generator__crop-selection"
                                style={{
                                  left: `${cropEditor.rect.x * 100}%`,
                                  top: `${cropEditor.rect.y * 100}%`,
                                  width: `${cropEditor.rect.width * 100}%`,
                                  height: `${cropEditor.rect.height * 100}%`,
                                }}
                                onPointerDown={(event) => startCropDrag('move', event)}
                              >
                                <button
                                  aria-label="Resize crop from top left"
                                  className="bulk-card-generator__crop-handle bulk-card-generator__crop-handle--nw"
                                  type="button"
                                  onPointerDown={(event) => startCropDrag('nw', event)}
                                />
                                <button
                                  aria-label="Resize crop from top right"
                                  className="bulk-card-generator__crop-handle bulk-card-generator__crop-handle--ne"
                                  type="button"
                                  onPointerDown={(event) => startCropDrag('ne', event)}
                                />
                                <button
                                  aria-label="Resize crop from bottom left"
                                  className="bulk-card-generator__crop-handle bulk-card-generator__crop-handle--sw"
                                  type="button"
                                  onPointerDown={(event) => startCropDrag('sw', event)}
                                />
                                <button
                                  aria-label="Resize crop from bottom right"
                                  className="bulk-card-generator__crop-handle bulk-card-generator__crop-handle--se"
                                  type="button"
                                  onPointerDown={(event) => startCropDrag('se', event)}
                                />
                              </div>
                            </div>

                            <small className="bulk-card-generator__crop-copy">
                              Drag the crop box, then apply.
                            </small>

                            <div className="modal-actions bulk-card-generator__crop-actions">
                              <button
                                className="ghost-button"
                                disabled={isImageBusy}
                                type="button"
                                onClick={() =>
                                  setCropEditor((current) =>
                                    current && current.imageId === image.id
                                      ? { ...current, rect: createDefaultCropRect() }
                                      : current,
                                  )
                                }
                              >
                                Reset crop
                              </button>
                              <button
                                className="ghost-button"
                                disabled={isImageBusy}
                                type="button"
                                onClick={() => setCropEditor(null)}
                              >
                                Cancel
                              </button>
                              <button
                                className="primary-button"
                                disabled={isImageBusy}
                                type="button"
                                onClick={() => {
                                  void applyCropSelection()
                                }}
                              >
                                {applyingCrop ? 'Applying...' : 'Apply crop'}
                              </button>
                            </div>
                          </article>
                        )
                      }

                      return (
                        <article key={image.id} className="preview-card bulk-card-generator__image-card">
                          <div className="bulk-card-generator__image-preview">
                            <img
                              alt={`Document page ${index + 1}`}
                              src={image.previewUrl}
                              style={{ '--rotation': `${image.rotation}deg` } as CSSProperties}
                            />
                          </div>

                          <div className="bulk-card-generator__image-copy">
                            <div className="panel-heading">
                              <strong>Page {index + 1}</strong>
                              <small>{image.file.name}</small>
                            </div>

                            {summarizeImageSettings(image) ? (
                              <small className="bulk-card-generator__image-meta-text">{summarizeImageSettings(image)}</small>
                            ) : null}

                            <div className="bulk-card-generator__image-buttons">
                              <button
                                className="ghost-button ghost-button--inline"
                                disabled={index === 0 || isImageBusy}
                                type="button"
                                onClick={() => {
                                  if (index === 0) {
                                    return
                                  }
                                  const next = [...imageItems]
                                  const [item] = next.splice(index, 1)
                                  if (!item) {
                                    return
                                  }
                                  next.splice(index - 1, 0, item)
                                  replaceImageItems(next)
                                }}
                              >
                                <ArrowUp size={16} />
                                Move up
                              </button>
                              <button
                                className="ghost-button ghost-button--inline"
                                disabled={index === imageItems.length - 1 || isImageBusy}
                                type="button"
                                onClick={() => {
                                  if (index === imageItems.length - 1) {
                                    return
                                  }
                                  const next = [...imageItems]
                                  const [item] = next.splice(index, 1)
                                  if (!item) {
                                    return
                                  }
                                  next.splice(index + 1, 0, item)
                                  replaceImageItems(next)
                                }}
                              >
                                <ArrowDown size={16} />
                                Move down
                              </button>
                              <button
                                className="ghost-button ghost-button--inline"
                                disabled={isImageBusy}
                                type="button"
                                onClick={() => openCropEditor(image)}
                              >
                                <Crop size={16} />
                                Crop
                              </button>
                              <button
                                className="ghost-button ghost-button--inline"
                                disabled={isImageBusy}
                                type="button"
                                onClick={() => {
                                  replaceImageItems(
                                    imageItems.map((item) =>
                                      item.id === image.id
                                        ? { ...item, rotation: (item.rotation + 90) % 360 }
                                        : item,
                                    ),
                                  )
                                }}
                              >
                                <RotateCw size={16} />
                                Rotate
                              </button>
                              <button
                                className="button-link button-link--danger"
                                disabled={isImageBusy}
                                type="button"
                                onClick={() => {
                                  replaceImageItems(imageItems.filter((item) => item.id !== image.id))
                                }}
                              >
                                <Trash2 size={16} />
                                Remove
                              </button>
                            </div>

                            <div className="checkbox-row checkbox-row--deck bulk-card-generator__image-toggles">
                              <label>
                                <input
                                  checked={image.enhanceScan}
                                  type="checkbox"
                                  onChange={(event) => {
                                    updateImageItem(image.id, (item) => ({
                                      ...item,
                                      enhanceScan: event.target.checked,
                                    }))
                                  }}
                                />
                                Enhance scan
                              </label>
                              <label>
                                <input
                                  checked={image.trimMargins}
                                  type="checkbox"
                                  onChange={(event) => {
                                    updateImageItem(image.id, (item) => ({
                                      ...item,
                                      trimMargins: event.target.checked,
                                    }))
                                  }}
                                />
                                Trim margins
                              </label>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </>
              ) : (
                <p className="hint-text">
                  Capture one or more document pages. Printed text works best, and the images will be merged in the order shown here.
                </p>
              )}
            </div>
          )}

        </>
      )}

      {error && <p className="error-text">{error}</p>}
      {success && !hasPreview && <p className="hint-text">{success}</p>}

      {progress && (
        <div className="preview-card preview-card--accent bulk-card-generator__progress">
          <div className="panel-heading">
            <strong>{progress.label}</strong>
            <small>{progress.percent}%</small>
          </div>
          <div className="progress-track" aria-hidden="true">
            <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}

      <div className="modal-actions quick-add-actions bulk-card-generator__actions bulk-card-generator__actions--top">
        {hasPreview ? (
          <>
            <button
              className="ghost-button"
              disabled={saving}
              type="button"
              onClick={() => {
                clearPreview()
                resetFeedback()
              }}
            >
              <PencilLine size={16} />
              Back to source
            </button>
            <button
              className="ghost-button"
              disabled={saving || !canClear}
              type="button"
              onClick={clearAll}
            >
              <Trash2 size={16} />
              Start over
            </button>
          </>
        ) : (
          <>
            <button
              className="primary-button"
              disabled={hasPreview || parsing || saving || !canGenerate}
              type="button"
              onClick={() => {
                void handleGenerate()
              }}
            >
              <Sparkles size={16} />
              {parsing ? 'Generating...' : 'Generate questions'}
            </button>

            <button
              className="ghost-button"
              disabled={saving || !canClear}
              type="button"
              onClick={clearAll}
            >
              Clear
            </button>
          </>
        )}
      </div>

      {candidates.length > 0 && (
        <section
          className={`quick-add-preview document-import-preview bulk-card-generator__review${
            hasAttentionCards ? '' : ' bulk-card-generator__review--clean'
          }`}
        >
          <div className="bulk-card-generator__review-header">
            <div className="bulk-card-generator__review-copy">
              <div className="panel-heading">
                <strong>Review</strong>
                <small>{candidates.length} ready to save</small>
              </div>
              {reviewIntro ? <p className="hint-text">{reviewIntro}</p> : null}
            </div>

            <div className="bulk-card-generator__review-stats">
              {reviewStats.map((stat) => (
                <div key={stat.id} className="bulk-card-generator__stat">
                  <strong>{stat.value}</strong>
                  <small>{stat.label}</small>
                </div>
              ))}
            </div>
          </div>

          {reviewFilters.length > 0 && (
            <div className="bulk-card-generator__review-filters" role="tablist" aria-label="Review filters">
              {reviewFilters.map((filter) => (
                <button
                  key={filter.id}
                  aria-pressed={reviewFilter === filter.id}
                  className={
                    reviewFilter === filter.id
                      ? 'bulk-card-generator__filter-button bulk-card-generator__filter-button--active'
                      : 'bulk-card-generator__filter-button'
                  }
                  type="button"
                  onClick={() => setReviewFilter(filter.id)}
                >
                  <span>{filter.label}</span>
                  <small>{filter.count}</small>
                </button>
              ))}
            </div>
          )}

          <div className="list-stack list-stack--scroll bulk-card-generator__review-list">
            {filteredCandidates.length > 0 ? (
              filteredCandidates.map((candidate) => {
                const summary = summarizeQuickAddDraft(candidate.draft)
                const needsAttention = candidate.confidence === 'medium' || candidate.warnings.length > 0
                const isActive = candidate.id === editingCandidateId

                if (isActive) {
                  return (
                    <article
                      key={candidate.id}
                      className={`activity-item document-import-item bulk-card-generator__review-card bulk-card-generator__review-card--editor${
                        needsAttention ? ' bulk-card-generator__review-card--attention' : ''
                      }`}
                    >
                      <div className="bulk-card-generator__review-editor-header">
                        <div className="bulk-card-generator__review-editor-copy">
                          <strong>Edit card</strong>
                          <small
                            className={`bulk-card-generator__review-meta-text${
                              needsAttention ? ' bulk-card-generator__review-meta-text--warning' : ''
                            }`}
                          >
                            {[
                              candidate.draft.type.replace('_', ' '),
                              needsAttention ? 'Needs review' : null,
                              candidate.method === 'ai' ? 'AI' : null,
                            ].filter(Boolean).join(' · ')}
                          </small>
                        </div>
                        <span className="bulk-card-generator__review-active-label">Editing</span>
                      </div>

                      {candidate.warnings.length > 0 && (
                        <div className="bulk-card-generator__warning-note">
                          <strong>Check this card</strong>
                          <small>{candidate.warnings.join(' ')}</small>
                        </div>
                      )}

                      <CardForm
                        initialValue={candidate.draft}
                        isEditing
                        onCancel={() => setEditingCandidateId(null)}
                        onSubmit={async (draft) => {
                          setCandidates((current) =>
                            current.map((currentCandidate) =>
                              currentCandidate.id === candidate.id ? { ...currentCandidate, draft } : currentCandidate,
                            ),
                          )
                          setEditingCandidateId(null)
                        }}
                      />
                    </article>
                  )
                }

                return (
                  <article
                    key={candidate.id}
                    className={`activity-item document-import-item bulk-card-generator__review-card${
                      needsAttention ? ' bulk-card-generator__review-card--attention' : ''
                    }`}
                  >
                    <div className="bulk-card-generator__review-meta">
                      <small
                        className={`bulk-card-generator__review-meta-text${
                          needsAttention ? ' bulk-card-generator__review-meta-text--warning' : ''
                        }`}
                      >
                        {[
                          candidate.draft.type.replace('_', ' '),
                          needsAttention ? 'Needs review' : null,
                          candidate.method === 'ai' ? 'AI' : null,
                          candidate.warnings.length > 0
                            ? `${candidate.warnings.length} warning${candidate.warnings.length === 1 ? '' : 's'}`
                            : null,
                        ].filter(Boolean).join(' · ')}
                      </small>
                    </div>

                    <div className="bulk-card-generator__summary">
                      <p className="bulk-card-generator__summary-line bulk-card-generator__summary-line--prompt">
                        {summary.heading}
                      </p>
                      <p className="bulk-card-generator__summary-line bulk-card-generator__summary-line--answer">
                        {summary.detail || 'No answer yet.'}
                      </p>
                    </div>

                    {candidate.warnings.length > 0 && (
                      <div className="bulk-card-generator__warning-note">
                        <strong>Check this card</strong>
                        <small>{candidate.warnings.join(' ')}</small>
                      </div>
                    )}

                    <div className="document-import-item__actions bulk-card-generator__review-actions">
                      <div className="inline-actions">
                        <button
                          className="ghost-button ghost-button--inline"
                          disabled={saving}
                          type="button"
                          onClick={() => setEditingCandidateId(candidate.id)}
                        >
                          <PencilLine size={16} />
                          Edit
                        </button>
                        <button
                          className="button-link button-link--danger"
                          disabled={saving}
                          type="button"
                          onClick={() => {
                            if (candidate.id === editingCandidateId) {
                              setEditingCandidateId(null)
                            }
                            setCandidates((current) => current.filter((item) => item.id !== candidate.id))
                          }}
                        >
                          <Trash2 size={16} />
                          Skip
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })
            ) : (
              <div className="preview-card bulk-card-generator__review-empty">
                <strong>No cards match this filter.</strong>
                <small>Switch filters to review the rest of this batch.</small>
              </div>
            )}
          </div>
        </section>
      )}

      {issues.length > 0 && (
        <div className="quick-add-feedback document-import-feedback">
          <strong>Needs review</strong>
          <div className="list-stack">
            {issues.map((issue) => (
              <div key={`${issue.sourceLabel}:${issue.lineNumber}:${issue.reason}`} className="activity-item">
                <strong>{issue.sourceLabel}</strong>
                <small>{issue.reason}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <div
          className={`modal-actions quick-add-actions bulk-card-generator__actions bulk-card-generator__actions--savebar${
            editingCandidate ? ' bulk-card-generator__actions--savebar--editing' : ''
          }`}
        >
          <div className="bulk-card-generator__save-summary">
            <strong>{candidates.length} ready to save</strong>
            <small>
              {editingCandidate
                ? 'Finish this edit or save the batch.'
                : skippedCount > 0
                ? `${skippedCount} skipped.`
                : needsReviewCount > 0
                  ? `${needsReviewCount} need a quick check.`
                  : 'Ready to save.'}
            </small>
          </div>

          <button
            className="primary-button"
            disabled={saving}
            type="button"
            onClick={() => {
              void handleSaveAll()
            }}
          >
            {saving
              ? 'Saving...'
              : `Save ${candidates.length} card${candidates.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </section>
  )
}
