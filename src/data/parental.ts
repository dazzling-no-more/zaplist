import { useSyncExternalStore } from 'react'
import { getPrefs } from './prefs'

// Entering the PIN once unlocks locked categories until the app restarts.
let unlocked = false
const listeners = new Set<() => void>()

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

/** Unlocks for this session when `pin` is right. */
export function unlock(pin: string): boolean {
  const ok = pin === getPrefs().pin
  if (ok) set(true)
  return ok
}

/** Called when a new PIN is set, so the person who set it isn't locked out of the settings. */
export const markUnlocked = (): void => set(true)
