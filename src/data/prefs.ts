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
