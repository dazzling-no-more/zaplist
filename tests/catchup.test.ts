import { describe, expect, it } from 'vitest'
import { catchupUrls, fillTemplate, replayableFrom } from '../src/data/catchup'
import type { Channel, Source, XtreamSource } from '../src/data/models'

// 2026-10-15 18:00 to 19:30 UTC, watched at 21:00 UTC.
const START = Date.UTC(2026, 9, 15, 18, 0, 0)
const STOP = Date.UTC(2026, 9, 15, 19, 30, 0)
const NOW = Date.UTC(2026, 9, 15, 21, 0, 0)
const s = (ms: number) => ms / 1000

const channel = (url: string, catchup: Channel['catchup'], extra: Partial<Channel> = {}): Channel => ({ id: 'c', sourceId: 'm', name: 'News', number: 1, urls: [url], catchup, ...extra })
const m3u: Source = { id: 'm', kind: 'm3u', name: 'M', url: 'http://list.example/a.m3u', addedAt: 1 }

describe('catchupUrls', () => {
  it('asks an Xtream server for the programme in the server’s time zone', () => {
    const xtream: XtreamSource = {
      id: 'x',
      kind: 'xtream',
      name: 'X',
      host: 'http://tv.example:8080/',
      username: 'u',
      password: 'p w',
      addedAt: 1,
      account: { status: 'Active', trial: false, outputFormats: [], timezone: 'Europe/Berlin' },
    }
    const urls = catchupUrls(channel('http://tv.example:8080/live/u/p/42.m3u8', { type: 'xc', days: 3 }, { sourceId: 'x', streamId: 42 }), xtream, START, STOP, NOW)
    expect(urls).toEqual([
      'http://tv.example:8080/timeshift/u/p%20w/90/2026-10-15:20-00/42.ts', // CEST, UTC+2
      'http://tv.example:8080/streaming/timeshift.php?username=u&password=p%20w&stream=42&start=2026-10-15:20-00&duration=90',
    ])
  })

  it('reads an Xtream server’s M3U addresses (catchup="xc"), in UTC', () => {
    expect(catchupUrls(channel('http://tv.example/live/u/p/7.ts', { type: 'xc' }), m3u, START, STOP, NOW)?.[0]).toBe('http://tv.example/timeshift/u/p/90/2026-10-15:18-00/7.ts')
    expect(catchupUrls(channel('http://tv.example/u/p/7', { type: 'xc' }), m3u, START, STOP, NOW)?.[0]).toBe('http://tv.example/timeshift/u/p/90/2026-10-15:18-00/7.ts')
  })

  it('fills catchup-source templates (default, append) and adds utc= for shift', () => {
    const template = 'http://archive.example/news?start={utc}&end=${end}&now={lutc}&len={duration:60}&at={utc:Y-m-d+H:M:S}'
    expect(catchupUrls(channel('http://live.example/news.m3u8', { type: 'default', source: template }), m3u, START, STOP, NOW)).toEqual([
      `http://archive.example/news?start=${s(START)}&end=${s(STOP)}&now=${s(NOW)}&len=90&at=2026-10-15+18:00:00`,
    ])
    expect(catchupUrls(channel('http://live.example/news.m3u8', { type: 'append', source: '?offset={offset:1}' }), m3u, START, STOP, NOW)).toEqual([
      `http://live.example/news.m3u8?offset=${s(NOW - START)}`,
    ])
    expect(catchupUrls(channel('http://live.example/news.m3u8?token=t', { type: 'shift' }), m3u, START, STOP, NOW)).toEqual([
      `http://live.example/news.m3u8?token=t&utc=${s(START)}&lutc=${s(NOW)}`,
    ])
  })

  it('turns Flussonic live addresses into archive ones', () => {
    expect(catchupUrls(channel('http://fs.example/news/index.m3u8?token=t', { type: 'flussonic' }), m3u, START, STOP, NOW)).toEqual([
      `http://fs.example/news/index-${s(START)}-5400.m3u8?token=t`,
    ])
    expect(catchupUrls(channel('http://fs.example/news/mpegts?token=t', { type: 'flussonic' }), m3u, START, STOP, NOW)).toEqual([`http://fs.example/news/timeshift_abs-${s(START)}.ts?token=t`])
  })

  it('has nothing for unsupported kinds or a template that is missing', () => {
    expect(catchupUrls(channel('http://live.example/a.m3u8', { type: 'vod' }), m3u, START, STOP, NOW)).toBeUndefined()
    expect(catchupUrls(channel('http://live.example/a.m3u8', { type: 'default' }), m3u, START, STOP, NOW)).toBeUndefined()
    expect(catchupUrls(channel('http://live.example/a.m3u8', undefined), m3u, START, STOP, NOW)).toBeUndefined()
  })
})

describe('replayableFrom', () => {
  it('goes back as many days as the channel keeps, one when it doesn’t say', () => {
    expect(replayableFrom(channel('http://tv.example/live/u/p/7.ts', { type: 'xc', days: 3 }), m3u, NOW)).toBe(NOW - 3 * 86_400_000)
    expect(replayableFrom(channel('http://live.example/a.m3u8', { type: 'shift' }), m3u, NOW)).toBe(NOW - 86_400_000)
    expect(replayableFrom(channel('http://live.example/a.m3u8', { type: 'vod' }), m3u, NOW)).toBeUndefined()
  })
})

describe('fillTemplate', () => {
  it('leaves placeholders it doesn’t know as they are', () => {
    expect(fillTemplate('{unknown}/{duration}', START, STOP, NOW)).toBe('{unknown}/5400')
  })
})
