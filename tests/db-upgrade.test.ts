import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'

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
