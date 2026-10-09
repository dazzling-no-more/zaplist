import { describe, expect, it } from 'vitest'
import { clampIndex, scrollToKeepVisible, visibleRange } from '../src/ui/scroll'

// 10 rows of 100px fit in the 1000px viewport.
const ROW = 100
const VIEW = 1000

describe('scrollToKeepVisible', () => {
  it('does not scroll while the row has a row of context on both sides', () => {
    expect(scrollToKeepVisible(0, 5, ROW, VIEW, 1000)).toBe(0)
    expect(scrollToKeepVisible(500, 7, ROW, VIEW, 1000)).toBe(500)
  })

  it('scrolls down just enough to show the row below the focused one', () => {
    expect(scrollToKeepVisible(0, 9, ROW, VIEW, 1000)).toBe(100)
    expect(scrollToKeepVisible(100, 10, ROW, VIEW, 1000)).toBe(200)
  })

  it('scrolls up just enough to show the row above the focused one', () => {
    expect(scrollToKeepVisible(500, 5, ROW, VIEW, 1000)).toBe(400)
  })

  it('jumps for far moves and clamps at both ends', () => {
    expect(scrollToKeepVisible(0, 49_999, ROW, VIEW, 50_000)).toBe(50_000 * ROW - VIEW)
    expect(scrollToKeepVisible(4_000_000, 0, ROW, VIEW, 50_000)).toBe(0)
    expect(scrollToKeepVisible(900, 3, ROW, VIEW, 4)).toBe(0)
  })
})

describe('visibleRange', () => {
  it('covers the viewport plus overscan, clamped to the list', () => {
    expect(visibleRange(0, ROW, VIEW, 1000, 3)).toEqual([0, 13])
    expect(visibleRange(5000, ROW, VIEW, 1000, 3)).toEqual([47, 63])
    expect(visibleRange(0, ROW, VIEW, 4, 3)).toEqual([0, 3])
  })
})

describe('clampIndex', () => {
  it('keeps the index inside the list', () => {
    expect(clampIndex(-1, 10)).toBe(0)
    expect(clampIndex(12, 10)).toBe(9)
    expect(clampIndex(3, 10)).toBe(3)
  })
})
