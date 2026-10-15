import type { VodItem } from '../data/vod'
import { Poster } from './Logo'

/** A poster cell's size in grids and shelves: the 188 x 282 poster, its two-line title and spacing. */
export const POSTER_CELL_WIDTH = 204
export const POSTER_CELL_HEIGHT = 384

/** A poster with its title, and how much was watched (movies). */
export function PosterCell({ item, focused, progress }: { item: VodItem; focused: boolean; progress?: { position: number; duration: number } }) {
  const fraction = progress && progress.duration > 0 ? Math.min(1, progress.position / progress.duration) : 0
  return (
    <div className={`poster-cell${focused ? ' focused' : ''}`}>
      <Poster url={item.poster} name={item.name} />
      {fraction > 0 && (
        <div className="poster-progress">
          <div style={{ width: `${fraction * 100}%` }} />
        </div>
      )}
      <div className="poster-title">{item.name}</div>
    </div>
  )
}
