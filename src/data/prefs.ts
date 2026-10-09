import { useSyncExternalStore } from 'react'

export const ASPECTS = ['fit', 'fill', '16:9', '4:3'] as const
export type Aspect = (typeof ASPECTS)[number]

/** Small user settings kept in localStorage. Playlists and the guide live in IndexedDB. */
export interface Prefs {
  /** Channel ids in the user's order. */
  favorites: string[]
  /** Channel ids, most recent first. */
  recents: string[]
  /** Parental PIN; locking is off without one. */
  pin?: string
  lockedCategories: string[]
  /** Extra XMLTV URL used for all sources. */
  epgUrl?: string
  /** Minutes added to every guide time. */
  epgOffsetMinutes: number
  epgRefreshHours: number
  /** Last channel played and the list it was played from, for resume on launch. */
  lastChannelId?: string
  lastListId?: string
  /** Picture shape in the player. */
  aspect: Aspect
}

export const MAX_RECENTS = 20

const KEY = 'iptv-player.prefs'
const DEFAULTS: Prefs = { favorites: [], recents: [], lockedCategories: [], epgOffsetMinutes: 0, epgRefreshHours: 12, aspect: 'fit' }

function load(): Prefs {
  try {
    const stored = localStorage.getItem(KEY)
    return stored ? { ...DEFAULTS, ...(JSON.parse(stored) as Partial<Prefs>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

let prefs = load()
const listeners = new Set<() => void>()

export const getPrefs = (): Prefs => prefs

export function updatePrefs(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Storage full or unavailable: keep the change for this session.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const usePrefs = (): Prefs => useSyncExternalStore(subscribe, getPrefs)

export function toggleFavorite(channelId: string): void {
  const { favorites } = prefs
  updatePrefs({ favorites: favorites.includes(channelId) ? favorites.filter((id) => id !== channelId) : [...favorites, channelId] })
}

/** Moves a favorite by `delta` places; returns its new index. */
export function moveFavorite(channelId: string, delta: number): number {
  const favorites = prefs.favorites.slice()
  const from = favorites.indexOf(channelId)
  if (from < 0) return -1
  const to = Math.max(0, Math.min(favorites.length - 1, from + delta))
  favorites.splice(from, 1)
  favorites.splice(to, 0, channelId)
  updatePrefs({ favorites })
  return to
}

export function addRecent(channelId: string): void {
  updatePrefs({ recents: [channelId, ...prefs.recents.filter((id) => id !== channelId)].slice(0, MAX_RECENTS) })
}
