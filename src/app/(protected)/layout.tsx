import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import type { PropsWithChildren } from 'react'
import { AppShell } from '../../components/AppShell'
import { LOCAL_DEV_BYPASS_COOKIE, isLocalDevBypassEnabled } from '../../lib/devBypass'
import { createSupabaseServerClient } from '../../lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function ProtectedLayout({ children }: PropsWithChildren) {
  const cookieStore = await cookies()

  if (isLocalDevBypassEnabled) {
    if (cookieStore.get(LOCAL_DEV_BYPASS_COOKIE)?.value === '1') {
      return <AppShell>{children}</AppShell>
    }
    redirect('/')
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/')
  }

  return <AppShell>{children}</AppShell>
}
