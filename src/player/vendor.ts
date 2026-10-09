import type HlsClass from 'hls.js'
import type Mpegts from 'mpegts.js'

// hls.js and mpegts.js are only needed when native playback fails, so production builds ship them as
// separate scripts (copied to dist/vendor/ by vite.config.ts) loaded on first use: the TV doesn't
// parse ~800 KB of JavaScript at startup. The dev server imports them as modules.

export type Hls = typeof HlsClass

declare global {
  interface Window {
    Hls?: Hls
    mpegts?: typeof Mpegts
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = () => resolve()
    script.onerror = () => {
      script.remove()
      reject(new Error(`Couldn't load ${src}`))
    }
    document.head.appendChild(script)
  })
}

/** Loads once; a failed load is retried on the next call. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => (pending ??= load().catch((error) => ((pending = undefined), Promise.reject(error))))
}

export const loadHls = once<Hls>(() =>
  import.meta.env.DEV ? import('hls.js').then((m) => m.default) : loadScript('vendor/hls.js').then(() => window.Hls!),
)

export const loadMpegts = once<typeof Mpegts>(() =>
  import.meta.env.DEV ? import('mpegts.js').then((m) => m.default) : loadScript('vendor/mpegts.js').then(() => window.mpegts!),
)
