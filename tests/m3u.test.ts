import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAttributes, parseM3u } from '../src/data/m3u'
import { decodeText } from '../src/data/text'

const fixture = (name: string) => decodeText(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))))

describe('parseAttributes', () => {
  it('reads quoted, single-quoted, unquoted and empty values', () => {
    const { attrs } = parseAttributes(`tvg-id="a b" tvg-name='c' group-title=News tvg-logo=""`)
    expect(attrs).toEqual({ 'tvg-id': 'a b', 'tvg-name': 'c', 'group-title': 'News', 'tvg-logo': '' })
  })

  it('lower-cases keys and stops at the title comma', () => {
    const { attrs, end } = parseAttributes(` TVG-ID="x",Title`)
    expect(attrs).toEqual({ 'tvg-id': 'x' })
    expect(` TVG-ID="x",Title`.slice(end)).toBe(',Title')
  })
})

describe('parseM3u on a clean playlist', () => {
  const playlist = parseM3u(fixture('clean.m3u'))

  it('reads the header guide URL', () => {
    expect(playlist.epgUrls).toEqual(['http://example.com/guide.xml.gz'])
  })

  it('reads every entry with its attributes', () => {
    expect(playlist.entries).toHaveLength(4)
    const [first] = playlist.entries
    expect(first.title).toBe('Big Buck Bunny (HLS)')
    expect(first.url).toBe('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')
    expect(first.attrs).toMatchObject({
      'tvg-id': 'bbb.test',
      'tvg-name': 'Big Buck Bunny',
      'tvg-logo': 'https://example.com/logos/bbb.png',
      'tvg-chno': '1',
      'group-title': 'Test streams',
    })
  })
})

describe('parseM3u on a messy playlist', () => {
  const playlist = parseM3u(fixture('messy.m3u'))
  const byUrl = (suffix: string) => playlist.entries.filter((e) => e.url.endsWith(suffix))
  const one = (suffix: string) => {
    const entries = byUrl(suffix)
    expect(entries).toHaveLength(1)
    return entries[0]
  }

  it('handles the BOM, CRLF line endings, blank lines and comma-separated guide URLs', () => {
    expect(playlist.header['x-tvg-url']).toBeDefined()
    expect(playlist.epgUrls).toEqual(['http://example.com/a.xml.gz', 'http://example.com/b.xml'])
    expect(playlist.entries.every((e) => !/[\r\n]/.test(e.url + e.title))).toBe(true)
    expect(playlist.entries).toHaveLength(14)
  })

  it('reads lower-case directives and unquoted attributes', () => {
    const news = one('/news.m3u8')
    expect(news.attrs).toMatchObject({ 'tvg-id': 'news.example', 'tvg-name': 'News', 'group-title': 'News' })
    expect(news.title).toBe('News 24')
  })

  it('accepts entries without attributes, with empty attributes, or without #EXTINF', () => {
    expect(one('/plain.ts')).toMatchObject({ title: 'No Attributes At All', attrs: {} })
    expect(one('/empty.m3u8').attrs).toEqual({ 'tvg-id': '', 'tvg-logo': '', 'group-title': '' })
    expect(one('/no-extinf.m3u8')).toMatchObject({ title: '', attrs: {} })
  })

  it('keeps duplicates', () => {
    expect(byUrl('/dup1.m3u8')).toHaveLength(2)
    expect(playlist.entries.filter((e) => e.title === 'Duplicate')).toHaveLength(3)
  })

  it('survives a missing closing quote and junk tokens', () => {
    expect(one('/broken.m3u8').title).toBe('Broken Quote')
    const junk = one('/junk.m3u8')
    expect(junk.attrs).toMatchObject({ 'tvg-id': 'x', 'tvg-name': 'After Junk' })
    expect(junk.title).toBe('After Junk')
  })

  it('keeps commas in the title', () => {
    expect(one('/commas.m3u8').title).toBe('Title, With, Commas')
  })

  it('collects #EXTVLCOPT, #KODIPROP and #EXTGRP for the next URL only', () => {
    expect(one('/commas.m3u8').options).toEqual({ 'http-user-agent': 'SomeAgent/1.0', 'http-referrer': 'http://example.com/' })
    expect(one('/catchup.mpd').options).toEqual({ 'inputstream.adaptive.license_type': 'com.widevine.alpha' })
    expect(one('/junk.m3u8').options).toEqual({})
    expect(one('/extgrp.m3u8').group).toBe('Sports')
    expect(one('/catchup.mpd').group).toBeUndefined()
  })

  it('reads catch-up, channel number and shift attributes', () => {
    expect(one('/catchup.mpd').attrs).toMatchObject({
      'tvg-chno': '7',
      'tvg-shift': '-1.5',
      catchup: 'default',
      'catchup-source': 'http://example.com/archive?start={utc}',
      'catchup-days': '3',
    })
  })

  it('decodes UTF-8 and replaces invalid bytes instead of failing', () => {
    expect(one('/unicode.m3u8').title).toBe('Télé Ünicode')
    expect(one('/unicode.m3u8').attrs).toMatchObject({ 'tvg-name': 'Single Quoted', 'group-title': 'News' })
    expect(one('/badbyte.m3u8').title).toBe('Bad Byte �')
  })
})

describe('decodeText', () => {
  it('falls back to Windows-1252 for files that are not UTF-8', () => {
    const playlist = parseM3u(fixture('latin1.m3u'))
    expect(playlist.entries).toEqual([
      { title: 'Télévision Française', url: 'http://example.com/fr.ts', attrs: { 'group-title': 'Télé' }, options: {}, group: undefined },
    ])
  })
})

describe('parseM3u at scale', () => {
  it('parses 50,000 entries quickly', () => {
    const lines = ['#EXTM3U']
    for (let i = 0; i < 50_000; i++) {
      lines.push(`#EXTINF:-1 tvg-id="ch${i}" tvg-name="Channel ${i}" tvg-logo="http://example.com/${i}.png" group-title="Group ${i % 200}",Channel ${i}`)
      lines.push(`http://example.com/live/${i}.m3u8`)
    }
    const text = lines.join('\n')
    const started = performance.now()
    const playlist = parseM3u(text)
    const elapsed = performance.now() - started
    expect(playlist.entries).toHaveLength(50_000)
    expect(playlist.entries[49_999]).toMatchObject({ title: 'Channel 49999', url: 'http://example.com/live/49999.m3u8' })
    expect(elapsed).toBeLessThan(2000)
  })
})
