// Stream types, attempt order and the engine contract. No engine code here, so tests can import it.
import type { Subtitle } from './subtitles'

/**
 * `remux`: the native player fed by the app's service, for movies with audio the TV can't decode;
 * `proxy`: the native player fetching through the service, for streams that need request headers.
 */
export type EngineName = 'native' | 'hls.js' | 'mpegts.js' | 'remux' | 'proxy'
export type PlaybackErrorCode = 'network' | 'format' | 'timeout'

export class PlaybackError extends Error {
  constructor(
    readonly code: PlaybackErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

export interface Track {
  id: number
  label: string
}

/** Labels of the tracks chosen (subtitle '': off), to choose the same ones in another stream (the next episode). */
export interface TrackLabels {
  audio?: string
  subtitle?: string
}

/**
 * Track ids chosen in the audio and subtitle menus (subtitle -1: off), kept while a stream restarts;
 * `labels` chooses by label where no id is set (a stream played for the first time).
 */
export interface TrackChoices {
  audio?: number
  subtitle?: number
  labels?: TrackLabels
}

/** The track to choose among `tracks`: `id`, else the one labelled `label` ('': -1, off); undefined for none. */
export function chosenTrack(tracks: Track[], id: number | undefined, label: string | undefined): number | undefined {
  if (id !== undefined) return id
  if (label === '') return -1
  const track = tracks.filter((t) => t.label === label)[0]
  return track && track.id
}

export interface Engine {
  readonly name: EngineName
  /**
   * Resolves once video plays, `position` seconds in (movies; live streams start where they are) and
   * with the `choices` made before the stream restarted; rejects with a PlaybackError when this engine
   * can't play the stream.
   */
  start(position?: number, choices?: TrackChoices): Promise<void>
  /** Seconds into the stream. */
  currentTime(): number
  seek(seconds: number): void
  /** Set by the owner: a fatal error after playback started. */
  onFatal?: (error: PlaybackError) => void
  audioTracks(): Track[]
  selectedAudio(): number
  setAudioTrack(id: number): void
  subtitleTracks(): Track[]
  /** -1 when subtitles are off. */
  selectedSubtitle(): number
  setSubtitleTrack(id: number): void
  /** Subtitles the app draws at `seconds`, for engines whose player can't show them (remux). */
  subtitleAt?(seconds: number): Subtitle | undefined
  /** Stops and releases the decoder. */
  destroy(): void
}

export type StreamKind = 'hls' | 'ts' | 'other' | 'unknown'

export function streamKind(url: string): StreamKind {
  const path = url.split(/[?#]/)[0].toLowerCase()
  const file = path.slice(path.lastIndexOf('/') + 1)
  if (/\.m3u8?$/.test(file)) return 'hls'
  if (/\.(ts|mts|m2ts|mpegts)$/.test(file)) return 'ts'
  return /\.[a-z0-9]{2,5}$/.test(file) ? 'other' : 'unknown'
}

/** Matroska and WebM files (movies), which can carry Opus audio. */
export function isMatroska(url: string): boolean {
  return /\.(mkv|webm)$/.test(url.split(/[?#]/)[0].toLowerCase())
}

/** A stream URL and the request headers after its `|` (Kodi's `url|User-Agent=…&Referer=…`, values URL-encoded). */
export function splitHeaders(url: string): { url: string; headers: string } {
  const bar = url.indexOf('|')
  return bar < 0 ? { url, headers: '' } : { url: url.slice(0, bar), headers: url.slice(bar + 1) }
}

// Playlist options that name request headers: VLC's, and Kodi's lists of them (`Name=value&…`).
const HEADER_OPTIONS: Record<string, string> = { 'http-user-agent': 'User-Agent', 'http-referrer': 'Referer', 'http-referer': 'Referer' }
const HEADER_LISTS = ['inputstream.adaptive.stream_headers', 'inputstream.adaptive.manifest_headers']

/**
 * A channel's stream URLs with the headers its playlist options ask for (#EXTVLCOPT, #KODIPROP) after
 * a `|`, as Kodi writes them. Headers already in the URL stay.
 */
export function withHeaders(urls: string[], options: Record<string, string> = {}): string[] {
  const named: string[] = []
  for (const key of Object.keys(options)) {
    if (HEADER_OPTIONS[key]) named.push(`${HEADER_OPTIONS[key]}=${encodeURIComponent(options[key])}`)
    else if (HEADER_LISTS.indexOf(key) >= 0) named.push(options[key])
  }
  if (!named.length) return urls
  return urls.map((url) => (url.indexOf('|') >= 0 ? url : `${url}|${named.join('&')}`))
}

export interface Attempt {
  url: string
  engine: EngineName
}

/**
 * The order to try for each URL: the native player first, since webOS plays HLS and MPEG-TS itself;
 * then the MSE engine that fits the stream type. URLs without an extension (typical IPTV live links)
 * are usually raw MPEG-TS, so mpegts.js goes before hls.js for them. Where the native player can't
 * play MPEG-TS (desktop browsers, which take seconds to fail), it goes last for those URLs. With
 * `remux` (the TV, which has the app's service), Matroska files play through the remux engine, and
 * streams that need request headers through the service's proxy first, both with the native player.
 */
export function playbackAttempts(urls: string[], mse: { hls: boolean; mpegts: boolean }, nativeMpegTs = true, remux = false): Attempt[] {
  const attempts: Attempt[] = []
  for (const full of urls) {
    const { url, headers } = splitHeaders(full)
    // The other engines can't send the headers; the stream may still play without them.
    if (remux && headers) attempts.push({ url: full, engine: 'proxy' })
    if (remux && isMatroska(url)) {
      attempts.push({ url, engine: 'remux' })
      continue
    }
    const kind = streamKind(url)
    const tsLike = kind === 'ts' || kind === 'unknown'
    const nativeLast = tsLike && !nativeMpegTs && mse.mpegts
    if (!nativeLast) attempts.push({ url, engine: 'native' })
    if (tsLike && mse.mpegts) attempts.push({ url, engine: 'mpegts.js' })
    if ((kind === 'hls' || kind === 'unknown') && mse.hls) attempts.push({ url, engine: 'hls.js' })
    if (nativeLast) attempts.push({ url, engine: 'native' })
  }
  return attempts
}

export interface Failure {
  engine: EngineName
  error: PlaybackError
}

/**
 * One error for a stream that no engine could play. The headline comes from the first MSE engine
 * tried, which knows the stream type best (the native player, which the proxy and remux engines feed
 * too, reports nearly everything as a format error, a server's refusal included); the detail lists
 * every engine's reason.
 */
export function summarizeFailures(failures: Failure[]): PlaybackError {
  if (!failures.length) return new PlaybackError('format', 'No playable stream')
  const main = failures.find((f) => f.engine === 'hls.js' || f.engine === 'mpegts.js') ?? failures[failures.length - 1]
  return new PlaybackError(main.error.code, failures.map((f) => `${f.engine}: ${f.error.detail ?? f.error.code}`).join(' · '))
}
