/**
 * Scroll offset that keeps row `index` visible with one row of context above and below,
 * moving as little as possible from `current`.
 */
export function scrollToKeepVisible(current: number, index: number, rowHeight: number, viewport: number, count: number): number {
  const rowTop = index * rowHeight
  let top = current
  if (rowTop - rowHeight < top) top = rowTop - rowHeight
  if (rowTop + 2 * rowHeight > top + viewport) top = rowTop + 2 * rowHeight - viewport
  const max = Math.max(0, count * rowHeight - viewport)
  return Math.max(0, Math.min(top, max))
}

/** Index range [first, last] to render for a scroll offset, with `overscan` extra rows on each side. */
export function visibleRange(top: number, rowHeight: number, viewport: number, count: number, overscan: number): [number, number] {
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan)
  const last = Math.min(count - 1, Math.ceil((top + viewport) / rowHeight) + overscan)
  return [first, last]
}

export const clampIndex = (index: number, count: number): number => Math.max(0, Math.min(count - 1, index))
