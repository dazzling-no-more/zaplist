import { library } from '../data/library'
import { ALL, isCategoryLocked } from '../data/lists'
import type { Channel } from '../data/models'
import { addRecent, getPrefs, updatePrefs } from '../data/prefs'
import { backStack, navigate, type Replay } from './navigation'

/** Remembers a channel as played: recents, plus what to resume on the next launch. */
export function recordPlay(channel: Channel, listId: string): void {
  addRecent(channel.id)
  updatePrefs({ lastChannelId: channel.id, lastListId: listId })
}

/**
 * Opens the player on `channel`; `listId` is the group it was picked from, for zapping. `catchup`: a
 * past programme to play again instead of what's on.
 */
export function playChannel(channel: Channel, listId: string, catchup?: Replay): void {
  recordPlay(channel, listId)
  navigate({ name: 'player', channelId: channel.id, listId, catchup })
}

/** On launch: reopen the last channel if its playlist is cached and it isn't locked. */
export function resumeLastChannel(): void {
  const prefs = getPrefs()
  const channel = prefs.lastChannelId ? library.channel(prefs.lastChannelId) : undefined
  if (!channel || isCategoryLocked(channel.categoryId, prefs)) return
  backStack.push({ name: 'player', channelId: channel.id, listId: prefs.lastListId ?? ALL }, 'home-channels')
}
