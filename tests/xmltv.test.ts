import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GuideCollector, guideKeys, guideWindow, nowNext, programmeAt, shiftMs } from '../src/data/guideData'
import { readXmltv, type ByteReader } from '../src/data/guideIngest'
import type { Programme } from '../src/data/models'
import { decodeEntities, parseXmltvTime, XmltvParser, type XmltvChannel, type XmltvProgramme } from '../src/data/xmltv'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
const utc = (iso: string) => Date.parse(iso)
const NOW = utc('2026-10-09T12:30:00Z')

function parse(text: string, chunkSize: number) {
  const channels: XmltvChannel[] = []
  const programmes: XmltvProgramme[] = []
  const parser = new XmltvParser({ channel: (c) => channels.push(c), programme: (p) => programmes.push(p) })
  for (let i = 0; i < text.length; i += chunkSize) parser.feed(text.slice(i, i + chunkSize))
  parser.end()
  return { channels, programmes }
}

function chunkedReader(bytes: Uint8Array, size: number): ByteReader {
  let offset = 0
  return {
    read: async () => {
      if (offset >= bytes.length) return { done: true }
      const value = bytes.slice(offset, offset + size)
      offset += size
      return { done: false, value }
    },
  }
}

describe('parseXmltvTime', () => {
  it.each([
    ['20261009120000 +0000', '2026-10-09T12:00:00Z'],
    ['20261009150000 +0200', '2026-10-09T13:00:00Z'],
    ['20261009073000 -0500', '2026-10-09T12:30:00Z'],
    ['20261009120000+0530', '2026-10-09T06:30:00Z'],
    ['20261009120000 +05:30', '2026-10-09T06:30:00Z'],
    ['20261009120000', '2026-10-09T12:00:00Z'],
    ['202610091430 +0000', '2026-10-09T14:30:00Z'],
    ['20261009120000 Z', '2026-10-09T12:00:00Z'],
  ])('%s is %s', (input, iso) => {
    expect(parseXmltvTime(input)).toBe(utc(iso))
  })

  it('rejects text that is not a time', () => {
    expect(parseXmltvTime('')).toBeUndefined()
    expect(parseXmltvTime('tomorrow')).toBeUndefined()
  })
})

describe('decodeEntities', () => {
  it('decodes named and numeric entities and leaves unknown ones', () => {
    expect(decodeEntities('A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos; &#8211; &#x2014; &nbsp;')).toBe(`A & B <c> "d" 'e' – — &nbsp;`)
  })
})

describe('XmltvParser', () => {
  const text = new TextDecoder().decode(fixture('guide.xml'))
  const whole = parse(text, text.length)

  it('reads channels with all their display names', () => {
    expect(whole.channels).toEqual([
      { id: 'bbb.test', names: ['Big Buck Bunny'] },
      { id: 'News.Example', names: ['News 24', 'News'] },
      { id: 'nomatch.test', names: ['Nobody Watches This'] },
    ])
  })

  it('reads programmes with the first title, CDATA and entities, and normalizes time zones', () => {
    expect(whole.programmes[0]).toEqual({
      channel: 'bbb.test',
      start: utc('2026-10-09T12:00:00Z'),
      stop: utc('2026-10-09T13:00:00Z'),
      title: 'Morning & Noon',
      description: 'A <bold> start & more',
    })
    expect(whole.programmes[1]).toMatchObject({ title: 'Offset Show', start: utc('2026-10-09T13:00:00Z'), stop: utc('2026-10-09T14:30:00Z') })
    expect(whole.programmes[2]).toMatchObject({ title: 'No Stop Time', start: utc('2026-10-09T14:30:00Z') })
    expect(whole.programmes[3]).toMatchObject({ title: 'News at Noon – Live — "Today"', start: utc('2026-10-09T12:30:00Z') })
    expect(whole.programmes).toHaveLength(8)
  })

  it('gives the same result however the text is split', () => {
    for (const size of [1, 2, 3, 7, 13, 64, 500]) expect(parse(text, size)).toEqual(whole)
  })
})

describe('GuideCollector', () => {
  const run = (wanted: string[]) => {
    const collector = new GuideCollector(new Set(wanted), guideWindow(NOW))
    const text = new TextDecoder().decode(fixture('guide.xml'))
    const parser = new XmltvParser(collector)
    parser.feed(text)
    return collector.finish()
  }

  it('matches by id (case-insensitive) or by display name, and skips unwanted channels', () => {
    const guide = run(['bbb.test', 'name:news', 'undeclared.test'])
    expect(Array.from(guide.keys()).sort()).toEqual(['bbb.test', 'name:news', 'undeclared.test'])
    expect(run(['news.example']).get('news.example')?.[0].title).toBe('News at Noon – Live — "Today"')
    expect(run(['name:news24']).get('name:news24')).toHaveLength(1)
  })

  it('counts a channel and its programmes once when both its id and its name are wanted', () => {
    const collector = new GuideCollector(new Set(['bbb.test']), guideWindow(NOW))
    new XmltvParser(collector).feed(new TextDecoder().decode(fixture('guide.xml')))
    const byId = { channels: collector.kept.channels.size, programmes: collector.kept.programmes }
    const both = new GuideCollector(new Set(['bbb.test', ...guideKeys({ name: 'Big Buck Bunny' })]), guideWindow(NOW))
    new XmltvParser(both).feed(new TextDecoder().decode(fixture('guide.xml')))
    expect(byId.channels).toBe(1)
    expect({ channels: both.kept.channels.size, programmes: both.kept.programmes }).toEqual(byId)
  })

  it('keeps the time window, sorts, and ends programmes without a stop at the next start', () => {
    const titles = (run(['bbb.test']).get('bbb.test') ?? []).map((p) => [p.title, new Date(p.start).toISOString(), new Date(p.stop).toISOString()])
    expect(titles).toEqual([
      ['Morning & Noon', '2026-10-09T12:00:00.000Z', '2026-10-09T13:00:00.000Z'],
      ['Offset Show', '2026-10-09T13:00:00.000Z', '2026-10-09T14:30:00.000Z'],
      ['No Stop Time', '2026-10-09T14:30:00.000Z', '2026-10-09T15:30:00.000Z'],
    ])
  })
})

describe('readXmltv', () => {
  const collect = async (bytes: Uint8Array, options: { nativeGzip?: boolean }) => {
    const titles: string[] = []
    await readXmltv(chunkedReader(bytes, 97), { channel: () => {}, programme: (p) => titles.push(p.title) }, options)
    return titles
  }

  it('reads plain and gzipped XML, with DecompressionStream or with pako', async () => {
    const plain = await collect(fixture('guide.xml'), {})
    expect(plain).toHaveLength(8)
    expect(await collect(fixture('guide.xml.gz'), { nativeGzip: true })).toEqual(plain)
    expect(await collect(fixture('guide.xml.gz'), { nativeGzip: false })).toEqual(plain)
  })

  it('decodes the encoding named in the XML declaration', async () => {
    const latin1 = new Uint8Array(
      Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><tv><programme start="20261009120000" channel="x"><title>Télé</title></programme></tv>', 'latin1'),
    )
    expect(await collect(latin1, {})).toEqual(['Télé'])
  })
})

describe('guide keys and now/next', () => {
  it('uses tvg-id first, then the normalized name', () => {
    expect(guideKeys({ tvgId: 'BBC.One.uk', tvgName: 'BBC One', name: 'BBC One HD' })).toEqual(['bbc.one.uk', 'name:bbcone'])
    expect(guideKeys({ name: 'Télé Matin' })).toEqual(['name:telematin'])
  })

  const hour = 3_600_000
  const list: Programme[] = [
    { start: utc('2026-10-09T11:00:00Z'), stop: utc('2026-10-09T12:00:00Z'), title: 'A' },
    { start: utc('2026-10-09T12:00:00Z'), stop: utc('2026-10-09T13:00:00Z'), title: 'B' },
    { start: utc('2026-10-09T14:00:00Z'), stop: utc('2026-10-09T15:00:00Z'), title: 'C' },
  ]

  it('finds the programme on now, or the next one in a gap', () => {
    expect(programmeAt(list, utc('2026-10-09T12:00:00Z'))).toBe(1)
    expect(programmeAt(list, utc('2026-10-09T13:30:00Z'))).toBe(2)
    expect(programmeAt(list, utc('2026-10-09T16:00:00Z'))).toBe(-1)
    expect(nowNext(list, NOW, 0)).toEqual({ now: list[1], next: list[2] })
    expect(nowNext(list, utc('2026-10-09T13:30:00Z'), 0)).toEqual({ next: list[2] })
    expect(nowNext(undefined, NOW, 0)).toEqual({})
  })

  it('applies tvg-shift and the global offset', () => {
    expect(shiftMs({ epgShift: 2 }, 0)).toBe(2 * hour)
    expect(shiftMs({ epgShift: -1.5 }, 30)).toBe(-hour)
    expect(shiftMs(undefined, -60)).toBe(-hour)
    // Shifted +1 h, "B" (12:00-13:00) airs 13:00-14:00, so at 12:30 "A" is on.
    expect(nowNext(list, NOW, shiftMs({ epgShift: 1 }, 0)).now?.title).toBe('A')
    // A -90 min offset makes "C" (14:00) air at 12:30.
    expect(nowNext(list, NOW, shiftMs(undefined, -90)).now?.title).toBe('C')
  })
})
