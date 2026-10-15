import { useSyncExternalStore } from 'react'

/** The sleep timer's choices in minutes, in the order the button goes through them; 0 is off. */
export const SLEEP_MINUTES = [0, 30, 60, 90, 120]
/** The last minute counts down in a dialog that can stop the timer (ui/SleepTimer.tsx). */
export const SLEEP_WARNING_MS = 60_000

export interface SleepState {
  /** When playback stops (epoch ms); 0 while the timer is off. */
  endsAt: number
  /** In the last minute: the dialog is open, so the players leave the remote's keys to it. */
  warning: boolean
}

let minutes = 0
let state: SleepState = { endsAt: 0, warning: false }
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function set(next: SleepState): void {
  state = next
  listeners.forEach((listener) => listener())
}

/** Sets the timer to `value` minutes from now; 0 turns it off. */
export function setSleep(value: number): void {
  minutes = value
  clearTimeout(timer)
  if (value) timer = setTimeout(() => set({ ...state, warning: true }), value * 60_000 - SLEEP_WARNING_MS)
  set({ endsAt: value ? Date.now() + value * 60_000 : 0, warning: false })
}

/** The next choice after the one set last (Off, 30 min, ..., 2 h, Off), from now; returns its minutes. */
export function cycleSleep(): number {
  const next = SLEEP_MINUTES[(SLEEP_MINUTES.indexOf(minutes) + 1) % SLEEP_MINUTES.length]
  setSleep(next)
  return next
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getSleep = (): SleepState => state

export const useSleep = (): SleepState => useSyncExternalStore(subscribe, getSleep)
