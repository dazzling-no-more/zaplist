import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, M3uSource } from '../src/data/models'

const db = vi.hoisted(() => ({
  getSources: vi.fn(),
  getPlaylistMeta: vi.fn(),
  getChannelChunk: vi.fn(),
  getSecretSettings: vi.fn(),
  putSecretSettings: vi.fn(),
  rebuildDatabase: vi.fn(),
  deleteSource: vi.fn(),
}))
const ingestSource = vi.hoisted(() => vi.fn())
vi.mock('../src/data/db', () => db)
vi.mock('../src/data/worker', () => ({ ingestSource }))

const source: M3uSource = { id: 's', kind: 'm3u', name: 'S', url: 'http://example.com/s.m3u', addedAt: 1 }
const channel: Channel = { id: 's:1', sourceId: 's', name: 'One', number: 1, urls: ['http://example.com/1.m3u8'] }

/** A fresh library (it's a module singleton). */
const load = async () => (await import('../src/data/library')).library

describe('library startup', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    db.getSecretSettings.mockResolvedValue(undefined)
  })

  it('reports a storage failure instead of loading forever, and starts on the next try', async () => {
    const library = await load()
    db.getSources.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(library.init()).rejects.toThrow('storage unavailable')
    expect(library.getState()).toMatchObject({ ready: false, error: expect.any(Error) })

    db.getSources.mockResolvedValue([source])
    db.getPlaylistMeta.mockResolvedValue({ sourceId: 's', categories: [], epgUrls: [], chunks: 1 })
    db.getChannelChunk.mockResolvedValue([channel])
    await library.init()
    expect(library.getState()).toMatchObject({ ready: true, error: undefined, channels: [channel] })
  })

  it('reads the PIN before listing anything, and downloads uncached sources again', async () => {
    const library = await load()
    db.getSecretSettings.mockResolvedValue({ pin: '1234' })
    db.getSources.mockResolvedValue([source])
    db.getPlaylistMeta.mockResolvedValue(undefined)
    ingestSource.mockResolvedValue({ source, channels: 1, categories: 0 })
    await library.init()
    const { getPrefs } = await import('../src/data/prefs')
    expect(getPrefs().pin).toBe('1234')
    expect(db.getSecretSettings.mock.invocationCallOrder[0]).toBeLessThan(db.getSources.mock.invocationCallOrder[0])
    await vi.waitFor(() => expect(ingestSource).toHaveBeenCalledWith(source, expect.any(Function)))
  })
})

describe('deleting a source', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    db.getSecretSettings.mockResolvedValue(undefined)
    db.getSources.mockResolvedValue([source])
    db.getPlaylistMeta.mockResolvedValue({ sourceId: 's', categories: [], epgUrls: [], chunks: 1 })
    db.getChannelChunk.mockResolvedValue([channel])
    db.deleteSource.mockResolvedValue(undefined)
  })

  it('wins over a refresh that is still downloading', async () => {
    const library = await load()
    await library.init()
    let finish = () => {}
    ingestSource.mockReturnValue(new Promise((resolve) => (finish = () => resolve({ source, channels: 1, categories: 0 }))))
    const refresh = library.refresh('s')
    await vi.waitFor(() => expect(ingestSource).toHaveBeenCalledOnce())

    const removal = library.remove('s')
    await vi.waitFor(() => expect(library.getState().sources).toEqual([]))
    // Deleted at once (the app may be closed before the download ends)...
    await vi.waitFor(() => expect(db.deleteSource).toHaveBeenCalledOnce())
    // ...and again after the download, which stores the source when it finishes.
    finish()
    await expect(refresh).rejects.toThrow('Source deleted')
    await removal
    expect(db.deleteSource).toHaveBeenCalledTimes(2)
    expect(db.deleteSource.mock.invocationCallOrder[1]).toBeGreaterThan(ingestSource.mock.invocationCallOrder[0])
    expect(library.getState()).toMatchObject({ sources: [], channels: [] })

    // A save that was still to come (clearing the cache goes through every source) doesn't download it again.
    await expect(library.save(source)).rejects.toThrow('Source deleted')
    expect(ingestSource).toHaveBeenCalledOnce()
  })

  it('shows the source again when it could not be deleted', async () => {
    const library = await load()
    await library.init()
    db.deleteSource.mockRejectedValue(new Error('storage unavailable'))
    await expect(library.remove('s')).rejects.toThrow('storage unavailable')
    expect(library.getState()).toMatchObject({ sources: [source], channels: [channel] })
  })
})

describe('saves, refreshes and clearing the cache', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    db.getSecretSettings.mockResolvedValue(undefined)
    db.getSources.mockResolvedValue([source])
    db.getPlaylistMeta.mockResolvedValue({ sourceId: 's', categories: [], epgUrls: [], chunks: 1 })
    db.getChannelChunk.mockResolvedValue([channel])
    db.deleteSource.mockResolvedValue(undefined)
    db.rebuildDatabase.mockResolvedValue(undefined)
    ingestSource.mockImplementation(async (saved: M3uSource) => ({ source: saved, channels: 1, categories: 0 }))
  })

  it('refreshes a source as it is after an edit queued before the refresh', async () => {
    const library = await load()
    await library.init()
    const edited = { ...source, url: 'http://example.com/new.m3u' }
    const edit = library.save(edited)
    const refresh = library.refresh('s')
    await Promise.all([edit, refresh])
    expect(ingestSource.mock.calls.map(([s]) => (s as M3uSource).url)).toEqual([edited.url, edited.url])
    expect(library.getState().sources).toEqual([edited])
  })

  it('lets screens follow channels a refresh gave new ids', async () => {
    const library = await load()
    await library.init()
    db.getChannelChunk.mockResolvedValue([{ ...channel, id: 's:new' }]) // same stream and name
    await library.refresh('s')
    expect(library.currentId('s:1')).toBe('s:new')
    expect(library.currentId('s:other')).toBe('s:other')
  })

  it('doesn’t bring back a source deleted while a refresh loads it', async () => {
    const library = await load()
    await library.init()
    let loaded = () => {}
    db.getChannelChunk.mockReturnValueOnce(new Promise((resolve) => (loaded = () => resolve([channel]))))
    const refresh = library.refresh('s')
    await vi.waitFor(() => expect(db.getChannelChunk).toHaveBeenCalledTimes(2))
    const removal = library.remove('s')
    loaded()
    await expect(refresh).rejects.toThrow('Source deleted')
    await removal
    expect(library.getState()).toMatchObject({ sources: [], channels: [] })
  })

  it('clears the cache only once the saves running have stored their sources, and saves after it', async () => {
    const library = await load()
    await library.init()
    let finish = () => {}
    ingestSource.mockReturnValueOnce(new Promise((resolve) => (finish = () => resolve({ source, channels: 1, categories: 0 }))))
    const refresh = library.refresh('s')
    await vi.waitFor(() => expect(ingestSource).toHaveBeenCalledOnce())
    const clear = library.clearCache()
    const later = library.refresh('s')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(db.rebuildDatabase).not.toHaveBeenCalled()
    finish()
    await Promise.all([refresh, clear, later])
    const rebuilt = db.rebuildDatabase.mock.invocationCallOrder[0]
    expect(ingestSource.mock.invocationCallOrder.filter((order) => order > rebuilt)).toHaveLength(2) // clear cache's and the later refresh
  })
})

describe('renamedIds', () => {
  it('finds the new id of each stream that is still there, by address and name', async () => {
    const { renamedIds } = await import('../src/data/library')
    const stream = (id: string, url: string, name: string) => ({ id, sourceId: 's', name, number: 1, urls: [url] })
    const before = {
      channels: [stream('s:old1', 'http://x/1', 'One'), stream('s:same', 'http://x/2', 'Two'), stream('s:gone', 'http://x/3', 'Three')],
      movies: [{ id: 's:m-old', sourceId: 's', name: 'Film', urls: ['http://x/film.mkv'] }],
      series: [{ id: 's:s:old', sourceId: 's', categoryId: 'c', name: 'Шоу', episodes: [{ id: 's:e-old', season: 1, episode: 2, title: '', urls: ['http://x/e.mkv'] }] }],
    }
    const after = {
      channels: [stream('s:new1', 'http://x/1', 'One'), stream('s:same', 'http://x/2', 'Two')],
      movies: [{ id: 's:m-new', sourceId: 's', name: 'Film', urls: ['http://x/film.mkv'] }],
      series: [{ id: 's:s:new', sourceId: 's', categoryId: 'c', name: 'Шоу', episodes: [{ id: 's:e-new', season: 1, episode: 2, title: '', urls: ['http://x/e.mkv'] }] }],
    }
    expect(renamedIds(before, after)).toEqual(
      new Map([
        ['s:old1', 's:new1'],
        ['s:m-old', 's:m-new'],
        ['s:s:old', 's:s:new'],
        ['s:e-old', 's:e-new'],
      ]),
    )
  })

  it('matches a stream listed twice under one name in order', async () => {
    const { renamedIds } = await import('../src/data/library')
    const stream = (id: string) => ({ id, sourceId: 's', name: 'News', number: 1, urls: ['http://x/news'] })
    const renamed = renamedIds({ channels: [stream('a'), stream('a~2')], movies: [], series: [] }, { channels: [stream('b'), stream('b~2')], movies: [], series: [] })
    expect(renamed).toEqual(new Map([['a', 'b'], ['a~2', 'b~2']]))
  })
})
