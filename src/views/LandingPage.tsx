'use client'

import { Brain, CloudUpload, Lock, Sparkles, Volume2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
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

  useEffect(() => {
    if (user) {
      router.replace('/app')
    }
  }, [router, user])

  return (
    <div className="landing-shell">
      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">MemoCards</p>
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

          {error && <div className="warning-banner">{error}</div>}

          <div className="hero-actions">
            <button
              className="primary-button"
              disabled={loading || !hasSupabaseEnvironment}
              type="button"
              onClick={() => void signIn()}
            >
              {loading ? 'Getting ready...' : 'Start with Google'}
            </button>
            <a className="ghost-button" href="#features">
              See how it works
            </a>
          </div>
        </div>

        <div className="hero-preview" aria-hidden="true">
          <div className="preview-card">
            <span className="pill">Biology finals</span>
            <strong>18 cards ready</strong>
            <p>Pick up where you left off, hear the card out loud, and keep your streak moving.</p>
          </div>
          <div className="preview-card preview-card--accent">
            <span className="pill">Today</span>
            <strong>12 / 20 done</strong>
            <p>See your goal, recent sessions, and due work in one study home.</p>
          </div>
        </div>
      </section>

      <section className="feature-grid" id="features">
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
      </section>
    </div>
  )
}
