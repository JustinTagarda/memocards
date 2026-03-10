import type { ReviewState, SelfAssessment } from '../types/models'
import { clamp, nowIso } from './utils'

export function createInitialReviewState(timestamp = nowIso()): ReviewState {
  return {
    repetitions: 0,
    easeFactor: 2.5,
    intervalDays: 0,
    lapses: 0,
    lastReviewedAt: null,
    dueAt: timestamp,
    mastery: 0,
  }
}

export function assessmentToQuality(assessment: SelfAssessment) {
  switch (assessment) {
    case 'again':
      return 1
    case 'hard':
      return 3
    case 'good':
      return 4
    case 'easy':
      return 5
  }
}

export function applySpacedRepetition(
  state: ReviewState,
  assessment: SelfAssessment,
  timestamp = nowIso(),
): ReviewState {
  const quality = assessmentToQuality(assessment)
  let repetitions = state.repetitions
  let easeFactor = state.easeFactor
  let intervalDays = state.intervalDays
  let lapses = state.lapses

  if (quality < 3) {
    repetitions = 0
    intervalDays = 1
    lapses += 1
  } else {
    repetitions += 1
    if (repetitions === 1) {
      intervalDays = 1
    } else if (repetitions === 2) {
      intervalDays = 3
    } else {
      intervalDays = Math.round(intervalDays * easeFactor)
    }
  }

  easeFactor = clamp(
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
    1.3,
    2.8,
  )

  if (assessment === 'easy') {
    intervalDays += 1
  }

  const dueAt = new Date(Date.parse(timestamp) + intervalDays * 24 * 60 * 60 * 1000).toISOString()
  const mastery = clamp(
    Math.round(
      repetitions * 12 + (easeFactor - 1.3) * 25 - lapses * 8 + (assessment === 'easy' ? 10 : 0),
    ),
    0,
    100,
  )

  return {
    repetitions,
    easeFactor,
    intervalDays,
    lapses,
    lastReviewedAt: timestamp,
    dueAt,
    mastery,
  }
}

export function isDue(dueAt: string, now = nowIso()) {
  return dueAt <= now
}
