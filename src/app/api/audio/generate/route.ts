import { TextToSpeechClient } from '@google-cloud/text-to-speech'
import { NextResponse } from 'next/server'
import { env, hasGoogleTtsEnvironment } from '../../../../lib/env'
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin'
import { createSupabaseServerClient } from '../../../../lib/supabase/server'
import { hashText, nowIso } from '../../../../lib/utils'
import type { Database, Json } from '../../../../types/database'

export const runtime = 'nodejs'

const audioBucket = 'memocards-audio'

const textToSpeech = hasGoogleTtsEnvironment
  ? new TextToSpeechClient({
      projectId: env.googleCloudProjectId,
      credentials: {
        client_email: env.googleCloudClientEmail,
        private_key: env.googleCloudPrivateKey,
      },
    })
  : null

type CardRow = Database['memocards']['Tables']['cards']['Row']

function toJson<T>(value: T): Json {
  return value as Json
}

function getAudioVariant(audio: Json | null, side: 'prompt' | 'answer') {
  const record = (audio ?? {}) as Record<string, unknown>
  return (record[side] ?? null) as
    | {
        status?: string
        storagePath?: string | null
        textHash?: string | null
        updatedAt?: string | null
      }
    | null
}

function getVoiceName(audio: Json | null) {
  const record = (audio ?? {}) as Record<string, unknown>
  return (record['voiceName'] as string | undefined) ?? 'en-US-Neural2-F'
}

function getLocale(audio: Json | null) {
  const record = (audio ?? {}) as Record<string, unknown>
  return (record['locale'] as string | undefined) ?? 'en-US'
}

function getAudioText(card: CardRow, side: 'prompt' | 'answer') {
  if (side === 'prompt') {
    return card.type === 'basic' || card.type === 'term' ? card.front || card.prompt : card.prompt
  }

  if (card.type === 'multiple_choice') {
    return card.answer
  }

  if (card.type === 'explanation') {
    const expectedAnswer = (card.expected_answer ?? {}) as Record<string, unknown>
    return (expectedAnswer['canonical'] as string | undefined) ?? card.answer
  }

  return card.back || card.answer
}

export async function POST(request: Request) {
  if (!textToSpeech) {
    return NextResponse.json({ error: 'Google Text-to-Speech environment is not configured.' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const body = (await request.json()) as { deckId?: string; cardId?: string; side?: 'prompt' | 'answer' }
  if (!body.deckId || !body.cardId || (body.side !== 'prompt' && body.side !== 'answer')) {
    return NextResponse.json({ error: 'deckId, cardId, and side are required.' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data: card, error: cardError } = await admin
    .schema('memocards')
    .from('cards')
    .select('*')
    .eq('user_id', user.id)
    .eq('deck_id', body.deckId)
    .eq('id', body.cardId)
    .single()

  if (cardError || !card) {
    return NextResponse.json({ error: 'Card not found.' }, { status: 404 })
  }

  const locale = getLocale(card.audio)
  const voiceName = getVoiceName(card.audio)
  const audioText = getAudioText(card, body.side).trim()

  if (!audioText) {
    return NextResponse.json({ error: 'This card does not have text to synthesize.' }, { status: 400 })
  }

  const contentHash = hashText(`${audioText}:${voiceName}:${locale}`)
  const existingVariant = getAudioVariant(card.audio, body.side)
  if (existingVariant?.storagePath && existingVariant.textHash === contentHash) {
    const { data: signedUrl, error: signError } = await admin.storage
      .from(audioBucket)
      .createSignedUrl(existingVariant.storagePath, 60 * 60)

    if (!signError && signedUrl?.signedUrl) {
      return NextResponse.json({
        signedUrl: signedUrl.signedUrl,
        storagePath: existingVariant.storagePath,
      })
    }
  }

  const [response] = await textToSpeech.synthesizeSpeech({
    input: { text: audioText },
    voice: {
      languageCode: locale,
      name: voiceName,
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 0.98,
    },
  })

  if (!response.audioContent) {
    return NextResponse.json({ error: 'Google Text-to-Speech returned no audio.' }, { status: 502 })
  }

  const bytes = Buffer.isBuffer(response.audioContent)
    ? response.audioContent
    : Buffer.from(response.audioContent as Uint8Array)
  const storagePath = `${user.id}/decks/${body.deckId}/cards/${body.cardId}/${body.side}-${contentHash}.mp3`

  const { error: uploadError } = await admin.storage
    .from(audioBucket)
    .upload(storagePath, bytes, {
      upsert: true,
      contentType: 'audio/mpeg',
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const nextAudio = {
    ...((card.audio ?? {}) as Record<string, unknown>),
    locale,
    voiceName,
    [body.side]: {
      status: 'ready',
      storagePath,
      textHash: contentHash,
      updatedAt: nowIso(),
    },
  }

  const { error: updateError } = await admin
    .schema('memocards')
    .from('cards')
    .update({
      audio: toJson(nextAudio),
      updated_at: nowIso(),
    })
    .eq('user_id', user.id)
    .eq('deck_id', body.deckId)
    .eq('id', body.cardId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  await admin.schema('memocards').from('activity').insert({
    user_id: user.id,
    type: 'audio_generated',
    title: 'Audio generated',
    description: `${body.side} audio generated for a study card`,
    deck_id: body.deckId,
    card_id: body.cardId,
    created_at: nowIso(),
  })

  const { data: signedUrl, error: signError } = await admin.storage
    .from(audioBucket)
    .createSignedUrl(storagePath, 60 * 60)

  if (signError || !signedUrl?.signedUrl) {
    return NextResponse.json({ error: signError?.message ?? 'Unable to sign generated audio.' }, { status: 500 })
  }

  return NextResponse.json({
    signedUrl: signedUrl.signedUrl,
    storagePath,
  })
}
