import { describe, expect, it } from 'vitest'
import type { M3uSource, XtreamSource } from '../src/data/models'
import { loginParts, maskUrl, newVaultKey, seal, unmaskUrl, unseal } from '../src/data/vault'

const xtream: XtreamSource = { id: 'x', kind: 'xtream', name: 'X', host: 'http://h', username: 'bob', password: 'p w/1', addedAt: 0 }
const m3u = (url: string): M3uSource => ({ id: 'm', kind: 'm3u', name: 'M', url, addedAt: 0 })

describe('vault', () => {
  it('seals and unseals a value, with a fresh IV each time', async () => {
    const key = await newVaultKey()
    const a = await seal(key, { password: 'x' })
    const b = await seal(key, { password: 'x' })
    expect(a.iv).not.toEqual(b.iv)
    expect(await unseal(key, a)).toEqual({ password: 'x' })
  })

  it('finds the login of Xtream sources and of get.php playlists', () => {
    expect(loginParts(xtream)).toEqual(['bob', 'p w/1', 'p%20w%2F1'])
    expect(loginParts(m3u('http://h/get.php?username=ann&password=42&type=m3u_plus'))).toEqual(['ann', '42'])
    expect(loginParts(m3u('http://h/list.m3u'))).toEqual([])
    expect(loginParts(m3u('not a url'))).toEqual([])
  })

  it('masks whole path segments and query values only, and restores them exactly', () => {
    const parts = ['ann', '42']
    const urls = [
      'http://h:8080/live/ann/42/4242.ts',
      'http://h/xmltv.php?username=ann&password=42',
      'http://ann:42@h/annex/42a',
      'http://h/plain.m3u8',
    ]
    const masked = urls.map((u) => maskUrl(u, parts))
    expect(masked[0]).toBe('http://h:8080/live/\u00010\u0001/\u00011\u0001/4242.ts')
    expect(masked[2]).toBe('http://\u00010\u0001:\u00011\u0001@h/annex/42a')
    expect(masked[3]).toBe('http://h/plain.m3u8')
    for (const m of masked) expect(m).not.toMatch(/\bann\b|=42|\/42\//)
    expect(masked.map((m) => unmaskUrl(m, parts))).toEqual(urls)
  })
})
