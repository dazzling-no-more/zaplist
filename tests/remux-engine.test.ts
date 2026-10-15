import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { element, ID, uintElement } from '../service/ebml'
import { SPU, VOBSUB_IDX } from './fixtures/vobsub'

// The remux engine against a fake <video>, a fake webOS service bridge and a fake fetch that plays
// both the IPTV server (the movie's first bytes) and the app's service (/info, /subs).
vi.mock('../src/platform/webos', () => ({ isWebOS: () => true }))
vi.mock('../src/data/http', () => ({ proxied: (url: string) => url }))

const { createEngine, remuxSupport, warmService } = await import('../src/player/engines')

const MOVIE = 'http://iptv.example/movie/u/p/1.mkv'
const SERVICE = 'http://127.0.0.1:4321'

class FakeVideo extends EventTarget {
  src = ''
  muted = false
  paused = true
  error = null
  currentTime = 0
  textTracks = { length: 0 }
  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }
  load(): void {}
}

/**
 * The start of a Matroska movie: video, one audio track of `audioCodec`, an English text subtitle
 * track; with `defaultAudio`, a second audio track of that codec (track 4) marked as the default.
 */
function movieHead(audioCodec: string, defaultAudio?: string): Uint8Array<ArrayBuffer> {
  const text = (id: number, value: string) => element(id, [Buffer.from(value)])
  const tracks = element(ID.Tracks, [
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 1), uintElement(ID.TrackType, 1), text(ID.CodecID, 'V_AV1')]),
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 2), uintElement(ID.TrackType, 2), text(ID.CodecID, audioCodec)].concat(defaultAudio ? [uintElement(ID.FlagDefault, 0)] : [])),
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 3), uintElement(ID.TrackType, 17), text(ID.CodecID, 'S_TEXT/UTF8')]),
    ...(defaultAudio ? [element(ID.TrackEntry, [uintElement(ID.TrackNumber, 4), uintElement(ID.TrackType, 2), text(ID.CodecID, defaultAudio)])] : []),
  ])
  const segment = Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
  return new Uint8Array(Buffer.concat([element(ID.EBML, [text(0x4282, 'matroska')]), segment, tracks, Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x80])]))
}

let head: Uint8Array<ArrayBuffer>
let requests: string[]
/** /info answers only once aborted. */
let slowInfo = false
let cues: unknown[]
type TrackInfo = { number: number; name: string; language: string; codec: string; default: boolean; private?: string }
const info: { audio: TrackInfo[]; subtitles: TrackInfo[] } = {
  audio: [{ number: 2, name: '', language: 'eng', codec: 'A_OPUS', default: true }],
  subtitles: [{ number: 3, name: 'SDH', language: 'eng', codec: 'S_TEXT/UTF8', default: false }],
}

beforeEach(() => {
  requests = []
  cues = []
  slowInfo = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(url.replace(SERVICE, '').replace(encodeURIComponent(MOVIE), 'MOVIE'))
      if (url === MOVIE) return new Response(head)
      if (url.startsWith(`${SERVICE}/info`)) {
        if (slowInfo) await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
        const t = Number(new URL(url).searchParams.get('t'))
        return Response.json({ ...info, start: Math.floor(t / 10) * 10 }) // cues every 10 s
      }
      if (url === `${SERVICE}/subs`) return Response.json({ cues: cues.splice(0) })
      return new Response(null, { status: 404 })
    }),
  )
  vi.stubGlobal('window', {
    webOS: { service: { request: (_uri: string, options: { onSuccess: (r: unknown) => void }) => (setTimeout(() => options.onSuccess({ port: 4321 })), { cancel: vi.fn() }) } },
  })
})
afterEach(() => vi.unstubAllGlobals())

/** Waits until `check` holds, letting fetches and timers run. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5))
  expect(check()).toBe(true)
}

/** Starts the engine and lets its stream "play" once its source is set. */
async function start(video: FakeVideo, position = 0, choices = {}) {
  const engine = createEngine({ url: MOVIE, engine: 'remux' }, video as unknown as HTMLVideoElement)
  const started = engine.start(position, choices)
  await until(() => video.src !== '')
  video.dispatchEvent(new Event('playing'))
  await started
  return engine
}

const playing = async (video: FakeVideo, src: string) => {
  await until(() => video.src.includes(src))
  video.dispatchEvent(new Event('playing'))
}

describe('remux engine', () => {
  it('plays a movie without Opus audio directly', async () => {
    head = movieHead('A_AC3')
    const video = new FakeVideo()
    const engine = await start(video)
    expect(engine.name).toBe('native')
    expect(video.src).toBe(MOVIE)
    expect(requests).toEqual([MOVIE])
  })

  it('streams an Opus movie through the service and counts time from where the stream starts', async () => {
    head = movieHead('A_OPUS')
    const video = new FakeVideo()
    const engine = await start(video, 95)
    expect(engine.name).toBe('remux')
    expect(video.src).toBe(`${SERVICE}/remux?u=${encodeURIComponent(MOVIE)}&t=90&a=2&s=3`)
    video.currentTime = 7 // the TV's player counts from the start of the stream
    expect(engine.currentTime()).toBe(97)
    engine.destroy()
  })

  it('plays the audio track the file marks as its default, which the TV doesn’t start on', async () => {
    head = movieHead('A_AC3', 'A_EAC3')
    const listed = () => [
      { label: '', language: 'ro', enabled: true },
      { label: '', language: 'ro', enabled: false },
    ]
    const video = new FakeVideo()
    const tracks = listed()
    Object.assign(video, { audioTracks: Object.assign({ length: 2 }, tracks) })
    expect((await start(video)).name).toBe('native')
    expect(tracks.map((t) => t.enabled)).toEqual([false, true])

    const chosen = new FakeVideo() // the viewer's choice stays
    const kept = listed()
    Object.assign(chosen, { audioTracks: Object.assign({ length: 2 }, kept) })
    await start(chosen, 0, { audio: 0 })
    expect(kept.map((t) => t.enabled)).toEqual([true, false])
  })

  it('streams a DTS movie through the service too', async () => {
    head = movieHead('A_DTS')
    const engine = await start(new FakeVideo())
    expect(engine.name).toBe('remux')
    engine.destroy()
  })

  it('restarts the stream once for a run of seeks', async () => {
    head = movieHead('A_OPUS')
    const video = new FakeVideo()
    const engine = await start(video)
    requests = []
    engine.seek(30)
    engine.seek(40)
    engine.seek(55)
    expect(engine.currentTime()).toBe(55) // shown at once, before the new stream plays
    await playing(video, '&t=50&')
    expect(requests.filter((r) => r.startsWith('/info'))).toEqual(['/info?u=MOVIE&t=55'])
    video.currentTime = 1
    await until(() => engine.currentTime() === 51)
    engine.destroy()
  })

  it('shows the subtitles chosen from the cues the service reads', async () => {
    head = movieHead('A_OPUS')
    const video = new FakeVideo()
    const engine = await start(video)
    expect(engine.subtitleTracks()).toEqual([{ id: 0, label: 'eng · SDH' }])
    cues.push({ track: 3, start: 12, end: 14.5, text: '<i>Hello</i>' })
    await until(() => cues.length === 0) // the engine asks for cues every second
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(engine.subtitleAt!(13)).toBeUndefined() // off until chosen
    engine.setSubtitleTrack(0)
    expect(engine.subtitleAt!(13)).toEqual({ text: 'Hello' })
    expect(engine.subtitleAt!(13)).toBe(engine.subtitleAt!(13.5)) // the same object while it shows
    expect(engine.subtitleAt!(15)).toBeUndefined()
    engine.destroy()
  })

  it('draws DVD subtitles from the subpictures the service passes on, while they show', async () => {
    head = movieHead('A_OPUS')
    info.subtitles.push({ number: 4, name: '', language: 'fre', codec: 'S_VOBSUB', default: false, private: VOBSUB_IDX })
    try {
      const video = new FakeVideo()
      const engine = await start(video)
      engine.setSubtitleTrack(1) // pictures are collected only for the track shown: a new stream
      await playing(video, '&s=3,4')
      cues.push({ track: 4, start: 30, data: Buffer.from(SPU).toString('base64') })
      await until(() => cues.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(engine.subtitleAt!(30.5)).toMatchObject({ picture: { width: 720, height: 576, objects: [{ x: 10, y: 20 }] } })
      expect(engine.subtitleAt!(31.1)).toBeUndefined() // 88 ticks: just over a second
      engine.destroy()
    } finally {
      info.subtitles.pop()
    }
  })

  it('goes straight to the service for subtitles chosen before a restart', async () => {
    head = movieHead('A_AC3')
    const video = new FakeVideo()
    const engine = await start(video, 20, { subtitle: 0 })
    expect(engine.name).toBe('remux')
    expect(video.src).toContain('&t=20&a=2&s=3')
    expect(engine.selectedSubtitle()).toBe(0)
    engine.destroy()
  })

  it('chooses the subtitles labelled as those of the episode before', async () => {
    head = movieHead('A_AC3')
    const video = new FakeVideo()
    const engine = await start(video, 0, { labels: { subtitle: 'eng' } }) // as the file's header lists it
    expect(engine.name).toBe('remux')
    expect(engine.selectedSubtitle()).toBe(0)
    engine.destroy()

    const other = await start(new FakeVideo(), 0, { labels: { subtitle: 'fre' } }) // not in this movie
    expect(other.name).toBe('native')
  })
})

describe('remuxSupport', () => {
  it('leaves the service out on webOS 4 (Chromium 53), whose Node.js can’t run it', () => {
    const agent = (chromium: string) => `Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromium} Safari/537.36`
    vi.stubGlobal('navigator', { userAgent: agent('53.0.2785.34') })
    expect(remuxSupport()).toBe(false)
    vi.stubGlobal('navigator', { userAgent: agent('68.0.3440.106') }) // webOS 5, firmware 04.64.00
    expect(remuxSupport()).toBe(true)
  })
})

describe('service warm-up', () => {
  /** Answers each `start` with the port; returns the cancel of each request. */
  function fakeService(): ReturnType<typeof vi.fn>[] {
    const cancels: ReturnType<typeof vi.fn>[] = []
    const service = (window as unknown as { webOS: { service: { request: unknown } } }).webOS.service
    service.request = (_uri: string, options: { onSuccess: (r: unknown) => void }) => {
      setTimeout(() => options.onSuccess({ port: 4321 }))
      const cancel = vi.fn()
      cancels.push(cancel)
      return { cancel }
    }
    return cancels
  }

  it('has the service read a Matroska movie’s header, then lets it go', async () => {
    const cancels = fakeService()
    warmService(MOVIE, 95)
    await until(() => cancels[0]?.mock.calls.length === 1)
    expect(requests).toEqual(['/info?u=MOVIE&t=95'])
    warmService('http://iptv.example/movie/u/p/2.mp4', 0) // the TV plays MP4 itself
    expect(cancels).toHaveLength(1)
  })

  it('ends a warm-up still reading once the movie starts, before it reads the movie itself', async () => {
    const cancels = fakeService()
    slowInfo = true
    warmService(MOVIE, 0)
    await until(() => requests.length === 1)
    head = movieHead('A_AC3')
    await start(new FakeVideo())
    expect(cancels[0]).toHaveBeenCalledTimes(1)
    expect(requests).toEqual(['/info?u=MOVIE&t=0', MOVIE])
  })
})
