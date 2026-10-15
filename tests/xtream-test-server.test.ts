import { describe, expect, it } from 'vitest'
import type { XtreamSource } from '../src/data/models'
import { apiUrl, liveUrls, parseAccount, parseSeriesInfo, xmltvUrl, xtreamToPlaylist, xtreamVod, XtreamAuthError, type XtreamLogin } from '../src/data/xtream'

// The reviewers' test server (store/xtream-test-server.js, a Cloudflare Worker), checked against the
// app's own Xtream client code. The import path is cast so TypeScript doesn't type the plain JS file.
const worker = (await import('../store/xtream-test-server.js' as string)).default as { fetch: (request: Request) => Promise<Response> }

const HOST = 'https://zaplist-test.example.workers.dev'
const source: XtreamSource = { id: 'x', kind: 'xtream', name: 'Test', host: HOST, username: 'zaplist', password: 'review', addedAt: 0 }
const get = (url: string) => worker.fetch(new Request(url))
const getJson = async <T>(url: string) => (await (await get(url)).json()) as T

describe('Xtream test server', () => {
  it('accepts the test login and gives the app a playable channel list', async () => {
    const account = parseAccount(await getJson<XtreamLogin>(apiUrl(source)))
    expect(account).toMatchObject({ status: 'Active', expiresAt: undefined, outputFormats: ['m3u8', 'ts'] })
    const categories = await getJson<[]>(apiUrl(source, { action: 'get_live_categories' }))
    const streams = await getJson<[]>(apiUrl(source, { action: 'get_live_streams' }))
    const playlist = xtreamToPlaylist(source, account, categories, streams)
    expect(playlist.categories.map((c) => c.name)).toEqual(['Open movies', 'Test streams'])
    expect(playlist.channels).toHaveLength(5)
    expect(playlist.channels[0]).toMatchObject({ name: 'Big Buck Bunny', tvgId: 'bbb.zaplist', number: 1 })
    expect(playlist.epgUrls).toEqual([xmltvUrl(source)])
  })

  it('rejects a wrong password the way the app recognizes', async () => {
    const login = await getJson<XtreamLogin>(apiUrl({ ...source, password: 'nope' }))
    expect(() => parseAccount(login)).toThrow(XtreamAuthError)
  })

  it('redirects each stream URL the app builds to the test stream that has that format', async () => {
    const [ts, hls] = liveUrls(source, 101, ['m3u8', 'ts'])
    expect((await get(ts)).status).toBe(404) // an HLS-only stream: the app moves on to the next URL
    const second = await get(hls)
    expect(second.status).toBe(302)
    expect(second.headers.get('location')).toBe('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')
    expect(second.headers.get('access-control-allow-origin')).toBe('*')
    expect((await get(liveUrls(source, 105, ['ts'])[0])).headers.get('location')).toMatch(/\.ts$/)
    expect((await get(liveUrls({ ...source, password: 'nope' }, 101, ['m3u8'])[0])).status).toBe(403)
  })

  it('serves movies and a two-season series the app can play', async () => {
    const vod = xtreamVod(
      source,
      await getJson<[]>(apiUrl(source, { action: 'get_vod_categories' })),
      await getJson<[]>(apiUrl(source, { action: 'get_vod_streams' })),
      await getJson<[]>(apiUrl(source, { action: 'get_series_categories' })),
      await getJson<[]>(apiUrl(source, { action: 'get_series' })),
    )
    expect(vod.movies.map((m) => m.name)).toEqual(['Big Buck Bunny', 'Tears of Steel', 'Sintel (trailer)'])
    expect(vod.categories.map((c) => [c.name, c.kind])).toEqual([
      ['Open movies', 'movie'],
      ['Test series', 'series'],
    ])
    const sintel = await get(vod.movies[2].urls[0])
    expect(sintel.status).toBe(302)
    expect(sintel.headers.get('location')).toBe('https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4')

    const episodes = parseSeriesInfo(source, await getJson(apiUrl(source, { action: 'get_series_info', series_id: vod.series[0].seriesId! })))
    expect(episodes.map((e) => `S${e.season}E${e.episode} ${e.title}`)).toEqual(['S1E1 Audio languages', 'S1E2 Subtitles', 'S2E1 MP4 file'])
    expect((await get(episodes[2].urls[0])).headers.get('location')).toMatch(/sintel_trailer-480p\.mp4$/)
    expect((await get(episodes[2].urls[0].replace('.mp4', '.mkv'))).status).toBe(404)
  })
})
