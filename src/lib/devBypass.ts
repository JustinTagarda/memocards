import type { User } from '@supabase/supabase-js'

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])
const LOCAL_DEV_BYPASS_FLAG =
  ((process.env as { NEXT_PUBLIC_LOCAL_DEV_BYPASS?: string }).NEXT_PUBLIC_LOCAL_DEV_BYPASS ?? '').toLowerCase() ===
  'true'
const LOCAL_DEV_SITE_URL =
  (process.env as { NEXT_PUBLIC_SITE_URL?: string }).NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

function getSiteHostname() {
  try {
    return new URL(LOCAL_DEV_SITE_URL).hostname
  } catch {
    return ''
  }
}

export const LOCAL_DEV_BYPASS_USER_ID = '11111111-1111-4111-8111-111111111111'
export const LOCAL_DEV_BYPASS_COOKIE = 'memocards-dev-bypass'
export const isLocalDevBypassEnabled =
  process.env.NODE_ENV !== 'production' &&
  LOCAL_DEV_BYPASS_FLAG &&
  LOCAL_DEV_HOSTS.has(getSiteHostname())

export function isLocalDevBypassUserId(uid: string | null | undefined) {
  return isLocalDevBypassEnabled && uid === LOCAL_DEV_BYPASS_USER_ID
}

export function hasLocalDevBypassSession(cookieHeader?: string) {
  if (!isLocalDevBypassEnabled) {
    return false
  }

  const source =
    cookieHeader ??
    (typeof document !== 'undefined' ? document.cookie : '')

  return source
    .split(';')
    .map((part) => part.trim())
    .some((part) => part === `${LOCAL_DEV_BYPASS_COOKIE}=1`)
}

export const LOCAL_DEV_BYPASS_USER = {
  id: LOCAL_DEV_BYPASS_USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'dev@local.memocards',
  email_confirmed_at: '2026-03-14T00:00:00.000Z',
  phone: '',
  confirmed_at: '2026-03-14T00:00:00.000Z',
  last_sign_in_at: '2026-03-14T00:00:00.000Z',
  app_metadata: { provider: 'local-dev-bypass', providers: ['local-dev-bypass'] },
  user_metadata: {
    name: 'Justiniano Tagarda',
    full_name: 'Justiniano Tagarda',
  },
  identities: [],
  factors: [],
  created_at: '2026-03-14T00:00:00.000Z',
  updated_at: '2026-03-14T00:00:00.000Z',
  is_anonymous: false,
} as User
