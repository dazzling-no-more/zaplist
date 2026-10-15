// Reading Matroska (EBML) elements. Shared by the app (track list of a movie, matroska.ts) and its
// JS service (service/), so it uses no browser or Node.js APIs. Works on Uint8Array and Node Buffers.

export const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  FlagDefault: 0x88,
  Name: 0x536e,
  Language: 0x22b59c,
  LanguageIETF: 0x22b59d,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  DefaultDuration: 0x23e383,
  SeekPreRoll: 0x56bb,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  BitDepth: 0x6264,
  ContentEncodings: 0x6d80,
  ContentEncoding: 0x6240,
  ContentEncodingType: 0x5033,
  ContentCompression: 0x5034,
  ContentCompAlgo: 0x4254,
  ContentCompSettings: 0x4255,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockDuration: 0x9b,
}

export const TRACK_VIDEO = 1
export const TRACK_AUDIO = 2
export const TRACK_SUBTITLE = 17

/** A track's language: BCP 47 if the file gives it, else ISO 639-2; Matroska's default is English. */
export function trackLanguage<T extends Uint8Array>(entry: T, text: (data: T | undefined) => string): string {
  return text(child(entry, ID.LanguageIETF)) || text(child(entry, ID.Language)) || 'eng'
}

/** How the app shows a Matroska subtitle codec (as text, or as Blu-ray PGS pictures); undefined if it can't. */
export function subtitleKind(codec: string): 'text' | 'pgs' | undefined {
  if (codec === 'S_HDMV/PGS') return 'pgs'
  return /^S_TEXT\/(UTF8|ASS|SSA|WEBVTT)$/.test(codec) ? 'text' : undefined
}

/** Size field of an element whose size isn't known (live streams). */
export const UNKNOWN = -1

/** An element ID with its marker bits, and its length in bytes; undefined if `buf` ends first. */
export function readId(buf: Uint8Array, pos: number): [number, number] | undefined {
  if (pos >= buf.length) return undefined
  let length = 1
  while (length <= 4 && !(buf[pos] & (0x80 >> (length - 1)))) length++
  if (length > 4) throw new Error(`Bad element ID at ${pos}`)
  if (pos + length > buf.length) return undefined
  let id = 0
  for (let i = 0; i < length; i++) id = id * 256 + buf[pos + i]
  return [id, length]
}

/**
 * A variable-length integer without its marker bit. As an element size, all value bits set means
 * UNKNOWN; `raw` reads the plain number (lace sizes).
 */
export function readVint(buf: Uint8Array, pos: number, raw = false): [number, number] | undefined {
  if (pos >= buf.length) return undefined
  let length = 1
  while (length <= 8 && !(buf[pos] & (0x80 >> (length - 1)))) length++
  if (length > 8) throw new Error(`Bad size at ${pos}`)
  if (pos + length > buf.length) return undefined
  let value = buf[pos] & (0xff >> length)
  let allOnes = value === 0xff >> length
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[pos + i]
    if (buf[pos + i] !== 0xff) allOnes = false
  }
  return [allOnes && !raw ? UNKNOWN : value, length]
}

export interface Element<T extends Uint8Array> {
  id: number
  data: T
}

/** The complete child elements of an element body (views of it, not copies). */
export function children<T extends Uint8Array>(body: T): Element<T>[] {
  const out: Element<T>[] = []
  for (let pos = 0; pos < body.length; ) {
    const id = readId(body, pos)
    const size = id && readVint(body, pos + id[1])
    if (!id || !size || size[0] === UNKNOWN) break
    const start = pos + id[1] + size[1]
    if (start + size[0] > body.length) break
    out.push({ id: id[0], data: body.subarray(start, start + size[0]) as T })
    pos = start + size[0]
  }
  return out
}

export function child<T extends Uint8Array>(body: T, id: number): T | undefined {
  const found = children(body).filter((c) => c.id === id)[0]
  return found && found.data
}

export function uint(data: Uint8Array | undefined, fallback = 0): number {
  if (!data) return fallback
  let value = 0
  for (let i = 0; i < data.length; i++) value = value * 256 + data[i]
  return value
}
