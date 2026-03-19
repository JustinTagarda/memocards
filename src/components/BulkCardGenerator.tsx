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
  previewUrl: string
  rotation: number
  manualCrop: DocumentCropRect | null
  enhanceScan: boolean
  trimMargins: boolean
}

type BulkSourceMode = 'text' | 'images'
type BulkGenerationMode = 'lesson' | 'parse'
type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

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
  return {
    id: createItemId('bulk-image', index),
    file,
    previewUrl: URL.createObjectURL(file),
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

function revokePreviewUrls(items: PendingImage[]) {
  items.forEach((item) => URL.revokeObjectURL(item.previewUrl))
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
  const [generationMode, setGenerationMode] = useState<BulkGenerationMode>('lesson')
  const [sourceText, setSourceText] = useState('')
  const [parserMode, setParserMode] = useState<DocumentParserMode>('auto')
  const [candidates, setCandidates] = useState<PendingCandidate[]>([])
  const [issues, setIssues] = useState<DocumentParseIssue[]>([])
  const [ocrPages, setOcrPages] = useState<ExtractedImageTextPage[]>([])
  const [imageItems, setImageItems] = useState<PendingImage[]>([])
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ percent: number; label: string } | null>(null)
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null)
  const [cropEditor, setCropEditor] = useState<ActiveImageCrop | null>(null)
  const editorRef = useRef<HTMLElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
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
  const activeCropImage = cropEditor
    ? imageItems.find((image) => image.id === cropEditor.imageId) ?? null
    : null
  const canGenerate =
    sourceMode === 'text' ? Boolean(sourceText.trim()) : imageItems.length > 0 && !cropEditor
  const canClear =
    Boolean(sourceText.trim()) ||
    imageItems.length > 0 ||
    candidates.length > 0 ||
    issues.length > 0 ||
    ocrPages.length > 0

  useEffect(() => {
    if (!editingCandidate) {
      return
    }
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editingCandidate])

  function resetFeedback() {
    setError(null)
    setSuccess(null)
  }

  function updateImageItem(
    imageId: string,
    updater: (image: PendingImage) => PendingImage,
  ) {
    replaceImageItems(
      imageItems.map((item) => (item.id === imageId ? updater(item) : item)),
    )
  }

  function clearPreview() {
    setCandidates([])
    setIssues([])
    setOcrPages([])
    setEditingCandidateId(null)
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
    revokePreviewUrls(imageItems)
    setImageItems([])
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

  function applyCropSelection() {
    if (!cropEditor) {
      return
    }

    updateImageItem(cropEditor.imageId, (item) => ({
      ...item,
      manualCrop: normalizeCropRect(cropEditor.rect),
    }))
    setCropEditor(null)
  }

  function applyParsedCandidates(
    parsed: ReturnType<typeof parseDocumentText>,
    sourceLabel: string,
    extraIssues: DocumentParseIssue[] = [],
  ) {
    const nextIssues = [...extraIssues, ...parsed.issues]
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

    setSuccess(buildParsedMessage(parsed.candidates.length, parserMode, nextIssues.length, sourceLabel))
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
    setProgress(null)
    resetFeedback()

    try {
      if (generationMode === 'lesson') {
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
        return
      }

      const parsed = parseDocumentText(sourceText, parserMode)
      applyParsedCandidates(parsed, 'the pasted text')
    } catch (reason) {
      clearPreview()
      setError(
        reason instanceof Error
          ? reason.message
          : generationMode === 'lesson'
            ? 'Unable to generate cards from this lesson.'
            : 'Unable to parse this text.',
      )
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
        parserMode,
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

      if (generationMode === 'lesson') {
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
          label: 'Parsing extracted text into cards...',
        })

        const parsed = parseDocumentText(extracted.combinedText, parserMode)
        applyParsedCandidates(
          parsed,
          `${preparedFiles.length} image${preparedFiles.length === 1 ? '' : 's'}`,
          buildOcrIssues(extracted.warnings),
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
          : generationMode === 'lesson'
            ? 'Unable to generate cards from this lesson.'
            : 'Unable to generate cards from these images.',
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
    setImageItems(nextItems)
  }

  function appendImageFiles(files: FileList | File[]) {
    const incoming = Array.from(files).filter((file) => file.type.startsWith('image/'))

    if (incoming.length === 0) {
      setError('Only image files can be used for document capture.')
      return
    }

    const nextTotal = imageItems.length + incoming.length
    if (nextTotal > 12) {
      setError('Use up to 12 images at a time.')
      return
    }

    resetFeedback()
    clearPreview()
    setSourceMode('images')
    replaceImageItems([
      ...imageItems,
      ...incoming.map((file, index) => createPendingImage(file, imageItems.length + index)),
    ])
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
              Paste text
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

          <div className="bulk-card-generator__generation-mode">
            <button
              aria-pressed={generationMode === 'lesson'}
              className={generationMode === 'lesson' ? 'choice-pill choice-pill--selected' : 'choice-pill'}
              type="button"
              onClick={() => {
                setGenerationMode('lesson')
                if (candidates.length > 0 || issues.length > 0 || ocrPages.length > 0) {
                  clearPreview()
                }
                resetFeedback()
              }}
            >
              Generate from lesson
            </button>
            <button
              aria-pressed={generationMode === 'parse'}
              className={generationMode === 'parse' ? 'choice-pill choice-pill--selected' : 'choice-pill'}
              type="button"
              onClick={() => {
                setGenerationMode('parse')
                if (candidates.length > 0 || issues.length > 0 || ocrPages.length > 0) {
                  clearPreview()
                }
                resetFeedback()
              }}
            >
              Parse existing Q&amp;A
            </button>
          </div>

          {sourceMode === 'text' ? (
            <label className="field bulk-card-generator__source">
              <span>Source text</span>
              <textarea
                placeholder="Paste copied text here..."
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

              {imageItems.length > 0 ? (
                <>
                  <div className="bulk-card-generator__image-list">
                    {imageItems.map((image, index) => (
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

                        <div className="editor-shell__meta bulk-card-generator__image-meta">
                          <span className="status-pill">{image.rotation}°</span>
                          {image.manualCrop && <span className="status-pill">Manual crop</span>}
                          {image.enhanceScan && <span className="status-pill">Enhance scan</span>}
                          {image.trimMargins && <span className="status-pill">Trim margins</span>}
                        </div>

                        <div className="bulk-card-generator__image-buttons">
                          <button
                            className="ghost-button ghost-button--inline"
                            disabled={index === 0 || parsing || saving}
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
                            disabled={index === imageItems.length - 1 || parsing || saving}
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
                            disabled={parsing || saving}
                            type="button"
                            onClick={() => openCropEditor(image)}
                          >
                            <Crop size={16} />
                            Crop
                          </button>
                          <button
                            className="ghost-button ghost-button--inline"
                            disabled={parsing || saving}
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
                            disabled={parsing || saving}
                            type="button"
                            onClick={() => {
                              URL.revokeObjectURL(image.previewUrl)
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
                  ))}
                  </div>

                  {activeCropImage && cropEditor ? (
                    <section className="preview-card bulk-card-generator__crop-editor">
                      <div className="panel-heading">
                        <strong>Crop page</strong>
                        <small>{activeCropImage.file.name}</small>
                      </div>

                      <div className="bulk-card-generator__crop-stage" ref={cropStageRef}>
                        <img alt="Crop selected page" src={activeCropImage.previewUrl} />

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

                      <div className="bulk-card-generator__crop-copy">
                        <small>Drag the crop box or its corners, then apply the crop before generating cards.</small>
                      </div>

                      <div className="modal-actions bulk-card-generator__crop-actions">
                        <button
                          className="ghost-button"
                          disabled={parsing || saving}
                          type="button"
                          onClick={() => {
                            updateImageItem(activeCropImage.id, (item) => ({ ...item, manualCrop: null }))
                            setCropEditor({
                              imageId: activeCropImage.id,
                              rect: createDefaultCropRect(),
                            })
                          }}
                        >
                          Reset crop
                        </button>
                        <button
                          className="ghost-button"
                          disabled={parsing || saving}
                          type="button"
                          onClick={() => setCropEditor(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className="primary-button"
                          disabled={parsing || saving}
                          type="button"
                          onClick={applyCropSelection}
                        >
                          Apply crop
                        </button>
                      </div>
                    </section>
                  ) : null}
                </>
              ) : (
                <p className="hint-text">
                  Capture one or more document pages. Printed text works best, and the images will be merged in the order shown here.
                </p>
              )}
            </div>
          )}

          {generationMode === 'parse' && (
            <div className="field-grid bulk-card-generator__controls">
              <label className="field quick-add-toolbar__type">
                <span>Parser mode</span>
                <select
                  value={parserMode}
                  onChange={(event) => {
                    setParserMode(event.target.value as DocumentParserMode)
                    if (candidates.length > 0 || issues.length > 0 || ocrPages.length > 0) {
                      clearPreview()
                    }
                    resetFeedback()
                  }}
                >
                  <option value="auto">Auto detect</option>
                  <option value="basic">Basic</option>
                  <option value="term">Term / Definition</option>
                  <option value="explanation">Explanation</option>
                  <option value="multiple_choice">Multiple Choice</option>
                </select>
              </label>
            </div>
          )}
        </>
      )}

      {error && <p className="error-text">{error}</p>}
      {success && <p className="hint-text">{success}</p>}

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
        <button
          className="primary-button"
          disabled={hasPreview || parsing || saving || !canGenerate}
          type="button"
          onClick={() => {
            void handleGenerate()
          }}
        >
          <Sparkles size={16} />
          {parsing ? 'Generating...' : 'Generate cards'}
        </button>

        <button
          className="ghost-button"
          disabled={saving || !canClear}
          type="button"
          onClick={clearAll}
        >
          Clear
        </button>
      </div>

      {editingCandidate && (
        <section ref={editorRef} className="editor-shell editor-shell--inline">
          <div className="editor-shell__header">
            <div className="editor-shell__copy">
              <p className="eyebrow">Review draft</p>
              <h2>Edit generated card</h2>
              <p>Refine this draft before it goes into the batch save.</p>
            </div>

            <div className="editor-shell__meta">
              <span className="status-pill">{editingCandidate.draft.type.replace('_', ' ')}</span>
              <span className="status-pill">
                {editingCandidate.confidence === 'high' ? 'High confidence' : 'Needs review'}
              </span>
            </div>
          </div>

          <div className="editor-shell__body">
            <CardForm
              initialValue={editingCandidate.draft}
              isEditing
              onCancel={() => setEditingCandidateId(null)}
              onSubmit={async (draft) => {
                setCandidates((current) =>
                  current.map((candidate) =>
                    candidate.id === editingCandidate.id ? { ...candidate, draft } : candidate,
                  ),
                )
                setEditingCandidateId(null)
              }}
            />
          </div>
        </section>
      )}

      {candidates.length > 0 && (
        <div className="quick-add-preview document-import-preview">
          <div className="panel-heading">
            <strong>Preview cards</strong>
            <small>{candidates.length} ready to save</small>
          </div>

          <div className="list-stack list-stack--scroll">
            {candidates.map((candidate) => {
              const summary = summarizeQuickAddDraft(candidate.draft)

              return (
                <article key={candidate.id} className="activity-item document-import-item">
                  <div className="quick-add-preview__meta">
                    <small>
                      {candidate.draft.type.replace('_', ' ')} ·{' '}
                      {candidate.method === 'ai'
                        ? candidate.confidence === 'high'
                          ? 'AI generated'
                          : 'AI generated · review suggested'
                        : candidate.confidence === 'high'
                          ? 'High confidence'
                          : 'Review suggested'}
                    </small>
                  </div>

                  <div className="bulk-card-generator__summary">
                    <p className="bulk-card-generator__summary-line bulk-card-generator__summary-line--prompt">
                      {summary.heading}
                    </p>
                    <p className="bulk-card-generator__summary-line">
                      {summary.detail || 'No answer yet.'}
                    </p>
                  </div>

                  {candidate.warnings.length > 0 && (
                    <p className="hint-text">{candidate.warnings.join(' ')}</p>
                  )}

                  <div className="document-import-item__actions">
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
                          setCandidates((current) => current.filter((item) => item.id !== candidate.id))
                        }}
                      >
                        <Trash2 size={16} />
                        Remove
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
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
        <div className="modal-actions quick-add-actions bulk-card-generator__actions">
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
