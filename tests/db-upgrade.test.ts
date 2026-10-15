import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it, vi } from 'vitest'

describe('upgrading the database from 1.0', () => {
  it('drops cached lists that filed movies and episodes as channels, keeping sources and settings', async () => {
    // The version 3 database of Zaplist 1.0, with one cached playlist.
    const old = await openDB('iptv-player', 3, {
      upgrade(database) {
        database.createObjectStore('sources', { keyPath: 'id' })
        database.createObjectStore('playlists', { keyPath: 'sourceId' })
        database.createObjectStore('channelChunks', { keyPath: ['sourceId', 'index'] })
        database.createObjectStore('guide', { keyPath: 'key' })
        database.createObjectStore('meta')
        database.createObjectStore('keys')
        database.createObjectStore('settings')
      },
    })
    await old.put('sources', { id: 's', kind: 'm3u', name: 'S', url: 'http://example.com/s.m3u', addedAt: 1 })
    await old.put('playlists', { sourceId: 's', categories: [], epgUrls: [], chunks: 1 })
    await old.put('channelChunks', { sourceId: 's', index: 0, channels: [] })
    await old.put('settings', { pin: '1234' }, 'secrets')
    old.close()

    const { db, getPlaylistMeta, getSources, getVodChunk } = await import('../src/data/db')
    expect(await getPlaylistMeta('s')).toBeUndefined() // the library downloads the source again
    expect(await (await db()).count('channelChunks')).toBe(0)
    expect((await getSources()).map((s) => s.id)).toEqual(['s'])
    expect(await (await db()).get('settings', 'secrets')).toEqual({ pin: '1234' })
    expect(await getVodChunk('s', 0)).toEqual({ movies: [] })
  })
})

describe('guide records', () => {
  it('stores programmes compressed and still reads the uncompressed records of 1.0', async () => {
    const { db, getGuide, saveGuide } = await import('../src/data/db')
    const programmes = Array.from({ length: 50 }, (_, i) => ({ start: i * 1800_000, stop: (i + 1) * 1800_000, title: `Show ${i}`, description: 'The same long description of the programme, again and again.' }))
    await saveGuide(new Map([['bbc1', programmes]]))
    const stored = await (await db()).get('guide', 'bbc1')
    expect(stored?.programmes).toBeUndefined()
    expect(stored!.packed!.byteLength).toBeLessThan(JSON.stringify(programmes).length / 4)
    expect(await getGuide('bbc1')).toEqual(programmes)

    await (await db()).put('guide', { key: 'old', programmes })
    expect(await getGuide('old')).toEqual(programmes)
  })
})

describe('a full storage', () => {
  it('is reported as such, not as an unreadable playlist', async () => {
    const { toLoadError } = await import('../src/data/ingest')
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    expect(toLoadError(quota).code).toBe('storage')
    expect(toLoadError(new Error('boom')).code).toBe('format')
  })
})

describe('clear cache', () => {
  it('rebuilds the database with the sources and secret settings only', async () => {
    const { getChannelChunk, getPlaylistMeta, getSecretSettings, getSources, putSecretSettings, rebuildDatabase, savePlaylist } = await import('../src/data/db')
    const source = { id: 'r', kind: 'm3u' as const, name: 'R', url: 'http://example.com/r.m3u?token=t0k', addedAt: 5 }
    const channel = { id: 'r:1', sourceId: 'r', name: 'One', number: 1, urls: ['http://example.com/1.ts'] }
    await savePlaylist(source, { categories: [], channels: [channel], movies: [], series: [], epgUrls: [] })
    await putSecretSettings({ pin: '9876' })

    // Another connection, like the worker's, must step aside instead of blocking the deletion.
    vi.resetModules()
    const other = await import('../src/data/db')
    expect((await other.getSources()).map((s) => s.id)).toContain('r')

    await rebuildDatabase()
    expect((await getSources()).find((s) => s.id === 'r')).toEqual(source)
    expect(await getSecretSettings()).toEqual({ pin: '9876' })
    expect(await getPlaylistMeta('r')).toBeUndefined()
    expect(await getChannelChunk('r', 0)).toEqual([])

    // The other connection reopens and reads what was sealed with the new key.
    expect((await other.getSources()).find((s) => s.id === 'r')).toEqual(source)
    await other.savePlaylist(source, { categories: [], channels: [channel], movies: [], series: [], epgUrls: [] })
    expect(await getChannelChunk('r', 0)).toEqual([channel])
  })
})
