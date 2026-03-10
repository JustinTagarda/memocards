'use client'

import { useEffect, useEffectEvent, useState } from 'react'
import type {
  ActivityLog,
  Card,
  Deck,
  Folder,
  StudySession,
  UserProfile,
} from '../types/models'
import {
  fetchCards,
  fetchDeck,
  fetchDecks,
  fetchFolders,
  fetchRecentActivity,
  fetchRecentSessions,
  fetchUserProfile,
  subscribeToDataChanged,
} from '../services/memocards'

interface ResourceState<T> {
  data: T
  loading: boolean
}

const EMPTY_FOLDERS: Folder[] = []
const EMPTY_DECKS: Deck[] = []
const EMPTY_CARDS: Card[] = []
const EMPTY_ACTIVITY: ActivityLog[] = []
const EMPTY_SESSIONS: StudySession[] = []

function useResource<T>(
  resourceKey: string | null,
  initialValue: T,
  load: () => Promise<T>,
): ResourceState<T> {
  const [data, setData] = useState<T>(initialValue)
  const [loading, setLoading] = useState(Boolean(resourceKey))
  const runLoad = useEffectEvent(load)

  useEffect(() => {
    let active = true

    if (!resourceKey) {
      setData(initialValue)
      setLoading(false)
      return
    }

    async function run() {
      setLoading(true)
      try {
        const nextValue = await runLoad()
        if (!active) {
          return
        }
        setData(nextValue)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void run()
    const unsubscribe = subscribeToDataChanged(() => {
      void run()
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [initialValue, resourceKey])

  return { data, loading }
}

export function useUserProfile(uid: string | undefined): ResourceState<UserProfile | null> {
  return useResource(uid ?? null, null, () => fetchUserProfile(uid!))
}

export function useFolders(uid: string | undefined): ResourceState<Folder[]> {
  return useResource(uid ?? null, EMPTY_FOLDERS, () => fetchFolders(uid!))
}

export function useDecks(uid: string | undefined): ResourceState<Deck[]> {
  return useResource(uid ?? null, EMPTY_DECKS, () => fetchDecks(uid!))
}

export function useDeck(uid: string | undefined, deckId: string | undefined): ResourceState<Deck | null> {
  return useResource(uid && deckId ? `${uid}:${deckId}` : null, null, () => fetchDeck(uid!, deckId!))
}

export function useCards(uid: string | undefined, deckId: string | undefined): ResourceState<Card[]> {
  return useResource(uid && deckId ? `${uid}:${deckId}` : null, EMPTY_CARDS, () => fetchCards(uid!, deckId!))
}

export function useRecentActivity(uid: string | undefined): ResourceState<ActivityLog[]> {
  return useResource(uid ?? null, EMPTY_ACTIVITY, () => fetchRecentActivity(uid!))
}

export function useRecentSessions(uid: string | undefined): ResourceState<StudySession[]> {
  return useResource(uid ?? null, EMPTY_SESSIONS, () => fetchRecentSessions(uid!))
}
