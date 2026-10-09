import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import type { ReactNode } from 'react'
import { hoverToFocus, isPointerVisible } from './focus'
import { Icon, type IconName } from './Icon'

interface Props {
  focusKey?: string
  /** Marks the current choice in a group (e.g. the open category), independent of focus. */
  selected?: boolean
  className?: string
  onPress: () => void
  onFocus?: () => void
  icon?: IconName
  children: ReactNode
}

/** A focusable control: OK on the 5-way remote, or hover + click with the Magic Remote. */
export function Button({ focusKey, selected, className, onPress, onFocus, icon, children }: Props) {
  const { ref, focused, focusSelf } = useFocusable<object, HTMLDivElement>({
    focusKey,
    onEnterPress: () => {
      if (!isPointerVisible()) onPress()
    },
    onFocus: () => onFocus?.(),
  })
  const classes = ['button', className, selected && 'selected', focused && 'focused'].filter(Boolean).join(' ')
  return (
    <div ref={ref} className={classes} onMouseEnter={hoverToFocus(focusSelf)} onClick={onPress}>
      {icon && <Icon name={icon} />}
      {children}
    </div>
  )
}
