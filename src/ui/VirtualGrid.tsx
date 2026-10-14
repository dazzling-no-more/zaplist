import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useRef, type ReactNode, type WheelEvent } from 'react'
import { onRemoteKey } from '../platform/keys'
import { canHover, isPointerVisible } from './focus'
import { clampIndex, scrollToKeepVisible, visibleRange } from './scroll'

const OVERSCAN = 1

interface Props<T> {
  focusKey: string
  items: readonly T[]
  itemKey: (item: T) => string
  columns: number
  /** Cell size in px, spacing included. */
  cellWidth: number
  rowHeight: number
  /** Visible height in px. */
  height: number
  /** The focused cell. The parent owns it so it can restore it. */
  index: number
  onIndexChange: (index: number) => void
  renderCell: (item: T, index: number, focused: boolean) => ReactNode
  onSelect: (item: T, index: number) => void
  className?: string
  empty?: ReactNode
}

/**
 * VirtualList's two-dimensional sibling, for posters: one focusable for the whole grid, arrows move
 * the index (Left from the first column and Up from the first row leave the grid), and only the
 * visible rows are in the DOM. Channel Up/Down page.
 */
export function VirtualGrid<T>(props: Props<T>) {
  const latest = useRef(props)
  latest.current = props
  const top = useRef(0)

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
    onArrowPress: (direction) => {
      const { index, columns, items } = latest.current
      const column = index % columns
      if (direction === 'left') return column === 0 || !move(-1)
      if (direction === 'right') return column === columns - 1 || !move(1)
      if (direction === 'up') return index < columns || !move(-columns)
      // Down onto a shorter last row lands on its last cell.
      if (Math.floor(index / columns) === Math.floor((items.length - 1) / columns)) return false
      return !move(Math.min(columns, items.length - 1 - index))
    },
    onEnterPress: () => {
      if (isPointerVisible()) return
      const { items, index, onSelect } = latest.current
      if (items[index] !== undefined) onSelect(items[index], index)
    },
  })

  useEffect(() => {
    if (!focused) return
    return onRemoteKey((key, event) => {
      const { height, rowHeight, columns } = latest.current
      const page = Math.max(1, Math.floor(height / rowHeight)) * columns
      if (key === 'channelUp') move(-page)
      else if (key === 'channelDown') move(page)
      else return
      event.preventDefault()
    })
  }, [focused])

  const { items, itemKey, columns, cellWidth, rowHeight, height, index, renderCell, className, empty } = props
  const rows = Math.ceil(items.length / columns)
  top.current = scrollToKeepVisible(top.current, Math.floor(index / columns), rowHeight, height, rows)
  const [first, last] = visibleRange(top.current, rowHeight, height, rows, OVERSCAN)

  const cells: ReactNode[] = []
  for (let row = first; row <= last; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column
      const item = items[i]
      if (item === undefined) break
      cells.push(
        <div
          key={itemKey(item)}
          className="vgrid-cell"
          style={{ top: row * rowHeight, left: column * cellWidth, width: cellWidth, height: rowHeight }}
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
  }

  const onWheel = (event: WheelEvent) => move(event.deltaY > 0 ? columns : -columns)

  return (
    <div ref={ref} className={`vlist${className ? ' ' + className : ''}`} style={{ height }} onWheel={onWheel}>
      {items.length ? <div className="vlist-inner" style={{ transform: `translate3d(0, ${-top.current}px, 0)` }}>{cells}</div> : empty}
    </div>
  )
}
