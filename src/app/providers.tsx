'use client'

import type { PropsWithChildren } from 'react'
import { AuthProvider } from '../hooks/useAuth'

export function Providers({ children }: PropsWithChildren) {
  return <AuthProvider>{children}</AuthProvider>
}
