import { useEffect, useState } from 'react'

/** Bounded set with least-recently-used eviction. */
class LruSet {
  private readonly items = new Map<string, true>()
  constructor(private readonly limit: number) {}
  has(key: string): boolean {
    if (!this.items.has(key)) return false
    this.items.delete(key)
    this.items.set(key, true)
    return true
  }
  clear(): void {
    this.items.clear()
  }
  add(key: string): void {
    this.items.delete(key)
    this.items.set(key, true)
    if (this.items.size > this.limit) this.items.delete(this.items.keys().next().value!)
  }
}

// Bounded bookkeeping only; the images themselves are freed with their rows.
const loaded = new LruSet(300)
const failed = new LruSet(2000)

export function clearLogoCache(): void {
  loaded.clear()
  failed.clear()
}

/** Rows that scroll past quickly never start a download. */
const LOAD_DELAY_MS = 150

// Leading tags such as "PT:", "DE |", "UK -" or "[FR]" say nothing about the channel itself.
const TAG = /^\s*(\[[^\]]{1,8}\]|[A-Z0-9]{2,4}\s*[:|\-])\s*/

function initials(name: string): string {
  const words = (name.replace(TAG, '') || name).split(/[\s\-_.,:;|/\\()[\]{}'"!?+*&#@]+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2)).toUpperCase()
}

/** A logo or poster loaded lazily: the image while it loads and once it has, `false` for the placeholder. */
function LazyImage({ url, onState }: { url?: string; onState: (shown: boolean) => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'failed'>(() =>
    !url || failed.has(url) ? 'failed' : loaded.has(url) ? 'loading' : 'idle',
  )
  useEffect(() => {
    if (state !== 'idle') return
    const timer = setTimeout(() => setState('loading'), LOAD_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  useEffect(() => onState(state === 'ok'), [state])

  if ((state !== 'loading' && state !== 'ok') || !url) return null
  return (
    <img
      src={url}
      alt=""
      // Some logo hosts (imgur) refuse hotlinked images that carry a Referer.
      referrerPolicy="no-referrer"
      className={state === 'ok' ? 'shown' : ''}
      onLoad={() => {
        loaded.add(url)
        setState('ok')
      }}
      onError={() => {
        failed.add(url)
        setState('failed')
      }}
    />
  )
}

/** Channel logo, loaded lazily, with the channel's initials as the placeholder. */
export function Logo({ url, name }: { url?: string; name: string }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="logo">
      <LazyImage url={url} onState={setShown} />
      {!shown && <span>{initials(name)}</span>}
    </div>
  )
}

/**
 * A details page's background, edge to edge behind a gradient: the backdrop, or the poster stretched
 * and dimmer (`soft`). Stretching softens it for free; `filter: blur` would be slow on webOS 4.
 */
export function Backdrop({ url, soft }: { url?: string; soft?: boolean }) {
  return <div className={`backdrop${soft ? ' soft' : ''}`}>{url && <LazyImage key={url} url={url} onState={() => undefined} />}</div>
}

/** Movie or series poster (2:3), with the title as the placeholder. */
export function Poster({ url, name, className }: { url?: string; name: string; className?: string }) {
  const [shown, setShown] = useState(false)
  return (
    <div className={`poster${className ? ' ' + className : ''}`}>
      {!shown && <span>{name}</span>}
      <LazyImage url={url} onState={setShown} />
    </div>
  )
}
