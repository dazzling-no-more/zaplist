import { useSyncExternalStore } from 'react'
import type { TrackLabels } from '../player/streams'

/** How far a movie or an episode was watched. */
export interface WatchEntry {
  /** Seconds. */
  position: number
  /** Seconds; 0 when the stream doesn't say. */
  duration: number
  /** When it was last watched (epoch ms). */
  at: number
  /** For episodes: the series they belong to. */
  seriesId?: string
  /** The audio and subtitles chosen, by label. */
  tracks?: TrackLabels
}

const KEY = 'iptv-player.watch'
/** The oldest entries go first beyond this; enough for a long history at a few kB of storage. */
const MAX_ENTRIES = 400

function load(): Record<string, WatchEntry> {
  try {
    const stored = localStorage.getItem(KEY)
    return stored ? (JSON.parse(stored) as Record<string, WatchEntry>) : {}
  } catch {
    return {}
  }
}

let entries = load()
const listeners = new Set<() => void>()

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    // Storage full or unavailable: keep the progress for this session.
  }
}

export const getWatch = (id: string): WatchEntry | undefined => entries[id]

/** Watched to the end; the last 5% is usually credits. */
export const isFinished = (entry: WatchEntry | undefined): boolean => !!entry && entry.duration > 0 && entry.position >= entry.duration * 0.95

/** Where to resume: undefined when it was barely started or already finished. */
export function resumePosition(entry: WatchEntry | undefined): number | undefined {
  return entry && entry.position >= 30 && !isFinished(entry) ? entry.position : undefined
}

/** The tracks to start with: for an episode those chosen for the series' latest one watched, else the movie's own. */
export function lastTracks(id: string, seriesId?: string): TrackLabels | undefined {
  if (!seriesId) return entries[id]?.tracks
  let latest: WatchEntry | undefined
  for (const key of Object.keys(entries)) {
    const entry = entries[key]
    if (entry.seriesId === seriesId && entry.tracks && (!latest || entry.at > latest.at)) latest = entry
  }
  return latest?.tracks
}

export function recordWatch(id: string, entry: Omit<WatchEntry, 'at'>): void {
  const next = { ...entries, [id]: { ...entry, at: Date.now() } }
  const ids = Object.keys(next)
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => next[a].at - next[b].at)
    for (const old of ids.slice(0, ids.length - MAX_ENTRIES)) delete next[old]
  }
  entries = next
  save()
  listeners.forEach((listener) => listener())
}

/** Forgets all progress (Reset app data). */
export function clearWatch(): void {
  entries = {}
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing stored
  }
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useWatch = (): Readonly<Record<string, WatchEntry>> => useSyncExternalStore(subscribe, () => entries)

/** Movie ids and series ids watched recently, newest first; finished movies are left out. */
export function continueIds(watch: Readonly<Record<string, WatchEntry>>): { movies: string[]; series: string[] } {
  const movies: string[] = []
  const series: string[] = []
  const ids = Object.keys(watch).sort((a, b) => watch[b].at - watch[a].at)
  for (const id of ids) {
    const entry = watch[id]
    if (entry.seriesId) {
      if (series.indexOf(entry.seriesId) < 0) series.push(entry.seriesId)
    } else if (!isFinished(entry)) movies.push(id)
  }
  return { movies, series }
}
