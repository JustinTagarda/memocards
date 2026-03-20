import { after, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin'
import { createSupabaseServerClient } from '../../../../lib/supabase/server'
import { ensureCardAudioGenerated } from '../../../../lib/cardAudioGeneration'
import { hasGoogleTtsEnvironment } from '../../../../lib/env'
import { nowIso } from '../../../../lib/utils'
import type { Database } from '../../../../types/database'

export const runtime = 'nodejs'
export const maxDuration = 60

const BATCH_SIZE = 10
const MAX_PROCESSING_MS = 45_000

type CardRow = Database['memocards']['Tables']['cards']['Row']
type AudioQueueRow = Database['memocards']['Tables']['audio_generation_queue']['Row']

async function markQueueJobFailed(admin: ReturnType<typeof createSupabaseAdminClient>, jobId: string, errorMessage: string) {
  await admin.schema('memocards').from('audio_generation_queue').update({
    status: 'failed',
    last_error: errorMessage,
    finished_at: nowIso(),
    updated_at: nowIso(),
  }).eq('id', jobId)
}

async function markQueueJobReady(admin: ReturnType<typeof createSupabaseAdminClient>, jobId: string) {
  await admin.schema('memocards').from('audio_generation_queue').update({
    status: 'ready',
    last_error: null,
    finished_at: nowIso(),
    updated_at: nowIso(),
  }).eq('id', jobId)
}

async function processAudioQueue(deckId?: string, userId?: string) {
  const admin = createSupabaseAdminClient()
  const startedAt = Date.now()

  while (Date.now() - startedAt < MAX_PROCESSING_MS) {
    const { data: jobs, error } = await admin.schema('memocards').rpc('claim_audio_generation_jobs', {
      limit_count: BATCH_SIZE,
      target_user_id: userId ?? null,
      target_deck_id: deckId ?? null,
    })

    if (error) {
      throw new Error(error.message)
    }

    const claimedJobs = (jobs ?? []) as AudioQueueRow[]
    if (claimedJobs.length === 0) {
      return
    }

    for (const job of claimedJobs) {
      const { data: card, error: cardError } = await admin
        .schema('memocards')
        .from('cards')
        .select('*')
        .eq('user_id', job.user_id)
        .eq('deck_id', job.deck_id)
        .eq('id', job.card_id)
        .single()

      if (cardError || !card) {
        await markQueueJobFailed(admin, job.id, cardError?.message ?? 'Card not found.')
        continue
      }

      try {
        await ensureCardAudioGenerated(admin, card as CardRow, job.side, { logActivity: true })
        await markQueueJobReady(admin, job.id)
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Unable to generate queued audio.'
        await markQueueJobFailed(admin, job.id, message)
      }
    }
  }
}

export async function POST(request: Request) {
  if (!hasGoogleTtsEnvironment) {
    return NextResponse.json({ error: 'Google Text-to-Speech environment is not configured.' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as { deckId?: string }
  const deckId = typeof body.deckId === 'string' && body.deckId.trim() ? body.deckId.trim() : undefined

  void after(async () => {
    try {
      await processAudioQueue(deckId, user.id)
    } catch {
      return
    }
  })

  return NextResponse.json({ accepted: true }, { status: 202 })
}
