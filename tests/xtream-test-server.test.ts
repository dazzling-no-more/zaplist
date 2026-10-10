import { describe, expect, it } from 'vitest'
import type { XtreamSource } from '../src/data/models'
import { apiUrl, liveUrls, parseAccount, xmltvUrl, xtreamToPlaylist, XtreamAuthError, type XtreamLogin } from '../src/data/xtream'

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
    const [hls, ts] = liveUrls(source, 101, ['m3u8', 'ts'])
    const first = await get(hls)
    expect(first.status).toBe(302)
    expect(first.headers.get('location')).toBe('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')
    expect(first.headers.get('access-control-allow-origin')).toBe('*')
    expect((await get(ts)).status).toBe(404) // an HLS-only stream: the app moves on to the next URL
    expect((await get(liveUrls(source, 105, ['ts'])[0])).headers.get('location')).toMatch(/\.ts$/)
    expect((await get(liveUrls({ ...source, password: 'nope' }, 101, ['m3u8'])[0])).status).toBe(403)
  })
})
