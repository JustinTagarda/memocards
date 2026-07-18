import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '../../../lib/supabase/server'

function sanitizeNextPath(next: string | null) {
  // Only allow same-origin relative paths; anything else (absolute URLs,
  // protocol-relative //host, backslash tricks) falls back to /app.
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return '/app'
  }
  return next
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = sanitizeNextPath(requestUrl.searchParams.get('next'))

  if (!code) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(new URL('/?auth_error=1', request.url))
  }

  return NextResponse.redirect(new URL(next, request.url))
}
