import { useEffect, useRef, useState } from 'react'
import type { Playback } from '../player/playback'
import { pgsPixels, type PgsPicture, type Subtitle } from '../player/subtitles'

const CHECK_MS = 200
const WIDTH = 1920
const HEIGHT = 1080

/**
 * Subtitles the app draws itself, for engines whose player can't show them (subtitleAt): text near
 * the bottom edge (higher while the info bar shows), PGS pictures where the movie places them.
 */
export function Subtitles({ playback, raised }: { playback?: Playback; raised: boolean }) {
  const [shown, setShown] = useState<Subtitle>()
  useEffect(() => {
    if (!playback) return
    // subtitleAt returns the same object while the same subtitle shows, so this re-renders on changes only.
    const timer = setInterval(() => setShown(playback.current()?.subtitleAt?.(playback.currentTime())), CHECK_MS)
    return () => clearInterval(timer)
  }, [playback])
  if (!shown) return null
  if ('picture' in shown) return <Picture picture={shown.picture} />
  return (
    <div className={`subtitles${raised ? ' raised' : ''}`}>
      <span>{shown.text}</span>
    </div>
  )
}

/** A PGS picture, scaled from the movie's frame to the screen. */
function Picture({ picture }: { picture: PgsPicture }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, WIDTH, HEIGHT)
    const scaleX = WIDTH / picture.width
    const scaleY = HEIGHT / picture.height
    for (const object of picture.objects) {
      const bitmap = document.createElement('canvas')
      bitmap.width = object.width
      bitmap.height = object.height
      bitmap.getContext('2d')?.putImageData(new ImageData(pgsPixels(object), object.width, object.height), 0, 0)
      context.drawImage(bitmap, object.x * scaleX, object.y * scaleY, object.width * scaleX, object.height * scaleY)
    }
  }, [picture])
  return <canvas ref={canvas} className="subtitle-picture" width={WIDTH} height={HEIGHT} />
}
