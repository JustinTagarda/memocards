'use client'

import { Brain, CloudUpload, Lock, Sparkles, Volume2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { isEmbeddedBrowser } from '../lib/embeddedBrowser'
import { hasSupabaseEnvironment } from '../lib/env'
import { useAuth } from '../hooks/useAuth'

const features = [
  {
    icon: Brain,
    title: 'Smart review',
    body: 'MemoCards keeps track of what is due, what is new, and what needs more practice.',
  },
  {
    icon: Lock,
    title: 'Private space',
    body: 'Your decks stay in your own study space, so your cards and notes feel personal.',
  },
  {
    icon: Volume2,
    title: 'Listen to cards',
    body: 'Play prompts and answers out loud when reading feels slow or you want to study hands-free.',
  },
  {
    icon: Sparkles,
    title: 'Long-answer help',
    body: 'Store model answers, keywords, and notes for cards that need more than one-word replies.',
  },
  {
    icon: CloudUpload,
    title: 'Bring your old decks',
    body: 'Import card sets from files, then export them again whenever you need a copy.',
  },
]

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
            <small>Private study space</small>
          </span>
        </Link>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">Study cards, made simple</p>
          <h1>Study cards that feel calm, personal, and easy to keep up with.</h1>
          <p className="landing-summary">
            Build decks, sort them by subject, and review on your phone without losing track of what to
            study next.
          </p>

          {!hasSupabaseEnvironment && (
            <div className="warning-banner">
              Some setup details are missing. Add them from `.env.example` before using connected
              services.
            </div>
          )}

          {embeddedBrowser && (
            <div className="warning-banner">
              Google sign-in is blocked inside in-app browsers like Messenger. Open MemoCards in
              Safari or Chrome first, then sign in there.
            </div>
          )}

          {error && <div className="warning-banner">{error}</div>}

          <div className="hero-actions">
            <button
              className="primary-button primary-button--google"
              disabled={loading || !hasSupabaseEnvironment || embeddedBrowser}
              type="button"
              onClick={() => void signIn()}
            >
              {!embeddedBrowser && (
                <span className="google-mark-badge">
                  <GoogleMark />
                </span>
              )}
              {embeddedBrowser
                ? 'Open in Safari or Chrome'
                : loading
                  ? 'Getting ready...'
                  : 'Continue with Google'}
            </button>
            {embeddedBrowser ? (
              <button className="ghost-button" type="button" onClick={() => void copySiteLink()}>
                {copiedLink ? 'Link copied' : 'Copy site link'}
              </button>
            ) : (
              <a className="ghost-button" href="#features">
                See how it works
              </a>
            )}
          </div>

          <div className="landing-notes">
            <span>Smart review</span>
            <span>Audio when you want it</span>
            <span>Private study space</span>
          </div>
        </div>

        <div className="landing-visual" aria-hidden="true">
          <div className="study-preview">
            <div className="study-preview__header">
              <span className="pill">Biology finals</span>
              <span className="muted-label">18 cards ready</span>
            </div>

            <div className="study-preview__body">
              <small>Quick review</small>
              <strong>What does the mitochondrion do?</strong>
              <p>Turns food into energy for the cell.</p>
            </div>

            <div className="study-preview__footer">
              <span className="status-pill">Play audio</span>
              <span className="status-pill">Review due</span>
            </div>
          </div>

          <div className="hero-preview">
            <div className="preview-card preview-card--accent">
              <span className="pill">Today</span>
              <strong>12 / 20 done</strong>
              <p>See your goal, recent sessions, and due cards in one place.</p>
            </div>
            <div className="preview-card">
              <span className="pill">This week</span>
              <strong>7 day streak</strong>
              <p>Pick up where you left off and keep your study habit moving.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="feature-section" id="features">
        <div className="feature-intro">
          <p className="eyebrow">Why MemoCards</p>
          <h2>Built for everyday studying</h2>
          <p>
            Keep cards tidy, review the right ones, and move between quick facts and longer answers
            without the app feeling busy.
          </p>
        </div>

        <div className="feature-grid">
          {features.map((feature) => {
            const Icon = feature.icon
            return (
              <article key={feature.title} className="feature-card">
                <Icon size={20} />
                <strong>{feature.title}</strong>
                <p>{feature.body}</p>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
