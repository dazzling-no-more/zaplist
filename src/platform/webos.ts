// Thin wrappers over the webOS globals. webOSTV.js (public/) defines `window.webOS`; the web engine
// defines `webOSSystem` (older firmware: `PalmSystem`). In desktop browsers only `webOS` exists.

interface LunaRequestOptions<T> {
  method: string
  parameters?: Record<string, unknown>
  /** Keeps the request open (more responses may come) until it is cancelled. */
  subscribe?: boolean
  onSuccess?: (response: T) => void
  onFailure?: (error: { errorCode?: number; errorText?: string }) => void
}

interface WebOSTV {
  platformBack(): void
  service: { request<T>(uri: string, options: LunaRequestOptions<T>): { cancel(): void } }
  /** webOSTV.js's system info; `sdkVersion` is the webOS version (5.6.2). */
  deviceInfo?(callback: (info: { sdkVersion?: string }) => void): void
}

interface WebOSSystem {
  activate(): void
  cursor?: { visibility?: boolean }
  /** JSON with modelName, platformVersion, ... */
  deviceInfo?: string
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

/** Whether the Magic Remote pointer is on screen right now. */
export function cursorVisible(): boolean {
  return !!(window.webOSSystem ?? window.PalmSystem)?.cursor?.visibility
}

export interface DeviceInfo {
  modelName?: string
  /** The firmware's version (04.64.00), not webOS's: see webOSVersion. */
  platformVersion?: string
}

/** Model and firmware version, read without a Luna call (so no extra permissions). Undefined off-TV. */
export function deviceInfo(): DeviceInfo | undefined {
  const raw = (window.webOSSystem ?? window.PalmSystem)?.deviceInfo
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as DeviceInfo
  } catch {
    return undefined
  }
}

/** The webOS version (5.6.2), as webOSTV.js asks the system for it; undefined off-TV or unanswered. */
export function webOSVersion(): Promise<string | undefined> {
  const webOS = window.webOS
  if (!isWebOS() || !webOS?.deviceInfo) return Promise.resolve(undefined)
  return new Promise((resolve) => webOS.deviceInfo!((info) => resolve(info.sdkVersion)))
}

/** Brings the app to the foreground. */
export function activateApp(): void {
  ;(window.webOSSystem ?? window.PalmSystem)?.activate()
}
