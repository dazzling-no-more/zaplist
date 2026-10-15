import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useEffect, type ReactNode } from 'react'

interface Props {
  focusKey: string
  className?: string
  /** Arrows can't move focus out of this region (dialogs). */
  isFocusBoundary?: boolean
  /** Child focused when arrows enter the region; with it, the region doesn't remember its last child. */
  preferredChild?: string
  /** False while the region has nothing focusable, so arrows skip it instead of losing focus in it. */
  focusable?: boolean
  /** Called when focus moves into the region (Home's sidebar opens and closes with it). */
  onFocusWithin?: () => void
  children: ReactNode
}

/** A group of focusables (sidebar, list, dialog). Entering it focuses its last focused (or preferred) child. */
export function Region({ focusKey, className, isFocusBoundary, preferredChild, focusable = true, onFocusWithin, children }: Props) {
  const { ref, focusKey: key, hasFocusedChild } = useFocusable<object, HTMLDivElement>({
    focusKey,
    focusable,
    isFocusBoundary,
    saveLastFocusedChild: !preferredChild,
    preferredChildFocusKey: preferredChild,
    trackChildren: !!onFocusWithin,
  })
  useEffect(() => {
    if (hasFocusedChild) onFocusWithin?.()
  }, [hasFocusedChild])
  return (
    <FocusContext.Provider value={key}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </FocusContext.Provider>
  )
}
