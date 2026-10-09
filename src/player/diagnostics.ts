import type { EngineName } from './streams'

/** What the About screen reports about playback. */
export const diagnostics: { engine?: EngineName; lastError?: string; lastErrorAt?: number } = {}

export function recordError(message: string): void {
  diagnostics.lastError = message
  diagnostics.lastErrorAt = Date.now()
}
