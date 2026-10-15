// Subtitles the TV's player can't show (inside MKV files), drawn by the app instead: text tracks,
// Blu-ray PGS and DVD (VobSub) pictures. The app's service collects their cues from the file
// (service/remux.ts).

/** What the screen shows now: text lines, or a picture. */
export type Subtitle = { text: string } | { picture: SubtitlePicture }

export interface PgsObject {
  /** Position and size in the picture's frame. */
  x: number
  y: number
  width: number
  height: number
  /** Run-length encoded colour indexes (pgsPixels). */
  rle: Uint8Array
  /** 256 colours, RGBA. */
  palette: Uint8Array
}

/** A decoded part of a picture (DVD subtitles). */
export interface BitmapObject {
  x: number
  y: number
  width: number
  height: number
  /** RGBA. */
  pixels: Uint8ClampedArray<ArrayBuffer>
}

/** A picture in a frame of `width` × `height` (the video's size); no objects clears the screen. */
export interface SubtitlePicture {
  width: number
  height: number
  objects: Array<PgsObject | BitmapObject>
}

/** An object's RGBA pixels. */
export const objectPixels = (object: PgsObject | BitmapObject): Uint8ClampedArray<ArrayBuffer> => ('pixels' in object ? object.pixels : pgsPixels(object))

/**
 * The words of a text subtitle. ASS and SSA events lose their other fields and their styling, SRT
 * and WebVTT their tags. Undefined for a cue without words (an ASS vector drawing, for one).
 */
export function subtitleText(codec: string, raw: string): string | undefined {
  let text = raw
  if (codec === 'S_TEXT/ASS' || codec === 'S_TEXT/SSA') {
    // Matroska keeps ASS events as ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text.
    const fields = raw.split(',')
    if (fields.length < 9) return undefined
    text = fields.slice(8).join(',')
    if (/\{[^}]*\\p[1-9]/.test(text)) return undefined
    text = text
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\\h/g, ' ')
  } else text = text.replace(/<[^>]*>/g, '')
  text = text.replace(/\r\n?/g, '\n').trim()
  return text || undefined
}

const u16 = (data: Uint8Array, at: number) => (data[at] << 8) | data[at + 1]

interface Composition {
  width: number
  height: number
  palette: number
  objects: { id: number; x: number; y: number }[]
}

/**
 * Decodes one PGS track's display sets, in order: palettes and objects defined in one display set
 * are used by later ones until the next epoch starts.
 */
export class PgsDecoder {
  private palettes: { [id: number]: Uint8Array } = {}
  private objects: { [id: number]: { width: number; height: number; rle: Uint8Array } } = {}
  private pending: { [id: number]: { width: number; height: number; parts: Uint8Array[] } } = {}
  /** HD pictures use BT.709 colours, SD ones BT.601. */
  private hd = true

  /** The picture a display set shows; undefined if it refers to objects or palettes never received. */
  decode(set: Uint8Array): SubtitlePicture | undefined {
    let composition: Composition | undefined
    for (let pos = 0; pos + 3 <= set.length; ) {
      const type = set[pos]
      const segment = set.subarray(pos + 3, pos + 3 + u16(set, pos + 1))
      pos += 3 + segment.length
      if (type === 0x16) composition = this.composition(segment)
      else if (type === 0x14) this.palette(segment)
      else if (type === 0x15) this.object(segment)
    }
    if (!composition) return undefined
    const palette = this.palettes[composition.palette]
    const objects: PgsObject[] = []
    for (const { id, x, y } of composition.objects) {
      const object = this.objects[id]
      if (!object || !palette) return undefined
      objects.push({ x, y, width: object.width, height: object.height, rle: object.rle, palette })
    }
    return { width: composition.width, height: composition.height, objects }
  }

  /** Presentation composition segment: which objects show where, with which palette. */
  private composition(s: Uint8Array): Composition {
    const width = u16(s, 0)
    const height = u16(s, 2)
    this.hd = height > 576
    if (s[7] & 0x80) {
      // epoch start: earlier palettes and objects no longer apply
      this.palettes = {}
      this.objects = {}
      this.pending = {}
    }
    const objects: Composition['objects'] = []
    for (let i = 0, p = 11; i < s[10] && p + 8 <= s.length; i++) {
      objects.push({ id: u16(s, p), x: u16(s, p + 4), y: u16(s, p + 6) })
      p += s[p + 3] & 0x40 ? 16 : 8 // cropped objects carry a crop rectangle (not applied)
    }
    return { width, height, palette: s[9], objects }
  }

  /** Palette definition segment: entries of index, Y, Cr, Cb, alpha. */
  private palette(s: Uint8Array): void {
    const palette = new Uint8Array(this.palettes[s[0]] || 256 * 4)
    for (let p = 2; p + 5 <= s.length; p += 5) {
      const y = 1.164 * (s[p + 1] - 16)
      const cr = s[p + 2] - 128
      const cb = s[p + 3] - 128
      const [r, g, b] = this.hd ? [y + 1.793 * cr, y - 0.213 * cb - 0.533 * cr, y + 2.112 * cb] : [y + 1.596 * cr, y - 0.392 * cb - 0.813 * cr, y + 2.017 * cb]
      const at = s[p] * 4
      palette[at] = Math.max(0, Math.min(255, Math.round(r)))
      palette[at + 1] = Math.max(0, Math.min(255, Math.round(g)))
      palette[at + 2] = Math.max(0, Math.min(255, Math.round(b)))
      palette[at + 3] = s[p + 4]
    }
    this.palettes[s[0]] = palette
  }

  /** Object definition segment: a run-length encoded bitmap, possibly split over several segments. */
  private object(s: Uint8Array): void {
    const id = u16(s, 0)
    const flags = s[3]
    if (flags & 0x80) this.pending[id] = { width: u16(s, 7), height: u16(s, 9), parts: [s.subarray(11)] }
    else if (this.pending[id]) this.pending[id].parts.push(s.subarray(4))
    const done = this.pending[id]
    if (!(flags & 0x40) || !done) return
    let length = 0
    for (const part of done.parts) length += part.length
    const rle = new Uint8Array(length)
    let at = 0
    for (const part of done.parts) {
      rle.set(part, at)
      at += part.length
    }
    this.objects[id] = { width: done.width, height: done.height, rle }
    delete this.pending[id]
  }
}

/** A PGS object's RGBA pixels. */
export function pgsPixels(object: PgsObject): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, rle, palette } = object
  const out = new Uint8ClampedArray(width * height * 4)
  let x = 0
  let y = 0
  const run = (color: number, count: number) => {
    const c = color * 4
    for (let end = Math.min(width, x + count); x < end; x++) {
      const at = (y * width + x) * 4
      out[at] = palette[c]
      out[at + 1] = palette[c + 1]
      out[at + 2] = palette[c + 2]
      out[at + 3] = palette[c + 3]
    }
  }
  for (let i = 0; i < rle.length && y < height; ) {
    const byte = rle[i++]
    if (byte) {
      run(byte, 1)
      continue
    }
    // 0, then: 0 ends the line; 00LLLLLL / 01LLLLLL LLLLLLLL runs colour 0; with 10 / 11, a colour byte follows.
    const flags = rle[i++]
    if (!flags) {
      x = 0
      y++
      continue
    }
    const count = flags & 0x40 ? ((flags & 0x3f) << 8) | rle[i++] : flags & 0x3f
    run(flags & 0x80 ? rle[i++] : 0, count)
  }
  return out
}

/** DVD subpicture times count in units of 1024 ticks of a 90 kHz clock. */
const SPU_TICK_S = 1024 / 90000

/**
 * DVD (VobSub) subtitles. A track's CodecPrivate is an .idx header (frame size, 16-colour palette);
 * each block is a subpicture unit: a 2-bit run-length encoded bitmap in two fields (even and odd
 * lines), and control sequences with its place, four colours from the palette with their opacity,
 * and when it shows and goes.
 */
export class VobSubDecoder {
  private readonly width: number
  private readonly height: number
  /** RGB. */
  private readonly palette: number[]

  constructor(idx: string) {
    const size = /size:\s*(\d+)\s*x\s*(\d+)/.exec(idx)
    this.width = size ? Number(size[1]) : 720
    this.height = size ? Number(size[2]) : 576
    const palette = /palette:([^\n]*)/.exec(idx)
    this.palette = palette ? palette[1].split(',').map((c) => parseInt(c.trim(), 16) || 0) : []
    // Without a palette: greys, so the text still shows.
    for (let i = this.palette.length; i < 16; i++) this.palette.push(i === 0 ? 0 : 0xffffff - (i % 4) * 0x333333)
  }

  /** The picture and its times (seconds after the block's start); undefined for a broken unit. */
  decode(unit: Uint8Array): { picture: SubtitlePicture; start: number; end?: number } | undefined {
    // Units over 64 kB (HD) start with 0 and use 4-byte offsets.
    const wide = u16(unit, 0) === 0
    const offset = (at: number) => (wide ? u16(unit, at) * 65536 + u16(unit, at + 2) : u16(unit, at))
    const size = wide ? 4 : 2
    let control = offset(size)
    let start = 0
    let end: number | undefined
    const colors = [0, 0, 0, 0]
    const alpha = [0, 0, 0, 0]
    let area: number[] | undefined
    let fields: number[] | undefined
    for (let guard = 0; control > 0 && control + 2 + size < unit.length && guard < 64; guard++) {
      const time = u16(unit, control) * SPU_TICK_S
      const next = offset(control + 2)
      let p = control + 2 + size
      commands: while (p < unit.length) {
        switch (unit[p++]) {
          case 0x01:
            start = time
            break
          case 0x02:
            end = time
            break
          case 0x03: // colour of each of the 4 pixel values, from the last
            colors.splice(0, 4, unit[p + 1] & 15, unit[p + 1] >> 4, unit[p] & 15, unit[p] >> 4)
            p += 2
            break
          case 0x04: // their opacity, 0 to 15
            alpha.splice(0, 4, unit[p + 1] & 15, unit[p + 1] >> 4, unit[p] & 15, unit[p] >> 4)
            p += 2
            break
          case 0x05: // x1, x2, y1, y2: 12 bits each
            area = [(unit[p] << 4) | (unit[p + 1] >> 4), ((unit[p + 1] & 15) << 8) | unit[p + 2], (unit[p + 3] << 4) | (unit[p + 4] >> 4), ((unit[p + 4] & 15) << 8) | unit[p + 5]]
            p += 6
            break
          case 0x06: // where each field's lines start
            fields = [u16(unit, p), u16(unit, p + 2)]
            p += 4
            break
          case 0x00: // forced (menu) subpicture
            break
          default: // 0xff ends the sequence; anything else can't be read past
            break commands
        }
      }
      if (next <= control) break
      control = next
    }
    if (!area || !fields) return undefined
    const [x1, x2, y1, y2] = area
    const width = x2 - x1 + 1
    const height = y2 - y1 + 1
    if (width <= 0 || height <= 0 || width * height > this.width * this.height) return undefined
    const rgba = colors.map((c, i) => {
      const rgb = this.palette[c]
      return [rgb >> 16, (rgb >> 8) & 255, rgb & 255, alpha[i] * 17]
    })
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let field = 0; field < 2; field++) spuField(unit, fields[field], width, height, field, rgba, pixels)
    return { picture: { width: this.width, height: this.height, objects: [{ x: x1, y: y1, width, height, pixels }] }, start, end }
  }
}

/** Decodes one field (every other line, from `first`) of a subpicture's run-length data into `out`. */
function spuField(unit: Uint8Array, from: number, width: number, height: number, first: number, rgba: number[][], out: Uint8ClampedArray): void {
  let nibble = from * 2
  const read = () => {
    const byte = unit[nibble >> 1]
    const value = nibble & 1 ? byte & 15 : byte >> 4
    nibble++
    return value
  }
  for (let y = first; y < height && nibble >> 1 < unit.length; y += 2) {
    for (let x = 0; x < width; ) {
      // A run is 1 to 4 nibbles: the more leading zero bits, the longer; its last 2 bits are the colour.
      let code = read()
      for (let limit = 4; code < limit && limit <= 0x40; limit <<= 2) code = (code << 4) | read()
      const count = code < 4 ? width - x : Math.min(code >> 2, width - x) // < 4: to the end of the line
      const [r, g, b, a] = rgba[code & 3]
      for (let end = x + count; x < end; x++) {
        const at = (y * width + x) * 4
        out[at] = r
        out[at + 1] = g
        out[at + 2] = b
        out[at + 3] = a
      }
    }
    nibble = (nibble + 1) & ~1 // each line starts on a byte
  }
}

export interface Cue {
  /** Seconds into the movie. */
  start: number
  /** Absent: until the next cue of the track (pictures), or a few seconds (text). */
  end?: number
  text?: string
  picture?: SubtitlePicture
}

const TEXT_WITHOUT_END_S = 5

/** One subtitle track's cues in time order. */
export class CueList {
  private cues: Cue[] = []

  /** Adds a cue; one with the same start replaces it (read again after a seek back). */
  add(cue: Cue): void {
    const i = this.after(cue.start)
    if (i > 0 && this.cues[i - 1].start === cue.start) this.cues[i - 1] = cue
    else this.cues.splice(i, 0, cue)
  }

  /** The cues on screen at `seconds`. */
  at(seconds: number): Cue[] {
    const last = this.after(seconds) - 1
    if (last < 0) return []
    const latest = this.cues[last]
    if (latest.picture) return latest.picture.objects.length && (latest.end === undefined || latest.end > seconds) ? [latest] : []
    const shown: Cue[] = []
    // Text cues can overlap (a sign during dialogue): look back a few.
    for (let i = last; i >= 0 && i > last - 10; i--) {
      const cue = this.cues[i]
      const next = this.cues[i + 1]
      const end = cue.end ?? Math.min(cue.start + TEXT_WITHOUT_END_S, next ? next.start : Infinity)
      if (cue.text && end > seconds) shown.unshift(cue)
    }
    return shown
  }

  /** Index of the first cue starting after `seconds`. */
  private after(seconds: number): number {
    let low = 0
    let high = this.cues.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (this.cues[mid].start <= seconds) low = mid + 1
      else high = mid
    }
    return low
  }
}
