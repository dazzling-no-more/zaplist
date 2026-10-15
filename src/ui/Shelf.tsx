import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useRef, type ReactNode, type WheelEvent } from 'react'
import { canHover, isPointerVisible } from './focus'
import { clampIndex, scrollToKeepVisible, visibleRange } from './scroll'

const OVERSCAN = 2

interface Props<T> {
  focusKey: string
  items: readonly T[]
  itemKey: (item: T) => string
  /** Card width in px, spacing included. */
  cellWidth: number
  height: number
  /** Visible width in px. */
  width: number
  /** The focused card. The parent owns it so it can restore it. */
  index: number
  onIndexChange: (index: number) => void
  onFocus?: () => void
  renderCell: (item: T, index: number, focused: boolean) => ReactNode
  onSelect: (item: T, index: number) => void
}

/**
 * VirtualGrid's one-row sibling, for Home's overview: one focusable for the row, Left/Right move the
 * index, Up/Down and Left from the first card leave the row, and only the visible cards are in the DOM.
 */
export function Shelf<T>(props: Props<T>) {
  const latest = useRef(props)
  latest.current = props
  const left = useRef(0)

  const move = (delta: number): boolean => {
    const { items, index, onIndexChange } = latest.current
    const next = clampIndex(index + delta, items.length)
    if (next === index || !items.length) return false
    onIndexChange(next)
    return true
  }

  const { ref, focused, focusSelf } = useFocusable<object, HTMLDivElement>({
    focusKey: props.focusKey,
    focusable: props.items.length > 0,
    onFocus: () => latest.current.onFocus?.(),
    onArrowPress: (direction) => {
      if (direction === 'left') return !move(-1)
      if (direction === 'right') {
        move(1)
        return false
      }
      return true
    },
    onEnterPress: () => {
      if (isPointerVisible()) return
      const { items, index, onSelect } = latest.current
      if (items[index] !== undefined) onSelect(items[index], index)
    },
  })

  const { items, itemKey, cellWidth, height, width, index, renderCell } = props
  left.current = scrollToKeepVisible(left.current, index, cellWidth, width, items.length)
  const [first, last] = visibleRange(left.current, cellWidth, width, items.length, OVERSCAN)

  const cells: ReactNode[] = []
  for (let i = first; i <= last; i++) {
    const item = items[i]
    cells.push(
      <div
        key={itemKey(item)}
        className="shelf-cell"
        style={{ left: i * cellWidth, width: cellWidth }}
        onMouseEnter={() => {
          if (!canHover()) return
          focusSelf()
          if (latest.current.index !== i) latest.current.onIndexChange(i)
        }}
        onClick={() => {
          latest.current.onIndexChange(i)
          latest.current.onSelect(item, i)
        }}
      >
        {renderCell(item, i, focused && i === index)}
      </div>,
    )
  }

  const onWheel = (event: WheelEvent) => move(event.deltaY > 0 ? 1 : -1)

  return (
    <div ref={ref} className="shelf" style={{ height }} onWheel={onWheel}>
      <div className="shelf-inner" style={{ transform: `translate3d(${-left.current}px, 0, 0)` }}>
        {cells}
      </div>
    </div>
  )
}
