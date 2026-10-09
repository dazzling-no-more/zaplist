// Runtime APIs missing in Chromium 53 (webOS TV 4.x). The build lowers syntax separately (build.target).
import 'virtual:core-js'
import 'abortcontroller-polyfill/dist/polyfill-patch-fetch'
import { ResizeObserver } from '@juggle/resize-observer'

if (!('ResizeObserver' in window)) {
  ;(window as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserver
}
