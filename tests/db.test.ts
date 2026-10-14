import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { CHUNK_SIZE, db, deleteSource, getChannelChunk, getPlaylistMeta, getSecretSettings, getSources, getVodChunk, putSecretSettings, savePlaylist, vodChunks } from '../src/data/db'
import type { Channel, M3uSource, Movie, Playlist, Series, XtreamSource } from '../src/data/models'

const source = (id: string, addedAt: number): M3uSource => ({ id, kind: 'm3u', name: id, url: `http://example.com/${id}.m3u`, addedAt })

const playlist = (sourceId: string, count: number): Playlist => ({
  categories: [{ id: `${sourceId}:g:A`, sourceId, name: 'A' }],
  epgUrls: ['http://example.com/guide.xml'],
  channels: Array.from({ length: count }, (_, i): Channel => ({ id: `${sourceId}:${i}`, sourceId, name: `Ch ${i}`, number: i + 1, urls: [`http://example.com/${i}`] })),
  movies: [],
  series: [],
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

  it('stores sources, channel lists and guide URLs encrypted, wherever a login or token sits', async () => {
    const secret = 'tok3nSECRET'
    const xtream: XtreamSource = { id: 'x', kind: 'xtream', name: 'Provider', host: 'http://tv.example.com:8080', username: 'alice77', password: secret, addedAt: 3 }
    const m3u: M3uSource = { id: 't', kind: 'm3u', name: 'Tokens', url: `http://tv.example.com/list.m3u?token=${secret}`, addedAt: 4 }
    const channel: Channel = {
      id: 't:1',
      sourceId: 't',
      name: 'One',
      number: 1,
      urls: [`http://tv.example.com/live/alice77/${secret}/1.ts`, `http://cdn.example.com/1.m3u8?token=${secret}`],
      logo: `http://img.example.com/1.png?sig=${secret}`,
      options: { 'http-referrer': `http://tv.example.com/?auth=${secret}` },
    }
    const epgUrls = [`http://tv.example.com/epg.xml?token=${secret}`]
    const movie: Movie = { id: 't:m', sourceId: 't', name: 'Film', urls: [`http://tv.example.com/movie/alice77/${secret}/9.mkv`] }
    const show: Series = {
      id: 't:s',
      sourceId: 't',
      name: 'Show',
      episodes: [{ id: 't:e', season: 1, episode: 1, title: 'Pilot', urls: [`http://tv.example.com/series/alice77/${secret}/7.mp4`] }],
    }
    await savePlaylist(xtream, { categories: [], epgUrls, channels: [{ ...channel, id: 'x:1', sourceId: 'x' }], movies: [], series: [] })
    await savePlaylist(m3u, { categories: [], epgUrls, channels: [channel], movies: [movie], series: [show] })

    const database = await db()
    const stores = ['sources', 'playlists', 'channelChunks', 'vodChunks'] as const
    const raw = JSON.stringify(await Promise.all(stores.map((store) => database.getAll(store))))
    expect(raw).not.toContain(secret)
    expect(raw).not.toContain('alice77')

    const sources = await getSources()
    expect(sources.find((s) => s.id === 'x')).toEqual(xtream)
    expect(sources.find((s) => s.id === 't')).toEqual(m3u)
    expect((await getPlaylistMeta('t'))?.epgUrls).toEqual(epgUrls)
    expect(await getChannelChunk('t', 0)).toEqual([channel])
    expect(await getVodChunk('t', 0)).toEqual({ movies: [movie] })
    expect(await getVodChunk('t', 1)).toEqual({ series: [show] })
  })

  it('splits movies and series into chunks, counting every episode', () => {
    const movies = Array.from({ length: CHUNK_SIZE + 1 }, (_, i): Movie => ({ id: `m${i}`, sourceId: 'a', name: `M${i}`, urls: [] }))
    const episodes = Array.from({ length: CHUNK_SIZE }, (_, i) => ({ id: `e${i}`, season: 1, episode: i + 1, title: '', urls: [] }))
    const series: Series[] = [
      { id: 's1', sourceId: 'a', name: 'Long', episodes },
      { id: 's2', sourceId: 'a', name: 'Short', episodes: episodes.slice(0, 2) },
    ]
    expect(vodChunks(movies, series).map((c) => (c.movies ? `m${c.movies.length}` : `s${c.series!.length}`))).toEqual(['m2000', 'm1', 's1', 's1'])
  })

  it('keeps the PIN and the extra guide URL encrypted', async () => {
    const secrets = { pin: '4321', epgUrl: 'http://tv.example.com/xmltv.php?username=bob&password=pw9secret' }
    await putSecretSettings(secrets)
    const raw = JSON.stringify(await (await db()).getAll('settings'))
    expect(raw).not.toContain('4321')
    expect(raw).not.toContain('pw9secret')
    expect(await getSecretSettings()).toEqual(secrets)
  })
})
