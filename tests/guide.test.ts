import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, Source } from '../src/data/models'

// The guide refreshed and looked up as the app does it, with fake sources and guide servers; the
// worker's job runs in place.
const state = vi.hoisted(() => ({
  sources: [] as Source[],
  channels: [] as Channel[],
  /** Guide URLs each source's playlist names. */
  playlistGuides: {} as Record<string, string[]>,
  prefs: { epgOffsetMinutes: 0, epgRefreshHours: 12 } as { epgUrl?: string; epgOffsetMinutes: number; epgRefreshHours: number },
}))
vi.mock('../src/data/library', () => ({
  library: { getState: () => ({ sources: state.sources, channels: state.channels }), epgUrls: (id: string) => state.playlistGuides[id] ?? [] },
}))
vi.mock('../src/data/prefs', async (importOriginal) => ({ ...(await importOriginal<object>()), getPrefs: () => state.prefs }))
vi.mock('../src/data/worker', async () => {
  const { ingestGuide } = await import('../src/data/guideIngest')
  return { ingestGuideUrls: ingestGuide }
})

const { guide } = await import('../src/data/guide')
const { MAX_OFFSET_MINUTES, nowNext, shiftMs } = await import('../src/data/guideData')

const HOUR = 3_600_000
const A = 'http://a.example/guide.xml'
const B = 'http://b.example/guide.xml'
const GLOBAL = 'http://global.example/guide.xml'

const source = (id: string): Source => ({ id, kind: 'm3u', name: id, url: `http://${id}.example/list.m3u`, addedAt: 1 })
const sport = (sourceId: string): Channel => ({ id: `${sourceId}:1`, sourceId, name: 'Sport 1', tvgId: 'sport1', number: 1, urls: [`http://${sourceId}.example/1`] })

/** XMLTV with an hour-long programme on `channel` every hour from `from` to `to`. */
function xmltv(channel: string, from: number, to: number, title: (start: number) => string): string {
  const time = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000'
  let programmes = ''
  for (let t = from; t < to; t += HOUR) programmes += `<programme start="${time(t)}" stop="${time(t + HOUR)}" channel="${channel}"><title>${title(t)}</title></programme>`
  return `<tv>${programmes}</tv>`
}

/** Serves each guide URL's XMLTV; requests come through the dev proxy (http.ts proxied). */
function serve(guides: Record<string, string>): void {
  vi.stubGlobal('location', { origin: 'http://localhost' })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const guideUrl = Object.keys(guides).find((u) => url.endsWith(u.replace('http://', '')))
      return guideUrl ? new Response(guides[guideUrl]) : new Response(null, { status: 404 })
    }),
  )
}

async function programmesOf(channel: Channel) {
  await guide.load(channel)
  return guide.cached(channel.id)
}

const hour = Math.floor(Date.now() / HOUR) * HOUR

beforeEach(() => {
  state.prefs.epgUrl = undefined
})
afterEach(() => vi.unstubAllGlobals())

describe('guide', () => {
  it('gives each provider’s channel its own guide when both use the same channel id', async () => {
    state.sources = [source('a'), source('b')]
    state.channels = [sport('a'), sport('b')]
    state.playlistGuides = { a: [A], b: [B] }
    serve({ [A]: xmltv('sport1', hour, hour + 2 * HOUR, () => 'A Match'), [B]: xmltv('sport1', hour, hour + 2 * HOUR, () => 'B Match') })
    await guide.refresh()
    expect(guide.getStatus().error).toBeUndefined()
    expect((await programmesOf(sport('a')))?.map((p) => p.title)).toEqual(['A Match', 'A Match'])
    expect((await programmesOf(sport('b')))?.map((p) => p.title)).toEqual(['B Match', 'B Match'])
  })

  it('looks in the global guide after a source’s own', async () => {
    state.sources = [source('a'), source('b')]
    state.channels = [sport('a'), sport('b')]
    state.playlistGuides = { a: [A] }
    state.prefs.epgUrl = GLOBAL
    serve({ [A]: xmltv('sport1', hour, hour + HOUR, () => 'A Match'), [GLOBAL]: xmltv('sport1', hour, hour + HOUR, () => 'Global Match') })
    await guide.refresh()
    expect((await programmesOf(sport('a')))?.map((p) => p.title)).toEqual(['A Match'])
    expect((await programmesOf(sport('b')))?.map((p) => p.title)).toEqual(['Global Match'])
  })

  it('keeps what the guide shows under any offset the settings allow', async () => {
    state.sources = [source('a')]
    state.channels = [sport('a')]
    state.playlistGuides = { a: [A] }
    serve({ [A]: xmltv('sport1', hour - 16 * HOUR, hour + 40 * HOUR, String) })
    await guide.refresh()
    const programmes = await programmesOf(sport('a'))
    const now = Date.now()
    // The guide screen spans 2 h ago to 24 h ahead.
    for (const minutes of [-MAX_OFFSET_MINUTES, -6 * 60, 0, 6 * 60, MAX_OFFSET_MINUTES]) {
      for (const time of [now - 2 * HOUR, now, now + 24 * HOUR]) {
        expect(nowNext(programmes, time, shiftMs(sport('a'), minutes)).now, `offset ${minutes} min, ${new Date(time).toISOString()}`).toBeDefined()
      }
    }
  })

  it('keeps a guide’s programmes when it can’t be downloaded at the next refresh', async () => {
    state.sources = [source('a'), source('b')]
    state.channels = [sport('a'), sport('b')]
    state.playlistGuides = { a: [A], b: [B] }
    serve({ [A]: xmltv('sport1', hour, hour + HOUR, () => 'A Match'), [B]: xmltv('sport1', hour, hour + HOUR, () => 'B Match') })
    await guide.refresh()
    serve({ [B]: xmltv('sport1', hour, hour + HOUR, () => 'B Final') })
    await guide.refresh()
    expect(guide.getStatus().failedUrls).toBe(1)
    expect((await programmesOf(sport('a')))?.map((p) => p.title)).toEqual(['A Match'])
    expect((await programmesOf(sport('b')))?.map((p) => p.title)).toEqual(['B Final'])
  })

  it('refreshes again for a source added while a refresh runs', async () => {
    state.sources = [source('a')]
    state.channels = [sport('a')]
    state.playlistGuides = { a: [A], b: [B] }
    serve({ [A]: xmltv('sport1', hour, hour + HOUR, () => 'A Match'), [B]: xmltv('sport1', hour, hour + HOUR, () => 'B Match') })
    const first = guide.refresh()
    state.sources = [source('a'), source('b')]
    state.channels = [sport('a'), sport('b')]
    await Promise.all([first, guide.refresh()])
    expect((await programmesOf(sport('b')))?.map((p) => p.title)).toEqual(['B Match'])
  })

  it('asks the Xtream short EPG again a while after a request failed', async () => {
    const xtream: Source = { id: 'x', kind: 'xtream', name: 'x', host: 'http://x.example', username: 'u', password: 'p', addedAt: 1 }
    const channel: Channel = { id: 'x:1', sourceId: 'x', name: 'News', number: 1, urls: ['http://x.example/1'], streamId: 1 }
    state.sources = [xtream]
    state.channels = [channel]
    state.playlistGuides = {}
    serve({})
    expect(await programmesOf(channel)).toEqual([])
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000)
    try {
      expect(guide.cached(channel.id)).toBeUndefined()
    } finally {
      vi.restoreAllMocks()
    }
  })
})
