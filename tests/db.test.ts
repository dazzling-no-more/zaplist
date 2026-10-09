import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { CHUNK_SIZE, db, deleteSource, getChannelChunk, getPlaylistMeta, getSources, savePlaylist } from '../src/data/db'
import type { Channel, M3uSource, Playlist, XtreamSource } from '../src/data/models'

const source = (id: string, addedAt: number): M3uSource => ({ id, kind: 'm3u', name: id, url: `http://example.com/${id}.m3u`, addedAt })

const playlist = (sourceId: string, count: number): Playlist => ({
  categories: [{ id: `${sourceId}:g:A`, sourceId, name: 'A' }],
  epgUrls: ['http://example.com/guide.xml'],
  channels: Array.from({ length: count }, (_, i): Channel => ({ id: `${sourceId}:${i}`, sourceId, name: `Ch ${i}`, number: i + 1, urls: [`http://example.com/${i}`] })),
})

describe('IndexedDB storage', () => {
  it('stores a playlist in chunks and reads it back', async () => {
    await savePlaylist(source('a', 2), playlist('a', CHUNK_SIZE * 2 + 5))
    const meta = await getPlaylistMeta(source('a', 2))
    expect(meta).toMatchObject({ sourceId: 'a', chunks: 3, epgUrls: ['http://example.com/guide.xml'] })
    expect(await getChannelChunk(source('a', 2), 0)).toHaveLength(CHUNK_SIZE)
    const last = await getChannelChunk(source('a', 2), 2)
    expect(last.map((c) => c.id)).toEqual(['a:4000', 'a:4001', 'a:4002', 'a:4003', 'a:4004'])
  })

  it('replaces old chunks when a source shrinks', async () => {
    await savePlaylist(source('a', 2), playlist('a', 10))
    expect((await getPlaylistMeta(source('a', 2)))?.chunks).toBe(1)
    expect(await getChannelChunk(source('a', 2), 1)).toEqual([])
  })

  it('lists sources by the order they were added and deletes one with its channels', async () => {
    await savePlaylist(source('b', 1), playlist('b', 3))
    expect((await getSources()).map((s) => s.id)).toEqual(['b', 'a'])
    await deleteSource('b')
    expect((await getSources()).map((s) => s.id)).toEqual(['a'])
    expect(await getPlaylistMeta(source('b', 1))).toBeUndefined()
    expect(await getChannelChunk(source('b', 1), 0)).toEqual([])
    expect(await getChannelChunk(source('a', 2), 0)).toHaveLength(10)
  })

  it('keeps the login out of the stored data and restores it on read', async () => {
    const xtream: XtreamSource = { id: 'x', kind: 'xtream', name: 'Provider', host: 'http://tv.example.com:8080', username: 'alice77', password: 's3cret!pw', addedAt: 3 }
    const login = 'http://tv.example.com:8080/live/alice77/s3cret!pw'
    await savePlaylist(xtream, {
      categories: [],
      epgUrls: ['http://tv.example.com:8080/xmltv.php?username=alice77&password=s3cret!pw'],
      channels: [{ id: 'x:1', sourceId: 'x', name: 'One', number: 1, urls: [`${login}/1.ts`, `${login}/1.m3u8`] }],
    })

    const database = await db()
    const raw = JSON.stringify([await database.getAll('sources'), await database.getAll('playlists'), await database.getAll('channelChunks')])
    expect(raw).not.toContain('alice77')
    expect(raw).not.toContain('s3cret')

    expect((await getSources()).find((s) => s.id === 'x')).toEqual(xtream)
    expect((await getPlaylistMeta(xtream))?.epgUrls).toEqual(['http://tv.example.com:8080/xmltv.php?username=alice77&password=s3cret!pw'])
    expect((await getChannelChunk(xtream, 0))[0].urls).toEqual([`${login}/1.ts`, `${login}/1.m3u8`])
  })
})
