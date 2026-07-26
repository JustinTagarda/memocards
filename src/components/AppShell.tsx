'use client'

import { ArrowLeft, Home, LoaderCircle, LogOut } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type PropsWithChildren } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useUserProfile } from '../hooks/useMemoCards'

export function AppShell({ children }: PropsWithChildren) {
  const { user, signOutUser } = useAuth()
  const { data: profile, loading: profileLoading } = useUserProfile(user?.id)
  const pathname = usePathname()
  const router = useRouter()
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement | null>(null)
  const streak = profile?.summary.studyStreak ?? 0
  const dueToday = profile?.summary.dueToday ?? 0
  const topbarSummary = `${dueToday} due today${streak > 0 ? ` · ${streak}-day streak` : ''}`
  const isHome = pathname === '/app'
  const controlsClassName = isHome ? 'app-topbar__controls app-topbar__controls--home' : 'app-topbar__controls'
  const avatarInitial = (() => {
    const displayName =
      profile?.displayName ??
      (typeof user?.user_metadata?.['full_name'] === 'string' ? user.user_metadata['full_name'] : null) ??
      (typeof user?.user_metadata?.['name'] === 'string' ? user.user_metadata['name'] : null) ??
      ''
    const parts = displayName.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
      return 'S'
    }
    if (parts.length === 1) {
      return parts[0]?.charAt(0).toUpperCase() ?? 'S'
    }
    return `${parts[0]?.charAt(0) ?? ''}${parts[parts.length - 1]?.charAt(0) ?? ''}`.toUpperCase()
  })()

  useEffect(() => {
    setAvatarFailed(false)
  }, [profile?.photoURL])

  useEffect(() => {
    setIsUserMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!isUserMenuOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setIsUserMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsUserMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isUserMenuOpen])

  return (
    <div className="app-shell">
      {isHome ? (
        <header className="app-topbar">
          <div className="app-topbar__brand">
            <Link className="brand-link" href="/app">
              <span className="brand-mark">MC</span>
              <span className="brand-copy">
                <strong>MemoCards</strong>
              </span>
            </Link>
          </div>

          <div className={controlsClassName}>
            <div className="app-topbar__meta">
              <small className="topbar-summary">{topbarSummary}</small>

              <div className="topbar-user topbar-user--menu" ref={userMenuRef}>
                <button
                  aria-expanded={isUserMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Open account menu"
                  className="avatar-shell avatar-shell--button"
                  type="button"
                  onClick={() => setIsUserMenuOpen((current) => !current)}
                >
                  {profileLoading ? (
                    <LoaderCircle className="avatar-spinner" size={15} />
                  ) : profile?.photoURL && !avatarFailed ? (
                    <img alt="" src={profile.photoURL} onError={() => setAvatarFailed(true)} />
                  ) : (
                    <span>{avatarInitial}</span>
                  )}
                </button>

                {isUserMenuOpen ? (
                  <div aria-label="Account menu" className="topbar-menu" role="menu">
                    <button
                      className="topbar-menu__item"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false)
                        void signOutUser()
                      }}
                    >
                      <LogOut size={16} />
                      <span>Log out</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>
      ) : (
        <div className="app-topbar-row app-topbar-row--subpage">
          <button
            aria-label="Go back"
            className="topbar-back-button ghost-button"
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined' && window.history.length > 1) {
                router.back()
                return
              }
              router.push('/app')
            }}
          >
            <ArrowLeft size={18} />
          </button>

          <header className="app-topbar app-topbar--subpage">
            <div className="app-topbar__brand">
              <Link className="brand-link" href="/app">
                <span className="brand-mark">MC</span>
                <span className="brand-copy">
                  <strong>MemoCards</strong>
                </span>
              </Link>
            </div>

            <div className={controlsClassName}>
              <nav className="topbar-nav" aria-label="Primary">
                <Link aria-label="Home" className="nav-link" href="/app">
                  <Home size={16} />
                  <span className="topbar-button__label">Home</span>
                </Link>
              </nav>

              <div className="app-topbar__meta">
                <small className="topbar-summary">{topbarSummary}</small>

                <div className="topbar-user topbar-user--menu" ref={userMenuRef}>
                  <button
                    aria-expanded={isUserMenuOpen}
                    aria-haspopup="menu"
                    aria-label="Open account menu"
                    className="avatar-shell avatar-shell--button"
                    type="button"
                    onClick={() => setIsUserMenuOpen((current) => !current)}
                  >
                    {profileLoading ? (
                      <LoaderCircle className="avatar-spinner" size={15} />
                    ) : profile?.photoURL && !avatarFailed ? (
                      <img alt="" src={profile.photoURL} onError={() => setAvatarFailed(true)} />
                    ) : (
                      <span>{avatarInitial}</span>
                    )}
                  </button>

                  {isUserMenuOpen ? (
                    <div aria-label="Account menu" className="topbar-menu" role="menu">
                      <button
                        className="topbar-menu__item"
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false)
                          void signOutUser()
                        }}
                      >
                        <LogOut size={16} />
                        <span>Log out</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </header>
        </div>
      )}

      <main className="app-main">
        {children}
      </main>
    </div>
  )
}
