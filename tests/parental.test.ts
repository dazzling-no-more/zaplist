import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/data/prefs', () => ({ getPrefs: () => ({ pin: '1234' }) }))

let stored: Record<string, string>

/** A fresh parental module (it's a singleton) over a stub localStorage. */
async function load() {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => (stored[key] = value),
  })
  vi.resetModules()
  return import('../src/data/parental')
}

describe('PIN entry', () => {
  beforeEach(() => {
    stored = {}
    vi.useRealTimers()
  })

  it('blocks entry after five wrong PINs, longer after each further one, even after a restart', async () => {
    vi.useFakeTimers()
    let parental = await load()
    for (let i = 0; i < 4; i++) expect(parental.unlock('0000')).toBe(false)
    expect(parental.pinBlockedUntil()).toBe(0)
    expect(parental.unlock('0000')).toBe(false)
    expect(parental.pinBlockedUntil()).toBe(Date.now() + 30_000)
    expect(parental.unlock('1234')).toBe(false) // not even checked while blocked

    parental = await load() // the app restarted
    expect(parental.pinBlockedUntil()).toBe(Date.now() + 30_000)
    vi.advanceTimersByTime(30_000)
    expect(parental.unlock('9999')).toBe(false)
    expect(parental.pinBlockedUntil()).toBe(Date.now() + 60_000)
    vi.advanceTimersByTime(60_000)
    expect(parental.unlock('1234')).toBe(true)
    expect(parental.unlock('0000')).toBe(false)
    expect(parental.pinBlockedUntil()).toBe(0) // the count started again
  })
})
