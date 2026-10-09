import type { Category, Channel, Source } from './models'
import type { Prefs } from './prefs'
import { normalizeName } from './text'

export const FAVORITES = 'favorites'
export const RECENT = 'recent'
export const ALL = 'all'

/** A sidebar entry: Favorites, Recent, All channels, or one playlist category. */
export interface ChannelGroup {
  id: string
  name: string
  /** Source name, shown when another source has a category with the same name. */
  detail?: string
  /** Hidden behind the parental PIN. */
  locked: boolean
}

export interface GroupLabels {
  favorites: string
  recent: string
  all: string
}

export function channelsByCategory(channels: readonly Channel[]): Map<string, Channel[]> {
  const map = new Map<string, Channel[]>()
  for (const channel of channels) {
    if (!channel.categoryId) continue
    let list = map.get(channel.categoryId)
    if (!list) map.set(channel.categoryId, (list = []))
    list.push(channel)
  }
  return map
}

/** Parental lock is on (a PIN exists) and this category is locked. */
export const isCategoryLocked = (categoryId: string | undefined, prefs: Pick<Prefs, 'pin' | 'lockedCategories'>): boolean =>
  !!prefs.pin && !!categoryId && prefs.lockedCategories.includes(categoryId)

export function buildGroups(categories: readonly Category[], sources: readonly Source[], prefs: Prefs, labels: GroupLabels): ChannelGroup[] {
  const sourceNames = new Map(sources.map((s) => [s.id, s.name]))
  const nameCount = new Map<string, number>()
  for (const c of categories) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1)
  return [
    { id: FAVORITES, name: labels.favorites, locked: false },
    { id: RECENT, name: labels.recent, locked: false },
    { id: ALL, name: labels.all, locked: false },
    ...categories.map((c) => ({
      id: c.id,
      name: c.name,
      detail: (nameCount.get(c.name) ?? 0) > 1 ? sourceNames.get(c.sourceId) : undefined,
      locked: isCategoryLocked(c.id, prefs),
    })),
  ]
}

/**
 * Channels shown for a group. Channels in locked categories are left out everywhere until the
 * PIN unlocks them for the session; a locked category itself shows nothing.
 */
export function channelsForGroup(
  groupId: string,
  channels: readonly Channel[],
  byId: (id: string) => Channel | undefined,
  byCategory: Map<string, Channel[]>,
  prefs: Prefs,
  unlocked: boolean,
): readonly Channel[] {
  const hidden = (c: Channel) => !unlocked && isCategoryLocked(c.categoryId, prefs)
  const fromIds = (ids: string[]) => ids.map(byId).filter((c): c is Channel => !!c && !hidden(c))
  if (groupId === FAVORITES) return fromIds(prefs.favorites)
  if (groupId === RECENT) return fromIds(prefs.recents)
  if (groupId === ALL) return prefs.pin && !unlocked && prefs.lockedCategories.length ? channels.filter((c) => !hidden(c)) : channels
  if (!unlocked && isCategoryLocked(groupId, prefs)) return []
  return byCategory.get(groupId) ?? []
}

const searchKeys = new WeakMap<readonly Channel[], string[]>()

/** Channels whose name contains the query (ignoring case, accents, spaces and punctuation). */
export function searchChannels(channels: readonly Channel[], query: string): Channel[] {
  const needle = normalizeName(query)
  if (!needle) return []
  let keys = searchKeys.get(channels)
  if (!keys) searchKeys.set(channels, (keys = channels.map((c) => normalizeName(c.name))))
  const results: Channel[] = []
  for (let i = 0; i < channels.length; i++) if (keys[i].indexOf(needle) >= 0) results.push(channels[i])
  return results
}
