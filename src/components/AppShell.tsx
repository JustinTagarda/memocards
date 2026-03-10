'use client'

import { Home, LogOut } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { PropsWithChildren } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useUserProfile } from '../hooks/useMemoCards'

export function AppShell({ children }: PropsWithChildren) {
  const { user, signOutUser } = useAuth()
  const { data: profile } = useUserProfile(user?.id)
  const pathname = usePathname()

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <Link className="brand-link" href="/app">
          <span className="brand-mark">MC</span>
          <span>
            <strong>MemoCards</strong>
            <small>Private study workspace</small>
          </span>
        </Link>

        <nav className="topbar-nav" aria-label="Primary">
          <Link className={pathname === '/app' ? 'nav-link nav-link--active' : 'nav-link'} href="/app">
            <Home size={16} />
            Dashboard
          </Link>
        </nav>

        <div className="topbar-user">
          <div className="topbar-summary">
            <strong>{profile?.summary.studyStreak ?? 0} day streak</strong>
            <small>{profile?.summary.dueToday ?? 0} due today</small>
          </div>
          <div className="avatar-shell" aria-hidden="true">
            {profile?.photoURL ? <img alt="" src={profile.photoURL} /> : <span>{profile?.displayName?.[0] ?? 'S'}</span>}
          </div>
          <button className="ghost-button" type="button" onClick={() => void signOutUser()}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </header>

      <main className="app-main">
        {children}
      </main>
    </div>
  )
}
