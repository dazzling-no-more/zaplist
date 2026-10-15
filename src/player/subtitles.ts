// Subtitles the TV's player can't show (inside MKV files), drawn by the app instead: text tracks and
// Blu-ray PGS pictures. The app's service collects their cues from the file (service/remux.ts).

/** What the screen shows now: text lines, or a picture made of PGS objects. */
export type Subtitle = { text: string } | { picture: PgsPicture }

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

/** A PGS picture in a frame of `width` × `height` (the video's size); no objects clears the screen. */
export interface PgsPicture {
  width: number
  height: number
  objects: PgsObject[]
}

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
  decode(set: Uint8Array): PgsPicture | undefined {
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

export interface Cue {
  /** Seconds into the movie. */
  start: number
  /** Absent: until the next cue of the track (PGS), or a few seconds (text). */
  end?: number
  text?: string
  picture?: PgsPicture
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
    if (latest.picture) return latest.picture.objects.length ? [latest] : []
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
