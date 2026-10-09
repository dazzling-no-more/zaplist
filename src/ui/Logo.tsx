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

function initials(name: string): string {
  const words = name.split(/[\s\-_.,:;|/\\()[\]{}'"!?+*&#@]+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2)).toUpperCase()
}

/** Channel logo, loaded lazily, with the channel's initials as the placeholder. */
export function Logo({ url, name }: { url?: string; name: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'failed'>(() =>
    !url || failed.has(url) ? 'failed' : loaded.has(url) ? 'loading' : 'idle',
  )
  useEffect(() => {
    if (state !== 'idle') return
    const timer = setTimeout(() => setState('loading'), LOAD_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="logo">
      {(state === 'loading' || state === 'ok') && url && (
        <img
          src={url}
          alt=""
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
      )}
      {state !== 'ok' && <span>{initials(name)}</span>}
    </div>
  )
}
