import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin'
import { createSupabaseServerClient } from '../../../../lib/supabase/server'
import { createSignedCardAudioUrl, ensureCardAudioGenerated } from '../../../../lib/cardAudioGeneration'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
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

  try {
    const result = await ensureCardAudioGenerated(admin, card, body.side, { logActivity: true })
    const signedUrl = await createSignedCardAudioUrl(admin, result.storagePath)

    return NextResponse.json({
      signedUrl,
      storagePath: result.storagePath,
    })
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : 'Unable to generate audio.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
