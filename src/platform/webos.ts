// Thin wrappers over the webOS globals. webOSTV.js (public/) defines `window.webOS`; the web engine
// defines `webOSSystem` (older firmware: `PalmSystem`). In desktop browsers only `webOS` exists.

interface WebOSTV {
  platformBack(): void
}

interface WebOSSystem {
  activate(): void
}

declare global {
  interface Window {
    webOS?: WebOSTV
    webOSSystem?: WebOSSystem
    PalmSystem?: WebOSSystem
  }
}

/** True on a TV or in the webOS simulator, false in a desktop browser. */
export function isWebOS(): boolean {
  return !!(window.webOSSystem || window.PalmSystem)
}

/** Leaves the app the way the system Back key would. Does nothing in a desktop browser. */
export function platformBack(): void {
  if (isWebOS()) window.webOS?.platformBack()
}

/** Brings the app to the foreground. */
export function activateApp(): void {
  ;(window.webOSSystem ?? window.PalmSystem)?.activate()
}
