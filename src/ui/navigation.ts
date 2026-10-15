import { doesFocusableExist, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { BackStack, type ScreenEntry } from '../platform/backStack'
import type { PhoneEntry } from '../data/relay'
import { platformBack } from '../platform/webos'

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'settings' }
  /** phone: entered on a phone from the welcome screen, to fill the form with. */
  | { name: 'sourceEdit'; sourceId?: string; phone?: PhoneEntry }
  /** listId: the group the channel was picked from (Favorites, a category, ...), for zapping. */
  | { name: 'player'; channelId: string; listId: string }
  | { name: 'guide'; listId: string }
  | { name: 'vod'; kind: 'movie' | 'series' }
  | { name: 'movie'; movieId: string }
  | { name: 'series'; seriesId: string }
  /** A movie (no seriesId) or an episode of `seriesId`; `fromStart` ignores the saved position. */
  | { name: 'vodPlayer'; itemId: string; seriesId?: string; fromStart?: boolean }

export type ScreenName = Route['name']

export interface ScreenProps<N extends ScreenName = ScreenName> {
  entry: ScreenEntry<Extract<Route, { name: N }>>
}

// Back on the first screen goes to the system, which shows its exit popup or the Home screen as each
// webOS version requires (LG's app checklist rejects custom handling there on webOS 23 and later).
export const backStack = new BackStack<Route>({ name: 'home' }, platformBack)

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
