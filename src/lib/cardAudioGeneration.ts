import { TextToSpeechClient } from '@google-cloud/text-to-speech'
import type { SupabaseClient } from '@supabase/supabase-js'
import { env, hasGoogleTtsEnvironment } from './env'
import { hashText, nowIso } from './utils'
import type { Database, Json } from '../types/database'

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

export function getAudioVariant(audio: Json | null, side: 'prompt' | 'answer') {
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

export function getVoiceName(audio: Json | null) {
  const record = (audio ?? {}) as Record<string, unknown>
  return (record['voiceName'] as string | undefined) ?? 'en-US-Neural2-F'
}

export function getLocale(audio: Json | null) {
  const record = (audio ?? {}) as Record<string, unknown>
  return (record['locale'] as string | undefined) ?? 'en-US'
}

export function getAudioText(card: CardRow, side: 'prompt' | 'answer') {
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

export function buildCardAudioVariant(card: CardRow, side: 'prompt' | 'answer') {
  const locale = getLocale(card.audio)
  const voiceName = getVoiceName(card.audio)
  const audioText = getAudioText(card, side).trim()

  if (!audioText) {
    return null
  }

  const contentHash = hashText(`${audioText}:${voiceName}:${locale}`)
  const storagePath = `${card.user_id}/decks/${card.deck_id}/cards/${card.id}/${side}-${contentHash}.mp3`

  return {
    audioText,
    locale,
    voiceName,
    contentHash,
    storagePath,
  }
}

export async function ensureCardAudioGenerated(
  admin: SupabaseClient<Database>,
  card: CardRow,
  side: 'prompt' | 'answer',
  options: { logActivity?: boolean } = {},
) {
  if (!textToSpeech) {
    throw new Error('Google Text-to-Speech environment is not configured.')
  }

  const variant = buildCardAudioVariant(card, side)
  if (!variant) {
    throw new Error('This card does not have text to synthesize.')
  }

  const existingVariant = getAudioVariant(card.audio, side)
  if (existingVariant?.storagePath && existingVariant.textHash === variant.contentHash) {
    return {
      storagePath: existingVariant.storagePath,
      reused: true,
      contentHash: variant.contentHash,
    }
  }

  const [response] = await textToSpeech.synthesizeSpeech({
    input: { text: variant.audioText },
    voice: {
      languageCode: variant.locale,
      name: variant.voiceName,
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 0.98,
    },
  })

  if (!response.audioContent) {
    throw new Error('Google Text-to-Speech returned no audio.')
  }

  const bytes = Buffer.isBuffer(response.audioContent)
    ? response.audioContent
    : Buffer.from(response.audioContent as Uint8Array)

  const { error: uploadError } = await admin.storage
    .from(audioBucket)
    .upload(variant.storagePath, bytes, {
      upsert: true,
      contentType: 'audio/mpeg',
    })

  if (uploadError) {
    throw new Error(uploadError.message)
  }

  const nextAudio = {
    ...((card.audio ?? {}) as Record<string, unknown>),
    locale: variant.locale,
    voiceName: variant.voiceName,
    [side]: {
      status: 'ready',
      storagePath: variant.storagePath,
      textHash: variant.contentHash,
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
    .eq('user_id', card.user_id)
    .eq('deck_id', card.deck_id)
    .eq('id', card.id)

  if (updateError) {
    throw new Error(updateError.message)
  }

  // The storage path is content-addressed, so regenerated text leaves the old
  // file orphaned unless it is removed here. Best-effort: a failed removal
  // should not fail the generation.
  if (existingVariant?.storagePath && existingVariant.storagePath !== variant.storagePath) {
    await admin.storage
      .from(audioBucket)
      .remove([existingVariant.storagePath])
      .catch(() => undefined)
  }

  if (options.logActivity) {
    await admin.schema('memocards').from('activity').insert({
      user_id: card.user_id,
      type: 'audio_generated',
      title: 'Audio generated',
      description: `${side} audio generated for a study card`,
      deck_id: card.deck_id,
      card_id: card.id,
      created_at: nowIso(),
    })
  }

  return {
    storagePath: variant.storagePath,
    reused: false,
    contentHash: variant.contentHash,
  }
}

export async function createSignedCardAudioUrl(
  admin: SupabaseClient<Database>,
  storagePath: string,
  ttlSeconds = 60 * 60,
) {
  const { data: signedUrl, error: signError } = await admin.storage
    .from(audioBucket)
    .createSignedUrl(storagePath, ttlSeconds)

  if (signError || !signedUrl?.signedUrl) {
    throw new Error(signError?.message ?? 'Unable to sign generated audio.')
  }

  return signedUrl.signedUrl
}
