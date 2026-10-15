import { useSyncExternalStore } from 'react'
import { diagnostics, recordError } from './diagnostics'
import { createEngine, mseSupport, nativePlaysMpegTs, releaseVideo, remuxSupport } from './engines'
import { playbackAttempts, PlaybackError, summarizeFailures, type Engine, type Failure, type TrackChoices, type TrackLabels } from './streams'

/** Waits before each retry of a failed stream; after the last one playback gives up. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000]
/** A stream that has played this long works again: a later failure gets all the retries again. */
export const RECOVERED_MS = 30_000

export type PlaybackStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'playing' }
  /** Waiting `delay` ms before retry number `retry` (1-based). */
  | { state: 'retrying'; retry: number; delay: number; error: PlaybackError }
  | { state: 'failed'; error: PlaybackError }

/**
 * Plays one stream at a time in a <video> element: tries each URL and engine in turn, retries with
 * backoff, and releases the previous engine (and decoder) before every new attempt.
 */
export class Playback {
  private status: PlaybackStatus = { state: 'idle' }
  private engine?: Engine
  /** The engine still trying to start, so a channel change can stop it too. */
  private starting?: Engine
  private urls: string[] = []
  private position = () => 0
  private choices: TrackChoices = {}
  private retries = 0
  /** Bumped by every play/stop so late results of an earlier load are ignored. */
  private token = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private recovered: ReturnType<typeof setTimeout> | undefined
  private readonly listeners = new Set<() => void>()

  /**
   * `live`: the stream has no end, so one that ends (the server closed it) is retried like a failure.
   * Switched off while a past programme plays again (catch-up), which does end.
   */
  constructor(
    private readonly video: HTMLVideoElement,
    public live = false,
  ) {
    if (live) video.addEventListener('ended', () => this.live && this.engine && this.fail(this.token, new PlaybackError('network', 'The stream ended')))
  }

  getStatus = (): PlaybackStatus => this.status

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * `position`: seconds into the stream to start at, asked again on every retry (movies). Playing the
   * same stream again (app back from the background, network back) keeps the tracks chosen for it;
   * another stream starts with the tracks labelled `labels` (those chosen for the episode before).
   */
  play(urls: string[], position: () => number = () => 0, labels: TrackLabels = {}): void {
    if (urls.join('\n') !== this.urls.join('\n')) this.choices = { labels: { ...labels } }
    this.urls = urls
    this.position = position
    this.retries = 0
    void this.load(this.reset())
  }

  /** Stops playback and frees the decoder (app hidden, network lost, leaving the player). */
  stop(): void {
    this.reset()
    this.set({ state: 'idle' })
  }

  /** The engine playing now, for track selection. */
  current(): Engine | undefined {
    return this.engine
  }

  /** Seconds into the stream; 0 while nothing plays. */
  currentTime(): number {
    return this.engine ? this.engine.currentTime() : 0
  }

  seek(seconds: number): void {
    this.engine?.seek(seconds)
  }

  /** Chooses an audio track (id from current().audioTracks()); kept when the stream restarts. */
  setAudioTrack(id: number): void {
    this.choices.audio = id
    const track = this.engine?.audioTracks().filter((t) => t.id === id)[0]
    if (track) this.labels().audio = track.label
    this.engine?.setAudioTrack(id)
  }

  /** Chooses subtitles (id from current().subtitleTracks(), -1: off); kept when the stream restarts. */
  setSubtitleTrack(id: number): void {
    this.choices.subtitle = id
    const track = this.engine?.subtitleTracks().filter((t) => t.id === id)[0]
    if (track || id < 0) this.labels().subtitle = track ? track.label : ''
    this.engine?.setSubtitleTrack(id)
  }

  /** Labels of the tracks chosen for this stream, or carried over from the one before: for the next episode. */
  chosenLabels(): TrackLabels {
    return { ...this.labels() }
  }

  private labels(): TrackLabels {
    return (this.choices.labels ??= {})
  }

  private reset(): number {
    clearTimeout(this.timer)
    clearTimeout(this.recovered)
    this.starting?.destroy()
    this.starting = undefined
    this.engine?.destroy()
    this.engine = undefined
    releaseVideo(this.video)
    return ++this.token
  }

  private async load(token: number): Promise<void> {
    this.set({ state: 'loading' })
    const failures: Failure[] = []
    for (const attempt of playbackAttempts(this.urls, mseSupport(), nativePlaysMpegTs(), remuxSupport())) {
      if (token !== this.token) return
      const engine = createEngine(attempt, this.video)
      this.starting = engine
      try {
        await engine.start(this.position(), { ...this.choices })
      } catch (error) {
        engine.destroy()
        failures.push({ engine: attempt.engine, error: error instanceof PlaybackError ? error : new PlaybackError('format', String(error)) })
        continue
      } finally {
        if (this.starting === engine) this.starting = undefined
      }
      if (token !== this.token) return engine.destroy()
      this.engine = engine
      engine.onFatal = (error) => this.fail(token, error)
      diagnostics.engine = engine.name
      // Not at the first frame: a stream that breaks right after it starts would be retried forever.
      this.recovered = setTimeout(() => (this.retries = 0), RECOVERED_MS)
      this.set({ state: 'playing' })
      return
    }
    // The detail names each engine's reason: shown under the error message and in Settings > About.
    this.fail(token, summarizeFailures(failures))
  }

  private fail(token: number, error: PlaybackError): void {
    if (token !== this.token) return
    recordError(error.message)
    const delay = RETRY_DELAYS_MS[this.retries]
    const next = this.reset()
    if (delay === undefined) return this.set({ state: 'failed', error })
    this.retries++
    this.set({ state: 'retrying', retry: this.retries, delay, error })
    this.timer = setTimeout(() => void this.load(next), delay)
  }

  private set(status: PlaybackStatus): void {
    this.status = status
    this.listeners.forEach((listener) => listener())
  }
}

// Stable values: useSyncExternalStore needs the same snapshot object until something changes.
const IDLE: PlaybackStatus = { state: 'idle' }
const getIdle = () => IDLE
const NONE = () => () => {}

export function usePlaybackStatus(playback: Playback | undefined): PlaybackStatus {
  return useSyncExternalStore(playback?.subscribe ?? NONE, playback?.getStatus ?? getIdle)
}
