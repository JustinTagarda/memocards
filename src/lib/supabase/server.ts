import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { env, hasSupabaseEnvironment } from '../env'
import type { Database } from '../../types/database'

export async function createSupabaseServerClient() {
  if (!hasSupabaseEnvironment) {
    throw new Error('Supabase environment variables are missing.')
  }

  const cookieStore = await cookies()

  return createServerClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Server Components can't always write cookies; middleware refreshes the session.
        }
      },
    },
  })
}
