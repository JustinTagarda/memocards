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

async function getWorker() {
  if (!workerPromise) {
    const startedAt = Date.now()
    console.info('[ocr] Initializing Tesseract worker...')

    workerPromise = (async () => {
      const workerPath = await resolveWorkerScriptPath()
      await ensureOcrRuntimePaths(workerPath)
      console.info(`[ocr] Using worker path: ${workerPath}`)
      console.info(`[ocr] Using cache path: ${OCR_CACHE_DIR}`)

      const worker = await Tesseract.createWorker('eng', Tesseract.OEM.DEFAULT, {
        logger: () => undefined,
        workerPath,
        cachePath: OCR_CACHE_DIR,
      })

      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      })
      console.info(`[ocr] Worker initialized in ${formatDuration(startedAt)}.`)
      return worker
    })()
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
  const authorizedUser = await getAuthorizedUser()
  if (!authorizedUser.ok) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const formData = await request.formData()
  const rawImages = formData.getAll('images')
  const images = rawImages.filter((value): value is File => value instanceof File)

  if (images.length === 0) {
    return NextResponse.json({ error: 'Add at least one image to extract text.' }, { status: 400 })
  }

  if (images.length > 12) {
    return NextResponse.json({ error: 'Use up to 12 images at a time.' }, { status: 400 })
  }

  console.info(`[ocr] Starting extraction for ${images.length} image(s).`)

  let worker: Tesseract.Worker
  try {
    worker = await getWorker()
  } catch (reason) {
    console.error('[ocr] Worker initialization failed.', reason)
    await resetWorker()
    return NextResponse.json(
      {
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
    console.info(
      `[ocr] Recognizing page ${index + 1}/${images.length}: ${image.name || `image-${index + 1}`}.`,
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
      console.error(
        `[ocr] Recognition failed for ${image.name || `image-${index + 1}`} after ${formatDuration(pageStartedAt)}.`,
        reason,
      )
      await resetWorker()
      return NextResponse.json(
        {
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

    console.info(
      `[ocr] Finished page ${index + 1}/${images.length} in ${formatDuration(pageStartedAt)} with ${wordCount} word(s) at ${confidence}% confidence.`,
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
    return NextResponse.json(
      {
        error: warnings[0] ?? 'No readable text was found in the selected images.',
      },
      { status: 422 },
    )
  }

  console.info(
    `[ocr] Completed extraction for ${images.length} image(s) in ${formatDuration(requestStartedAt)}.`,
  )

  return NextResponse.json({
    combinedText,
    pages,
    warnings,
  })
}
