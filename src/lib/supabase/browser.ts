import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { env, hasSupabaseEnvironment } from '../env'
import type { Database } from '../../types/database'

let browserClient: SupabaseClient<Database> | undefined

export function getSupabaseBrowserClient() {
  if (!hasSupabaseEnvironment) {
    throw new Error('Supabase environment variables are missing.')
  }

  if (!browserClient) {
    browserClient = createBrowserClient<Database>(env.supabaseUrl, env.supabasePublishableKey)
  }
  return browserClient
}
