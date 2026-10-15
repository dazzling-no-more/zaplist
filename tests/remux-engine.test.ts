import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { element, ID, uintElement } from '../service/ebml'

// The remux engine against a fake <video>, a fake webOS service bridge and a fake fetch that plays
// both the IPTV server (the movie's first bytes) and the app's service (/info, /subs).
vi.mock('../src/platform/webos', () => ({ isWebOS: () => true }))
vi.mock('../src/data/http', () => ({ proxied: (url: string) => url }))

const { createEngine } = await import('../src/player/engines')

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

/** The start of a Matroska movie: video, one audio track of `audioCodec`, an English text subtitle track. */
function movieHead(audioCodec: string): Uint8Array<ArrayBuffer> {
  const text = (id: number, value: string) => element(id, [Buffer.from(value)])
  const tracks = element(ID.Tracks, [
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 1), uintElement(ID.TrackType, 1), text(ID.CodecID, 'V_AV1')]),
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 2), uintElement(ID.TrackType, 2), text(ID.CodecID, audioCodec)]),
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 3), uintElement(ID.TrackType, 17), text(ID.CodecID, 'S_TEXT/UTF8')]),
  ])
  const segment = Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
  return new Uint8Array(Buffer.concat([element(ID.EBML, [text(0x4282, 'matroska')]), segment, tracks, Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x80])]))
}

let head: Uint8Array<ArrayBuffer>
let requests: string[]
let cues: unknown[]
const info = { audio: [{ number: 2, name: '', language: 'eng', codec: 'A_OPUS', default: true }], subtitles: [{ number: 3, name: 'SDH', language: 'eng', codec: 'S_TEXT/UTF8', default: false }] }

beforeEach(() => {
  requests = []
  cues = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url.replace(SERVICE, '').replace(encodeURIComponent(MOVIE), 'MOVIE'))
      if (url === MOVIE) return new Response(head)
      if (url.startsWith(`${SERVICE}/info`)) {
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

  it('goes straight to the service for subtitles chosen before a restart', async () => {
    head = movieHead('A_AC3')
    const video = new FakeVideo()
    const engine = await start(video, 20, { subtitle: 0 })
    expect(engine.name).toBe('remux')
    expect(video.src).toContain('&t=20&a=2&s=3')
    expect(engine.selectedSubtitle()).toBe(0)
    engine.destroy()
  })
})
