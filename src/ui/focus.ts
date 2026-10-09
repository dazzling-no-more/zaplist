import { init, pause, resume } from '@noriginmedia/norigin-spatial-navigation'
import { isWebOS } from '../platform/webos'

type VisibilityEvent = CustomEvent<{ visibility: boolean }>

let pointerVisible = false

/**
 * While the Magic Remote pointer is on screen, its OK button arrives as a click, so focusables act
 * on the click and ignore the Enter key to avoid running twice.
 */
export const isPointerVisible = (): boolean => pointerVisible

/** mouseenter handler: the element under the Magic Remote pointer (or a desktop mouse) takes focus. */
export const hoverToFocus = (focusSelf: () => void) => (): void => {
  if (pointerVisible || !isWebOS()) focusSelf()
}

/**
 * Starts spatial navigation (arrows move focus between focusables; OK presses the focused one).
 * Pointer hide/show needs no extra work: hovering already moved focus, so arrows continue from there.
 */
export function initFocus(): void {
  init()
  document.addEventListener('cursorStateChange', (event) => {
    pointerVisible = (event as VisibilityEvent).detail.visibility
  })
  // The on-screen keyboard uses the arrows itself while it's open.
  document.addEventListener('keyboardStateChange', (event) => {
    if ((event as VisibilityEvent).detail.visibility) pause()
    else resume()
  })
}
