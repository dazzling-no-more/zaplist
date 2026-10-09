import type { Channel } from '../data/models'
import { addRecent, updatePrefs } from '../data/prefs'

/** Starts watching `channel`; `listId` is the group it was picked from, for zapping and resume. */
export function playChannel(channel: Channel, listId: string): void {
  addRecent(channel.id)
  updatePrefs({ lastChannelId: channel.id, lastListId: listId })
}
