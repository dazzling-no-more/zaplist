import { useSyncExternalStore } from 'react'
import { getSecretSettings, putSecretSettings } from './db'

export const ASPECTS = ['fit', 'zoom', 'fill', '16:9', '4:3'] as const
export type Aspect = (typeof ASPECTS)[number]

/**
 * Small user settings, kept in localStorage except the secrets (PIN, guide URL), which are stored
 * encrypted in IndexedDB and read by `loadSecretPrefs`. Playlists and the guide live in IndexedDB.
 */
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
  /** Movie and series ids on the user's list ("My list"), the latest added first. */
  watchlist: string[]
  /** Categories left out of every list (not parental control: no PIN undoes it, Settings does). */
  hiddenCategories: string[]
}

export const MAX_RECENTS = 20

const KEY = 'iptv-player.prefs'
const DEFAULTS: Prefs = { favorites: [], recents: [], lockedCategories: [], epgOffsetMinutes: 0, epgRefreshHours: 12, aspect: 'fit', watchlist: [], hiddenCategories: [] }

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

/** Settings that can grant access (a guide URL may carry a login): never written to localStorage. */
type Secrets = Pick<Prefs, 'pin' | 'epgUrl'>
const secretsOf = ({ pin, epgUrl }: Prefs): Secrets => ({ pin, epgUrl })

function writeLocal(value: Prefs): void {
  const { pin: _pin, epgUrl: _epgUrl, ...rest } = value
  localStorage.setItem(KEY, JSON.stringify(rest))
}

function saveLocal(): void {
  try {
    writeLocal(prefs)
  } catch {
    // Storage full or unavailable: keep the change for this session.
  }
}

/** Parental control: changed only through `saveParental`, which reports storage failures. */
type ParentalPrefs = Pick<Prefs, 'pin' | 'lockedCategories'>

/** Changes everyday settings; if storage fails they still apply for this session. */
export function updatePrefs(patch: Partial<Omit<Prefs, keyof ParentalPrefs>>): void {
  prefs = { ...prefs, ...patch }
  saveLocal()
  if ('epgUrl' in patch) void putSecretSettings(secretsOf(prefs)).catch(() => undefined)
  listeners.forEach((listener) => listener())
}

/**
 * Changes parental control. A setting that applied now but was lost at the next start would quietly
 * unlock the TV, so this resolves only once the change is stored and rejects, changing nothing, when it can't be.
 */
export async function saveParental(patch: Partial<ParentalPrefs>): Promise<void> {
  const next = { ...prefs, ...patch }
  if ('lockedCategories' in patch) writeLocal(next)
  if ('pin' in patch) {
    try {
      await putSecretSettings(secretsOf(next))
    } catch (error) {
      saveLocal() // puts back the locked categories written above
      throw error
    }
  }
  prefs = { ...prefs, ...patch }
  listeners.forEach((listener) => listener())
}

/** Reads the PIN and guide URL from encrypted storage, moving them there from localStorage (older versions). */
export async function loadSecretPrefs(): Promise<void> {
  const stored = await getSecretSettings<Secrets>()
  if (stored) prefs = { ...prefs, pin: stored.pin, epgUrl: stored.epgUrl }
  else if (prefs.pin !== undefined || prefs.epgUrl !== undefined) {
    await putSecretSettings(secretsOf(prefs))
    saveLocal()
  }
  listeners.forEach((listener) => listener())
}

/** Forgets every setting (startup recovery). */
export function clearPrefs(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing stored
  }
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

/**
 * Moves a favorite by `delta` places among `shown`, the favorites on screen (those hidden, locked or
 * gone from the playlists, keep their places); returns its new index in `shown`.
 */
export function moveFavorite(channelId: string, delta: number, shown: readonly string[]): number {
  const from = shown.indexOf(channelId)
  if (from < 0) return -1
  const to = Math.max(0, Math.min(shown.length - 1, from + delta))
  if (to === from) return from
  const favorites = prefs.favorites.filter((id) => id !== channelId)
  // Before the favorite it passes going up, after it going down.
  favorites.splice(favorites.indexOf(shown[to]) + (to > from ? 1 : 0), 0, channelId)
  updatePrefs({ favorites })
  return to
}

/** Puts a movie or series on the user's list, or takes it off. */
export function toggleWatchlist(id: string): void {
  updatePrefs({ watchlist: prefs.watchlist.includes(id) ? prefs.watchlist.filter((other) => other !== id) : [id, ...prefs.watchlist] })
}

export function toggleHiddenCategory(categoryId: string): void {
  const hidden = prefs.hiddenCategories
  updatePrefs({ hiddenCategories: hidden.includes(categoryId) ? hidden.filter((id) => id !== categoryId) : [...hidden, categoryId] })
}

/** Channels, movies and series whose ids changed (old id → new id): favorites, recents, the last channel and the list follow. */
export function renameIds(renamed: ReadonlyMap<string, string>): void {
  const rename = (id: string) => renamed.get(id) ?? id
  const changed = (ids: string[]) => ids.some((id) => renamed.has(id))
  if (!changed(prefs.favorites) && !changed(prefs.recents) && !changed(prefs.watchlist) && !(prefs.lastChannelId && renamed.has(prefs.lastChannelId))) return
  updatePrefs({
    favorites: prefs.favorites.map(rename),
    recents: prefs.recents.map(rename),
    watchlist: prefs.watchlist.map(rename),
    lastChannelId: prefs.lastChannelId && rename(prefs.lastChannelId),
  })
}

export function addRecent(channelId: string): void {
  updatePrefs({ recents: [channelId, ...prefs.recents.filter((id) => id !== channelId)].slice(0, MAX_RECENTS) })
}
