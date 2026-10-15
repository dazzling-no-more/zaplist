import { describe, expect, it } from 'vitest'
import { newVaultKey, seal, unseal } from '../src/data/vault'

describe('vault', () => {
  it('seals values so they read back only with the key', async () => {
    const key = await newVaultKey()
    const value = { url: 'http://tv.example.com/get.php?username=alice&password=s3cret', n: 1 }
    const sealed = await seal(key, value)
    expect(new TextDecoder().decode(sealed.data)).not.toContain('s3cret')
    expect(await unseal(key, sealed)).toEqual(value)
    await expect(unseal(await newVaultKey(), sealed)).rejects.toThrow()
  })

  it('uses a fresh IV each time', async () => {
    const key = await newVaultKey()
    const a = await seal(key, { password: 'x' })
    const b = await seal(key, { password: 'x' })
    expect(a.iv).not.toEqual(b.iv)
  })

  it('compresses before encrypting, so repetitive playlists take a fraction of the space', async () => {
    const key = await newVaultKey()
    const movies = Array.from({ length: 2000 }, (_, i) => ({
      id: `s:m:${i}`,
      name: `Movie ${i}`,
      urls: [`http://provider.example.com:8080/movie/someuser/somepassword/${40000 + i}.mkv`],
    }))
    const sealed = await seal(key, movies)
    expect(sealed.z).toBe(1)
    expect(sealed.data.byteLength).toBeLessThan(JSON.stringify(movies).length / 4)
    expect(await unseal(key, sealed)).toEqual(movies)
  })

  it('still reads values sealed uncompressed by 1.0', async () => {
    const key = await newVaultKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ pin: '1234' })))
    expect(await unseal(key, { iv, data })).toEqual({ pin: '1234' })
  })
})
