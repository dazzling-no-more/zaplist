import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { getChannelChunk, getPlaylistMeta, getVodChunk, savePlaylist } from '../src/data/db'
import { ingest } from '../src/data/ingest'
import type { M3uSource, XtreamSource } from '../src/data/models'

const source: M3uSource = { id: 'a', kind: 'm3u', name: 'A', url: 'http://example.com/a.m3u', addedAt: 1 }

afterEach(() => vi.unstubAllGlobals())

describe('ingest', () => {
  it('keeps the cached playlist when the server answers with an error page', async () => {
    const news = { id: 'a:1', sourceId: 'a', name: 'News', number: 1, urls: ['http://example.com/1'] }
    await savePlaylist(source, { categories: [], epgUrls: [], channels: [news], movies: [], series: [] })
    vi.stubGlobal('location', { origin: 'http://localhost' }) // the dev proxy (http.ts proxied) reads it
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html><body>Account expired</body></html>', { headers: { 'Content-Type': 'text/html' } })),
    )
    await expect(ingest(source, () => {})).rejects.toMatchObject({ code: 'format' })
    expect((await getChannelChunk('a', 0)).map((c) => c.name)).toEqual(['News'])
  })

  it('keeps the movies and series of the last refresh when the server can’t list them this time', async () => {
    const xtream: XtreamSource = { id: 'x', kind: 'xtream', name: 'X', host: 'http://x.example', username: 'u', password: 'p', addedAt: 1 }
    const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
    const answers: Record<string, string> = {
      '': fixture('xtream-login.json'),
      get_live_categories: fixture('xtream-live-categories.json'),
      get_live_streams: fixture('xtream-live-streams.json'),
      get_vod_categories: JSON.stringify([{ category_id: '7', category_name: 'Films' }]),
      get_vod_streams: JSON.stringify([{ stream_id: 9, name: 'Film', category_id: '7', container_extension: 'mkv' }]),
      get_series_categories: '[]',
      get_series: '[]',
    }
    vi.stubGlobal('location', { origin: 'http://localhost' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const action = /action=(\w+)/.exec(url)?.[1] ?? ''
        return action in answers ? new Response(answers[action]) : new Response(null, { status: 504 })
      }),
    )
    await ingest(xtream, () => {})
    delete answers.get_vod_streams // times out
    const result = await ingest({ ...xtream, password: 'new' }, () => {}) // after the password was changed
    expect(result.movies).toBe(1)
    expect((await getVodChunk('x', 0)).movies?.map((m) => [m.name, m.urls[0]])).toEqual([['Film', 'http://x.example/movie/u/new/9.mkv']])
    expect((await getPlaylistMeta('x'))?.categories.filter((c) => c.kind).map((c) => c.name)).toEqual(['Films'])
  })
})
