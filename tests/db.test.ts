import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { CHUNK_SIZE, deleteSource, getChannelChunk, getPlaylistMeta, getSources, savePlaylist } from '../src/data/db'
import type { Channel, M3uSource, Playlist } from '../src/data/models'

const source = (id: string, addedAt: number): M3uSource => ({ id, kind: 'm3u', name: id, url: `http://example.com/${id}.m3u`, addedAt })

const playlist = (sourceId: string, count: number): Playlist => ({
  categories: [{ id: `${sourceId}:g:A`, sourceId, name: 'A' }],
  epgUrls: ['http://example.com/guide.xml'],
  channels: Array.from({ length: count }, (_, i): Channel => ({ id: `${sourceId}:${i}`, sourceId, name: `Ch ${i}`, number: i + 1, urls: [`http://example.com/${i}`] })),
})

describe('IndexedDB storage', () => {
  it('stores a playlist in chunks and reads it back', async () => {
    await savePlaylist(source('a', 2), playlist('a', CHUNK_SIZE * 2 + 5))
    const meta = await getPlaylistMeta('a')
    expect(meta).toMatchObject({ sourceId: 'a', chunks: 3, epgUrls: ['http://example.com/guide.xml'] })
    expect(await getChannelChunk('a', 0)).toHaveLength(CHUNK_SIZE)
    const last = await getChannelChunk('a', 2)
    expect(last.map((c) => c.id)).toEqual(['a:4000', 'a:4001', 'a:4002', 'a:4003', 'a:4004'])
  })

  it('replaces old chunks when a source shrinks', async () => {
    await savePlaylist(source('a', 2), playlist('a', 10))
    expect((await getPlaylistMeta('a'))?.chunks).toBe(1)
    expect(await getChannelChunk('a', 1)).toEqual([])
  })

  it('lists sources by the order they were added and deletes one with its channels', async () => {
    await savePlaylist(source('b', 1), playlist('b', 3))
    expect((await getSources()).map((s) => s.id)).toEqual(['b', 'a'])
    await deleteSource('b')
    expect((await getSources()).map((s) => s.id)).toEqual(['a'])
    expect(await getPlaylistMeta('b')).toBeUndefined()
    expect(await getChannelChunk('b', 0)).toEqual([])
    expect(await getChannelChunk('a', 0)).toHaveLength(10)
  })
})
