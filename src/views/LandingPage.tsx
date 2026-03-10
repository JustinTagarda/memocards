'use client'

import { Brain, CloudUpload, Lock, Sparkles, Volume2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { hasSupabaseEnvironment } from '../lib/env'
import { useAuth } from '../hooks/useAuth'

const features = [
  {
    icon: Brain,
    title: 'Spaced repetition',
    body: 'Review queues, due dates, streaks, and mastery tracking are built into every deck.',
  },
  {
    icon: Lock,
    title: 'Private by default',
    body: 'MemoCards lives in its own Supabase schema with row-level security tied to your account.',
  },
  {
    icon: Volume2,
    title: 'Audio playback',
    body: 'Use Google Text-to-Speech for card prompts and answers without exposing privileged APIs.',
  },
  {
    icon: Sparkles,
    title: 'AI-ready schema',
    body: 'Explanation cards already store rubrics and expected concepts for future answer grading.',
  },
  {
    icon: CloudUpload,
    title: 'Import and export',
    body: 'Bring in JSON or CSV decks, then export them again without weakening user isolation.',
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
          <h1>Private flashcards with spaced repetition, TTS, and room to grow.</h1>
          <p className="landing-summary">
            Build study decks, organize them into folders, review on mobile, and keep every card under
            your own private workspace.
          </p>

          {!hasSupabaseEnvironment && (
            <div className="warning-banner">
              Supabase environment variables are missing. Add them from `.env.example` before using
              production services.
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
              {loading ? 'Preparing...' : 'Continue with Google'}
            </button>
            <a className="ghost-button" href="#features">
              View features
            </a>
          </div>
        </div>

        <div className="hero-preview" aria-hidden="true">
          <div className="preview-card">
            <span className="pill">Biology finals</span>
            <strong>18 due now</strong>
            <p>Review, cram, or learn with audio playback and explanation grading hooks.</p>
          </div>
          <div className="preview-card preview-card--accent">
            <span className="pill">Streak</span>
            <strong>7 days</strong>
            <p>Daily goal progress, recent activity, and session history stay synced in Supabase.</p>
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
