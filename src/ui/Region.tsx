import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import type { ReactNode } from 'react'

interface Props {
  focusKey: string
  className?: string
  /** Arrows can't move focus out of this region (dialogs). */
  isFocusBoundary?: boolean
  children: ReactNode
}

/** A group of focusables (sidebar, list, dialog). Entering it again focuses its last focused child. */
export function Region({ focusKey, className, isFocusBoundary, children }: Props) {
  const { ref, focusKey: key } = useFocusable<object, HTMLDivElement>({
    focusKey,
    isFocusBoundary,
    saveLastFocusedChild: true,
  })
  return (
    <FocusContext.Provider value={key}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </FocusContext.Provider>
  )
}
