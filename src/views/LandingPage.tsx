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
              className="primary-button"
              disabled={loading || !hasSupabaseEnvironment || embeddedBrowser}
              type="button"
              onClick={() => void signIn()}
            >
              {embeddedBrowser
                ? 'Open in Safari or Chrome'
                : loading
                  ? 'Getting ready...'
                  : 'Start with Google'}
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
