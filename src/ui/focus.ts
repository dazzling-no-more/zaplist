import { init, pause, resume } from '@noriginmedia/norigin-spatial-navigation'
import { cursorVisible, isWebOS } from '../platform/webos'

type VisibilityEvent = CustomEvent<{ visibility: boolean }>

let pointerVisible = false
let swallowEnter = false

/**
 * While the Magic Remote pointer is on screen, its OK button arrives as a click, so focusables act
 * on the click and ignore the Enter key to avoid running twice.
 */
export const isPointerVisible = (): boolean => pointerVisible

/** Hovering moves focus while the Magic Remote pointer is shown (or always with a desktop mouse). */
export const canHover = (): boolean => pointerVisible || !isWebOS()

/** mouseenter handler: the element under the pointer takes focus. */
export const hoverToFocus = (focusSelf: () => void) => (): void => {
  if (canHover()) focusSelf()
}

/**
 * After a long press opens something (a menu), the OK key is still held and keeps repeating; ignore
 * it until it is released so it doesn't also press whatever just opened.
 */
export function swallowHeldEnter(): void {
  swallowEnter = true
}

/**
 * Starts spatial navigation (arrows move focus between focusables; OK presses the focused one).
 * Pointer hide/show needs no extra work: hovering already moved focus, so arrows continue from there.
 */
export function initFocus(): void {
  // Native events: keep the browser's default key handling so the caret moves inside text inputs.
  // Nothing scrolls natively (overflow is hidden everywhere), so arrows have no other default effect.
  init({ shouldUseNativeEvents: true })
  pointerVisible = cursorVisible()
  // Capture phase on window runs before spatial navigation's own listener.
  const swallow = (event: KeyboardEvent) => {
    if (!swallowEnter || event.keyCode !== 13) return
    if (event.type === 'keyup') swallowEnter = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  window.addEventListener('keydown', swallow, true)
  window.addEventListener('keyup', swallow, true)
  document.addEventListener('cursorStateChange', (event) => {
    pointerVisible = (event as VisibilityEvent).detail.visibility
  })
  // The on-screen keyboard uses the arrows itself while it's open.
  document.addEventListener('keyboardStateChange', (event) => {
    if ((event as VisibilityEvent).detail.visibility) pause()
    else resume()
  })
}
