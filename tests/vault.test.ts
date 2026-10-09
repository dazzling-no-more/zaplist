import { describe, expect, it } from 'vitest'
import { newVaultKey, seal, unseal } from '../src/data/vault'

describe('vault', () => {
  it('seals and unseals a value, with a fresh IV each time', async () => {
    const key = await newVaultKey()
    const a = await seal(key, { password: 'x' })
    const b = await seal(key, { password: 'x' })
    expect(a.iv).not.toEqual(b.iv)
    expect(await unseal(key, a)).toEqual({ password: 'x' })
  })

  it('rejects data sealed with another key', async () => {
    const sealed = await seal(await newVaultKey(), [1, 2, 3])
    await expect(unseal(await newVaultKey(), sealed)).rejects.toThrow()
  })
})
