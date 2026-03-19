import { ImageAnnotatorClient } from '@google-cloud/vision'
import { NextResponse } from 'next/server'
import { isLocalDevBypassEnabled } from '../../../../lib/devBypass'
import { env, hasGoogleCloudEnvironment } from '../../../../lib/env'
import { createSupabaseServerClient } from '../../../../lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 180

const GOOGLE_VISION_TIMEOUT_MS = 120000

type OcrPage = {
  id: string
  name: string
  text: string
  confidence: number
  wordCount: number
}

type VisionWord = {
  confidence?: number | null
}

type VisionParagraph = {
  words?: VisionWord[] | null
}

type VisionBlock = {
  paragraphs?: VisionParagraph[] | null
}

type VisionPage = {
  confidence?: number | null
  blocks?: VisionBlock[] | null
}

type VisionTextAnnotation = {
  text?: string | null
  pages?: VisionPage[] | null
}

const visionClient = hasGoogleCloudEnvironment
  ? new ImageAnnotatorClient({
      projectId: env.googleCloudProjectId,
      credentials: {
        client_email: env.googleCloudClientEmail,
        private_key: env.googleCloudPrivateKey,
      },
    })
  : null

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function logOcrInfo(requestId: string, message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[ocr:${requestId}] ${message}`, details)
    return
  }

  console.info(`[ocr:${requestId}] ${message}`)
}

function logOcrError(requestId: string, message: string, details?: unknown) {
  if (typeof details === 'undefined') {
    console.error(`[ocr:${requestId}] ${message}`)
    return
  }

  console.error(`[ocr:${requestId}] ${message}`, details)
}

function normalizeOcrText(text: string) {
  return text
    .replace(/\u000c/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function formatDuration(startedAt: number) {
  return `${Date.now() - startedAt}ms`
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length
}

function averageConfidence(annotation: VisionTextAnnotation | null | undefined) {
  const wordConfidences: number[] = []

  annotation?.pages?.forEach((page) => {
    page.blocks?.forEach((block) => {
      block.paragraphs?.forEach((paragraph) => {
        paragraph.words?.forEach((word) => {
          if (typeof word.confidence === 'number' && Number.isFinite(word.confidence)) {
            wordConfidences.push(word.confidence)
          }
        })
      })
    })
  })

  if (wordConfidences.length > 0) {
    const total = wordConfidences.reduce((sum, confidence) => sum + confidence, 0)
    return Math.round((total / wordConfidences.length) * 100)
  }

  const pageConfidences =
    annotation?.pages
      ?.map((page) => page.confidence)
      .filter((confidence): confidence is number => typeof confidence === 'number' && Number.isFinite(confidence)) ?? []

  if (pageConfidences.length > 0) {
    const total = pageConfidences.reduce((sum, confidence) => sum + confidence, 0)
    return Math.round((total / pageConfidences.length) * 100)
  }

  return 0
}

async function getAuthorizedUser() {
  if (isLocalDevBypassEnabled) {
    return { ok: true as const }
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user ? { ok: true as const } : { ok: false as const }
}

export async function POST(request: Request) {
  const requestStartedAt = Date.now()
  const requestId = request.headers.get('x-ocr-request-id')?.trim() || createRequestId()

  if (!visionClient) {
    return NextResponse.json(
      {
        requestId,
        stage: 'config',
        error: 'Google Cloud Vision environment is not configured.',
      },
      { status: 500 },
    )
  }

  const authorizedUser = await getAuthorizedUser()
  if (!authorizedUser.ok) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  logOcrInfo(requestId, 'OCR request accepted.', {
    contentLength: request.headers.get('content-length'),
    contentType: request.headers.get('content-type'),
    userAgent: request.headers.get('user-agent'),
  })

  let formData: FormData
  const formDataStartedAt = Date.now()
  try {
    formData = await request.formData()
  } catch (reason) {
    logOcrError(requestId, `Failed to parse form data after ${formatDuration(formDataStartedAt)}.`, reason)
    return NextResponse.json(
      {
        requestId,
        stage: 'form_data',
        error: 'Unable to read the uploaded image data.',
      },
      { status: 400 },
    )
  }

  logOcrInfo(requestId, `Parsed form data in ${formatDuration(formDataStartedAt)}.`)

  const rawImages = formData.getAll('images')
  const images = rawImages.filter((value): value is File => value instanceof File)

  if (images.length === 0) {
    return NextResponse.json(
      {
        requestId,
        stage: 'input',
        error: 'Add at least one image to extract text.',
      },
      { status: 400 },
    )
  }

  if (images.length > 12) {
    return NextResponse.json(
      {
        requestId,
        stage: 'input',
        error: 'Use up to 12 images at a time.',
      },
      { status: 400 },
    )
  }

  logOcrInfo(requestId, `Starting Vision extraction for ${images.length} image(s).`, {
    images: images.map((image, index) => ({
      index: index + 1,
      name: image.name || `image-${index + 1}`,
      type: image.type,
      size: image.size,
    })),
  })

  const pages: OcrPage[] = []
  const warnings: string[] = []

  for (const [index, image] of images.entries()) {
    if (!image.type.startsWith('image/')) {
      return NextResponse.json(
        {
          requestId,
          stage: 'input',
          error: `Unsupported file type for ${image.name}.`,
        },
        { status: 400 },
      )
    }

    const bytes = Buffer.from(await image.arrayBuffer())
    const pageStartedAt = Date.now()
    logOcrInfo(
      requestId,
      `Submitting page ${index + 1}/${images.length} to Google Cloud Vision: ${image.name || `image-${index + 1}`}.`,
      {
        byteLength: bytes.byteLength,
      },
    )

    let result: Awaited<ReturnType<ImageAnnotatorClient['documentTextDetection']>>[0]
    try {
      ;[result] = await withTimeout(
        visionClient.documentTextDetection({
          image: {
            content: bytes,
          },
        }),
        GOOGLE_VISION_TIMEOUT_MS,
        `Reading ${image.name || `image ${index + 1}`} took too long. Try a tighter crop or clearer photo.`,
      )
    } catch (reason) {
      logOcrError(
        requestId,
        `Vision recognition failed for ${image.name || `image-${index + 1}`} after ${formatDuration(pageStartedAt)}.`,
        reason,
      )
      return NextResponse.json(
        {
          requestId,
          stage: 'vision_request',
          error:
            reason instanceof Error
              ? reason.message
              : 'Unable to read that image. Try again with a clearer photo.',
        },
        { status: 504 },
      )
    }

    const responseError = result.error
    if (responseError?.message) {
      logOcrError(
        requestId,
        `Vision returned an error for ${image.name || `image-${index + 1}`}.`,
        responseError,
      )
      return NextResponse.json(
        {
          requestId,
          stage: 'vision_response',
          error: responseError.message,
        },
        { status: 502 },
      )
    }

    const annotation = (result.fullTextAnnotation ?? null) as VisionTextAnnotation | null
    const fallbackText = result.textAnnotations?.[0]?.description ?? ''
    const text = normalizeOcrText(annotation?.text ?? fallbackText)
    const confidence = averageConfidence(annotation)
    const wordCount = countWords(text)

    logOcrInfo(
      requestId,
      `Finished page ${index + 1}/${images.length} in ${formatDuration(pageStartedAt)}.`,
      {
        wordCount,
        confidence,
      },
    )

    if (!text) {
      warnings.push(`No readable text was found in ${image.name || `image ${index + 1}`}.`)
      continue
    }

    if (confidence > 0 && confidence < 58) {
      warnings.push(
        `OCR confidence was low for ${image.name || `image ${index + 1}`}. Review those cards carefully.`,
      )
    }

    pages.push({
      id: `ocr-page-${index + 1}`,
      name: image.name || `Image ${index + 1}`,
      text,
      confidence,
      wordCount,
    })
  }

  const combinedText = pages.map((page) => page.text).join('\n\n')

  if (!combinedText.trim()) {
    logOcrInfo(requestId, `Vision finished without readable text after ${formatDuration(requestStartedAt)}.`, {
      warnings: warnings.length,
    })
    return NextResponse.json(
      {
        requestId,
        stage: 'vision_response',
        error: warnings[0] ?? 'No readable text was found in the selected images.',
      },
      { status: 422 },
    )
  }

  logOcrInfo(requestId, `Completed Vision extraction for ${images.length} image(s) in ${formatDuration(requestStartedAt)}.`, {
    pages: pages.length,
    warnings: warnings.length,
    combinedLength: combinedText.length,
  })

  return NextResponse.json({
    requestId,
    combinedText,
    pages,
    warnings,
  })
}
