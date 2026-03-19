import { access, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextResponse } from 'next/server'
import Tesseract from 'tesseract.js'
import { isLocalDevBypassEnabled } from '../../../../lib/devBypass'
import { createSupabaseServerClient } from '../../../../lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 180

const WORKER_INIT_TIMEOUT_MS = 45000
const RECOGNIZE_TIMEOUT_MS = 90000
const OCR_CACHE_DIR = path.join(tmpdir(), 'memocards-tesseract')
const TESSERACT_WORKER_PATH = path.join(
  process.cwd(),
  'node_modules',
  'tesseract.js',
  'src',
  'worker-script',
  'node',
  'index.js',
)

type OcrPage = {
  id: string
  name: string
  text: string
  confidence: number
  wordCount: number
}

let workerPromise: Promise<Tesseract.Worker> | null = null

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

async function resetWorker() {
  if (!workerPromise) {
    return
  }

  const activePromise = workerPromise
  workerPromise = null

  try {
    const worker = await activePromise
    await worker.terminate()
  } catch {
    // Best effort reset only.
  }
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

async function resolveWorkerScriptPath() {
  await access(TESSERACT_WORKER_PATH).catch(() => {
    throw new Error(`OCR worker script was not found at ${TESSERACT_WORKER_PATH}.`)
  })
  return TESSERACT_WORKER_PATH
}

async function ensureOcrRuntimePaths(workerPath: string) {
  await access(workerPath).catch(() => {
    throw new Error(`OCR worker script was not found at ${workerPath}.`)
  })
  await mkdir(OCR_CACHE_DIR, { recursive: true })
}

async function getWorker(requestId: string) {
  if (!workerPromise) {
    const startedAt = Date.now()
    logOcrInfo(requestId, 'Initializing Tesseract worker.')

    workerPromise = (async () => {
      const workerPath = await resolveWorkerScriptPath()
      await ensureOcrRuntimePaths(workerPath)
      logOcrInfo(requestId, 'Using OCR runtime paths.', {
        workerPath,
        cachePath: OCR_CACHE_DIR,
      })

      const worker = await Tesseract.createWorker('eng', Tesseract.OEM.DEFAULT, {
        logger: (event) => {
          const progress =
            typeof event.progress === 'number' ? `${Math.round(event.progress * 100)}%` : 'n/a'
          console.info(`[ocr-worker:${requestId}] ${event.status} (${progress})`)
        },
        workerPath,
        cachePath: OCR_CACHE_DIR,
      })

      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      })
      logOcrInfo(requestId, `Worker initialized in ${formatDuration(startedAt)}.`)
      return worker
    })()
  } else {
    logOcrInfo(requestId, 'Reusing cached Tesseract worker.')
  }

  return withTimeout(
    workerPromise,
    WORKER_INIT_TIMEOUT_MS,
    'OCR initialization took too long. Try again in a moment.',
  )
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
    return NextResponse.json({ error: 'Add at least one image to extract text.' }, { status: 400 })
  }

  if (images.length > 12) {
    return NextResponse.json({ error: 'Use up to 12 images at a time.' }, { status: 400 })
  }

  logOcrInfo(requestId, `Starting extraction for ${images.length} image(s).`, {
    images: images.map((image, index) => ({
      index: index + 1,
      name: image.name || `image-${index + 1}`,
      type: image.type,
      size: image.size,
    })),
  })

  let worker: Tesseract.Worker
  try {
    worker = await getWorker(requestId)
  } catch (reason) {
    logOcrError(requestId, 'Worker initialization failed.', reason)
    await resetWorker()
    return NextResponse.json(
      {
        requestId,
        stage: 'worker_init',
        error:
          reason instanceof Error
            ? reason.message
            : 'OCR initialization failed. Please try again.',
      },
      { status: 504 },
    )
  }

  const pages: OcrPage[] = []
  const warnings: string[] = []

  for (const [index, image] of images.entries()) {
    if (!image.type.startsWith('image/')) {
      return NextResponse.json({ error: `Unsupported file type for ${image.name}.` }, { status: 400 })
    }

    const bytes = Buffer.from(await image.arrayBuffer())
    const pageStartedAt = Date.now()
    logOcrInfo(
      requestId,
      `Recognizing page ${index + 1}/${images.length}: ${image.name || `image-${index + 1}`}.`,
      {
        byteLength: bytes.byteLength,
      },
    )

    let result: Tesseract.RecognizeResult
    try {
      result = await withTimeout(
        worker.recognize(bytes, {
          rotateAuto: true,
        }),
        RECOGNIZE_TIMEOUT_MS,
        `Reading ${image.name || `image ${index + 1}`} took too long. Try a tighter crop or clearer photo.`,
      )
    } catch (reason) {
      logOcrError(
        requestId,
        `Recognition failed for ${image.name || `image-${index + 1}`} after ${formatDuration(pageStartedAt)}.`,
        reason,
      )
      await resetWorker()
      return NextResponse.json(
        {
          requestId,
          stage: 'recognize',
          error:
            reason instanceof Error
              ? reason.message
              : 'Unable to read that image. Try again with a clearer photo.',
        },
        { status: 504 },
      )
    }

    const text = normalizeOcrText(result.data.text ?? '')
    const confidence = Number.isFinite(result.data.confidence) ? Math.round(result.data.confidence) : 0
    const wordCount = text.split(/\s+/).filter(Boolean).length

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

    if (confidence < 58) {
      warnings.push(`OCR confidence was low for ${image.name || `image ${index + 1}`}. Review those cards carefully.`)
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
    logOcrInfo(requestId, `OCR finished without readable text after ${formatDuration(requestStartedAt)}.`, {
      warnings: warnings.length,
    })
    return NextResponse.json(
      {
        requestId,
        stage: 'recognize',
        error: warnings[0] ?? 'No readable text was found in the selected images.',
      },
      { status: 422 },
    )
  }

  logOcrInfo(requestId, `Completed extraction for ${images.length} image(s) in ${formatDuration(requestStartedAt)}.`, {
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
