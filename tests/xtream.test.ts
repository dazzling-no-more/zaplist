import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { XtreamSource } from '../src/data/models'
import {
  apiUrl,
  liveUrls,
  normalizeHost,
  parseAccount,
  parseShortEpg,
  xmltvUrl,
  XtreamAuthError,
  xtreamToPlaylist,
} from '../src/data/xtream'

const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

const source: XtreamSource = {
  id: 'x1',
  kind: 'xtream',
  name: 'Demo',
  host: 'http://example.com:8080',
  username: 'demo',
  password: 'p@ss word',
  addedAt: 0,
}

describe('normalizeHost', () => {
  it.each([
    ['example.com:8080', 'http://example.com:8080'],
    ['http://example.com:8080/', 'http://example.com:8080'],
    ['https://example.com', 'https://example.com'],
    ['  http://example.com:8080/player_api.php?username=a&password=b ', 'http://example.com:8080'],
    ['http://example.com/get.php?username=a&password=b&type=m3u_plus', 'http://example.com'],
    ['http://example.com/panel/', 'http://example.com/panel'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeHost(input)).toBe(expected)
  })
})

describe('URLs', () => {
  it('encodes credentials in API, guide and stream URLs', () => {
    expect(apiUrl(source, { action: 'get_live_streams' })).toBe(
      'http://example.com:8080/player_api.php?username=demo&password=p%40ss%20word&action=get_live_streams',
    )
    expect(xmltvUrl(source)).toBe('http://example.com:8080/xmltv.php?username=demo&password=p%40ss%20word')
  })

  it('prefers HLS and falls back to MPEG-TS, within the allowed formats', () => {
    const base = 'http://example.com:8080/live/demo/p%40ss%20word/5'
    expect(liveUrls(source, 5, ['m3u8', 'ts', 'rtmp'])).toEqual([`${base}.m3u8`, `${base}.ts`])
    expect(liveUrls(source, 5, [])).toEqual([`${base}.m3u8`, `${base}.ts`])
    expect(liveUrls(source, 5, ['ts'])).toEqual([`${base}.ts`])
    expect(liveUrls(source, 5, ['rtmp'])).toEqual([`${base}.ts`])
  })
})

describe('parseAccount', () => {
  it('reads expiry, connections and output formats', () => {
    expect(parseAccount(json('xtream-login.json'))).toEqual({
      status: 'Active',
      expiresAt: 1798761600000,
      maxConnections: 2,
      activeConnections: 0,
      trial: false,
      outputFormats: ['m3u8', 'ts', 'rtmp'],
    })
  })

  it('treats a null expiry as never expiring', () => {
    const login = json('xtream-login.json')
    login.user_info.exp_date = null
    expect(parseAccount(login).expiresAt).toBeUndefined()
  })

  it('throws on rejected logins', () => {
    expect(() => parseAccount(json('xtream-login-rejected.json'))).toThrow(XtreamAuthError)
    expect(() => parseAccount({})).toThrow(XtreamAuthError)
  })
})

describe('xtreamToPlaylist', () => {
  const account = parseAccount(json('xtream-login.json'))
  const playlist = xtreamToPlaylist(source, account, json('xtream-live-categories.json'), json('xtream-live-streams.json'))

  it('keeps the server category order and only used categories', () => {
    expect(playlist.categories).toEqual([
      { id: 'x1:c:10', sourceId: 'x1', name: 'News' },
      { id: 'x1:c:2', sourceId: 'x1', name: 'Sports' },
    ])
  })

  it('maps streams to channels and skips streams without an id', () => {
    expect(playlist.channels).toHaveLength(3)
    expect(playlist.channels[0]).toEqual({
      id: 'x1:501',
      sourceId: 'x1',
      categoryId: 'x1:c:2',
      name: 'Sports One',
      number: 1,
      logo: 'http://example.com/s1.png',
      tvgId: 'sports1.example',
      urls: liveUrls(source, 501, account.outputFormats),
      catchup: { type: 'xc', days: 7 },
      streamId: 501,
    })
    expect(playlist.channels[1]).toMatchObject({ id: 'x1:502', number: 2, logo: undefined, tvgId: undefined, catchup: undefined })
    expect(playlist.channels[2]).toMatchObject({ categoryId: undefined, number: 3 })
  })

  it('names the xmltv.php guide', () => {
    expect(playlist.epgUrls).toEqual([xmltvUrl(source)])
  })
})

describe('parseShortEpg', () => {
  it('decodes base64 UTF-8 titles and sorts by start', () => {
    expect(parseShortEpg(json('xtream-short-epg.json'))).toEqual([
      { start: 1791547200000, stop: 1791554400000, title: 'Morning Show: Café', description: undefined },
      { start: 1791554400000, stop: 1791561600000, title: 'Late Match', description: 'Second half — live' },
    ])
  })
})
