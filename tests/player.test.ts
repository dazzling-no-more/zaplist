import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playbackAttempts, PlaybackError, streamKind, summarizeFailures, type Attempt, type Engine } from '../src/player/streams'

// Fake engines: each attempt's outcome comes from `outcomes` (keyed by engine name), in order.
const outcomes: Record<string, (() => Promise<void>)[]> = {}
const created: { attempt: Attempt; engine: Engine & { destroyed: boolean } }[] = []

vi.mock('../src/player/engines', () => ({
  mseSupport: () => ({ hls: true, mpegts: true }),
  nativePlaysMpegTs: () => true,
  releaseVideo: vi.fn(),
  createEngine: (attempt: Attempt) => {
    const next = outcomes[attempt.engine]?.shift() ?? (() => Promise.reject(new PlaybackError('format')))
    const engine = {
      name: attempt.engine,
      destroyed: false,
      start: next,
      audioTracks: () => [],
      selectedAudio: () => -1,
      setAudioTrack: () => {},
      subtitleTracks: () => [],
      selectedSubtitle: () => -1,
      setSubtitleTrack: () => {},
      destroy() {
        this.destroyed = true
      },
    }
    created.push({ attempt, engine })
    return engine
  },
}))

const { Playback, RETRY_DELAYS_MS } = await import('../src/player/playback')
const { diagnostics } = await import('../src/player/diagnostics')

const ok = () => Promise.resolve()
const fail = (code: 'network' | 'format' | 'timeout' = 'network') => () => Promise.reject(new PlaybackError(code))
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('streamKind', () => {
  it.each([
    ['http://h/live/u/p/1.m3u8', 'hls'],
    ['http://h/playlist.m3u?token=1', 'hls'],
    ['http://h/live/u/p/1.ts', 'ts'],
    ['http://h/a/b.MTS#x', 'ts'],
    ['http://h/movie.mp4', 'other'],
    ['http://h/live/u/p/1', 'unknown'],
    ['http://h:8080/', 'unknown'],
  ])('%s is %s', (url, kind) => {
    expect(streamKind(url)).toBe(kind)
  })
})

describe('playbackAttempts', () => {
  const all = { hls: true, mpegts: true }

  it('tries native first, then the engine for the stream type, URL by URL', () => {
    expect(playbackAttempts(['a.m3u8', 'a.ts'], all)).toEqual([
      { url: 'a.m3u8', engine: 'native' },
      { url: 'a.m3u8', engine: 'hls.js' },
      { url: 'a.ts', engine: 'native' },
      { url: 'a.ts', engine: 'mpegts.js' },
    ])
  })

  it('tries both MSE engines (MPEG-TS first) for URLs without a known extension, and none without MSE', () => {
    expect(playbackAttempts(['x'], all).map((a) => a.engine)).toEqual(['native', 'mpegts.js', 'hls.js'])
    expect(playbackAttempts(['x.mp4'], all).map((a) => a.engine)).toEqual(['native'])
    expect(playbackAttempts(['a.m3u8'], { hls: false, mpegts: false }).map((a) => a.engine)).toEqual(['native'])
  })

  it('tries the native player last for MPEG-TS where it cannot play it (desktop browsers)', () => {
    expect(playbackAttempts(['a.ts', 'x', 'a.m3u8'], all, false).map((a) => a.engine)).toEqual([
      'mpegts.js', 'native',
      'mpegts.js', 'hls.js', 'native',
      'native', 'hls.js',
    ])
    expect(playbackAttempts(['a.ts'], { hls: true, mpegts: false }, false).map((a) => a.engine)).toEqual(['native'])
  })
})

describe('summarizeFailures', () => {
  it('headlines the first MSE engine and lists every reason', () => {
    const error = summarizeFailures([
      { engine: 'mpegts.js', error: new PlaybackError('network', 'HttpStatusCodeInvalid (HTTP 403)') },
      { engine: 'hls.js', error: new PlaybackError('format', 'manifestParsingError') },
      { engine: 'native', error: new PlaybackError('format') },
    ])
    expect(error.code).toBe('network')
    expect(error.detail).toBe('mpegts.js: HttpStatusCodeInvalid (HTTP 403) · hls.js: manifestParsingError · native: format')
  })

  it('uses the native error when it was the only engine', () => {
    expect(summarizeFailures([{ engine: 'native', error: new PlaybackError('network', 'x') }])).toMatchObject({ code: 'network', detail: 'native: x' })
    expect(summarizeFailures([]).code).toBe('format')
  })
})

describe('Playback', () => {
  const video = {} as HTMLVideoElement
  beforeEach(() => {
    vi.useFakeTimers()
    created.length = 0
    for (const key of Object.keys(outcomes)) delete outcomes[key]
  })
  afterEach(() => vi.useRealTimers())

  it('falls back from native to hls.js and reports the engine', async () => {
    outcomes.native = [fail('format')]
    outcomes['hls.js'] = [ok]
    const playback = new Playback(video)
    playback.play(['s.m3u8'])
    expect(playback.getStatus()).toEqual({ state: 'loading' })
    await flush()
    expect(playback.getStatus()).toEqual({ state: 'playing' })
    expect(created.map((c) => c.attempt.engine)).toEqual(['native', 'hls.js'])
    expect(created[0].engine.destroyed).toBe(true)
    expect(playback.current()?.name).toBe('hls.js')
    expect(diagnostics.engine).toBe('hls.js')
  })

  it('retries with backoff three times, then gives up with the last error', async () => {
    const playback = new Playback(video)
    playback.play(['s.mp4'])
    await flush()
    for (let retry = 1; retry <= RETRY_DELAYS_MS.length; retry++) {
      expect(playback.getStatus()).toMatchObject({ state: 'retrying', retry, delay: RETRY_DELAYS_MS[retry - 1] })
      vi.advanceTimersByTime(RETRY_DELAYS_MS[retry - 1] - 1)
      expect(playback.getStatus().state).toBe('retrying')
      vi.advanceTimersByTime(1)
      await flush()
    }
    // The detail names the engine that failed last, for the error panel and Settings > About.
    expect(playback.getStatus()).toMatchObject({ state: 'failed', error: { code: 'format', detail: 'native: format' } })
    expect(created).toHaveLength(4)
    expect(diagnostics.lastError).toBe('format: native: format')
  })

  it('recovers when a retry works and starts counting retries again', async () => {
    outcomes.native = [fail(), ok]
    const playback = new Playback(video)
    playback.play(['s.mp4'])
    await flush()
    expect(playback.getStatus().state).toBe('retrying')
    vi.advanceTimersByTime(RETRY_DELAYS_MS[0])
    await flush()
    expect(playback.getStatus()).toEqual({ state: 'playing' })

    // A fatal error later starts a fresh round of retries.
    playback.current()!.onFatal!(new PlaybackError('timeout', 'stalled'))
    expect(playback.getStatus()).toMatchObject({ state: 'retrying', retry: 1 })
    expect(created[1].engine.destroyed).toBe(true)
  })

  it('stops an engine that is still starting when the channel changes', async () => {
    let finishFirst!: () => void
    outcomes.native = [() => new Promise<void>((resolve) => (finishFirst = resolve)), ok]
    const playback = new Playback(video)
    playback.play(['first.mp4'])
    playback.play(['second.mp4'])
    // Two engines must never drive the <video> at once.
    expect(created[0].engine.destroyed).toBe(true)
    await flush()
    expect(playback.current()).toBe(created[1].engine)
    finishFirst()
    await flush()
    expect(created[0].engine.destroyed).toBe(true)
    expect(playback.current()).toBe(created[1].engine)
  })

  it('stop releases the engine and cancels a pending retry', async () => {
    const playback = new Playback(video)
    playback.play(['s.mp4'])
    await flush()
    expect(playback.getStatus().state).toBe('retrying')
    playback.stop()
    vi.advanceTimersByTime(10_000)
    await flush()
    expect(playback.getStatus()).toEqual({ state: 'idle' })
    expect(created).toHaveLength(1)
  })
})
