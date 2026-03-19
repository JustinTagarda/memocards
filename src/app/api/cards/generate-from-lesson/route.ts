import { GoogleAuth } from 'google-auth-library'
import { NextResponse } from 'next/server'
import { isLocalDevBypassEnabled } from '../../../../lib/devBypass'
import { env, hasGoogleCloudEnvironment } from '../../../../lib/env'
import { createSupabaseServerClient } from '../../../../lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 180

const GEMINI_MODEL = 'gemini-2.5-flash-lite'
const GEMINI_TIMEOUT_MS = 120000
const MAX_SOURCE_LENGTH = 16000

type GeneratedLessonCard = {
  question: string
  answer: string
  tags?: string[]
  confidence?: 'high' | 'medium'
  note?: string
}

type GeneratedLessonCardsPayload = {
  cards?: GeneratedLessonCard[]
}

type GenerateLessonRequest = {
  sourceText?: string
  deckTitle?: string
  requestedCardCount?: number
}

type VertexResponsePart = {
  text?: string | null
}

type VertexResponseCandidate = {
  content?: {
    parts?: VertexResponsePart[] | null
  } | null
  finishReason?: string | null
}

type VertexGenerateContentResponse = {
  candidates?: VertexResponseCandidate[] | null
  promptFeedback?: {
    blockReason?: string | null
  } | null
  usageMetadata?: {
    promptTokenCount?: number | null
    candidatesTokenCount?: number | null
    totalTokenCount?: number | null
  } | null
}

const lessonCardSchema = {
  type: 'OBJECT',
  properties: {
    cards: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          question: {
            type: 'STRING',
          },
          answer: {
            type: 'STRING',
          },
          tags: {
            type: 'ARRAY',
            items: {
              type: 'STRING',
            },
          },
          confidence: {
            type: 'STRING',
            enum: ['high', 'medium'],
          },
          note: {
            type: 'STRING',
          },
        },
        required: ['question', 'answer'],
      },
    },
  },
  required: ['cards'],
} as const

const vertexAuth = hasGoogleCloudEnvironment
  ? new GoogleAuth({
      projectId: env.googleCloudProjectId,
      credentials: {
        client_email: env.googleCloudClientEmail,
        private_key: env.googleCloudPrivateKey,
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
  : null

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function logInfo(requestId: string, message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[lesson-gen:${requestId}] ${message}`, details)
    return
  }

  console.info(`[lesson-gen:${requestId}] ${message}`)
}

function logError(requestId: string, message: string, details?: unknown) {
  if (typeof details === 'undefined') {
    console.error(`[lesson-gen:${requestId}] ${message}`)
    return
  }

  console.error(`[lesson-gen:${requestId}] ${message}`, details)
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

function normalizeSourceText(text: string) {
  return text.replace(/\u000c/g, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length
}

function countExplicitQuestions(text: string) {
  return (
    text.match(/(?:^|\n)\s*(?:\d+[.)]\s*)?(?:q(?:uestion)?[:\-]\s*)/gim)?.length ??
    0
  )
}

function clampRequestedCardCount(wordCount: number, requestedCardCount?: number) {
  if (typeof requestedCardCount === 'number' && Number.isFinite(requestedCardCount)) {
    return Math.min(20, Math.max(4, Math.round(requestedCardCount)))
  }

  return Math.min(20, Math.max(6, Math.round(wordCount / 45)))
}

function buildPrompt(sourceText: string, deckTitle: string | undefined, requestedCardCount: number) {
  const deckContext = deckTitle ? `Deck title: ${deckTitle.trim()}` : 'Deck title: not provided'

  return [
    'Generate concise study flashcards from the lesson text below.',
    '',
    `Return up to ${requestedCardCount} useful cards.`,
    'Use only facts that are clearly supported by the source text.',
    'Do not invent facts that are not present in the source.',
    'If the source already contains explicit question-answer pairs, preserve them as separate cards when possible.',
    'Prefer short factual questions and short direct answers.',
    'Set confidence to "high" when the source states the fact directly, otherwise "medium".',
    'Use 0 to 3 short topical tags per card.',
    'Use note only when the generated card needs extra human review.',
    '',
    deckContext,
    '',
    'Source text:',
    sourceText,
  ].join('\n')
}

function extractResponseText(response: VertexGenerateContentResponse) {
  const firstCandidate = response.candidates?.[0]
  return (
    firstCandidate?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim() ?? ''
  )
}

function normalizeGeneratedCard(card: GeneratedLessonCard): GeneratedLessonCard | null {
  const question = card.question?.trim() ?? ''
  const answer = card.answer?.trim() ?? ''

  if (!question || !answer) {
    return null
  }

  return {
    question,
    answer,
    tags: (card.tags ?? [])
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 3),
    confidence: card.confidence === 'medium' ? 'medium' : 'high',
    note: card.note?.trim() ?? '',
  }
}

async function callGemini(
  requestId: string,
  sourceText: string,
  deckTitle: string | undefined,
  requestedCardCount: number,
) {
  if (!vertexAuth) {
    throw new Error('Google Cloud environment is not configured for lesson-card generation.')
  }

  const client = await vertexAuth.getClient()
  const prompt = buildPrompt(sourceText, deckTitle, requestedCardCount)
  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${env.googleCloudProjectId}/locations/global/publishers/google/models/${GEMINI_MODEL}:generateContent`

  logInfo(requestId, `Submitting lesson text to ${GEMINI_MODEL}.`, {
    requestedCardCount,
    sourceLength: sourceText.length,
    wordCount: countWords(sourceText),
  })

  const startedAt = Date.now()
  const response = await withTimeout(
    client.request<VertexGenerateContentResponse>({
      url: endpoint,
      method: 'POST',
      data: {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: lessonCardSchema,
        },
      },
    }),
    GEMINI_TIMEOUT_MS,
    'AI card generation took too long. Try a shorter lesson excerpt or fewer pages.',
  )

  logInfo(requestId, `Gemini responded in ${formatDuration(startedAt)}.`, {
    finishReason: response.data.candidates?.[0]?.finishReason ?? null,
    promptTokens: response.data.usageMetadata?.promptTokenCount ?? null,
    outputTokens: response.data.usageMetadata?.candidatesTokenCount ?? null,
    totalTokens: response.data.usageMetadata?.totalTokenCount ?? null,
  })

  return response.data
}

export async function POST(request: Request) {
  const requestId = request.headers.get('x-card-generation-request-id')?.trim() || createRequestId()
  const requestStartedAt = Date.now()

  if (!vertexAuth) {
    return NextResponse.json(
      {
        requestId,
        stage: 'config',
        error: 'Google Vertex AI environment is not configured.',
      },
      { status: 500 },
    )
  }

  const authorizedUser = await getAuthorizedUser()
  if (!authorizedUser.ok) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  let body: GenerateLessonRequest
  try {
    body = (await request.json()) as GenerateLessonRequest
  } catch (reason) {
    logError(requestId, 'Failed to parse lesson-generation request body.', reason)
    return NextResponse.json(
      {
        requestId,
        stage: 'request_body',
        error: 'Unable to read the lesson text request.',
      },
      { status: 400 },
    )
  }

  const sourceText = normalizeSourceText(body.sourceText ?? '')
  if (!sourceText) {
    return NextResponse.json(
      {
        requestId,
        stage: 'input',
        error: 'Add some lesson text before generating cards.',
      },
      { status: 400 },
    )
  }

  const warnings: string[] = []
  const truncatedSourceText =
    sourceText.length > MAX_SOURCE_LENGTH ? sourceText.slice(0, MAX_SOURCE_LENGTH).trim() : sourceText

  if (truncatedSourceText.length < sourceText.length) {
    warnings.push('Only the first part of the lesson text was used to keep generation fast and low-cost.')
  }

  const explicitQuestionCount = countExplicitQuestions(truncatedSourceText)
  const requestedCardCount =
    explicitQuestionCount > 0
      ? clampRequestedCardCount(explicitQuestionCount, explicitQuestionCount)
      : clampRequestedCardCount(countWords(truncatedSourceText), body.requestedCardCount)

  logInfo(requestId, 'Lesson-card generation request accepted.', {
    sourceLength: sourceText.length,
    truncatedLength: truncatedSourceText.length,
    requestedCardCount,
    explicitQuestionCount,
    deckTitle: body.deckTitle?.trim() || null,
  })

  let vertexResponse: VertexGenerateContentResponse
  try {
    vertexResponse = await callGemini(
      requestId,
      truncatedSourceText,
      body.deckTitle?.trim(),
      requestedCardCount,
    )
  } catch (reason) {
    logError(requestId, 'Lesson-card generation request failed.', reason)
    return NextResponse.json(
      {
        requestId,
        stage: 'vertex_request',
        error:
          reason instanceof Error
            ? reason.message
            : 'Unable to generate cards from this lesson right now.',
      },
      { status: 504 },
    )
  }

  if (vertexResponse.promptFeedback?.blockReason) {
    return NextResponse.json(
      {
        requestId,
        stage: 'vertex_response',
        error: `The lesson text was blocked by the model safety filters (${vertexResponse.promptFeedback.blockReason}).`,
      },
      { status: 422 },
    )
  }

  const rawText = extractResponseText(vertexResponse)
  if (!rawText) {
    return NextResponse.json(
      {
        requestId,
        stage: 'vertex_response',
        error: 'The model returned no card data. Try a clearer source page or shorter text.',
      },
      { status: 502 },
    )
  }

  let parsedPayload: GeneratedLessonCardsPayload
  try {
    parsedPayload = JSON.parse(rawText) as GeneratedLessonCardsPayload
  } catch (reason) {
    logError(requestId, 'Failed to parse Gemini JSON output.', { rawText })
    return NextResponse.json(
      {
        requestId,
        stage: 'parse_response',
        error: 'The AI returned an unreadable response. Please try again.',
      },
      { status: 502 },
    )
  }

  const uniqueQuestions = new Set<string>()
  const cards =
    (parsedPayload.cards ?? [])
      .map(normalizeGeneratedCard)
      .filter((card): card is GeneratedLessonCard => Boolean(card))
      .filter((card) => {
        const key = card.question.toLowerCase()
        if (uniqueQuestions.has(key)) {
          return false
        }
        uniqueQuestions.add(key)
        return true
      })
      .slice(0, requestedCardCount)

  if (cards.length === 0) {
    return NextResponse.json(
      {
        requestId,
        stage: 'normalize_cards',
        error: 'The AI could not generate any usable cards from this lesson.',
      },
      { status: 422 },
    )
  }

  logInfo(requestId, `Generated ${cards.length} lesson card(s) in ${formatDuration(requestStartedAt)}.`, {
    warnings: warnings.length,
  })

  return NextResponse.json({
    requestId,
    cards,
    warnings,
  })
}
