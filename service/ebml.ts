// Matroska (EBML) element reading and writing: just what the remuxer needs.

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
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  DefaultDuration: 0x23e383,
  SeekPreRoll: 0x56bb,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  BitDepth: 0x6264,
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
}

export const TRACK_VIDEO = 1
export const TRACK_AUDIO = 2

/** Size field of an element whose size isn't known (live streams). */
export const UNKNOWN = -1

/** An element ID with its marker bits, and its length in bytes; undefined if `buf` ends first. */
export function readId(buf: Buffer, pos: number): [number, number] | undefined {
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
export function readVint(buf: Buffer, pos: number, raw = false): [number, number] | undefined {
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

export interface Element {
  id: number
  data: Buffer
}

/** The child elements of an element body. */
export function children(body: Buffer): Element[] {
  const out: Element[] = []
  for (let pos = 0; pos < body.length; ) {
    const id = readId(body, pos)
    const size = id && readVint(body, pos + id[1])
    if (!id || !size || size[0] === UNKNOWN) break
    const start = pos + id[1] + size[1]
    out.push({ id: id[0], data: body.slice(start, start + size[0]) })
    pos = start + size[0]
  }
  return out
}

export const child = (body: Buffer, id: number): Buffer | undefined => children(body).find((c) => c.id === id)?.data

export function uint(data: Buffer | undefined, fallback = 0): number {
  if (!data) return fallback
  let value = 0
  for (let i = 0; i < data.length; i++) value = value * 256 + data[i]
  return value
}

export function encodeId(id: number): Buffer {
  const bytes: number[] = []
  for (let v = id; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff)
  return Buffer.from(bytes)
}

/** The shortest size field that holds `n`. */
export function encodeSize(n: number): Buffer {
  let length = 1
  while (n >= Math.pow(2, 7 * length) - 1) length++
  const out = Buffer.alloc(length)
  for (let i = length - 1, v = n; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v & 0xff
  out[0] |= 0x80 >> (length - 1)
  return out
}

export const UNKNOWN_SIZE = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])

export function element(id: number, parts: Buffer[]): Buffer {
  const length = parts.reduce((sum, p) => sum + p.length, 0)
  return Buffer.concat([encodeId(id), encodeSize(length), ...parts])
}

export function uintElement(id: number, n: number): Buffer {
  const bytes: number[] = []
  for (let v = n; v > 0 || !bytes.length; v = Math.floor(v / 256)) bytes.unshift(v & 0xff)
  return element(id, [Buffer.from(bytes)])
}

export function floatElement(id: number, f: number): Buffer {
  const data = Buffer.alloc(8)
  data.writeDoubleBE(f, 0)
  return element(id, [data])
}
