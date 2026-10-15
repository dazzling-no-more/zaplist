// Stream types, attempt order and the engine contract. No engine code here, so tests can import it.

/** `remux`: the native player fed by the app's service, for movies with audio the TV can't decode. */
export type EngineName = 'native' | 'hls.js' | 'mpegts.js' | 'remux'
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

export interface Engine {
  readonly name: EngineName
  /**
   * Resolves once video plays, `position` seconds in (movies; live streams start where they are);
   * rejects with a PlaybackError when this engine can't play the stream.
   */
  start(position?: number): Promise<void>
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

export interface Attempt {
  url: string
  engine: EngineName
}

/**
 * The order to try for each URL: the native player first, since webOS plays HLS and MPEG-TS itself;
 * then the MSE engine that fits the stream type. URLs without an extension (typical IPTV live links)
 * are usually raw MPEG-TS, so mpegts.js goes before hls.js for them. Where the native player can't
 * play MPEG-TS (desktop browsers, which take seconds to fail), it goes last for those URLs. With
 * `remux` (the TV), Matroska files play through the remux engine, which uses the native player too.
 */
export function playbackAttempts(urls: string[], mse: { hls: boolean; mpegts: boolean }, nativeMpegTs = true, remux = false): Attempt[] {
  const attempts: Attempt[] = []
  for (const url of urls) {
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
 * tried, which knows the stream type best (the native player reports nearly everything as a format
 * error); the detail lists every engine's reason.
 */
export function summarizeFailures(failures: Failure[]): PlaybackError {
  if (!failures.length) return new PlaybackError('format', 'No playable stream')
  const main = failures.find((f) => f.engine !== 'native') ?? failures[failures.length - 1]
  return new PlaybackError(main.error.code, failures.map((f) => `${f.engine}: ${f.error.detail ?? f.error.code}`).join(' · '))
}
