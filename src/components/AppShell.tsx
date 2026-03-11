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
  const streak = profile?.summary.studyStreak ?? 0
  const dueToday = profile?.summary.dueToday ?? 0

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-topbar__brand">
          <Link className="brand-link" href="/app">
            <span className="brand-mark">MC</span>
            <span>
              <strong>MemoCards</strong>
              <small>Private study space</small>
            </span>
          </Link>
        </div>

        <nav className="topbar-nav" aria-label="Primary">
          <Link
            aria-current={pathname === '/app' ? 'page' : undefined}
            className={pathname === '/app' ? 'nav-link nav-link--active' : 'nav-link'}
            href="/app"
          >
            <Home size={16} />
            Home
          </Link>
        </nav>

        <div className="app-topbar__meta">
          <div className="topbar-status" aria-label="Study summary">
            <span className="status-pill status-pill--warm">{streak} day streak</span>
            <span className="status-pill">{dueToday} due today</span>
          </div>

          <div className="topbar-user">
            <div className="avatar-shell" aria-hidden="true">
              {profile?.photoURL ? <img alt="" src={profile.photoURL} /> : <span>{profile?.displayName?.[0] ?? 'S'}</span>}
            </div>
            <button className="ghost-button" type="button" onClick={() => void signOutUser()}>
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        {children}
      </main>
    </div>
  )
}
