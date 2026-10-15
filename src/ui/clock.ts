import { useSyncExternalStore } from 'react'

// One timer for every clock, progress bar and now/next line on screen.
const TICK_MS = 30_000
let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!timer) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      listeners.forEach((l) => l())
    }, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

/**
 * The time to show. No timer runs while no clock is on screen, and a screen's first render reads it
 * before it subscribes: a time older than a tick is renewed then (the guide would open in the past).
 */
function getNow(): number {
  if (!timer && Date.now() - now >= TICK_MS) now = Date.now()
  return now
}

/** The current time, updated every 30 seconds. */
export const useNow = (): number => useSyncExternalStore(subscribe, getNow)

export const formatTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
