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

function useResource<T>(
  enabled: boolean,
  initialValue: T,
  load: () => Promise<T>,
): ResourceState<T> {
  const [data, setData] = useState<T>(initialValue)
  const [loading, setLoading] = useState(enabled)
  const runLoad = useEffectEvent(load)
  const getInitialValue = useEffectEvent(() => initialValue)

  useEffect(() => {
    let active = true

    if (!enabled) {
      setData(getInitialValue())
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
  }, [enabled, getInitialValue, runLoad])

  return { data, loading }
}

export function useUserProfile(uid: string | undefined): ResourceState<UserProfile | null> {
  return useResource(Boolean(uid), null, () => fetchUserProfile(uid!))
}

export function useFolders(uid: string | undefined): ResourceState<Folder[]> {
  return useResource(Boolean(uid), [], () => fetchFolders(uid!))
}

export function useDecks(uid: string | undefined): ResourceState<Deck[]> {
  return useResource(Boolean(uid), [], () => fetchDecks(uid!))
}

export function useDeck(uid: string | undefined, deckId: string | undefined): ResourceState<Deck | null> {
  return useResource(Boolean(uid && deckId), null, () => fetchDeck(uid!, deckId!))
}

export function useCards(uid: string | undefined, deckId: string | undefined): ResourceState<Card[]> {
  return useResource(Boolean(uid && deckId), [], () => fetchCards(uid!, deckId!))
}

export function useRecentActivity(uid: string | undefined): ResourceState<ActivityLog[]> {
  return useResource(Boolean(uid), [], () => fetchRecentActivity(uid!))
}

export function useRecentSessions(uid: string | undefined): ResourceState<StudySession[]> {
  return useResource(Boolean(uid), [], () => fetchRecentSessions(uid!))
}
