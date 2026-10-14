import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { XtreamSource } from '../src/data/models'
import {
  apiUrl,
  liveUrls,
  normalizeHost,
  parseAccount,
  parseSeriesInfo,
  parseShortEpg,
  parseVodInfo,
  xmltvUrl,
  XtreamAuthError,
  xtreamToPlaylist,
  xtreamVod,
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

  it.each([null, '0', '-1', 0])('treats an expiry of %s as never expiring', (value) => {
    const login = json('xtream-login.json')
    login.user_info.exp_date = value
    expect(parseAccount(login).expiresAt).toBeUndefined()
  })

  it('accepts auth as a number, string or boolean', () => {
    for (const auth of [1, '1', true]) {
      const login = json('xtream-login.json')
      login.user_info.auth = auth
      expect(parseAccount(login).status).toBe('Active')
    }
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

describe('movies and series', () => {
  const vod = xtreamVod(
    source,
    [
      { category_id: 10, category_name: 'Action' },
      { category_id: 11, category_name: 'Empty' },
    ],
    [
      { stream_id: 9001, name: 'Film One', stream_icon: 'http://img/1.jpg', category_id: '10', container_extension: 'mkv' },
      { stream_id: '9002', name: 'Film Two', category_id: 99 },
      { name: 'No id' },
    ],
    [{ category_id: '20', category_name: 'Drama' }],
    [{ series_id: 70, name: 'Show', cover: 'http://img/show.jpg', plot: 'Plot', releaseDate: '2020-01-02', category_id: 20 }],
  )

  it('maps movies with their file URLs, and keeps only categories that have something', () => {
    expect(vod.movies[0]).toEqual({
      id: 'x1:m:9001',
      sourceId: 'x1',
      categoryId: 'x1:mc:10',
      name: 'Film One',
      poster: 'http://img/1.jpg',
      urls: ['http://example.com:8080/movie/demo/p%40ss%20word/9001.mkv'],
      vodId: 9001,
    })
    expect(vod.movies[1].urls).toEqual(['http://example.com:8080/movie/demo/p%40ss%20word/9002.mp4'])
    expect(vod.movies).toHaveLength(2)
    expect(vod.categories).toEqual([
      { id: 'x1:mc:10', sourceId: 'x1', name: 'Action', kind: 'movie' },
      { id: 'x1:mc:99', sourceId: 'x1', name: '99', kind: 'movie' },
      { id: 'x1:sc:20', sourceId: 'x1', name: 'Drama', kind: 'series' },
    ])
  })

  it('maps series without episodes, which the server lists per series', () => {
    expect(vod.series).toEqual([
      { id: 'x1:s:70', sourceId: 'x1', categoryId: 'x1:sc:20', name: 'Show', poster: 'http://img/show.jpg', plot: 'Plot', released: '2020-01-02', seriesId: 70 },
    ])
  })

  it('reads a series’ episodes from get_series_info', () => {
    const episodes = parseSeriesInfo(source, {
      episodes: {
        '2': [{ id: '502', episode_num: 1, title: 'Two-one', season: 2, container_extension: 'mp4', info: { duration_secs: '2700', plot: 'P' } }],
        '1': [
          { id: 402, episode_num: '2', title: 'One-two', season: '1', container_extension: 'mkv', info: [] },
          { id: 401, episode_num: 1, title: 'One-one', season: 1, container_extension: 'mkv' },
        ],
      },
    })
    expect(episodes.map((e) => [e.id, e.season, e.episode])).toEqual([
      ['x1:e:401', 1, 1],
      ['x1:e:402', 1, 2],
      ['x1:e:502', 2, 1],
    ])
    expect(episodes[2]).toMatchObject({ urls: ['http://example.com:8080/series/demo/p%40ss%20word/502.mp4'], duration: 2700, plot: 'P' })
  })

  it('reads movie details from get_vod_info', () => {
    expect(parseVodInfo({ info: { description: 'About', releasedate: '2017', duration_secs: '5400', genre: 'Drama', actors: 'A, B' } })).toEqual({
      plot: 'About',
      released: '2017',
      duration: 5400,
      genre: 'Drama',
      cast: 'A, B',
      director: undefined,
    })
  })
})
