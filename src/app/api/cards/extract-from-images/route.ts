import { NextResponse } from 'next/server'
import Tesseract from 'tesseract.js'
import { isLocalDevBypassEnabled } from '../../../../lib/devBypass'
import { createSupabaseServerClient } from '../../../../lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

type OcrPage = {
  id: string
  name: string
  text: string
  confidence: number
  wordCount: number
}

let workerPromise: Promise<Tesseract.Worker> | null = null

function normalizeOcrText(text: string) {
  return text
    .replace(/\u000c/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', Tesseract.OEM.DEFAULT, {
      logger: () => undefined,
    }).then(async (worker) => {
      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      })
      return worker
    })
  }

  return workerPromise
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

  const worker = await getWorker()
  const pages: OcrPage[] = []
  const warnings: string[] = []

  for (const [index, image] of images.entries()) {
    if (!image.type.startsWith('image/')) {
      return NextResponse.json({ error: `Unsupported file type for ${image.name}.` }, { status: 400 })
    }

    const bytes = Buffer.from(await image.arrayBuffer())
    const result = await worker.recognize(bytes, {
      rotateAuto: true,
    })
    const text = normalizeOcrText(result.data.text ?? '')
    const confidence = Number.isFinite(result.data.confidence) ? Math.round(result.data.confidence) : 0
    const wordCount = text.split(/\s+/).filter(Boolean).length

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

  return NextResponse.json({
    combinedText,
    pages,
    warnings,
  })
}
