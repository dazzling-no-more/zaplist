import type { Writable } from 'stream'
import { child, children, element, encodeId, encodeSize, floatElement, ID, readVint, TRACK_AUDIO, TRACK_VIDEO, uint, uintElement, UNKNOWN, UNKNOWN_SIZE } from './ebml'
import { get } from './fetch'
import { OpusToPcm, parseOpusHead, SAMPLE_RATE } from './opus'
import { Reader, type ElementHeader } from './reader'

// A WebAssembly module the engine can't compile leaves the decoder's `ready` pending forever.
const DECODER_TIMEOUT_MS = 10000

interface Track {
  body: Buffer
  number: number
  type: number
  codec: string
  isDefault: boolean
  label: string
}

export interface AudioTrack {
  number: number
  label: string
  default: boolean
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

/** The movie's audio tracks, and where a stream asked to start at `seconds` really starts. */
export async function info(url: string, seconds: number, job: Job): Promise<{ start: number; audio: AudioTrack[] }> {
  const { movie } = await open(url, job)
  const [start] = await cueAt(url, movie, seconds, job)
  const audio = movie.tracks.filter((t) => t.type === TRACK_AUDIO).map((t) => ({ number: t.number, label: t.label, default: t.isDefault }))
  return { start, audio }
}

export interface RemuxOptions {
  url: string
  /** Seconds into the movie; the stream starts at the cue at or before it (see `info`). */
  start: number
  /** Track number of the audio to play; the default track if absent. */
  audio?: number
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
    await write(out, Buffer.concat([movie.ebml, encodeId(ID.Segment), UNKNOWN_SIZE, element(ID.Info, [movie.info]), element(ID.Tracks, entries)]))
    while (!job.closed) {
      const next = head || (await reader.header())
      head = undefined
      if (!next || next.size === UNKNOWN) break
      const body = await reader.read(next.size)
      if (!body) break
      if (next.id === ID.Cluster) await write(out, cluster(body, video.number, audio && audio.number, converter))
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
  const text = (id: number) => {
    const data = child(body, id)
    return data ? data.toString('utf8').replace(/\0+$/, '') : ''
  }
  const language = text(ID.Language)
  return {
    body,
    number: uint(child(body, ID.TrackNumber)),
    type: uint(child(body, ID.TrackType)),
    codec: text(ID.CodecID),
    isDefault: uint(child(body, ID.FlagDefault), 1) === 1,
    label: text(ID.Name) || (language !== 'und' ? language : ''),
  }
}

/** The track entry with Opus swapped for 16-bit PCM. */
export function pcmTrack(body: Buffer, channels: number): Buffer {
  const dropped = [ID.CodecID, ID.CodecPrivate, ID.CodecDelay, ID.SeekPreRoll, ID.DefaultDuration, ID.Audio]
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

export function parseCues(body: Buffer, movie: { info: Buffer; segmentStart: number }): Array<[number, number]> {
  const scale = uint(child(movie.info, ID.TimecodeScale), 1000000) / 1e9
  const cues: Array<[number, number]> = []
  for (const point of children(body)) {
    const positions = point.id === ID.CuePoint ? child(point.data, ID.CueTrackPositions) : undefined
    const seconds = Math.round(uint(child(point.data, ID.CueTime)) * scale * 1000) / 1000
    if (positions) cues.push([seconds, movie.segmentStart + uint(child(positions, ID.CueClusterPosition))])
  }
  return cues.sort((a, b) => a[0] - b[0])
}

/** A cluster with only the video and the chosen audio; Opus blocks become PCM. One copy of the data. */
export function cluster(body: Buffer, video: number, audio: number | undefined, converter: OpusToPcm | undefined): Buffer {
  const parts: Buffer[] = []
  for (const c of children(body)) {
    if (c.id === ID.Timecode) parts.push(element(c.id, [c.data]))
    if (c.id !== ID.SimpleBlock && c.id !== ID.BlockGroup) continue
    const block = c.id === ID.SimpleBlock ? c.data : child(c.data, ID.Block)
    const track = block && readVint(block, 0)
    if (!block || !track) continue
    if (track[0] === video || (track[0] === audio && !converter)) parts.push(encodeId(c.id), encodeSize(c.data.length), c.data)
    else if (track[0] === audio && converter) {
      const pcm = pcmBlock(block, track[1], converter)
      parts.push(encodeId(ID.SimpleBlock), encodeSize(pcm.length), pcm)
    }
  }
  let length = 0
  for (const p of parts) length += p.length
  return Buffer.concat([encodeId(ID.Cluster), encodeSize(length)].concat(parts))
}

/** An Opus block as a PCM SimpleBlock: same track and time, frames decoded, no lacing. */
function pcmBlock(block: Buffer, trackLength: number, converter: OpusToPcm): Buffer {
  const head = Buffer.alloc(trackLength + 3)
  block.copy(head, 0, 0, trackLength + 2) // track number and time
  head[trackLength + 2] = 0x80 // keyframe
  return Buffer.concat([head, converter.decode(unlace(block, trackLength + 2))])
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
