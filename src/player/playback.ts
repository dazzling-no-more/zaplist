import { useSyncExternalStore } from 'react'
import { diagnostics, recordError } from './diagnostics'
import { createEngine, mseSupport, nativePlaysMpegTs, releaseVideo, remuxSupport } from './engines'
import { playbackAttempts, PlaybackError, summarizeFailures, type Engine, type Failure } from './streams'

/** Waits before each retry of a failed stream; after the last one playback gives up. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000]

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
  private retries = 0
  /** Bumped by every play/stop so late results of an earlier load are ignored. */
  private token = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly listeners = new Set<() => void>()

  constructor(private readonly video: HTMLVideoElement) {}

  getStatus = (): PlaybackStatus => this.status

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** `position`: seconds into the stream to start at, asked again on every retry (movies). */
  play(urls: string[], position: () => number = () => 0): void {
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

  private reset(): number {
    clearTimeout(this.timer)
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
        await engine.start(this.position())
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
      this.retries = 0
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
