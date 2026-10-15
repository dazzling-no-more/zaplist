import type { Writable } from 'stream'
import { inflateSync } from 'zlib'
import { child, children, element, encodeId, encodeSize, floatElement, ID, readVint, subtitleKind, trackLanguage, TRACK_AUDIO, TRACK_SUBTITLE, TRACK_VIDEO, uint, uintElement, UNKNOWN, UNKNOWN_SIZE } from './ebml'
import { get } from './fetch'
import { OpusToPcm, parseOpusHead, SAMPLE_RATE } from './opus'
import { Reader, type ElementHeader } from './reader'

// A WebAssembly module the engine can't compile leaves the decoder's `ready` pending forever.
const DECODER_TIMEOUT_MS = 10000
/** Subtitle cues kept for the app at most; it fetches them every second, so only if it stopped asking. */
const MAX_PENDING_CUES = 5000

interface Track {
  body: Buffer
  number: number
  type: number
  codec: string
  isDefault: boolean
  name: string
  language: string
  /** Undoes the track's content encoding (contentDecoder), for frames read here. */
  frames: (frame: Buffer) => Buffer
}

export interface TrackInfo {
  number: number
  name: string
  language: string
  codec: string
  default: boolean
}

/** A subtitle as the TV's player can't show it: the app draws it (src/player/subtitles.ts). */
export interface SubtitleCue {
  track: number
  /** Seconds into the movie. */
  start: number
  /** Absent when the block has no duration (PGS: the next picture of the track replaces it). */
  end?: number
  /** Text tracks: the block's text (for ASS, the event line). */
  text?: string
  /** PGS tracks: the display set, base64. */
  data?: string
}

/** What comes before the first cluster, plus the cue index once it has been read. */
interface Movie {
  ebml: Buffer
  /** File offset of the Segment's body; cluster and cue positions count from here. */
  segmentStart: number
  firstCluster: number
  info: Buffer
  tracks: Track[]
  /** File offset of the Cues element, if the SeekHead names one. */
  cuesAt?: number
  /** [seconds, file offset of the cluster], in time order. */
  cues?: Array<[number, number]>
}

// The last movie opened: every seek restarts the stream, which shouldn't read the header and cues again.
let cached: { url: string; movie: Movie } | undefined

/** One request to the IPTV server's file at a time. Stopping it closes its connection at once. */
export class Job {
  closed = false
  private reader?: Reader
  private cues: SubtitleCue[] = []

  addCues(cues: SubtitleCue[]): void {
    this.cues = this.cues.concat(cues)
    if (this.cues.length > MAX_PENDING_CUES) this.cues = this.cues.slice(this.cues.length - MAX_PENDING_CUES)
  }

  /** The subtitle cues read since the last call. */
  takeCues(): SubtitleCue[] {
    const cues = this.cues
    this.cues = []
    return cues
  }

  /** Reads `url` from byte `from`, after closing the job's previous connection: IPTV logins often allow one. */
  async open(url: string, from: number): Promise<Reader> {
    if (this.reader) this.reader.destroy()
    this.reader = undefined
    const reader = new Reader(await get(url, from), from)
    if (this.closed) reader.destroy()
    else this.reader = reader
    return reader
  }

  stop(): void {
    this.closed = true
    if (this.reader) this.reader.destroy()
  }
}

/** The movie's header, from the cache or read from the start of the file (`pending`: that reader, at the first cluster). */
async function open(url: string, job: Job): Promise<{ movie: Movie; pending?: { reader: Reader; cluster: ElementHeader } }> {
  if (cached && cached.url === url) return { movie: cached.movie }
  const reader = await job.open(url, 0)
  const { movie, cluster } = await readMovie(reader)
  cached = { url, movie }
  return { movie, pending: { reader, cluster } }
}

/** The movie's audio and subtitle tracks, and where a stream asked to start at `seconds` really starts. */
export async function info(url: string, seconds: number, job: Job): Promise<{ start: number; audio: TrackInfo[]; subtitles: TrackInfo[] }> {
  const { movie } = await open(url, job)
  const [start] = await cueAt(url, movie, seconds, job)
  const list = (tracks: Track[]) => tracks.map((t) => ({ number: t.number, name: t.name, language: t.language, codec: t.codec, default: t.isDefault }))
  return {
    start,
    audio: list(movie.tracks.filter((t) => t.type === TRACK_AUDIO)),
    subtitles: list(movie.tracks.filter((t) => t.type === TRACK_SUBTITLE && subtitleKind(t.codec))),
  }
}

export interface RemuxOptions {
  url: string
  /** Seconds into the movie; the stream starts at the cue at or before it (see `info`). */
  start: number
  /** Track number of the audio to play; the default track if absent. */
  audio?: number
  /** Subtitle tracks whose cues the job collects for the app. */
  subtitles?: number[]
}

/**
 * Writes the movie to `out` as Matroska with its video and one audio track; Opus audio becomes PCM,
 * which the TV's player decodes. Resolves at the end of the movie or once the job stops.
 */
export async function remux(options: RemuxOptions, out: Writable, job: Job): Promise<void> {
  let converter: OpusToPcm | undefined
  let reader: Reader | undefined
  try {
    const { movie, pending } = await open(options.url, job)
    const video = movie.tracks.filter((t) => t.type === TRACK_VIDEO)[0]
    if (!video) throw new Error('No video track')
    const audios = movie.tracks.filter((t) => t.type === TRACK_AUDIO)
    const audio = audios.filter((t) => t.number === options.audio)[0] || audios.filter((t) => t.isDefault)[0] || audios[0]
    const entries = [element(ID.TrackEntry, [video.body])]
    if (audio && audio.codec === 'A_OPUS') {
      const head = child(audio.body, ID.CodecPrivate)
      if (!head) throw new Error('Opus track without a header')
      converter = new OpusToPcm(parseOpusHead(head))
      await Promise.race([converter.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('The Opus decoder did not load')), DECODER_TIMEOUT_MS))])
      entries.push(pcmTrack(audio.body, converter.channels))
    } else if (audio) entries.push(element(ID.TrackEntry, [audio.body]))

    let head: ElementHeader | undefined
    if (pending && options.start <= 0) {
      reader = pending.reader
      head = pending.cluster
    } else {
      const [, from] = await cueAt(options.url, movie, options.start, job)
      reader = await job.open(options.url, from)
    }
    const subtitles: Selection['subtitles'] = {}
    for (const t of movie.tracks) {
      const kind = subtitleKind(t.codec)
      if (t.type === TRACK_SUBTITLE && kind && (options.subtitles || []).indexOf(t.number) >= 0) subtitles[t.number] = { kind, frames: t.frames }
    }
    const selection: Selection = { video: video.number, audio: audio && audio.number, audioFrames: audio && audio.frames, converter, subtitles, scale: timecodeScale(movie) }
    await write(out, Buffer.concat([movie.ebml, encodeId(ID.Segment), UNKNOWN_SIZE, element(ID.Info, [movie.info]), element(ID.Tracks, entries)]))
    while (!job.closed) {
      const next = head || (await reader.header())
      head = undefined
      if (!next || next.size === UNKNOWN) break
      const body = await reader.read(next.size)
      if (!body) break
      if (next.id !== ID.Cluster) continue
      const cues: SubtitleCue[] = []
      const data = cluster(body, selection, cues)
      job.addCues(cues)
      await write(out, data)
    }
  } finally {
    if (reader) reader.destroy()
    if (converter) converter.free()
  }
}

/** Waits while the player's buffer is full; the Reader then pauses the download too. */
function write(out: Writable, data: Buffer): Promise<void> {
  return new Promise((resolve) => {
    if (out.write(data)) return resolve()
    const done = () => {
      out.removeListener('drain', done)
      out.removeListener('close', done)
      resolve()
    }
    out.on('drain', done)
    out.on('close', done)
  })
}

/** Reads the EBML header and the Segment up to its first cluster, and that cluster's header. */
async function readMovie(reader: Reader): Promise<{ movie: Movie; cluster: ElementHeader }> {
  const ebmlHead = await reader.header()
  const ebmlBody = ebmlHead && ebmlHead.id === ID.EBML ? await reader.read(ebmlHead.size) : undefined
  if (!ebmlBody) throw new Error('Not a Matroska file')
  const segment = await reader.header()
  if (!segment || segment.id !== ID.Segment) throw new Error('No Matroska segment')
  const segmentStart = reader.position
  let info: Buffer | undefined
  let tracks: Track[] = []
  let cuesAt: number | undefined
  for (;;) {
    const head = await reader.header()
    if (!head) throw new Error('No clusters')
    if (head.id === ID.Cluster) {
      if (!info || !tracks.length) throw new Error('No track list before the first cluster')
      return { movie: { ebml: element(ID.EBML, [ebmlBody]), segmentStart, firstCluster: head.start, info, tracks, cuesAt }, cluster: head }
    }
    if (head.size === UNKNOWN) throw new Error('Element of unknown size before the first cluster')
    const body = await reader.read(head.size)
    if (!body) throw new Error('The file ends before the first cluster')
    if (head.id === ID.Info) info = body
    else if (head.id === ID.Tracks) tracks = children(body).filter((e) => e.id === ID.TrackEntry).map((e) => track(e.data))
    else if (head.id === ID.SeekHead) {
      for (const seek of children(body)) {
        if (seek.id === ID.Seek && uint(child(seek.data, ID.SeekID)) === ID.Cues) cuesAt = segmentStart + uint(child(seek.data, ID.SeekPosition))
      }
    }
  }
}

function track(body: Buffer): Track {
  const text = (data: Buffer | undefined) => (data ? data.toString('utf8').replace(/\0+$/, '') : '')
  return {
    body,
    number: uint(child(body, ID.TrackNumber)),
    type: uint(child(body, ID.TrackType)),
    codec: text(child(body, ID.CodecID)),
    isDefault: uint(child(body, ID.FlagDefault), 1) === 1,
    name: text(child(body, ID.Name)),
    language: trackLanguage(body, text),
    frames: contentDecoder(body),
  }
}

const unchanged = (frame: Buffer) => frame

/**
 * Undoes a track's content compression: zlib (mkvmerge's default for subtitles) or header stripping
 * (bytes every frame starts with, kept once in the track entry). The TV's player undoes it for the
 * tracks passed through; this is for those read here. Encrypted tracks are left as they are.
 */
export function contentDecoder(body: Buffer): (frame: Buffer) => Buffer {
  const encodings = child(body, ID.ContentEncodings)
  const encoding = encodings && child(encodings, ID.ContentEncoding)
  const compression = encoding && uint(child(encoding, ID.ContentEncodingType)) === 0 ? child(encoding, ID.ContentCompression) : undefined
  if (!compression) return unchanged
  const algorithm = uint(child(compression, ID.ContentCompAlgo))
  const settings = child(compression, ID.ContentCompSettings)
  if (algorithm === 3 && settings) return (frame) => Buffer.concat([settings, frame])
  if (algorithm === 0) return (frame) => inflateSync(frame) // small frames; a corrupt one throws
  return unchanged
}

/** The track entry with Opus swapped for 16-bit PCM. */
export function pcmTrack(body: Buffer, channels: number): Buffer {
  const dropped = [ID.CodecID, ID.CodecPrivate, ID.CodecDelay, ID.SeekPreRoll, ID.DefaultDuration, ID.Audio, ID.ContentEncodings]
  const parts = children(body)
    .filter((c) => dropped.indexOf(c.id) < 0)
    .map((c) => element(c.id, [c.data]))
  const audio = element(ID.Audio, [floatElement(ID.SamplingFrequency, SAMPLE_RATE), uintElement(ID.Channels, channels), uintElement(ID.BitDepth, 16)])
  return element(ID.TrackEntry, parts.concat([element(ID.CodecID, [Buffer.from('A_PCM/INT/LIT')]), audio]))
}

/** [seconds, file offset] of the last cluster starting at or before `seconds`, from the cue index. */
async function cueAt(url: string, movie: Movie, seconds: number, job: Job): Promise<[number, number]> {
  if (seconds <= 0) return [0, movie.firstCluster]
  if (!movie.cues && movie.cuesAt !== undefined) {
    const reader = await job.open(url, movie.cuesAt)
    const head = await reader.header()
    const body = head && head.id === ID.Cues && head.size !== UNKNOWN ? await reader.read(head.size) : undefined
    reader.destroy()
    movie.cues = body ? parseCues(body, movie) : []
  }
  let found: [number, number] = [0, movie.firstCluster]
  for (const cue of movie.cues || []) {
    if (cue[0] > seconds) break
    found = cue
  }
  return found
}

/** Seconds per unit of Matroska time. */
const timecodeScale = (movie: { info: Buffer }) => uint(child(movie.info, ID.TimecodeScale), 1000000) / 1e9
const toMilliseconds = (seconds: number) => Math.round(seconds * 1000) / 1000

export function parseCues(body: Buffer, movie: { info: Buffer; segmentStart: number }): Array<[number, number]> {
  const scale = timecodeScale(movie)
  const cues: Array<[number, number]> = []
  for (const point of children(body)) {
    const positions = point.id === ID.CuePoint ? child(point.data, ID.CueTrackPositions) : undefined
    if (positions) cues.push([toMilliseconds(uint(child(point.data, ID.CueTime)) * scale), movie.segmentStart + uint(child(positions, ID.CueClusterPosition))])
  }
  return cues.sort((a, b) => a[0] - b[0])
}

export interface Selection {
  video: number
  audio?: number
  /** Turns the audio into PCM (Opus); without it, the audio passes through. */
  converter?: OpusToPcm
  /** Undoes the audio's content encoding before the converter. */
  audioFrames?: (frame: Buffer) => Buffer
  /** The subtitle tracks whose cues are collected: how the app shows them, how to undo their encoding. */
  subtitles: { [track: number]: { kind: 'text' | 'pgs'; frames: (frame: Buffer) => Buffer } }
  /** Seconds per unit of Matroska time. */
  scale: number
}

/**
 * A cluster with only the video and the chosen audio (Opus blocks become PCM), in one copy of the
 * data. Blocks of the selected subtitle tracks go to `cues` instead.
 */
export function cluster(body: Buffer, selection: Selection, cues: SubtitleCue[]): Buffer {
  const { video, audio, converter, subtitles, scale } = selection
  const parts: Buffer[] = []
  let time = 0
  for (const c of children(body)) {
    if (c.id === ID.Timecode) {
      time = uint(c.data)
      parts.push(element(c.id, [c.data]))
    }
    if (c.id !== ID.SimpleBlock && c.id !== ID.BlockGroup) continue
    const block = c.id === ID.SimpleBlock ? c.data : child(c.data, ID.Block)
    const track = block && readVint(block, 0)
    if (!block || !track) continue
    const number = track[0]
    if (number === video || (number === audio && !converter)) parts.push(encodeId(c.id), encodeSize(c.data.length), c.data)
    else if (number === audio && converter) {
      const frames = unlace(block, track[1] + 2).map(selection.audioFrames || ((frame: Buffer) => frame))
      const pcm = pcmBlock(block, track[1], converter.decode(frames))
      parts.push(encodeId(ID.SimpleBlock), encodeSize(pcm.length), pcm)
    } else if (subtitles[number]) {
      // Subtitle blocks have no lacing: after the track number, the time (2 bytes) and flags (1).
      const start = (time + block.readInt16BE(track[1])) * scale
      const duration = c.id === ID.BlockGroup ? child(c.data, ID.BlockDuration) : undefined
      let payload: Buffer
      try {
        payload = subtitles[number].frames(block.slice(track[1] + 3))
      } catch {
        continue // a corrupt compressed block: one subtitle missing
      }
      const cue: SubtitleCue = { track: number, start: toMilliseconds(start) }
      if (duration) cue.end = toMilliseconds(start + uint(duration) * scale)
      if (subtitles[number].kind === 'text') cue.text = payload.toString('utf8')
      else cue.data = payload.toString('base64')
      cues.push(cue)
    }
  }
  let length = 0
  for (const p of parts) length += p.length
  return Buffer.concat([encodeId(ID.Cluster), encodeSize(length)].concat(parts))
}

/** A SimpleBlock with the Opus block's track and time, holding its frames decoded to PCM (no lacing). */
function pcmBlock(block: Buffer, trackLength: number, pcm: Buffer): Buffer {
  const head = Buffer.alloc(trackLength + 3)
  block.copy(head, 0, 0, trackLength + 2) // track number and time
  head[trackLength + 2] = 0x80 // keyframe
  return Buffer.concat([head, pcm])
}

/** The frames of a Matroska block (`flagsAt`: offset of its flags byte). */
export function unlace(block: Buffer, flagsAt: number): Buffer[] {
  const lacing = (block[flagsAt] >> 1) & 3
  let pos = flagsAt + 1
  if (!lacing) return [block.slice(pos)]
  const count = block[pos++] + 1
  const sizes: number[] = []
  if (lacing === 1) {
    // Xiph: each size is a run of 255s plus a final byte
    for (let i = 0; i < count - 1; i++) {
      let size = 0
      let byte: number
      do {
        byte = block[pos++]
        size += byte
      } while (byte === 255)
      sizes.push(size)
    }
  } else if (lacing === 3) {
    // EBML: the first size, then signed differences
    const first = readVint(block, pos, true)!
    pos += first[1]
    sizes.push(first[0])
    for (let i = 1; i < count - 1; i++) {
      const delta = readVint(block, pos, true)!
      pos += delta[1]
      sizes.push(sizes[i - 1] + delta[0] - (Math.pow(2, 7 * delta[1] - 1) - 1))
    }
  } else {
    // fixed: equal sizes
    const each = (block.length - pos) / count
    for (let i = 0; i < count - 1; i++) sizes.push(each)
  }
  let used = 0
  for (const s of sizes) used += s
  sizes.push(block.length - pos - used)
  return sizes.map((size) => {
    const frame = block.slice(pos, pos + size)
    pos += size
    return frame
  })
}
