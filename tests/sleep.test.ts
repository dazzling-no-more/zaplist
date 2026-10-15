import { describe, expect, it, vi } from 'vitest'
import { cycleSleep, getSleep, setSleep } from '../src/player/sleep'

describe('sleep timer', () => {
  it('goes through Off, 30 min, 1 h, 1 h 30 and 2 h, each from now', () => {
    vi.useFakeTimers()
    try {
      expect([cycleSleep(), cycleSleep(), cycleSleep(), cycleSleep(), cycleSleep(), cycleSleep()]).toEqual([30, 60, 90, 120, 0, 30])
      setSleep(0)
      expect(cycleSleep()).toBe(30)
    } finally {
      setSleep(0)
      vi.useRealTimers()
    }
  })

  it('warns in the last minute, and not after it was turned off', () => {
    vi.useFakeTimers()
    try {
      setSleep(30)
      vi.advanceTimersByTime(29 * 60_000 - 1)
      expect(getSleep().warning).toBe(false)
      vi.advanceTimersByTime(1)
      expect(getSleep()).toEqual({ endsAt: Date.now() + 60_000, warning: true })
      setSleep(0)
      expect(getSleep()).toEqual({ endsAt: 0, warning: false })
      setSleep(30)
      setSleep(0)
      vi.advanceTimersByTime(30 * 60_000)
      expect(getSleep().warning).toBe(false)
    } finally {
      setSleep(0)
      vi.useRealTimers()
    }
  })
})
