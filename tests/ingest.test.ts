import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getChannelChunk, savePlaylist } from '../src/data/db'
import { ingest } from '../src/data/ingest'
import type { M3uSource } from '../src/data/models'

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
})
