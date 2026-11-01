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

  it('does not overwrite a newly saved PIN with a guide setting changed while it was saving', async () => {
    const prefs = await load()
    let finish!: () => void
    db.putSecretSettings.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    const saving = prefs.saveParental({ pin: '1234' })
    await vi.waitFor(() => expect(db.putSecretSettings).toHaveBeenCalledOnce())
    prefs.updatePrefs({ epgUrl: 'http://example.com/guide.xml' })
    finish()
    await saving
    await vi.waitFor(() => expect(db.putSecretSettings).toHaveBeenCalledTimes(2))
    expect(db.putSecretSettings).toHaveBeenLastCalledWith({ pin: '1234', epgUrl: 'http://example.com/guide.xml', proxy: undefined })
  })
})

describe('proxy settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    failLocal = false
    db.putSecretSettings.mockResolvedValue(undefined)
  })

  it('keeps the proxy and its login in encrypted storage, never in localStorage', async () => {
    const prefs = await load()
    const proxy = { host: '203.0.113.10', port: 18080, user: 'zaplist', password: 'secret' }
    prefs.updatePrefs({ proxy })
    await vi.waitFor(() => expect(db.putSecretSettings).toHaveBeenCalledWith({ pin: undefined, epgUrl: undefined, proxy }))
    expect(stored[KEY]).not.toContain('secret')
    expect(stored[KEY]).not.toContain('203.0.113.10')

    const restarted = await load(JSON.parse(stored[KEY]))
    db.getSecretSettings.mockResolvedValue({ proxy })
    await restarted.loadSecretPrefs()
    expect(restarted.getPrefs().proxy).toEqual(proxy)
  })

  it('stores rapid edits in order even when the first encrypted write is slow', async () => {
    const prefs = await load()
    let persisted: unknown
    let finish!: () => void
    db.putSecretSettings
      .mockImplementationOnce((value: unknown) => new Promise<void>((resolve) => {
        finish = () => { persisted = value; resolve() }
      }))
      .mockImplementation(async (value: unknown) => { persisted = value })
    prefs.updatePrefs({ epgUrl: 'http://example.com/old' })
    await vi.waitFor(() => expect(db.putSecretSettings).toHaveBeenCalledOnce())
    prefs.updatePrefs({ epgUrl: 'http://example.com/new' })
    finish()
    await vi.waitFor(() => expect(db.putSecretSettings).toHaveBeenCalledTimes(2))
    expect(persisted).toMatchObject({ epgUrl: 'http://example.com/new' })
  })

  it('continues saving settings after an earlier encrypted write fails', async () => {
    const prefs = await load()
    db.putSecretSettings.mockRejectedValueOnce(new Error('storage unavailable'))
    prefs.updatePrefs({ epgUrl: 'http://example.com/old' })
    prefs.updatePrefs({ epgUrl: 'http://example.com/new' })
    await vi.waitFor(() => expect(db.putSecretSettings).toHaveBeenCalledTimes(2))
    expect(db.putSecretSettings).toHaveBeenLastCalledWith({ pin: undefined, epgUrl: 'http://example.com/new', proxy: undefined })
  })
})

describe('moveFavorite', () => {
  it('moves past the next favorite on screen, leaving hidden ones where they are', async () => {
    const prefs = await load({ favorites: ['a', 'locked', 'b', 'c'] })
    const shown = ['a', 'b', 'c']
    expect(prefs.moveFavorite('b', -1, shown)).toBe(0)
    expect(prefs.getPrefs().favorites).toEqual(['b', 'a', 'locked', 'c'])
    expect(prefs.moveFavorite('a', 1, ['b', 'a', 'c'])).toBe(2)
    expect(prefs.getPrefs().favorites).toEqual(['b', 'locked', 'c', 'a'])
    expect(prefs.moveFavorite('a', 1, ['b', 'c', 'a'])).toBe(2)
  })
})

describe('renameIds', () => {
  it('moves favorites, recents and the last channel to the new ids', async () => {
    const prefs = await load({ favorites: ['a', 'b'], recents: ['b', 'c'], lastChannelId: 'b' })
    prefs.renameIds(new Map([['b', 'B']]))
    expect(prefs.getPrefs()).toMatchObject({ favorites: ['a', 'B'], recents: ['B', 'c'], lastChannelId: 'B' })
  })
})
