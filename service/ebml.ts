// Matroska (EBML) elements: reading is shared with the app (src/player/ebml.ts), writing is here.
export * from '../src/player/ebml'

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
