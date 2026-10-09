import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import { onRemoteKey, type Key } from '../platform/keys'
import { canHover, isPointerVisible, swallowHeldEnter } from './focus'
import { clampIndex, scrollToKeepVisible, visibleRange } from './scroll'

const OVERSCAN = 3
const LONG_PRESS_MS = 600
/** Key repeats arrive well within this; a longer gap means a new press. */
const REPEAT_GAP_MS = 300

export interface VirtualListProps<T> {
  focusKey: string
  items: readonly T[]
  itemKey: (item: T) => string
  rowHeight: number
  /** Visible height in px. */
  height: number
  /** The focused row. The parent owns it so it can restore and move it. */
  index: number
  onIndexChange: (index: number) => void
  /** `action`: the row's button (see onRowAction) has focus rather than the row itself. */
  renderRow: (item: T, index: number, focused: boolean, action: boolean) => ReactNode
  onSelect?: (item: T, index: number) => void
  /** The row's button (e.g. favorite): Right moves onto it, Left back, OK presses it. */
  onRowAction?: (item: T, index: number) => void
  /** Holding OK. Without it, OK selects on key down instead of key up. */
  onLongPress?: (item: T, index: number) => void
  /** Up/Down before the list moves focus; return true when handled (e.g. reordering). */
  onVertical?: (direction: 1 | -1, index: number) => boolean
  /** Other remote keys while the list has focus (color keys); return true when handled. */
  onKey?: (key: Key, item: T | undefined, index: number) => boolean
  onFocusChange?: (focused: boolean) => void
  className?: string
  empty?: ReactNode
}

/**
 * A virtualized list that manages focus by index: one spatial-navigation focusable for the whole
 * list, arrows move the index, and only the visible rows are in the DOM. Channel Up/Down page.
 */
export function VirtualList<T>(props: VirtualListProps<T>) {
  const latest = useRef(props)
  latest.current = props
  const press = useRef<{ at: number; last: number; long: boolean } | null>(null)
  const top = useRef(0)
  const [actionMode, setActionMode] = useState(false)
  const action = useRef(false)
  action.current = actionMode

  const move = (delta: number): boolean => {
    const { items, index, onIndexChange } = latest.current
    const next = clampIndex(index + delta, items.length)
    if (next === index || !items.length) return false
    onIndexChange(next)
    return true
  }

  const { ref, focused, focusSelf } = useFocusable<object, HTMLDivElement>({
    focusKey: props.focusKey,
    // An empty list can't show focus, so it doesn't take it.
    focusable: props.items.length > 0,
    onArrowPress: (direction) => {
      // Right onto the row's button and Left back; Up/Down keep it, so you can go down the column.
      if (direction === 'right' && latest.current.onRowAction) {
        setActionMode(true)
        return false
      }
      if (direction === 'left' && action.current) {
        setActionMode(false)
        return false
      }
      if (direction !== 'up' && direction !== 'down') return true
      const delta = direction === 'up' ? -1 : 1
      if (latest.current.onVertical?.(delta, latest.current.index)) return false
      return !move(delta)
    },
    onEnterPress: (_props, details) => {
      if (isPointerVisible()) return
      const { items, index, onSelect, onLongPress, onRowAction } = latest.current
      const item = items[index]
      if (item === undefined) return
      if (action.current) {
        if (onRowAction && (details?.pressedKeys?.enter ?? 1) <= 1) onRowAction(item, index)
        return
      }
      if (!onLongPress) return void onSelect?.(item, index)
      const now = Date.now()
      const current = press.current
      if (!current || now - current.last > REPEAT_GAP_MS) {
        press.current = { at: now, last: now, long: false }
      } else {
        current.last = now
        if (!current.long && now - current.at >= LONG_PRESS_MS) {
          current.long = true
          swallowHeldEnter()
          onLongPress(item, index)
        }
      }
    },
    onEnterRelease: () => {
      const current = press.current
      press.current = null
      const { items, index, onSelect, onLongPress } = latest.current
      if (onLongPress && current && !current.long && !action.current && items[index] !== undefined) onSelect?.(items[index], index)
    },
    onFocus: () => latest.current.onFocusChange?.(true),
    onBlur: () => {
      press.current = null
      setActionMode(false)
      latest.current.onFocusChange?.(false)
    },
  })

  useEffect(() => {
    if (!focused) return
    return onRemoteKey((key, event) => {
      const { items, index, height, rowHeight, onKey } = latest.current
      const page = Math.max(1, Math.floor(height / rowHeight) - 1)
      if (key === 'channelUp') move(-page)
      else if (key === 'channelDown') move(page)
      else if (!onKey?.(key, items[index], index)) return
      event.preventDefault()
    })
  }, [focused])

  const { items, itemKey, rowHeight, height, index, renderRow, className, empty } = props
  top.current = scrollToKeepVisible(top.current, index, rowHeight, height, items.length)
  const [first, last] = visibleRange(top.current, rowHeight, height, items.length, OVERSCAN)

  const rows: ReactNode[] = []
  for (let i = first; i <= last; i++) {
    const item = items[i]
    rows.push(
      <div
        key={itemKey(item)}
        className="vlist-row"
        style={{ top: i * rowHeight, height: rowHeight }}
        onMouseEnter={() => {
          if (!canHover()) return
          focusSelf()
          if (latest.current.index !== i) latest.current.onIndexChange(i)
        }}
        onClick={() => {
          latest.current.onIndexChange(i)
          latest.current.onSelect?.(item, i)
        }}
      >
        {renderRow(item, i, focused && i === index, focused && i === index && actionMode)}
      </div>,
    )
  }

  const onWheel = (event: WheelEvent) => move(event.deltaY > 0 ? 3 : -3)

  return (
    <div ref={ref} className={`vlist${focused ? ' vlist-focused' : ''}${className ? ' ' + className : ''}`} style={{ height }} onWheel={onWheel}>
      {items.length ? <div className="vlist-inner" style={{ transform: `translate3d(0, ${-top.current}px, 0)` }}>{rows}</div> : empty}
    </div>
  )
}
