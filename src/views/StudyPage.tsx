'use client'

import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { StudySessionView } from '../components/StudySessionView'
import { useAuth } from '../hooks/useAuth'
import { useCards, useDeck } from '../hooks/useMemoCards'
import { getCardAudioText } from '../lib/cardText'
import { hashText } from '../lib/utils'
import { queueAnswerEvaluation, recordStudySession, requestCardAudio, reviewCard } from '../services/memocards'
import type { Card, SelfAssessment, SessionCardResult, StudyMode } from '../types/models'

export function StudyPage() {
  const params = useParams<{ deckId: string }>()
  const deckId = typeof params.deckId === 'string' ? params.deckId : undefined
  const { user } = useAuth()
  const { data: deck, loading: deckLoading } = useDeck(user?.id, deckId)
  const { data: cards, loading: cardsLoading } = useCards(user?.id, deckId)
  const [audioMessage, setAudioMessage] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrls = useRef(new Map<string, string>())

  useEffect(() => {
    audioRef.current = new Audio()
    return () => {
      audioRef.current?.pause()
      for (const url of objectUrls.current.values()) {
        URL.revokeObjectURL(url)
      }
      objectUrls.current.clear()
    }
  }, [])

  if (!user || !deckId) {
    return null
  }

  if (deckLoading || cardsLoading || !deck) {
    return <div className="empty-panel">Loading study session...</div>
  }

  const activeDeck = deck

  async function playAudio(card: Card, side: 'prompt' | 'answer') {
    setAudioMessage(null)
    try {
      const contentHash = hashText(`${getCardAudioText(card, side)}:${card.audio.voiceName}:${card.audio.locale}`)
      const cachedKey = `${card.id}:${side}:${contentHash}`
      let objectUrl = objectUrls.current.get(cachedKey)

      if (!objectUrl) {
        const response = await requestCardAudio(activeDeck.id, card.id, side)
        objectUrl = response.signedUrl
        objectUrls.current.set(cachedKey, objectUrl)
      }

      if (!audioRef.current) {
        audioRef.current = new Audio()
      }
      audioRef.current.src = objectUrl
      await audioRef.current.play()
    } catch (reason) {
      setAudioMessage(reason instanceof Error ? reason.message : 'Unable to play audio right now.')
    }
  }

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
        cards={cards}
        deck={activeDeck}
        onComplete={async (mode: StudyMode, startedAt: string, results: SessionCardResult[]) => {
          if (results.length === 0) {
            return
          }
          await recordStudySession(user.id, activeDeck, mode, startedAt, results)
        }}
        onPlayAudio={playAudio}
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
