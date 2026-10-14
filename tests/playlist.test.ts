import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseM3u } from '../src/data/m3u'
import { assignNumbers, entryKind, m3uToPlaylist, parseEpisodeName } from '../src/data/playlist'
import { decodeText } from '../src/data/text'

const load = (name: string) => parseM3u(decodeText(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))))

describe('m3uToPlaylist', () => {
  const playlist = m3uToPlaylist('s1', load('messy.m3u'))
  const channel = (urlSuffix: string) => playlist.channels.find((c) => c.urls[0].endsWith(urlSuffix))!

  it('creates categories from group-title and #EXTGRP in first-seen order', () => {
    // The broken-quote entry's quoted tvg-logo swallows its group-title, so it has no category.
    expect(playlist.categories.map((c) => c.name)).toEqual(['News', 'Movies', 'Sports'])
    expect(playlist.categories[0]).toEqual({ id: 's1:g:News', sourceId: 's1', name: 'News' })
    expect(channel('/extgrp.m3u8').categoryId).toBe('s1:g:Sports')
    expect(channel('/plain.ts').categoryId).toBeUndefined()
  })

  it('gives every channel a unique, stable id', () => {
    const ids = playlist.channels.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id.includes('~2'))).toHaveLength(1)
    expect(m3uToPlaylist('s1', load('messy.m3u')).channels.map((c) => c.id)).toEqual(ids)
  })

  it('names channels from the title, then tvg-name, then the URL', () => {
    expect(channel('/news.m3u8').name).toBe('News 24')
    expect(channel('/no-extinf.m3u8').name).toBe('http://example.com/no-extinf.m3u8')
  })

  it('maps guide, catch-up and option attributes', () => {
    const catchup = channel('/catchup.mpd')
    expect(catchup).toMatchObject({
      number: 7,
      epgShift: -1.5,
      catchup: { type: 'default', source: 'http://example.com/archive?start={utc}', days: 3 },
      options: { 'inputstream.adaptive.license_type': 'com.widevine.alpha' },
    })
    expect(channel('/news.m3u8')).toMatchObject({ tvgId: 'news.example', tvgName: 'News' })
    expect(channel('/empty.m3u8').tvgId).toBeUndefined()
    expect(channel('/empty.m3u8').logo).toBeUndefined()
  })

  it('numbers channels after the highest tvg-chno', () => {
    const numbers = playlist.channels.map((c) => c.number)
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(channel('/news.m3u8').number).toBe(8)
  })

  it('keeps the playlist guide URLs', () => {
    expect(playlist.epgUrls).toEqual(['http://example.com/a.xml.gz', 'http://example.com/b.xml'])
  })
})

describe('assignNumbers', () => {
  it('numbers from 1 when no channel has a number', () => {
    const channels = [{ number: 0 }, { number: 0 }]
    assignNumbers(channels)
    expect(channels.map((c) => c.number)).toEqual([1, 2])
  })
})

describe('movies and series in M3U playlists', () => {
  const text = [
    '#EXTM3U',
    '#EXTINF:-1 group-title="News",News 24',
    'http://tv.example.com/user/pass/101',
    '#EXTINF:-1 tvg-logo="http://img/agnelli.jpg" group-title="Docs",Agnelli - 2017',
    'http://tv.example.com/movie/user/pass/47675.mp4',
    '#EXTINF:-1 group-title="Classic TV",Rafferty\'s Rules (1987) S03 E24',
    'http://tv.example.com/series/user/pass/260597.mkv',
    '#EXTINF:-1 tvg-logo="http://img/rafferty.jpg" group-title="Classic TV",Rafferty\'s Rules (1987) S01 E02',
    'http://tv.example.com/series/user/pass/260500.mkv',
    '#EXTINF:-1 group-title="Classic TV",Rafferty\'s Rules (1987) S01 E01',
    'http://tv.example.com/series/user/pass/260499.mkv',
    '#EXTINF:-1 group-title="Films",Big Buck Bunny',
    'https://cdn.example.com/films/bbb.mp4',
    '#EXTINF:-1 group-title="Shows",Open Shorts S01E02 - Sintel',
    'https://cdn.example.com/shorts/sintel.mp4',
    '#EXTINF:-1 group-title="News",Hls News',
    'https://cdn.example.com/live/news.m3u8',
  ].join('\n')
  const playlist = m3uToPlaylist('s1', parseM3u(text))

  it('keeps live channels apart from movies and episodes', () => {
    expect(playlist.channels.map((c) => [c.name, c.number])).toEqual([
      ['News 24', 1],
      ['Hls News', 2],
    ])
    expect(playlist.movies.map((m) => m.name)).toEqual(['Agnelli - 2017', 'Big Buck Bunny'])
    expect(playlist.movies[0]).toMatchObject({ categoryId: 's1:m:Docs', poster: 'http://img/agnelli.jpg', urls: ['http://tv.example.com/movie/user/pass/47675.mp4'] })
  })

  it('groups episodes into series, in season and episode order', () => {
    expect(playlist.series.map((s) => s.name)).toEqual(["Rafferty's Rules (1987)", 'Open Shorts'])
    const [rafferty, shorts] = playlist.series
    expect(rafferty.episodes!.map((e) => `${e.season}x${e.episode}`)).toEqual(['1x1', '1x2', '3x24'])
    expect(rafferty).toMatchObject({ categoryId: 's1:s:Classic TV', poster: 'http://img/rafferty.jpg' })
    expect(shorts.episodes![0]).toMatchObject({ season: 1, episode: 2, title: 'Sintel' })
  })

  it('gives live, movie and series categories with the same name separate ids', () => {
    expect(playlist.categories.map((c) => [c.id, c.kind])).toEqual([
      ['s1:g:News', undefined],
      ['s1:m:Docs', 'movie'],
      ['s1:s:Classic TV', 'series'],
      ['s1:m:Films', 'movie'],
      ['s1:s:Shows', 'series'],
    ])
  })
})

describe('entryKind and parseEpisodeName', () => {
  it('tells live streams, movies and episodes apart', () => {
    expect(entryKind('http://h/u/p/123', 'Channel')).toBe('live')
    expect(entryKind('http://h/live/u/p/123.ts', 'Channel')).toBe('live')
    expect(entryKind('http://h/movie/u/p/1.mkv', 'Film S01E01 lookalike')).toBe('movie')
    expect(entryKind('http://h/series/u/p/1.mkv', 'No numbers')).toBe('episode')
    expect(entryKind('http://h/files/show.s02e05.mkv?x=1', 'Show 2x05')).toBe('episode')
    expect(entryKind('http://h/files/film.avi', 'Film')).toBe('movie')
  })

  it('reads the series name, season and episode', () => {
    expect(parseEpisodeName('Show Name S02 E07 - The Title')).toEqual({ series: 'Show Name', season: 2, episode: 7, title: 'The Title' })
    expect(parseEpisodeName('Show.Name.s1e3')).toEqual({ series: 'Show.Name', season: 1, episode: 3, title: '' })
    expect(parseEpisodeName('Other 3x12')).toEqual({ series: 'Other', season: 3, episode: 12, title: '' })
    expect(parseEpisodeName('Just a title')).toEqual({ series: 'Just a title', season: 1, episode: 0, title: 'Just a title' })
  })
})
