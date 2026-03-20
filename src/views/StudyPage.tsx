'use client'

import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { StudySessionView } from '../components/StudySessionView'
import { useAuth } from '../hooks/useAuth'
import { useAutoPlayAudioPreference, useCards, useDeck } from '../hooks/useMemoCards'
import {
  buildCachedAudioKey,
  queueAnswerEvaluation,
  recordStudySession,
  requestAudioQueueProcessing,
  requestCardAudio,
  reviewCard,
} from '../services/memocards'
import type { Card, SelfAssessment, SessionCardResult, StudyMode } from '../types/models'

export function StudyPage() {
  const params = useParams<{ deckId: string }>()
  const deckId = typeof params.deckId === 'string' ? params.deckId : undefined
  const { user } = useAuth()
  const { data: deck, loading: deckLoading } = useDeck(user?.id, deckId)
  const { data: cards, loading: cardsLoading } = useCards(user?.id, deckId)
  const {
    autoPlayAudio,
    loading: autoPlayAudioLoading,
    saving: autoPlayAudioSaving,
    setAutoPlayAudio,
  } = useAutoPlayAudioPreference(user?.id)
  const [audioMessage, setAudioMessage] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrls = useRef(new Map<string, string>())
  const pendingAudio = useRef(new Map<string, Promise<string>>())

  const clearAudioCache = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current?.removeAttribute('src')
    audioRef.current?.load()
    for (const url of objectUrls.current.values()) {
      URL.revokeObjectURL(url)
    }
    objectUrls.current.clear()
    pendingAudio.current.clear()
  }, [])

  useEffect(() => {
    audioRef.current = new Audio()
    audioRef.current.preload = 'auto'
    return () => {
      clearAudioCache()
    }
  }, [clearAudioCache])

  useEffect(() => {
    const handleUnload = () => {
      clearAudioCache()
    }

    window.addEventListener('beforeunload', handleUnload)
    window.addEventListener('pagehide', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      window.removeEventListener('pagehide', handleUnload)
      clearAudioCache()
    }
  }, [clearAudioCache])

  const ensureAudioReady = useCallback(
    async (card: Card, side: 'prompt' | 'answer') => {
      if (!deckId) {
        throw new Error('Missing deck identifier.')
      }

      const cachedKey = `${card.id}:${buildCachedAudioKey(card, side)}`
      const existingUrl = objectUrls.current.get(cachedKey)
      if (existingUrl) {
        return existingUrl
      }

      const inFlight = pendingAudio.current.get(cachedKey)
      if (inFlight) {
        return inFlight
      }

      const nextRequest = (async () => {
        const response = await requestCardAudio(deckId, card.id, side)
        const audioResponse = await fetch(response.signedUrl)
        if (!audioResponse.ok) {
          throw new Error('Unable to load audio right now.')
        }

        const audioBlob = await audioResponse.blob()
        const objectUrl = URL.createObjectURL(audioBlob)
        objectUrls.current.set(cachedKey, objectUrl)
        return objectUrl
      })()

      pendingAudio.current.set(cachedKey, nextRequest)

      try {
        return await nextRequest
      } finally {
        pendingAudio.current.delete(cachedKey)
      }
    },
    [deckId],
  )

  const warmAudio = useCallback(
    async (card: Card, side: 'prompt' | 'answer') => {
      try {
        await ensureAudioReady(card, side)
      } catch {
        return
      }
    },
    [ensureAudioReady],
  )

  const playAudio = useCallback(
    async (card: Card, side: 'prompt' | 'answer') => {
      setAudioMessage(null)
      try {
        const objectUrl = await ensureAudioReady(card, side)

        if (!audioRef.current) {
          audioRef.current = new Audio()
          audioRef.current.preload = 'auto'
        }

        audioRef.current.src = objectUrl
        await audioRef.current.play()
      } catch (reason) {
        setAudioMessage(reason instanceof Error ? reason.message : 'Unable to play audio right now.')
      }
    },
    [ensureAudioReady],
  )

  useEffect(() => {
    if (!deck?.id || cards.length === 0) {
      return undefined
    }

    void requestAudioQueueProcessing(deck.id)

    const audioTargets = cards.flatMap((card) => [
      { card, side: 'prompt' as const },
      { card, side: 'answer' as const },
    ])
    const isSmallDeck = cards.length <= 20

    if (isSmallDeck) {
      for (const target of audioTargets) {
        void warmAudio(target.card, target.side)
      }
      return undefined
    }

    const queue = [...audioTargets]
    let cancelled = false
    const concurrency = 4

    async function worker() {
      while (!cancelled && queue.length > 0) {
        const next = queue.shift()
        if (!next) {
          break
        }

        await warmAudio(next.card, next.side)
      }
    }

    void Promise.all(Array.from({ length: concurrency }, () => worker()))
    return () => {
      cancelled = true
    }
  }, [cards, deck?.id, warmAudio])

  if (!user || !deckId) {
    return null
  }

  if (!deck || (deckLoading && !deck) || (cardsLoading && cards.length === 0)) {
    return <div className="empty-panel">Loading study cards...</div>
  }

  const activeDeck = deck

  return (
    <div className="page-stack">
      <div className="page-breadcrumb">
        <Link className="ghost-button" href={`/app/decks/${deck.id}`}>
          <ArrowLeft size={16} />
          Back to deck
        </Link>
      </div>

      {audioMessage && <div className="warning-banner">{audioMessage}</div>}

      <StudySessionView
        autoPlayAudio={autoPlayAudio}
        autoPlayAudioDisabled={autoPlayAudioLoading || autoPlayAudioSaving}
        cards={cards}
        deck={activeDeck}
        onComplete={async (mode: StudyMode, startedAt: string, results: SessionCardResult[]) => {
          if (results.length === 0) {
            return
          }
          await recordStudySession(user.id, activeDeck, mode, startedAt, results)
        }}
        onAutoPlayAudioChange={async (enabled: boolean) => {
          setAudioMessage(null)
          try {
            await setAutoPlayAudio(enabled)
          } catch (reason) {
            setAudioMessage(
              reason instanceof Error ? reason.message : 'Unable to update the audio preference right now.',
            )
          }
        }}
        onPlayAudio={playAudio}
        onWarmAudio={warmAudio}
        onQueueEvaluation={async (card: Card, submittedAnswer: string) =>
          queueAnswerEvaluation(activeDeck.id, card, submittedAnswer)
        }
        onReview={async (card: Card, assessment: SelfAssessment, mode: StudyMode, responseText: string) => {
          await reviewCard(user.id, activeDeck.id, card, assessment, mode, responseText)
        }}
      />
    </div>
  )
}
