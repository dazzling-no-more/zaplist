import { doesFocusableExist, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { BackStack, type ScreenEntry } from '../platform/backStack'

export type ScreenName = 'home' | 'settings'

export interface ScreenProps {
  entry: ScreenEntry<ScreenName>
}

export const backStack = new BackStack<ScreenName>('home')

export const useBackStack = () => useSyncExternalStore(backStack.subscribe, backStack.getState)

/** Opens a screen; the current focus is restored when the user comes back with Back. */
export function navigate(name: ScreenName): void {
  backStack.push(name, getCurrentFocusKey())
}

/** Handles Back while `active`. Return true to consume the press; newer handlers run first. */
export function useBackHandler(handler: () => boolean, active = true): void {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => (active ? backStack.addHandler(() => latest.current()) : undefined), [active])
}

/** On mount, focuses what was focused when the user left this screen, or else `fallbackKey`. */
export function useScreenFocus(entry: ScreenEntry<ScreenName>, fallbackKey: string): void {
  useEffect(() => {
    const saved = entry.focusKey
    setFocus(saved && doesFocusableExist(saved) ? saved : fallbackKey)
  }, [])
}
