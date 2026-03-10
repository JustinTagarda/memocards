import { formatDistanceToNowStrict, isToday, isYesterday, parseISO } from 'date-fns'
import { clsx } from 'clsx'

export function cn(...values: Array<string | false | null | undefined>) {
  return clsx(values)
}

export function nowIso() {
  return new Date().toISOString()
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function shuffleArray<T>(items: T[]) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = copy[index]
    copy[index] = copy[swapIndex] as T
    copy[swapIndex] = current as T
  }
  return copy
}

export function hashText(input: string) {
  let hash = 5381
  for (const character of input) {
    hash = (hash * 33) ^ character.charCodeAt(0)
  }
  return (hash >>> 0).toString(16)
}

export function parseTags(input: string) {
  return Array.from(
    new Set(
      input
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
}

export function formatSmartDate(iso: string | null) {
  if (!iso) {
    return 'Never'
  }

  const date = parseISO(iso)
  if (isToday(date)) {
    return 'Today'
  }
  if (isYesterday(date)) {
    return 'Yesterday'
  }
  return formatDistanceToNowStrict(date, { addSuffix: true })
}

export function formatCalendarDate(iso: string | null) {
  if (!iso) {
    return 'Not yet'
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parseISO(iso))
}

export function toTitleCase(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

export function triggerDownload(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function startOfLocalDayKey(iso = nowIso()) {
  return iso.slice(0, 10)
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function sleep(durationMs: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}
