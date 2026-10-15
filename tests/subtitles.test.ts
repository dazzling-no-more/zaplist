import { describe, expect, it } from 'vitest'
import { readTracks, trackLabel } from '../src/player/matroska'
import { CueList, PgsDecoder, pgsPixels, subtitleText, type PgsPicture } from '../src/player/subtitles'
import { element, ID, uintElement } from '../service/ebml'

describe('subtitleText', () => {
  it('keeps the words of an ASS event: no fields, styling or drawings', () => {
    expect(subtitleText('S_TEXT/ASS', '12,0,Default,,0,0,0,,{\\i1}Hello,{\\i0} world\\NSecond line')).toBe('Hello, world\nSecond line')
    expect(subtitleText('S_TEXT/ASS', '13,0,Sign,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100')).toBeUndefined()
    expect(subtitleText('S_TEXT/SSA', 'too,few,fields')).toBeUndefined()
  })

  it('drops the tags of SRT and WebVTT text', () => {
    expect(subtitleText('S_TEXT/UTF8', '<i>Hi</i> <font color="red">there</font>\n')).toBe('Hi there')
    expect(subtitleText('S_TEXT/UTF8', '- One\r\n- Two')).toBe('- One\n- Two')
    expect(subtitleText('S_TEXT/UTF8', '  ')).toBeUndefined()
  })
})

// PGS segments: type, 2-byte size, data.
const segment = (type: number, data: number[]) => [type, data.length >> 8, data.length & 255, ...data]
const u16 = (n: number) => [n >> 8, n & 255]
/** Composition: a 1920×1080 frame, `state` (0x80: epoch start), palette 0, objects [id, x, y]. */
const pcs = (state: number, objects: [number, number, number][]) =>
  segment(0x16, [...u16(1920), ...u16(1080), 0x10, 0, 1, state, 0, 0, objects.length, ...objects.flatMap(([id, x, y]) => [...u16(id), 0, 0, ...u16(x), ...u16(y)])])
/** Palette 0: index 1 white and opaque (index 0 stays transparent). */
const pds = segment(0x14, [0, 0, 1, 235, 128, 128, 255])
/** Object 0, 4×2: a row of four index-1 pixels, then a row of four transparent ones. */
const rle = [0x00, 0x84, 0x01, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00]
const ods = segment(0x15, [0, 0, 0, 0xc0, 0, 0, rle.length + 4, ...u16(4), ...u16(2), ...rle])
const end = segment(0x80, [])
const set = (...segments: number[][]) => new Uint8Array(segments.flat())

describe('PGS', () => {
  it('decodes a picture to pixels, and keeps its objects for later display sets of the epoch', () => {
    const decoder = new PgsDecoder()
    const picture = decoder.decode(set(pcs(0x80, [[0, 100, 900]]), pds, ods, end))!
    expect(picture).toMatchObject({ width: 1920, height: 1080, objects: [{ x: 100, y: 900, width: 4, height: 2 }] })
    const pixels = Array.from(pgsPixels(picture.objects[0]))
    expect(pixels.slice(0, 4)).toEqual([255, 255, 255, 255])
    expect(pixels.slice(12, 16)).toEqual([255, 255, 255, 255])
    expect(pixels.slice(16).every((v) => v === 0)).toBe(true)

    expect(decoder.decode(set(pcs(0, []), end))!.objects).toEqual([]) // clears the screen
    expect(decoder.decode(set(pcs(0, [[0, 10, 20]]), end))!.objects[0]).toMatchObject({ x: 10, y: 20, width: 4 })
    // A new epoch forgets the old objects: one that needs them can't be shown.
    expect(decoder.decode(set(pcs(0x80, [[0, 10, 20]]), end))).toBeUndefined()
  })
})

describe('CueList', () => {
  it('shows text cues while they last, overlapping ones together', () => {
    const list = new CueList()
    list.add({ start: 10, end: 12, text: 'one' })
    list.add({ start: 11, end: 20, text: 'sign' })
    list.add({ start: 30, text: 'no end' })
    expect(list.at(9).map((c) => c.text)).toEqual([])
    expect(list.at(11.5).map((c) => c.text)).toEqual(['one', 'sign'])
    expect(list.at(15).map((c) => c.text)).toEqual(['sign'])
    expect(list.at(34).map((c) => c.text)).toEqual(['no end'])
    expect(list.at(36).map((c) => c.text)).toEqual([])
    list.add({ start: 10, end: 12, text: 'one again' }) // read again after a seek back
    expect(list.at(10).map((c) => c.text)).toEqual(['one again'])
  })

  it('shows a picture until the next one of the track', () => {
    const picture = (objects: number): PgsPicture => ({ width: 1920, height: 1080, objects: Array.from({ length: objects }, () => ({ x: 0, y: 0, width: 1, height: 1, rle: new Uint8Array(), palette: new Uint8Array(1024) })) })
    const list = new CueList()
    list.add({ start: 5, picture: picture(1) })
    list.add({ start: 8, picture: picture(0) })
    expect(list.at(7)).toHaveLength(1)
    expect(list.at(9)).toEqual([])
  })
})

describe('readTracks', () => {
  const text = (id: number, value: string) => element(id, [Buffer.from(value)])
  const tracks = element(ID.Tracks, [
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 1), uintElement(ID.TrackType, 1), text(ID.CodecID, 'V_AV1')]),
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 2), uintElement(ID.TrackType, 2), text(ID.CodecID, 'A_OPUS'), text(ID.Name, 'Surround')]),
    element(ID.TrackEntry, [uintElement(ID.TrackNumber, 3), uintElement(ID.TrackType, 17), text(ID.CodecID, 'S_HDMV/PGS'), text(ID.Language, 'fre'), uintElement(ID.FlagDefault, 0)]),
  ])
  // The start of a file: EBML header, then a Segment whose clusters are cut off.
  const head = Buffer.concat([element(ID.EBML, [text(0x4282, 'matroska')]), Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), element(ID.Info, []), tracks, Buffer.from([0x1f, 0x43, 0xb6, 0x75])])

  it('reads the track list from the start of a Matroska file', () => {
    expect(readTracks(head)).toEqual([
      { number: 1, type: 1, codec: 'V_AV1', name: '', language: 'eng', default: true },
      { number: 2, type: 2, codec: 'A_OPUS', name: 'Surround', language: 'eng', default: true },
      { number: 3, type: 17, codec: 'S_HDMV/PGS', name: '', language: 'fre', default: false },
    ])
  })

  it('labels tracks by language and name', () => {
    expect(trackLabel({ name: 'SDH', language: 'eng', codec: 'S_TEXT/ASS' }, 0)).toBe('eng · SDH')
    expect(trackLabel({ name: '', language: 'fre', codec: 'S_HDMV/PGS' }, 1)).toBe('fre (PGS)')
    expect(trackLabel({ name: 'Canadian / PGS', language: 'fre', codec: 'S_HDMV/PGS' }, 2)).toBe('fre · Canadian / PGS')
    expect(trackLabel({ name: '', language: 'und', codec: 'S_TEXT/UTF8' }, 3)).toBe('4')
  })

  it('gives up when the list is cut off', () => {
    expect(readTracks(head.subarray(0, head.length - 20))).toBeUndefined()
  })
})
