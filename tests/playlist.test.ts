import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseM3u } from '../src/data/m3u'
import { assignNumbers, m3uToPlaylist } from '../src/data/playlist'
import { decodeText } from '../src/data/text'

const load = (name: string) => parseM3u(decodeText(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))))

describe('m3uToPlaylist', () => {
  const playlist = m3uToPlaylist('s1', load('messy.m3u'))
  const channel = (urlSuffix: string) => playlist.channels.find((c) => c.urls[0].endsWith(urlSuffix))!

  it('creates categories from group-title and #EXTGRP in first-seen order', () => {
    // The broken-quote entry's quoted tvg-logo swallows its group-title, so it has no category.
    expect(playlist.categories.map((c) => c.name)).toEqual(['News', 'Movies', 'Sports'])
    expect(playlist.categories[0]).toEqual({ id: 's1:g:News', sourceId: 's1', name: 'News' })
    expect(channel('/extgrp.m3u8').categoryId).toBe('s1:g:Sports')
    expect(channel('/plain.ts').categoryId).toBeUndefined()
  })

  it('gives every channel a unique, stable id', () => {
    const ids = playlist.channels.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id.includes('~2'))).toHaveLength(1)
    expect(m3uToPlaylist('s1', load('messy.m3u')).channels.map((c) => c.id)).toEqual(ids)
  })

  it('names channels from the title, then tvg-name, then the URL', () => {
    expect(channel('/news.m3u8').name).toBe('News 24')
    expect(channel('/no-extinf.m3u8').name).toBe('http://example.com/no-extinf.m3u8')
  })

  it('maps guide, catch-up and option attributes', () => {
    const catchup = channel('/catchup.mpd')
    expect(catchup).toMatchObject({
      number: 7,
      epgShift: -1.5,
      catchup: { type: 'default', source: 'http://example.com/archive?start={utc}', days: 3 },
      options: { 'inputstream.adaptive.license_type': 'com.widevine.alpha' },
    })
    expect(channel('/news.m3u8')).toMatchObject({ tvgId: 'news.example', tvgName: 'News' })
    expect(channel('/empty.m3u8').tvgId).toBeUndefined()
    expect(channel('/empty.m3u8').logo).toBeUndefined()
  })

  it('numbers channels after the highest tvg-chno', () => {
    const numbers = playlist.channels.map((c) => c.number)
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(channel('/news.m3u8').number).toBe(8)
  })

  it('keeps the playlist guide URLs', () => {
    expect(playlist.epgUrls).toEqual(['http://example.com/a.xml.gz', 'http://example.com/b.xml'])
  })
})

describe('assignNumbers', () => {
  it('numbers from 1 when no channel has a number', () => {
    const channels = [{ number: 0 }, { number: 0 }]
    assignNumbers(channels)
    expect(channels.map((c) => c.number)).toEqual([1, 2])
  })
})
