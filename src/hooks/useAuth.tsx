'use client'

import type { User } from '@supabase/supabase-js'
import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react'
import {
  hasLocalDevBypassSession,
  isLocalDevBypassEnabled,
  LOCAL_DEV_BYPASS_COOKIE,
  LOCAL_DEV_BYPASS_USER,
} from '../lib/devBypass'
import { env, hasSupabaseEnvironment } from '../lib/env'
import { getSupabaseBrowserClient } from '../lib/supabase/browser'
import { ensureUserProfile } from '../services/memocards'

interface AuthContextValue {
  user: User | null
  loading: boolean
  error: string | null
  signIn: () => Promise<void>
  signOutUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function isIgnorableAuthError(message: string) {
  return message === 'Auth session missing!'
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isLocalDevBypassEnabled) {
      setUser(hasLocalDevBypassSession() ? LOCAL_DEV_BYPASS_USER : null)
      setLoading(false)
      return
    }

    if (!hasSupabaseEnvironment) {
      setLoading(false)
      return
    }

    let mounted = true
    const client = getSupabaseBrowserClient()

    void client.auth.getUser().then(async ({ data, error: authError }) => {
      if (!mounted) {
        return
      }

      if (authError && !isIgnorableAuthError(authError.message)) {
        setError(authError.message)
      }

      setUser(data.user ?? null)
      setLoading(false)

      if (data.user) {
        try {
          await ensureUserProfile(data.user)
        } catch (reason) {
          if (mounted) {
            setError(reason instanceof Error ? reason.message : 'Unable to initialize your account.')
          }
        }
      }
    })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      startTransition(() => {
        setUser(session?.user ?? null)
        setLoading(false)
      })

      if (session?.user) {
        void ensureUserProfile(session.user).catch((reason: unknown) => {
          if (mounted) {
            setError(reason instanceof Error ? reason.message : 'Unable to initialize your account.')
          }
        })
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const value: AuthContextValue = {
    user,
    loading,
    error,
    async signIn() {
      if (isLocalDevBypassEnabled) {
        document.cookie = `${LOCAL_DEV_BYPASS_COOKIE}=1; Path=/; SameSite=Lax`
        setUser(LOCAL_DEV_BYPASS_USER)
        setLoading(false)
        window.location.assign('/app')
        return
      }

      if (!hasSupabaseEnvironment) {
        setError('Supabase environment variables are missing.')
        return
      }

      setError(null)
      const redirectTo = `${env.siteUrl}/auth/callback?next=/app`
      const { error: authError } = await getSupabaseBrowserClient().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          },
        },
      })

      if (authError) {
        setError(authError.message)
      }
    },
    async signOutUser() {
      if (isLocalDevBypassEnabled) {
        document.cookie = `${LOCAL_DEV_BYPASS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
        setUser(null)
        setError(null)
        window.location.assign('/')
        return
      }

      if (!hasSupabaseEnvironment) {
        window.location.assign('/')
        return
      }

      setError(null)
      const { error: authError } = await getSupabaseBrowserClient().auth.signOut()
      if (authError) {
        setError(authError.message)
        return
      }
      window.location.assign('/')
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.')
  }
  return context
}
