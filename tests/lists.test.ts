import { beforeEach, describe, expect, it } from 'vitest'
import { ALL, buildGroups, channelsByCategory, channelsForGroup, FAVORITES, RECENT, searchChannels } from '../src/data/lists'
import type { Category, Channel, Source } from '../src/data/models'
import type { Prefs } from '../src/data/prefs'

const channel = (id: string, name: string, categoryId?: string): Channel => ({ id, sourceId: 's', name, number: 0, categoryId, urls: [] })
const channels = [
  channel('1', 'BBC One HD', 'news'),
  channel('2', 'Télé Matin', 'news'),
  channel('3', 'Kids Fun', 'kids'),
  channel('4', 'Movie+ 24/7'),
]
const byId = (id: string) => channels.find((c) => c.id === id)
const byCategory = channelsByCategory(channels)
const categories: Category[] = [
  { id: 'news', sourceId: 's', name: 'News' },
  { id: 'kids', sourceId: 's', name: 'Kids' },
]
const labels = { favorites: 'Favorites', recent: 'Recent', all: 'All' }
let prefs: Prefs

beforeEach(() => {
  prefs = { favorites: ['3', '1', 'gone'], recents: ['2', '3'], lockedCategories: [], epgOffsetMinutes: 0, epgRefreshHours: 12, aspect: 'fit' }
})

describe('buildGroups', () => {
  it('starts with Favorites, Recent and All, then the categories', () => {
    const groups = buildGroups(categories, [{ id: 's', name: 'Src' } as Source], prefs, labels)
    expect(groups.map((g) => g.id)).toEqual([FAVORITES, RECENT, ALL, 'news', 'kids'])
    expect(groups.every((g) => !g.locked && !g.detail)).toBe(true)
  })

  it('names the source only for category names that several sources use', () => {
    const sources = [{ id: 's', name: 'Src' }, { id: 't', name: 'Other' }] as Source[]
    const withDuplicate = [...categories, { id: 'news2', sourceId: 't', name: 'News' }]
    const groups = buildGroups(withDuplicate, sources, prefs, labels)
    expect(groups.map((g) => g.detail)).toEqual([undefined, undefined, undefined, 'Src', undefined, 'Other'])
  })

  it('marks locked categories only when a PIN is set', () => {
    const sources = [{ id: 's', name: 'Src' }] as Source[]
    prefs.lockedCategories = ['kids']
    expect(buildGroups(categories, sources, prefs, labels)[4]).toMatchObject({ locked: false })
    prefs.pin = '1234'
    expect(buildGroups(categories, sources, prefs, labels)[4]).toMatchObject({ locked: true })
  })
})

describe('channelsForGroup', () => {
  const ids = (list: readonly Channel[]) => list.map((c) => c.id)

  it('lists favorites in the user order and recents newest first, skipping missing channels', () => {
    expect(ids(channelsForGroup(FAVORITES, channels, byId, byCategory, prefs, false))).toEqual(['3', '1'])
    expect(ids(channelsForGroup(RECENT, channels, byId, byCategory, prefs, false))).toEqual(['2', '3'])
    expect(ids(channelsForGroup('news', channels, byId, byCategory, prefs, false))).toEqual(['1', '2'])
    expect(channelsForGroup(ALL, channels, byId, byCategory, prefs, false)).toBe(channels)
  })

  it('hides locked categories everywhere until unlocked', () => {
    prefs.pin = '1234'
    prefs.lockedCategories = ['kids']
    expect(ids(channelsForGroup(ALL, channels, byId, byCategory, prefs, false))).toEqual(['1', '2', '4'])
    expect(ids(channelsForGroup(FAVORITES, channels, byId, byCategory, prefs, false))).toEqual(['1'])
    expect(ids(channelsForGroup(RECENT, channels, byId, byCategory, prefs, false))).toEqual(['2'])
    expect(channelsForGroup('kids', channels, byId, byCategory, prefs, false)).toEqual([])
    expect(ids(channelsForGroup('kids', channels, byId, byCategory, prefs, true))).toEqual(['3'])
    expect(channelsForGroup(ALL, channels, byId, byCategory, prefs, true)).toBe(channels)
  })

  it('ignores locked categories when no PIN is set', () => {
    prefs.lockedCategories = ['kids']
    expect(ids(channelsForGroup('kids', channels, byId, byCategory, prefs, false))).toEqual(['3'])
  })
})

describe('searchChannels', () => {
  it('matches part of the name ignoring case, accents, spaces and punctuation', () => {
    const names = (query: string) => searchChannels(channels, query).map((c) => c.name)
    expect(names('bbc one')).toEqual(['BBC One HD'])
    expect(names('TELE')).toEqual(['Télé Matin'])
    expect(names('movie 24')).toEqual(['Movie+ 24/7'])
    expect(names('  ')).toEqual([])
    expect(names('zzz')).toEqual([])
  })
})
