import type { ErrorData } from 'hls.js'
import type Mpegts from 'mpegts.js'
import { proxied } from '../data/http'
import { isWebOS } from '../platform/webos'
import { playWithSound } from './autoplay'
import { PlaybackError, type Attempt, type Engine, type Track } from './streams'
import { loadHls, loadMpegts, type Hls } from './vendor'

// Native playback can stall without an error; after this long the next engine gets a turn.
const START_TIMEOUT_MS = 12_000
const STALL_TIMEOUT_MS = 20_000

/** Whether the MSE engines can work here (the same checks hls.js and mpegts.js make). */
export function mseSupport(): { hls: boolean; mpegts: boolean } {
  const mse = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')
  return { hls: mse, mpegts: mse && typeof ReadableStream !== 'undefined' }
}

/** webOS plays MPEG-TS in <video>; desktop browsers don't. */
export const nativePlaysMpegTs = (): boolean => isWebOS()

/** Stops the element and frees its decoder. */
export function releaseVideo(video: HTMLVideoElement): void {
  video.pause()
  video.removeAttribute('src')
  video.load()
}

function mediaError(video: HTMLVideoElement): PlaybackError {
  const code = video.error?.code
  // MEDIA_ERR_NETWORK = 2; DECODE = 3 and SRC_NOT_SUPPORTED = 4 mean the format can't be played.
  return new PlaybackError(code === 2 ? 'network' : 'format', video.error?.message || (code ? `MediaError ${code}` : undefined))
}

/**
 * Ends a start() that is still waiting when the engine is destroyed (the user changed channels), so a
 * stopped engine never acts on the <video> element, which by then belongs to the next engine.
 */
function cancellation(): { promise: Promise<never>; cancel: () => void } {
  let cancel = () => {}
  const promise = new Promise<never>((_, reject) => {
    cancel = () => reject(new PlaybackError('format', 'cancelled'))
  })
  promise.catch(() => undefined) // after start() has finished, nobody is waiting for it
  return { promise, cancel }
}

const cancelled = () => new PlaybackError('format', 'cancelled')

/** Waits for the first frames; `failed` lets the engine abort the wait with its own error. */
function waitForPlaying(video: HTMLVideoElement, failed: Promise<never>): Promise<void> {
  let cleanup = () => {}
  const started = new Promise<void>((resolve, reject) => {
    const onPlaying = () => resolve()
    const onError = () => reject(mediaError(video))
    const timer = setTimeout(() => reject(new PlaybackError('timeout')), START_TIMEOUT_MS)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('error', onError)
    cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error', onError)
    }
  })
  return Promise.race([started, failed]).then(
    () => cleanup(),
    (error) => {
      cleanup()
      throw error
    },
  )
}

/** After start: media errors and long stalls are fatal. Returns a function that stops watching. */
function watchVideo(video: HTMLVideoElement, engine: Engine): () => void {
  let stall: ReturnType<typeof setTimeout> | undefined
  const onError = () => engine.onFatal?.(mediaError(video))
  const onWaiting = () => {
    clearTimeout(stall)
    stall = setTimeout(() => engine.onFatal?.(new PlaybackError('timeout', 'stalled')), STALL_TIMEOUT_MS)
  }
  const onPlaying = () => clearTimeout(stall)
  video.addEventListener('error', onError)
  video.addEventListener('waiting', onWaiting)
  video.addEventListener('playing', onPlaying)
  return () => {
    clearTimeout(stall)
    video.removeEventListener('error', onError)
    video.removeEventListener('waiting', onWaiting)
    video.removeEventListener('playing', onPlaying)
  }
}

interface MediaTrackList {
  length: number
  [index: number]: { label: string; language: string; enabled: boolean }
}

class NativeEngine implements Engine {
  readonly name = 'native'
  onFatal?: (error: PlaybackError) => void
  private destroyed = false
  private readonly cancellation = cancellation()
  private unwatch = () => {}

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly url: string,
  ) {}

  async start(): Promise<void> {
    this.video.src = this.url
    const started = waitForPlaying(this.video, this.cancellation.promise)
    void playWithSound(this.video)
    await started
    if (this.destroyed) throw cancelled()
    this.unwatch = watchVideo(this.video, this)
  }

  private audioList(): MediaTrackList | undefined {
    return (this.video as unknown as { audioTracks?: MediaTrackList }).audioTracks
  }

  audioTracks(): Track[] {
    const list = this.audioList()
    const tracks: Track[] = []
    for (let i = 0; list && i < list.length; i++) tracks.push({ id: i, label: list[i].label || list[i].language || `${i + 1}` })
    return tracks
  }

  selectedAudio(): number {
    const list = this.audioList()
    for (let i = 0; list && i < list.length; i++) if (list[i].enabled) return i
    return -1
  }

  setAudioTrack(id: number): void {
    const list = this.audioList()
    for (let i = 0; list && i < list.length; i++) list[i].enabled = i === id
  }

  subtitleTracks(): Track[] {
    const tracks: Track[] = []
    const list = this.video.textTracks
    for (let i = 0; i < list.length; i++) {
      if (list[i].kind === 'subtitles' || list[i].kind === 'captions') tracks.push({ id: i, label: list[i].label || list[i].language || `${i + 1}` })
    }
    return tracks
  }

  selectedSubtitle(): number {
    const list = this.video.textTracks
    for (let i = 0; i < list.length; i++) if (list[i].mode === 'showing') return i
    return -1
  }

  setSubtitleTrack(id: number): void {
    const list = this.video.textTracks
    for (let i = 0; i < list.length; i++) list[i].mode = i === id ? 'showing' : 'disabled'
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.cancellation.cancel()
    this.unwatch()
    releaseVideo(this.video)
  }
}

class HlsEngine implements Engine {
  readonly name = 'hls.js'
  onFatal?: (error: PlaybackError) => void
  private hls?: InstanceType<Hls>
  private started = false
  private recovered = false
  private destroyed = false
  private readonly cancellation = cancellation()
  private unwatch = () => {}

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly url: string,
  ) {}

  async start(): Promise<void> {
    const Hls = await loadHls().catch((error: Error) => Promise.reject(new PlaybackError('format', error.message)))
    if (this.destroyed) throw cancelled()
    const hls = (this.hls = new Hls({
      // On the TV hls.js is only the fallback to native HLS; its Blob-URL worker is unreliable there.
      enableWorker: !isWebOS(),
      xhrSetup: import.meta.env.DEV ? (xhr, url) => xhr.open('GET', proxied(url), true) : undefined,
    }))
    const failed = new Promise<never>((_, reject) => {
      hls.on(Hls.Events.ERROR, (_event, data: ErrorData) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !this.recovered) {
          this.recovered = true
          hls.recoverMediaError()
          return
        }
        const status = data.response?.code ? ` (HTTP ${data.response.code})` : ''
        const error = new PlaybackError(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'format', data.details + status)
        if (this.started) this.onFatal?.(error)
        else reject(error)
      })
    })
    hls.loadSource(this.url)
    hls.attachMedia(this.video)
    const started = waitForPlaying(this.video, Promise.race([failed, this.cancellation.promise]))
    void playWithSound(this.video)
    await started
    if (this.destroyed) throw cancelled()
    this.started = true
    this.unwatch = watchVideo(this.video, this)
  }

  audioTracks(): Track[] {
    return (this.hls?.audioTracks ?? []).map((t, i) => ({ id: i, label: t.name || t.lang || `${i + 1}` }))
  }

  selectedAudio(): number {
    return this.hls?.audioTrack ?? -1
  }

  setAudioTrack(id: number): void {
    if (this.hls) this.hls.audioTrack = id
  }

  subtitleTracks(): Track[] {
    return (this.hls?.subtitleTracks ?? []).map((t, i) => ({ id: i, label: t.name || t.lang || `${i + 1}` }))
  }

  selectedSubtitle(): number {
    return this.hls?.subtitleTrack ?? -1
  }

  setSubtitleTrack(id: number): void {
    if (!this.hls) return
    this.hls.subtitleDisplay = id >= 0
    this.hls.subtitleTrack = id
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.cancellation.cancel()
    this.unwatch()
    this.hls?.destroy()
    releaseVideo(this.video)
  }
}

class MpegtsEngine implements Engine {
  readonly name = 'mpegts.js'
  onFatal?: (error: PlaybackError) => void
  private player?: Mpegts.Player
  private started = false
  private destroyed = false
  private readonly cancellation = cancellation()
  private unwatch = () => {}

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly url: string,
  ) {}

  async start(): Promise<void> {
    const mpegts = await loadMpegts().catch((error: Error) => Promise.reject(new PlaybackError('format', error.message)))
    if (this.destroyed) throw cancelled()
    const player = (this.player = mpegts.createPlayer(
      { type: 'mpegts', isLive: true, url: proxied(this.url) },
      // No latency chasing: it keeps under a second buffered, so every network hiccup stalls the
      // picture. Without it, each stall adds to the buffer and playback settles.
      { enableWorker: false, liveBufferLatencyChasing: false, autoCleanupSourceBuffer: true },
    ))
    const failed = new Promise<never>((_, reject) => {
      player.on(mpegts.Events.ERROR, (type: string, detail: string, info?: { code?: number; msg?: string }) => {
        const extra = info?.code && info.code > 0 ? ` (HTTP ${info.code})` : info?.msg ? ` (${info.msg})` : ''
        const error = new PlaybackError(type === mpegts.ErrorTypes.NETWORK_ERROR ? 'network' : 'format', detail + extra)
        if (this.started) this.onFatal?.(error)
        else reject(error)
      })
    })
    player.attachMediaElement(this.video)
    player.load()
    const started = waitForPlaying(this.video, Promise.race([failed, this.cancellation.promise]))
    void playWithSound(this.video)
    await started
    if (this.destroyed) throw cancelled()
    this.started = true
    this.unwatch = watchVideo(this.video, this)
  }

  // mpegts.js plays the stream's default tracks and has no track switching.
  audioTracks = (): Track[] => []
  selectedAudio = (): number => -1
  setAudioTrack(): void {}
  subtitleTracks = (): Track[] => []
  selectedSubtitle = (): number => -1
  setSubtitleTrack(): void {}

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.cancellation.cancel()
    this.unwatch()
    if (this.player) {
      this.player.pause()
      this.player.unload()
      this.player.detachMediaElement()
      this.player.destroy()
    }
    releaseVideo(this.video)
  }
}

export function createEngine(attempt: Attempt, video: HTMLVideoElement): Engine {
  switch (attempt.engine) {
    case 'native':
      return new NativeEngine(video, attempt.url)
    case 'hls.js':
      return new HlsEngine(video, attempt.url)
    case 'mpegts.js':
      return new MpegtsEngine(video, attempt.url)
  }
}
