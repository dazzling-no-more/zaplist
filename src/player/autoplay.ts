import { useSyncExternalStore } from 'react'

// Desktop browsers refuse to start a video with sound before the user has pressed a key or clicked
// (the TV has no such rule). Then the video plays muted, and the first key press or click unmutes it.

let muted = false
const listeners = new Set<() => void>()

function setMuted(value: boolean): void {
  muted = value
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** True while sound is off because the browser blocked it. */
export const useSoundBlocked = (): boolean => useSyncExternalStore(subscribe, () => muted)

/** Plays with sound; where the browser forbids that, plays muted until the next user input. */
export async function playWithSound(video: HTMLVideoElement): Promise<void> {
  video.muted = false
  try {
    await video.play()
  } catch (error) {
    if ((error as Error)?.name !== 'NotAllowedError') return
    video.muted = true
    setMuted(true)
    const unmute = () => {
      video.muted = false
      setMuted(false)
      window.removeEventListener('keydown', unmute, true)
      window.removeEventListener('pointerdown', unmute, true)
    }
    window.addEventListener('keydown', unmute, true)
    window.addEventListener('pointerdown', unmute, true)
    await video.play().catch(() => undefined)
  }
}
