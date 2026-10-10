import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ getSecretSettings: vi.fn(), putSecretSettings: vi.fn() }))
vi.mock('../src/data/db', () => db)

const KEY = 'iptv-player.prefs'
let stored: Record<string, string>
let failLocal: boolean

/** A fresh prefs module (it's a singleton) over a stub localStorage. */
async function load(initial?: object) {
  stored = initial ? { [KEY]: JSON.stringify(initial) } : {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => {
      if (failLocal) throw new Error('QuotaExceededError')
      stored[key] = value
    },
    removeItem: (key: string) => delete stored[key],
  })
  vi.resetModules()
  return import('../src/data/prefs')
}
const lockedOnDisk = () => (JSON.parse(stored[KEY]) as { lockedCategories: string[] }).lockedCategories

describe('parental control settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    failLocal = false
    db.putSecretSettings.mockResolvedValue(undefined)
  })

  it('applies a new PIN only once it is stored', async () => {
    const prefs = await load()
    await prefs.saveParental({ pin: '1234' })
    expect(db.putSecretSettings).toHaveBeenCalledWith({ pin: '1234', epgUrl: undefined })
    expect(prefs.getPrefs().pin).toBe('1234')
  })

  it('rejects a PIN that could not be stored and keeps parental control as it was', async () => {
    const prefs = await load()
    db.putSecretSettings.mockRejectedValue(new Error('storage unavailable'))
    await expect(prefs.saveParental({ pin: '1234' })).rejects.toThrow('storage unavailable')
    expect(prefs.getPrefs().pin).toBeUndefined()
  })

  it('rejects a category lock that could not be stored', async () => {
    const prefs = await load({ lockedCategories: ['a'] })
    failLocal = true
    await expect(prefs.saveParental({ lockedCategories: ['a', 'b'] })).rejects.toThrow()
    expect(prefs.getPrefs().lockedCategories).toEqual(['a'])
  })

  it('leaves both parts as they were when turning off fails half-way', async () => {
    const prefs = await load({ lockedCategories: ['a'] })
    await prefs.saveParental({ pin: '1234' })
    db.putSecretSettings.mockRejectedValue(new Error('storage unavailable'))
    await expect(prefs.saveParental({ pin: undefined, lockedCategories: [] })).rejects.toThrow()
    expect(prefs.getPrefs()).toMatchObject({ pin: '1234', lockedCategories: ['a'] })
    expect(lockedOnDisk()).toEqual(['a'])
  })
})
