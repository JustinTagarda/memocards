import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin'
import { createSupabaseServerClient } from '../../../../lib/supabase/server'
import { nowIso } from '../../../../lib/utils'
import type { Json } from '../../../../types/database'

function toJson<T>(value: T): Json {
  return value as Json
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const body = (await request.json()) as {
    deckId?: string
    cardId?: string
    prompt?: string
    expectedAnswer?: unknown
    submittedAnswer?: string
  }

  if (!body.deckId || !body.cardId || !body.prompt || !body.submittedAnswer?.trim()) {
    return NextResponse.json({ error: 'deckId, cardId, prompt, and submittedAnswer are required.' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data: card, error: cardError } = await admin
    .schema('memocards')
    .from('cards')
    .select('id, ai_evaluation')
    .eq('user_id', user.id)
    .eq('deck_id', body.deckId)
    .eq('id', body.cardId)
    .single()

  if (cardError || !card) {
    return NextResponse.json({ error: 'Card not found.' }, { status: 404 })
  }

  const timestamp = nowIso()
  const { error: insertError } = await admin.schema('memocards').from('answer_evaluations').insert({
    user_id: user.id,
    deck_id: body.deckId,
    card_id: body.cardId,
    prompt: body.prompt,
    expected_answer: toJson(body.expectedAnswer ?? {}),
    submitted_answer: body.submittedAnswer.trim(),
    status: 'pending',
    processor: 'future-ai-evaluator',
    pipeline_version: 'v1',
    created_at: timestamp,
    updated_at: timestamp,
  })

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  const nextEvaluation = {
    ...((card.ai_evaluation ?? {}) as Record<string, unknown>),
    requestStatus: 'queued',
    lastRequestedAt: timestamp,
  }

  const { error: updateError } = await admin
    .schema('memocards')
    .from('cards')
    .update({
      ai_evaluation: toJson(nextEvaluation),
      updated_at: timestamp,
    })
    .eq('user_id', user.id)
    .eq('deck_id', body.deckId)
    .eq('id', body.cardId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ status: 'queued' as const })
}
