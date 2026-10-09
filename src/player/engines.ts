import Hls, { type ErrorData } from 'hls.js'
import mpegts from 'mpegts.js'
import { proxied } from '../data/http'
import { isWebOS } from '../platform/webos'
import { PlaybackError, type Attempt, type Engine, type Track } from './streams'

const START_TIMEOUT_MS = 20_000
const STALL_TIMEOUT_MS = 20_000

export const mseSupport = (): { hls: boolean; mpegts: boolean } => ({
  hls: Hls.isSupported(),
  mpegts: !!mpegts.getFeatureList().mseLivePlayback,
})

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

async function playVideo(video: HTMLVideoElement): Promise<void> {
  try {
    await video.play()
  } catch (error) {
    // Desktop browsers block sound before the first user input; the TV does not.
    if ((error as Error)?.name !== 'NotAllowedError') return
    video.muted = true
    await video.play().catch(() => undefined)
  }
}

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
  private unwatch = () => {}

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly url: string,
  ) {}

  async start(): Promise<void> {
    this.video.src = this.url
    const started = waitForPlaying(this.video, new Promise<never>(() => {}))
    void playVideo(this.video)
    await started
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
    this.unwatch()
    releaseVideo(this.video)
  }
}

function hlsError(data: ErrorData): PlaybackError {
  return new PlaybackError(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'format', data.details)
}

class HlsEngine implements Engine {
  readonly name = 'hls.js'
  onFatal?: (error: PlaybackError) => void
  private readonly hls: Hls
  private started = false
  private recovered = false
  private unwatch = () => {}

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly url: string,
  ) {
    this.hls = new Hls({
      // On the TV hls.js is only the fallback to native HLS; its Blob-URL worker is unreliable there.
      enableWorker: !isWebOS(),
      xhrSetup: import.meta.env.DEV ? (xhr, url) => xhr.open('GET', proxied(url), true) : undefined,
    })
  }

  async start(): Promise<void> {
    const failed = new Promise<never>((_, reject) => {
      this.hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !this.recovered) {
          this.recovered = true
          this.hls.recoverMediaError()
          return
        }
        const error = hlsError(data)
        if (this.started) this.onFatal?.(error)
        else reject(error)
      })
    })
    this.hls.loadSource(this.url)
    this.hls.attachMedia(this.video)
    const started = waitForPlaying(this.video, failed)
    void playVideo(this.video)
    await started
    this.started = true
    this.unwatch = watchVideo(this.video, this)
  }

  audioTracks(): Track[] {
    return this.hls.audioTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `${i + 1}` }))
  }

  selectedAudio(): number {
    return this.hls.audioTrack
  }

  setAudioTrack(id: number): void {
    this.hls.audioTrack = id
  }

  subtitleTracks(): Track[] {
    return this.hls.subtitleTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `${i + 1}` }))
  }

  selectedSubtitle(): number {
    return this.hls.subtitleTrack
  }

  setSubtitleTrack(id: number): void {
    this.hls.subtitleDisplay = id >= 0
    this.hls.subtitleTrack = id
  }

  destroy(): void {
    this.unwatch()
    this.hls.destroy()
    releaseVideo(this.video)
  }
}

class MpegtsEngine implements Engine {
  readonly name = 'mpegts.js'
  onFatal?: (error: PlaybackError) => void
  private readonly player: mpegts.Player
  private started = false
  private unwatch = () => {}

  constructor(
    private readonly video: HTMLVideoElement,
    url: string,
  ) {
    this.player = mpegts.createPlayer(
      { type: 'mpegts', isLive: true, url: proxied(url) },
      { enableWorker: false, liveBufferLatencyChasing: true, autoCleanupSourceBuffer: true },
    )
  }

  async start(): Promise<void> {
    const failed = new Promise<never>((_, reject) => {
      this.player.on(mpegts.Events.ERROR, (type: string, detail: string) => {
        const error = new PlaybackError(type === mpegts.ErrorTypes.NETWORK_ERROR ? 'network' : 'format', detail)
        if (this.started) this.onFatal?.(error)
        else reject(error)
      })
    })
    this.player.attachMediaElement(this.video)
    this.player.load()
    const started = waitForPlaying(this.video, failed)
    void playVideo(this.video)
    await started
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
    this.unwatch()
    this.player.pause()
    this.player.unload()
    this.player.detachMediaElement()
    this.player.destroy()
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
