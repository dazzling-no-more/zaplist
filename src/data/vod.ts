import type { Category, Movie, Series, Source } from './models'
import { categoryGroups, isCategoryLocked, leavesOut, leftOut, type ChannelGroup } from './lists'
import type { Prefs } from './prefs'

/** Sidebar groups of the Movies and Series screens, before the categories. */
export const CONTINUE = 'continue'
/** The movies or series on the user's list. */
export const WATCHLIST = 'watchlist'
export const ALL_ITEMS = 'all'

export type VodKind = 'movie' | 'series'
export type VodItem = Movie | Series

export function vodGroups(
  kind: VodKind,
  categories: readonly Category[],
  sources: readonly Source[],
  prefs: Prefs,
  labels: { continue: string; watchlist: string; all: string },
): ChannelGroup[] {
  return [
    { id: CONTINUE, name: labels.continue, locked: false },
    { id: WATCHLIST, name: labels.watchlist, locked: false },
    { id: ALL_ITEMS, name: labels.all, locked: false },
    ...categoryGroups(categories.filter((c) => c.kind === kind), sources, prefs),
  ]
}

/**
 * Movies or series shown for a group. As with channels, those in hidden categories are left out
 * everywhere, those in locked ones until the PIN unlocks them for the session.
 */
export function vodForGroup<T extends VodItem>(
  groupId: string,
  items: readonly T[],
  byCategory: Map<string, T[]>,
  byId: (id: string) => T | undefined,
  continueIds: readonly string[],
  prefs: Prefs,
  unlocked: boolean,
): readonly T[] {
  const out = leftOut(prefs, unlocked)
  const fromIds = (ids: readonly string[]) => ids.map(byId).filter((item): item is T => !!item && !out(item.categoryId))
  if (groupId === CONTINUE) return fromIds(continueIds)
  if (groupId === WATCHLIST) return fromIds(prefs.watchlist)
  if (groupId === ALL_ITEMS) return leavesOut(prefs, unlocked) ? items.filter((item) => !out(item.categoryId)) : items
  if (out(groupId)) return []
  return byCategory.get(groupId) ?? []
}

export function vodByCategory<T extends VodItem>(items: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    if (!item.categoryId) continue
    let list = map.get(item.categoryId)
    if (!list) map.set(item.categoryId, (list = []))
    list.push(item)
  }
  return map
}

export const isVodLocked = (item: VodItem, prefs: Pick<Prefs, 'pin' | 'lockedCategories'>, unlocked: boolean): boolean =>
  !unlocked && isCategoryLocked(item.categoryId, prefs)
