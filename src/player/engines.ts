import type { ErrorData } from 'hls.js'
import type Mpegts from 'mpegts.js'
import { id as appId } from '../../appinfo.json'
import { proxied } from '../data/http'
import { isWebOS } from '../platform/webos'
import { playWithSound } from './autoplay'
import { subtitleKind, TRACK_AUDIO, TRACK_SUBTITLE } from './ebml'
import { readTracks, trackLabel } from './matroska'
import { chosenTrack, isMatroska, PlaybackError, splitHeaders, type Attempt, type Engine, type EngineName, type Track, type TrackChoices } from './streams'
import { CueList, PgsDecoder, subtitleText, VobSubDecoder, type Subtitle } from './subtitles'
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

/** Once the stream plays: back to `position`, with the tracks chosen before it restarted. */
function resume(engine: Engine, position: number, { audio, subtitle, labels = {} }: TrackChoices): void {
  if (position > 0) engine.seek(position)
  const audioId = chosenTrack(engine.audioTracks(), audio, labels.audio)
  const subtitleId = chosenTrack(engine.subtitleTracks(), subtitle, labels.subtitle)
  if (audioId !== undefined && audioId !== engine.selectedAudio()) engine.setAudioTrack(audioId)
  if (subtitleId !== undefined && subtitleId !== engine.selectedSubtitle()) engine.setSubtitleTrack(subtitleId)
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

  async start(position = 0, choices: TrackChoices = {}): Promise<void> {
    await this.load(this.url)
    resume(this, position, choices)
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

  async start(position = 0, choices: TrackChoices = {}): Promise<void> {
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
    resume(this, position, choices)
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

  async start(position = 0, choices: TrackChoices = {}): Promise<void> {
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
    resume(this, position, choices)
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
/** Bytes read from the start of a movie to find its tracks: Matroska lists them first. */
const PROBE_BYTES = 64 * 1024
const PROBE_TIMEOUT_MS = 10_000
/** How long the service may take to read where a stream starts (/info). */
const INFO_TIMEOUT_MS = 20_000
/**
 * Matroska codec IDs of the audio the service turns into PCM (service/remux.ts): Opus and DTS. Also
 * looked for as bytes when the track list is cut off.
 */
const CONVERTED = ['A_OPUS', 'A_DTS']
/** A seek waits this long for the next one: a run of Left/Right presses restarts the stream once. */
const SEEK_DELAY_MS = 700
/** How often the engine fetches the subtitle cues the service has read. */
const SUBTITLE_POLL_MS = 1000

/**
 * The remux and proxy engines need the app's service: on a TV with webOS 5 or newer, whose Node.js
 * runs it (webOS 4 has Node.js 0.12; there Matroska files go to the TV's player as they are). Told
 * by the web engine, Chromium 68 from webOS 5 on: the version the system reports is the firmware's.
 */
export function remuxSupport(): boolean {
  const chromium = /Chrome\/(\d+)/.exec(navigator.userAgent)
  return isWebOS() && !(chromium && Number(chromium[1]) < 68)
}

/** A warm-up of the service still going (warmService). */
let warming: { cancel(): void } | undefined

/**
 * Starts the service while a Matroska movie's page shows and has it read the movie's header and cue
 * index, so Play doesn't wait for either. It stays up a minute after (service/main.ts).
 */
export function warmService(full: string, position: number): void {
  const webOS = window.webOS
  const { url, headers } = splitHeaders(full)
  if (!remuxSupport() || !isMatroska(url) || !webOS) return
  stopWarming()
  const controller = new AbortController()
  let done = false
  const finish = () => {
    if (!done) request.cancel()
    done = true
  }
  const request = webOS.service.request<{ port?: number }>(SERVICE, {
    method: 'start',
    subscribe: true,
    onSuccess: (response) => {
      if (done || !response.port) return finish()
      // Let go of the service once it has the header: cancelling first would stop the read.
      fetch(`http://127.0.0.1:${response.port}/info?${serviceSource(url, headers)}&t=${position}`, { signal: controller.signal })
        .catch(() => undefined)
        .then(finish)
    },
    onFailure: () => (done = true),
  })
  warming = {
    cancel: () => {
      controller.abort()
      finish()
    },
  }
}

/** A movie's address and request headers (`Name=value&…`) as the service's /info and /remux take them. */
const serviceSource = (url: string, headers: string) => `u=${encodeURIComponent(url)}${headers ? `&h=${encodeURIComponent(headers)}` : ''}`

/** Ends a warm-up, closing its connection to the IPTV server: the movie starting now opens its own. */
function stopWarming(): void {
  warming?.cancel()
  warming = undefined
}

/** The first PROBE_BYTES of the file at `url`; undefined if they can't be read. */
async function readHead(url: string): Promise<Uint8Array | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers: { Range: `bytes=0-${PROBE_BYTES - 1}` }, signal: controller.signal })
    if (!response.ok || !response.body) return undefined
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
    return head.subarray(0, length)
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Whether `data` holds the ASCII `text` (a codec ID). */
function contains(data: Uint8Array, text: string): boolean {
  search: for (let i = 0; i + text.length <= data.length; i++) {
    for (let j = 0; j < text.length; j++) if (data[i + j] !== text.charCodeAt(j)) continue search
    return true
  }
  return false
}

function fromBase64(data: string): Uint8Array {
  const text = atob(data)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes
}

/** A track as the service lists it (service/remux.ts TrackInfo). */
interface TrackInfo {
  number: number
  name: string
  language: string
  codec: string
  default: boolean
  /** DVD subtitles: the track's .idx header (frame size, palette). */
  private?: string
}

/** The service's /info answer (service/server.ts). */
interface MovieInfo {
  /** Seconds into the movie where a stream asked for a position starts (the cue before it). */
  start: number
  audio: TrackInfo[]
  subtitles: TrackInfo[]
}

/** The service's /subs answer: subtitle cues read from the movie (service/remux.ts SubtitleCue). */
interface CueData {
  track: number
  start: number
  end?: number
  text?: string
  data?: string
}

/** The native player fed through the app's service (service/server.ts). */
class ServiceEngine extends NativeEngine {
  private request?: { cancel(): void }
  /** The service's address, once it runs. */
  protected base = ''

  /** Starts the service once; it stays up (an open subscription) until destroy. */
  protected async connect(): Promise<void> {
    if (!this.base) this.base = `http://127.0.0.1:${await Promise.race([this.startService(), this.cancellation.promise])}`
  }

  /** Resolves with the service's port. */
  private startService(): Promise<number> {
    return new Promise((resolve, reject) => {
      const fail = (why: string) => reject(new PlaybackError('format', `The app's service didn't start: ${why}`))
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

  destroy(): void {
    this.request?.cancel()
    super.destroy()
  }
}

const sameSubtitle = (a: Subtitle | undefined, b: Subtitle | undefined) =>
  a === b || (!!a && !!b && ('text' in a && 'text' in b ? a.text === b.text : 'picture' in a && 'picture' in b && a.picture === b.picture))

/**
 * Matroska movies on the TV. Its player can't decode Opus audio and stalls on files that carry it,
 * and LG's TVs of 2020 and 2021 have no DTS decoder, so those stream through the app's service,
 * which turns the audio into PCM; anything else plays as with NativeEngine. The TV's player counts
 * each stream's time from zero, and a seek or another audio track starts a new stream: positions add
 * the movie time where the stream starts.
 *
 * The TV's player doesn't pass a file's subtitles on either: the service collects their cues while
 * it streams, and the app draws them (subtitleAt). Turning subtitles on for a movie the TV plays
 * itself moves it to the service's stream.
 */
class RemuxEngine extends ServiceEngine {
  private offset = 0
  /** The position asked for while a new stream starts. */
  private target?: number
  private seekTimer?: ReturnType<typeof setTimeout>
  /** Bumped by every restart, so an earlier one that finishes late changes nothing. */
  private generation = 0
  private audios: TrackInfo[] = []
  /** Track number of the audio playing. */
  private audio?: number
  /** The subtitle tracks the app can draw. */
  private subtitles: TrackInfo[] = []
  /** Track number of the subtitles shown; undefined when they are off. */
  private subtitle?: number
  /** Subtitle tracks whose cues the current stream collects. */
  private collecting: number[] = []
  private cues: { [track: number]: CueList } = {}
  private pictures: { [track: number]: PgsDecoder | VobSubDecoder } = {}
  private pollTimer?: ReturnType<typeof setInterval>
  private shown?: Subtitle

  async start(position = 0, choices: TrackChoices = {}): Promise<void> {
    stopWarming()
    const { url, headers } = splitHeaders(this.url)
    // A movie that needs request headers is read through the service, which sends them.
    if (headers) await this.connect()
    const head = await Promise.race([readHead(headers ? this.proxyUrl() : url), this.cancellation.promise])
    const tracks = head && readTracks(head)
    if (tracks) {
      this.audios = tracks.filter((t) => t.type === TRACK_AUDIO)
      this.subtitles = tracks.filter((t) => t.type === TRACK_SUBTITLE && subtitleKind(t.codec))
    }
    const convert = tracks ? tracks.some((t) => t.type === TRACK_AUDIO && CONVERTED.indexOf(t.codec) >= 0) : !!head && CONVERTED.some((codec) => contains(head, codec))
    const labels = choices.labels || {}
    // Subtitles chosen before a restart need the service's stream too: go there straight away.
    const subtitleId = chosenTrack(this.subtitleTracks(), choices.subtitle, labels.subtitle)
    const subtitle = subtitleId !== undefined ? this.subtitles[subtitleId] : undefined
    if (!convert && !subtitle) return this.playItself(position, choices)
    const audioId = chosenTrack(this.serviceAudioTracks(), choices.audio, labels.audio)
    const audio = audioId !== undefined ? this.audios[audioId] : undefined
    if (audio) this.audio = audio.number
    if (subtitle) this.subtitle = subtitle.number
    this.name = 'remux'
    try {
      await this.connect()
      await this.open(position)
    } catch (error) {
      // Only the subtitles needed the service, which can't stream this movie (its Node.js can't reach
      // some HTTPS servers): play it without them rather than not at all, now and on every retry.
      if (convert || this.destroyed) throw error
      this.name = 'native'
      this.subtitle = undefined
      await this.playItself(position, choices)
    }
  }

  /** The TV's player plays the file as it is (through the service's proxy if it needs request headers). */
  private async playItself(position: number, choices: TrackChoices): Promise<void> {
    const labels = choices.labels || {}
    const audio = { audio: choices.audio, labels: { audio: labels.audio } }
    if (splitHeaders(this.url).headers) {
      await this.load(this.proxyUrl())
      resume(this, position, audio)
    } else await super.start(position, audio)
    // The TV's player starts on the first audio track, whatever the file marks as its default.
    // It lists them in the file's order.
    const preferred = this.audios.findIndex((t) => t.default)
    const listed = this.audioTracks()
    if (preferred > 0 && listed.length === this.audios.length && chosenTrack(listed, choices.audio, labels.audio) === undefined) this.setAudioTrack(preferred)
  }

  /** The movie fetched with its request headers by the service (once connected). */
  private proxyUrl(): string {
    const { url, headers } = splitHeaders(this.url)
    return `${this.base}/proxy?u=${encodeURIComponent(url)}&h=${encodeURIComponent(headers)}`
  }

  /** The movie and its request headers as /info and /remux take them. */
  private source(): string {
    const { url, headers } = splitHeaders(this.url)
    return serviceSource(url, headers)
  }

  /** Plays a new stream from the cue at or before `position`. */
  private async open(position: number): Promise<void> {
    let response: Response
    let info: MovieInfo & { error?: string }
    // The service reads the movie's header and cue index from the IPTV server, which can stall.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), INFO_TIMEOUT_MS)
    try {
      response = await Promise.race([fetch(`${this.base}/info?${this.source()}&t=${position}`, { signal: controller.signal }), this.cancellation.promise])
      info = await response.json()
    } catch (error) {
      if (this.destroyed) throw cancelled()
      if (controller.signal.aborted) throw new PlaybackError('timeout', "The app's service didn't answer")
      throw new PlaybackError('format', `The app's service didn't answer: ${String(error)}`)
    } finally {
      clearTimeout(timer)
    }
    // The service couldn't read the movie: the IPTV server refused or failed.
    if (!response.ok) throw new PlaybackError('network', info.error)
    this.audios = info.audio
    this.subtitles = info.subtitles
    if (this.audio === undefined) this.audio = (info.audio.find((t) => t.default) ?? info.audio[0])?.number
    this.offset = info.start
    // Text cues are small: every text track is collected, so switching between them is instant.
    // Pictures (PGS, DVD) only for the track shown; a new stream starts their decoders afresh.
    this.collecting = this.subtitles.filter((t) => subtitleKind(t.codec) === 'text' || t.number === this.subtitle).map((t) => t.number)
    for (const t of this.subtitles) {
      const kind = subtitleKind(t.codec)
      if (kind !== 'text' && this.collecting.indexOf(t.number) >= 0) this.pictures[t.number] = kind === 'pgs' ? new PgsDecoder() : new VobSubDecoder(t.private ?? '')
    }
    const query = `${this.source()}&t=${info.start}&a=${this.audio ?? 0}&s=${this.collecting.join(',')}`
    await this.load(`${this.base}/remux?${query}`)
    if (this.subtitles.length && this.pollTimer === undefined) this.pollTimer = setInterval(() => void this.fetchCues(), SUBTITLE_POLL_MS)
  }

  private async fetchCues(): Promise<void> {
    let cues: CueData[]
    try {
      cues = ((await (await fetch(`${this.base}/subs`)).json()) as { cues: CueData[] }).cues
    } catch {
      return // the next poll tries again
    }
    for (const cue of cues) {
      const track = this.subtitles.find((t) => t.number === cue.track)
      if (!track) continue
      const list = (this.cues[cue.track] ??= new CueList())
      if (cue.text !== undefined) {
        const text = subtitleText(track.codec, cue.text)
        if (text) list.add({ start: cue.start, end: cue.end, text })
      } else if (cue.data !== undefined) {
        const decoder = this.pictures[cue.track]
        if (decoder instanceof VobSubDecoder) {
          // A DVD subpicture says itself when it shows and goes.
          const unit = decoder.decode(fromBase64(cue.data))
          if (unit) list.add({ start: cue.start + unit.start, end: unit.end !== undefined ? cue.start + unit.end : cue.end, picture: unit.picture })
        } else {
          const picture = decoder?.decode(fromBase64(cue.data))
          if (picture) list.add({ start: cue.start, end: cue.end, picture })
        }
      }
    }
  }

  subtitleAt(seconds: number): Subtitle | undefined {
    const list = this.subtitle !== undefined ? this.cues[this.subtitle] : undefined
    const cues = list ? list.at(seconds) : []
    const picture = cues.length === 1 ? cues[0].picture : undefined
    const now: Subtitle | undefined = picture ? { picture } : cues.length ? { text: cues.map((c) => c.text).join('\n') } : undefined
    // The same object while the same subtitle shows: the screen redraws only when it changes.
    if (!sameSubtitle(this.shown, now)) this.shown = now
    return this.shown
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

  /** A new stream at the position playing now (another audio or picture subtitle track). */
  private restartNow(): void {
    this.target = this.currentTime()
    clearTimeout(this.seekTimer)
    this.restart()
  }

  /** Starts a new stream at the target position, and pauses again if the movie was paused. */
  private restart(): void {
    const generation = ++this.generation
    const paused = this.video.paused
    this.connect()
      .then(() => this.open(this.currentTime()))
      .then(
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
    return this.serviceAudioTracks()
  }

  /** The audio tracks as the service's stream offers them. */
  private serviceAudioTracks(): Track[] {
    return this.audios.map((t, i) => ({ id: i, label: trackLabel(t, i) }))
  }

  selectedAudio(): number {
    if (this.name !== 'remux') return super.selectedAudio()
    return this.audios.findIndex((t) => t.number === this.audio)
  }

  setAudioTrack(id: number): void {
    if (this.name !== 'remux') return super.setAudioTrack(id)
    const track = this.audios[id]
    if (!track || track.number === this.audio) return
    this.audio = track.number
    this.restartNow()
  }

  subtitleTracks(): Track[] {
    if (!this.subtitles.length) return super.subtitleTracks()
    return this.subtitles.map((t, i) => ({ id: i, label: trackLabel(t, i) }))
  }

  selectedSubtitle(): number {
    if (!this.subtitles.length) return super.selectedSubtitle()
    return this.subtitles.findIndex((t) => t.number === this.subtitle)
  }

  setSubtitleTrack(id: number): void {
    if (!this.subtitles.length) return super.setSubtitleTrack(id)
    const track = this.subtitles[id]
    this.subtitle = track?.number
    if (!track) return
    if (this.name !== 'remux') {
      // The TV plays the file itself: move to the service's stream, at the same place and audio.
      const audio = this.audios[super.selectedAudio()]
      if (audio) this.audio = audio.number
      this.target = super.currentTime()
      this.offset = 0
      this.name = 'remux'
      return this.restartNow()
    }
    if (this.collecting.indexOf(track.number) < 0) this.restartNow()
  }

  destroy(): void {
    clearTimeout(this.seekTimer)
    clearInterval(this.pollTimer)
    super.destroy()
  }
}

/**
 * Streams that need request headers web code can't set (a playlist's User-Agent or Referer, after
 * the URL's `|`): the native player fetches them through the app's service, which sends them.
 */
class ProxyEngine extends ServiceEngine {
  name: EngineName = 'proxy'

  async start(position = 0, choices: TrackChoices = {}): Promise<void> {
    const { url, headers } = splitHeaders(this.url)
    await this.connect()
    await this.load(`${this.base}/proxy?u=${encodeURIComponent(url)}&h=${encodeURIComponent(headers)}`)
    resume(this, position, choices)
  }
}

export function createEngine(attempt: Attempt, video: HTMLVideoElement): Engine {
  switch (attempt.engine) {
    case 'remux':
      return new RemuxEngine(video, attempt.url)
    case 'proxy':
      return new ProxyEngine(video, attempt.url)
    case 'native':
      return new NativeEngine(video, attempt.url)
    case 'hls.js':
      return new HlsEngine(video, attempt.url)
    case 'mpegts.js':
      return new MpegtsEngine(video, attempt.url)
  }
}
