import type { ErrorData } from 'hls.js'
import type Mpegts from 'mpegts.js'
import { id as appId } from '../../appinfo.json'
import { proxied } from '../data/http'
import { isWebOS } from '../platform/webos'
import { playWithSound } from './autoplay'
import { PlaybackError, type Attempt, type Engine, type EngineName, type Track } from './streams'
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
  name: EngineName = 'native'
  onFatal?: (error: PlaybackError) => void
  protected destroyed = false
  protected readonly cancellation = cancellation()
  private unwatch = () => {}

  constructor(
    protected readonly video: HTMLVideoElement,
    protected readonly url: string,
  ) {}

  async start(position = 0): Promise<void> {
    await this.load(this.url)
    if (position > 0) this.seek(position)
  }

  /** Plays `src` until the first frames show, then watches it for errors and stalls. */
  protected async load(src: string): Promise<void> {
    this.video.src = src
    const started = waitForPlaying(this.video, this.cancellation.promise)
    void playWithSound(this.video)
    await started
    if (this.destroyed) throw cancelled()
    this.unwatch()
    this.unwatch = watchVideo(this.video, this)
  }

  currentTime(): number {
    return this.video.currentTime
  }

  seek(seconds: number): void {
    this.video.currentTime = seconds
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

  async start(position = 0): Promise<void> {
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
    if (position > 0) this.seek(position)
  }

  currentTime(): number {
    return this.video.currentTime
  }

  seek(seconds: number): void {
    this.video.currentTime = seconds
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

  async start(position = 0): Promise<void> {
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
    if (position > 0) this.seek(position)
  }

  currentTime(): number {
    return this.video.currentTime
  }

  seek(seconds: number): void {
    this.video.currentTime = seconds
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

// The app's JS service (service/main.ts); webOS names it after the app.
const SERVICE = `luna://${appId}.service`
const SERVICE_TIMEOUT_MS = 15_000
/** Bytes read from the start of a movie to find its codecs: Matroska lists its tracks first. */
const PROBE_BYTES = 64 * 1024
const PROBE_TIMEOUT_MS = 10_000
/** "A_OPUS", Matroska's codec ID for Opus audio. */
const OPUS_CODEC_ID = [0x41, 0x5f, 0x4f, 0x50, 0x55, 0x53]
/** A seek waits this long for the next one: a run of Left/Right presses restarts the stream once. */
const SEEK_DELAY_MS = 700

/** The remux engine needs the app's service, which only exists on the TV. */
export const remuxSupport = (): boolean => isWebOS()

/** Whether the start of the Matroska file at `url` names an Opus track. False if it can't be read. */
async function hasOpus(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers: { Range: `bytes=0-${PROBE_BYTES - 1}` }, signal: controller.signal })
    if (!response.ok || !response.body) return false
    // A server that ignores the range sends the whole file: read only its start.
    const reader = response.body.getReader()
    const head = new Uint8Array(PROBE_BYTES)
    let length = 0
    while (length < PROBE_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      const take = Math.min(value.length, PROBE_BYTES - length)
      head.set(value.subarray(0, take), length)
      length += take
    }
    reader.cancel().catch(() => undefined)
    search: for (let i = 0; i + OPUS_CODEC_ID.length <= length; i++) {
      for (let j = 0; j < OPUS_CODEC_ID.length; j++) if (head[i + j] !== OPUS_CODEC_ID[j]) continue search
      return true
    }
    return false
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** The service's /info answer (service/server.ts). */
interface MovieInfo {
  /** Seconds into the movie where a stream asked for a position starts (the cue before it). */
  start: number
  audio: { number: number; label: string; default: boolean }[]
}

/**
 * Matroska movies on the TV. Its player can't decode Opus audio and stalls on files that carry it,
 * so those stream through the app's service, which turns the audio into PCM; anything else plays as
 * with NativeEngine. The TV's player counts each stream's time from zero, and a seek or another audio
 * track starts a new stream: positions add the movie time where the stream starts.
 */
class RemuxEngine extends NativeEngine {
  private request?: { cancel(): void }
  private base = ''
  private offset = 0
  /** The position asked for while a new stream starts. */
  private target?: number
  private seekTimer?: ReturnType<typeof setTimeout>
  /** Bumped by every restart, so an earlier one that finishes late changes nothing. */
  private generation = 0
  private tracks: MovieInfo['audio'] = []
  /** Track number of the audio playing. */
  private audio?: number

  async start(position = 0): Promise<void> {
    const opus = await Promise.race([hasOpus(this.url), this.cancellation.promise])
    if (!opus) return super.start(position)
    this.name = 'remux'
    this.base = `http://127.0.0.1:${await Promise.race([this.startService(), this.cancellation.promise])}`
    await this.open(position)
  }

  /** Starts the service and holds it up (an open subscription) until destroy; resolves with its port. */
  private startService(): Promise<number> {
    return new Promise((resolve, reject) => {
      const fail = (why: string) => reject(new PlaybackError('format', `Opus audio needs the app's service: ${why}`))
      const webOS = window.webOS
      if (!webOS) return fail('not on a TV')
      const timer = setTimeout(() => fail('no answer'), SERVICE_TIMEOUT_MS)
      this.request = webOS.service.request<{ port?: number; errorText?: string }>(SERVICE, {
        method: 'start',
        subscribe: true,
        onSuccess: (response) => {
          clearTimeout(timer)
          if (response.port) resolve(response.port)
          else fail(response.errorText ?? 'no port')
        },
        onFailure: (error) => {
          clearTimeout(timer)
          fail(error.errorText ?? `error ${error.errorCode}`)
        },
      })
    })
  }

  /** Plays a new stream from the cue at or before `position`. */
  private async open(position: number): Promise<void> {
    const query = `u=${encodeURIComponent(this.url)}&t=${position}`
    let response: Response
    let info: MovieInfo & { error?: string }
    try {
      response = await Promise.race([fetch(`${this.base}/info?${query}`), this.cancellation.promise])
      info = await response.json()
    } catch (error) {
      if (this.destroyed) throw cancelled()
      throw new PlaybackError('format', `The app's service didn't answer: ${String(error)}`)
    }
    // The service couldn't read the movie: the IPTV server refused or failed.
    if (!response.ok) throw new PlaybackError('network', info.error)
    this.tracks = info.audio
    if (this.audio === undefined) this.audio = (info.audio.find((t) => t.default) ?? info.audio[0])?.number
    this.offset = info.start
    await this.load(`${this.base}/remux?u=${encodeURIComponent(this.url)}&t=${info.start}&a=${this.audio ?? 0}`)
  }

  currentTime(): number {
    if (this.name !== 'remux') return super.currentTime()
    return this.target ?? this.offset + this.video.currentTime
  }

  seek(seconds: number): void {
    if (this.name !== 'remux') return super.seek(seconds)
    this.target = seconds
    clearTimeout(this.seekTimer)
    this.seekTimer = setTimeout(() => this.restart(), SEEK_DELAY_MS)
  }

  /** Starts a new stream at the target position, and pauses again if the movie was paused. */
  private restart(): void {
    const generation = ++this.generation
    const paused = this.video.paused
    this.open(this.currentTime()).then(
      () => {
        if (generation !== this.generation) return
        this.target = undefined
        if (paused) this.video.pause()
      },
      (error: unknown) => {
        if (generation !== this.generation || this.destroyed) return
        this.onFatal?.(error instanceof PlaybackError ? error : new PlaybackError('format', String(error)))
      },
    )
  }

  audioTracks(): Track[] {
    if (this.name !== 'remux') return super.audioTracks()
    return this.tracks.map((t, i) => ({ id: i, label: t.label || `${i + 1}` }))
  }

  selectedAudio(): number {
    if (this.name !== 'remux') return super.selectedAudio()
    return this.tracks.findIndex((t) => t.number === this.audio)
  }

  setAudioTrack(id: number): void {
    if (this.name !== 'remux') return super.setAudioTrack(id)
    const track = this.tracks[id]
    if (!track || track.number === this.audio) return
    this.audio = track.number
    this.target = this.currentTime()
    clearTimeout(this.seekTimer)
    this.restart()
  }

  destroy(): void {
    clearTimeout(this.seekTimer)
    this.request?.cancel()
    super.destroy()
  }
}

export function createEngine(attempt: Attempt, video: HTMLVideoElement): Engine {
  switch (attempt.engine) {
    case 'remux':
      return new RemuxEngine(video, attempt.url)
    case 'native':
      return new NativeEngine(video, attempt.url)
    case 'hls.js':
      return new HlsEngine(video, attempt.url)
    case 'mpegts.js':
      return new MpegtsEngine(video, attempt.url)
  }
}
