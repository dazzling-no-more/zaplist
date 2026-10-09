import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, M3uSource } from '../src/data/models'

const db = vi.hoisted(() => ({
  getSources: vi.fn(),
  getPlaylistMeta: vi.fn(),
  getChannelChunk: vi.fn(),
  getSecretSettings: vi.fn(),
  putSecretSettings: vi.fn(),
  clearCache: vi.fn(),
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
