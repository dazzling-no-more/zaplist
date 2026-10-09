import { doesFocusableExist, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { BackStack, type ScreenEntry } from '../platform/backStack'

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'settings' }
  | { name: 'sourceEdit'; sourceId?: string }
  /** listId: the group the channel was picked from (Favorites, a category, ...), for zapping. */
  | { name: 'player'; channelId: string; listId: string }
  | { name: 'guide'; listId: string }

export type ScreenName = Route['name']

export interface ScreenProps<N extends ScreenName = ScreenName> {
  entry: ScreenEntry<Extract<Route, { name: N }>>
}

export const backStack = new BackStack<Route>({ name: 'home' })

export const useBackStack = () => useSyncExternalStore(backStack.subscribe, backStack.getState)

/** Opens a screen; the current focus is restored when the user comes back with Back. */
export function navigate(route: Route): void {
  backStack.push(route, getCurrentFocusKey())
}

/** Handles Back while `active`. Return true to consume the press; newer handlers run first. */
export function useBackHandler(handler: () => boolean, active = true): void {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => (active ? backStack.addHandler(() => latest.current()) : undefined), [active])
}

/** On mount, focuses what was focused when the user left this screen, or else `fallbackKey`. */
export function useScreenFocus(entry: ScreenEntry<Route>, fallbackKey: string): void {
  useEffect(() => {
    const saved = entry.focusKey
    setFocus(saved && doesFocusableExist(saved) ? saved : fallbackKey)
  }, [])
}
