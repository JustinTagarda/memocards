import { redirect } from 'next/navigation'
import type { PropsWithChildren } from 'react'
import { AppShell } from '../../components/AppShell'
import { createSupabaseServerClient } from '../../lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function ProtectedLayout({ children }: PropsWithChildren) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/')
  }

  return <AppShell>{children}</AppShell>
}
