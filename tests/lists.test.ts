import { beforeEach, describe, expect, it } from 'vitest'
import { ALL, buildGroups, channelsByCategory, channelsForGroup, FAVORITES, RECENT, searchChannels } from '../src/data/lists'
import { normalizeName } from '../src/data/text'
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
  prefs = { favorites: ['3', '1', 'gone'], recents: ['2', '3'], lockedCategories: [], epgOffsetMinutes: 0, epgRefreshHours: 12, aspect: 'fit', watchlist: [], hiddenCategories: [] }
})

describe('buildGroups', () => {
  it('starts with Favorites, Recent and All, then the categories', () => {
    const groups = buildGroups(categories, [{ id: 's', name: 'Src' } as Source], prefs, labels)
    expect(groups.map((g) => g.id)).toEqual([FAVORITES, RECENT, ALL, 'news', 'kids'])
    expect(groups.every((g) => !g.locked && !g.detail)).toBe(true)
  })

  it('leaves movie and series categories to their own screens', () => {
    const withVod: Category[] = [...categories, { id: 'films', sourceId: 's', name: 'Films', kind: 'movie' }, { id: 'shows', sourceId: 's', name: 'Shows', kind: 'series' }]
    expect(buildGroups(withVod, [], prefs, labels).map((g) => g.id)).toEqual([FAVORITES, RECENT, ALL, 'news', 'kids'])
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

  it('leaves hidden categories out of every list and the sidebar, PIN or not', () => {
    prefs.hiddenCategories = ['kids']
    expect(ids(channelsForGroup(ALL, channels, byId, byCategory, prefs, true))).toEqual(['1', '2', '4'])
    expect(ids(channelsForGroup(FAVORITES, channels, byId, byCategory, prefs, true))).toEqual(['1'])
    expect(channelsForGroup('kids', channels, byId, byCategory, prefs, true)).toEqual([])
    expect(buildGroups(categories, [], prefs, labels).map((g) => g.id)).not.toContain('kids')
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

describe('normalizeName', () => {
  it('keeps the letters of non-Latin scripts', () => {
    expect(normalizeName('Россия 1')).toBe('россия1')
    expect(normalizeName('Беларусь 1')).toBe('беларусь1')
    expect(normalizeName('الجزيرة')).toBe('الجزيرة')
    expect(normalizeName('ΕΡΤ 1')).toBe('ερτ1')
    expect(normalizeName('CCTV-1 综合')).toBe('cctv1综合')
    expect(normalizeName('Straße')).toBe('straße')
    expect(normalizeName('KBS 1TV 서울')).not.toBe(normalizeName('KBS 1TV 부산'))
    expect(normalizeName('한국')).toBe('한국'.normalize('NFD'))
  })

  it('drops symbols, emoji and decorations around Latin names', () => {
    expect(normalizeName('🇬🇧 BBC One ᴴᴰ ★')).toBe('bbcone')
    expect(normalizeName('BBC One – HD')).toBe('bbconehd')
    expect(normalizeName('Télé Matin')).toBe('telematin')
  })
})
