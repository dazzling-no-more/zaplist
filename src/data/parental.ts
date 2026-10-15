import { useSyncExternalStore } from 'react'
import { getPrefs } from './prefs'

// Entering the PIN once unlocks locked categories until the app restarts.
let unlocked = false
const listeners = new Set<() => void>()

// Wrong PINs block entry for a while, so the 10,000 PINs can't all be tried with the number keys in
// a few hours. Kept across restarts, which would otherwise start the count again.
const TRIES_KEY = 'iptv-player.pinTries'
/** Wrong PINs allowed in a row before entry is blocked. */
const FREE_TRIES = 5
/** The first block; each wrong PIN after it doubles it, up to MAX_WAIT_MS. */
const FIRST_WAIT_MS = 30_000
const MAX_WAIT_MS = 3_600_000

interface Tries {
  wrong: number
  /** Epoch ms until which no PIN is checked. */
  blockedUntil: number
}

function loadTries(): Tries {
  try {
    const stored = JSON.parse(localStorage.getItem(TRIES_KEY) ?? 'null') as Tries | null
    if (stored && typeof stored.wrong === 'number' && typeof stored.blockedUntil === 'number') return stored
  } catch {
    // unreadable: start counting again
  }
  return { wrong: 0, blockedUntil: 0 }
}

let tries = loadTries()

function saveTries(next: Tries): void {
  tries = next
  try {
    localStorage.setItem(TRIES_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable: the count holds for this session
  }
}

/** When PIN entry opens again after too many wrong PINs (epoch ms); 0 when it is open. */
export const pinBlockedUntil = (): number => (tries.blockedUntil > Date.now() ? tries.blockedUntil : 0)

function set(value: boolean): void {
  unlocked = value
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useUnlocked = (): boolean => useSyncExternalStore(subscribe, () => unlocked)

/** Unlocks for this session when `pin` is right; always false while entry is blocked (pinBlockedUntil). */
export function unlock(pin: string): boolean {
  if (pinBlockedUntil()) return false
  const ok = pin === getPrefs().pin
  if (ok) {
    if (tries.wrong) saveTries({ wrong: 0, blockedUntil: 0 })
    set(true)
  } else {
    const wrong = tries.wrong + 1
    const wait = wrong < FREE_TRIES ? 0 : Math.min(MAX_WAIT_MS, FIRST_WAIT_MS * Math.pow(2, wrong - FREE_TRIES))
    saveTries({ wrong, blockedUntil: wait ? Date.now() + wait : 0 })
  }
  return ok
}

/** Called when a new PIN is set, so the person who set it isn't locked out of the settings. */
export const markUnlocked = (): void => set(true)
