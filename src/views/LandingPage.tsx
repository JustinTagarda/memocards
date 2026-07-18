'use client'

import { Camera, Repeat, Volume2, Zap } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { isLocalDevBypassEnabled } from '../lib/devBypass'
import { isEmbeddedBrowser } from '../lib/embeddedBrowser'
import { hasSupabaseEnvironment } from '../lib/env'
import { useAuth } from '../hooks/useAuth'

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="google-mark" viewBox="0 0 18 18">
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.96 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3-2.33Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.32 0 2.5.45 3.44 1.32l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3 2.33c.71-2.12 2.7-3.7 5.04-3.7Z"
        fill="#EA4335"
      />
    </svg>
  )
}

export function LandingPage() {
  const router = useRouter()
  const { user, signIn, loading, error } = useAuth()
  const [embeddedBrowser, setEmbeddedBrowser] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  useEffect(() => {
    if (user) {
      router.replace('/app')
    }
  }, [router, user])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    setEmbeddedBrowser(isEmbeddedBrowser(window.navigator.userAgent))
  }, [])

  async function copySiteLink() {
    if (typeof window === 'undefined' || !navigator.clipboard) {
      return
    }

    await navigator.clipboard.writeText(window.location.href)
    setCopiedLink(true)
    window.setTimeout(() => setCopiedLink(false), 2000)
  }

  return (
    <div className="landing-shell">
      <header className="landing-topbar">
        <Link className="brand-link landing-brand" href="/">
          <span className="brand-mark">MC</span>
          <span>
            <strong>MemoCards</strong>
          </span>
        </Link>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <h1>Study with cards that strengthen your memory and thinking skills.</h1>
          <p className="landing-summary">Build decks, paste cards quickly, and review anywhere.</p>

          {!hasSupabaseEnvironment && !isLocalDevBypassEnabled && (
            <div className="warning-banner">
              Some setup details are missing. Add them from `.env.example` before using connected
              services.
            </div>
          )}

          {embeddedBrowser && !isLocalDevBypassEnabled && (
            <div className="warning-banner">
              Google sign-in is blocked inside in-app browsers like Messenger. Open MemoCards in
              Safari or Chrome first, then sign in there.
            </div>
          )}

          {isLocalDevBypassEnabled && (
            <div className="warning-banner">
              Local dev bypass is enabled. This session uses sample data instead of Google sign-in.
            </div>
          )}

          {error && <div className="warning-banner">{error}</div>}

          <div className="hero-actions">
            <button
              className="primary-button primary-button--google"
              disabled={loading || (!hasSupabaseEnvironment && !isLocalDevBypassEnabled) || (embeddedBrowser && !isLocalDevBypassEnabled)}
              type="button"
              onClick={() => void signIn()}
            >
              {!embeddedBrowser && !isLocalDevBypassEnabled && (
                <span className="google-mark-badge">
                  <GoogleMark />
                </span>
              )}
              {isLocalDevBypassEnabled
                ? 'Continue locally'
                : embeddedBrowser
                ? 'Open in Safari or Chrome'
                : loading
                  ? 'Getting ready...'
                  : 'Continue with Google'}
            </button>
            {embeddedBrowser && !isLocalDevBypassEnabled && (
              <button className="ghost-button" type="button" onClick={() => void copySiteLink()}>
                {copiedLink ? 'Link copied' : 'Copy site link'}
              </button>
            )}
          </div>
        </div>

        <div className="landing-features">
          <article className="landing-feature">
            <span className="landing-feature__icon">
              <Repeat size={18} />
            </span>
            <strong>Spaced repetition</strong>
            <p>Cards come back right before you forget them, so every review counts.</p>
          </article>
          <article className="landing-feature">
            <span className="landing-feature__icon">
              <Zap size={18} />
            </span>
            <strong>Fast card entry</strong>
            <p>Quick Add syntax and paste-many turn notes into decks in seconds.</p>
          </article>
          <article className="landing-feature">
            <span className="landing-feature__icon">
              <Camera size={18} />
            </span>
            <strong>Photos to cards</strong>
            <p>Snap a lesson page and let OCR and AI draft the questions for you.</p>
          </article>
          <article className="landing-feature">
            <span className="landing-feature__icon">
              <Volume2 size={18} />
            </span>
            <strong>Listen while you study</strong>
            <p>Generated audio reads prompts and answers aloud during reviews.</p>
          </article>
        </div>
      </section>
    </div>
  )
}
