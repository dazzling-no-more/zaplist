import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Movie } from '../src/data/models'
import type { Prefs } from '../src/data/prefs'
import { ALL_ITEMS, CONTINUE, vodByCategory, vodForGroup, vodGroups } from '../src/data/vod'

const prefs = (patch: Partial<Prefs> = {}): Prefs => ({ favorites: [], recents: [], lockedCategories: [], epgOffsetMinutes: 0, epgRefreshHours: 12, aspect: 'fit', ...patch })
const movie = (id: string, categoryId?: string): Movie => ({ id, sourceId: 's', categoryId, name: id, urls: [] })

describe('movie and series groups', () => {
  const movies = [movie('a', 'c1'), movie('b', 'c2'), movie('c', 'c1')]
  const byCategory = vodByCategory(movies)
  const byId = (id: string) => movies.find((m) => m.id === id)
  const categories = [
    { id: 'live', sourceId: 's', name: 'News' },
    { id: 'c1', sourceId: 's', name: 'Action', kind: 'movie' as const },
    { id: 'c2', sourceId: 's', name: 'Adult', kind: 'movie' as const },
    { id: 'sc', sourceId: 's', name: 'Drama', kind: 'series' as const },
  ]

  it('lists Continue watching, All and the categories of that kind only', () => {
    const groups = vodGroups('movie', categories, [], prefs(), { continue: 'Continue', all: 'All movies' })
    expect(groups.map((g) => g.id)).toEqual([CONTINUE, ALL_ITEMS, 'c1', 'c2'])
  })

  it('shows a category’s items, and Continue watching in watch order', () => {
    expect(vodForGroup('c1', movies, byCategory, byId, [], prefs(), false).map((m) => m.id)).toEqual(['a', 'c'])
    expect(vodForGroup(CONTINUE, movies, byCategory, byId, ['c', 'gone', 'a'], prefs(), false).map((m) => m.id)).toEqual(['c', 'a'])
  })

  it('hides locked categories everywhere until unlocked', () => {
    const locked = prefs({ pin: '1234', lockedCategories: ['c2'] })
    expect(vodForGroup(ALL_ITEMS, movies, byCategory, byId, [], locked, false).map((m) => m.id)).toEqual(['a', 'c'])
    expect(vodForGroup('c2', movies, byCategory, byId, [], locked, false)).toEqual([])
    expect(vodForGroup(CONTINUE, movies, byCategory, byId, ['b'], locked, false)).toEqual([])
    expect(vodForGroup('c2', movies, byCategory, byId, [], locked, true).map((m) => m.id)).toEqual(['b'])
  })
})

describe('watch progress', () => {
  let store: Record<string, string>
  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => (store[key] = value),
      removeItem: (key: string) => delete store[key],
    })
    vi.resetModules()
  })
  const load = () => import('../src/data/watch')

  it('resumes a started title, not one barely begun or already finished', async () => {
    const { resumePosition, isFinished } = await load()
    expect(resumePosition({ position: 600, duration: 5400, at: 0 })).toBe(600)
    expect(resumePosition({ position: 10, duration: 5400, at: 0 })).toBeUndefined()
    expect(resumePosition({ position: 5390, duration: 5400, at: 0 })).toBeUndefined()
    expect(isFinished({ position: 5150, duration: 5400, at: 0 })).toBe(true)
    // Unknown length (some streams): never counts as finished.
    expect(resumePosition({ position: 600, duration: 0, at: 0 })).toBe(600)
  })

  it('moves progress to the new ids of a movie, an episode and its series', async () => {
    const watch = await load()
    watch.recordWatch('m1', { position: 100, duration: 1000 })
    watch.recordWatch('e1', { position: 50, duration: 1000, seriesId: 's1' })
    watch.renameWatch(new Map([['m1', 'M1'], ['e1', 'E1'], ['s1', 'S1']]))
    expect(watch.getWatch('m1')).toBeUndefined()
    expect(watch.getWatch('M1')).toMatchObject({ position: 100 })
    expect(watch.getWatch('E1')).toMatchObject({ position: 50, seriesId: 'S1' })
  })

  it('keeps progress across restarts and lists what to continue, newest first', async () => {
    const watch = await load()
    vi.spyOn(Date, 'now').mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3).mockReturnValueOnce(4)
    watch.recordWatch('m1', { position: 100, duration: 1000 })
    watch.recordWatch('e1', { position: 50, duration: 1000, seriesId: 's1' })
    watch.recordWatch('m2', { position: 1000, duration: 1000 })
    watch.recordWatch('e2', { position: 70, duration: 1000, seriesId: 's1' })
    vi.restoreAllMocks()

    const reloaded = await (vi.resetModules(), load())
    expect(reloaded.getWatch('m1')).toMatchObject({ position: 100, duration: 1000 })
    expect(reloaded.continueIds(JSON.parse(store['iptv-player.watch']))).toEqual({ movies: ['m1'], series: ['s1'] })
  })

  it('starts an episode with the tracks chosen for the series’ latest one, a movie with its own', async () => {
    const watch = await load()
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => ++now)
    watch.recordWatch('e1', { position: 50, duration: 1000, seriesId: 's1', tracks: { subtitle: 'en' } })
    watch.recordWatch('e2', { position: 70, duration: 1000, seriesId: 's1', tracks: { subtitle: '' } })
    watch.recordWatch('x1', { position: 70, duration: 1000, seriesId: 's2', tracks: { audio: 'fre' } })
    watch.recordWatch('m1', { position: 100, duration: 1000, tracks: { audio: 'deu' } })
    vi.restoreAllMocks()
    expect(watch.lastTracks('e3', 's1')).toEqual({ subtitle: '' })
    expect(watch.lastTracks('e1', 's1')).toEqual({ subtitle: '' })
    expect(watch.lastTracks('m1')).toEqual({ audio: 'deu' })
    expect(watch.lastTracks('m2')).toBeUndefined()
    expect(watch.lastTracks('y1', 's3')).toBeUndefined()
  })

  it('forgets the oldest entries beyond its limit', async () => {
    const watch = await load()
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => ++now)
    for (let i = 0; i < 405; i++) watch.recordWatch(`m${i}`, { position: 100, duration: 1000 })
    vi.restoreAllMocks()
    expect(watch.getWatch('m0')).toBeUndefined()
    expect(watch.getWatch('m404')).toBeDefined()
    expect(Object.keys(JSON.parse(store['iptv-player.watch']))).toHaveLength(400)
  })
})

describe('series next up', () => {
  it('offers the episode last watched, or the next one once it was finished', async () => {
    vi.resetModules()
    const { nextUp } = await import('../src/screens/SeriesDetails')
    const episodes = [1, 2, 3].map((n) => ({ id: `e${n}`, season: 1, episode: n, title: '', urls: [] }))
    expect(nextUp(episodes, {})?.id).toBe('e1')
    expect(nextUp(episodes, { e2: { position: 300, duration: 1000, at: 5 } })?.id).toBe('e2')
    expect(nextUp(episodes, { e2: { position: 1000, duration: 1000, at: 5 }, e1: { position: 10, duration: 1000, at: 1 } })?.id).toBe('e3')
    expect(nextUp(episodes, { e3: { position: 1000, duration: 1000, at: 5 } })?.id).toBe('e3')
  })
})

