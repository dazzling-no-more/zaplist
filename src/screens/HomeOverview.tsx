import { useMemo, useRef, useState, type ReactNode } from 'react'
import { library, useLibrary } from '../data/library'
import { channelsForGroup, FAVORITES, leftOut, RECENT } from '../data/lists'
import type { Channel } from '../data/models'
import { useUnlocked } from '../data/parental'
import { usePrefs } from '../data/prefs'
import type { VodItem } from '../data/vod'
import { continueIds, useWatch, type WatchEntry } from '../data/watch'
import { t } from '../i18n'
import { Logo } from '../ui/Logo'
import { navigate } from '../ui/navigation'
import { NowPlaying } from '../ui/NowPlaying'
import { playChannel } from '../ui/play'
import { POSTER_CELL_HEIGHT, POSTER_CELL_WIDTH, PosterCell } from '../ui/PosterCell'
import { clampIndex } from '../ui/scroll'
import { Shelf } from '../ui/Shelf'

/** A shelf's title above its cards. */
const TITLE = 52
/** A channel card: the 208 x 117 logo, name, programme on now and spacing. */
const TILE_WIDTH = 228
const TILE_HEIGHT = 232
const NO_CATEGORIES = new Map<string, Channel[]>()

/** A movie or series the user started, with when they last watched it. */
export interface Started {
  kind: 'movie' | 'series'
  item: VodItem
  at: number
  /** Movies: how far they got. */
  progress?: WatchEntry
}

/** A movie or series on the user's list. */
export interface Listed {
  kind: 'movie' | 'series'
  item: VodItem
}

export interface Overview {
  started: Started[]
  watchlist: Listed[]
  favorites: readonly Channel[]
  recent: readonly Channel[]
}

export const isOverviewEmpty = (overview: Overview): boolean =>
  !overview.started.length && !overview.watchlist.length && !overview.favorites.length && !overview.recent.length

/** The first shelf's focus key, to focus the overview from its top. */
export const overviewFocusKey = (overview: Overview): string =>
  overview.started.length ? 'overview-started' : overview.watchlist.length ? 'overview-watchlist' : overview.favorites.length ? 'overview-favorites' : 'overview-recent'

/** What Home's overview shows. Hidden categories are left out, locked ones until the PIN unlocks them, as everywhere. */
export function useOverview(): Overview {
  const { channels, movies, series } = useLibrary()
  const prefs = usePrefs()
  const unlocked = useUnlocked()
  const watch = useWatch()
  return useMemo(() => {
    const ids = continueIds(watch)
    // A series was last watched when its most recent episode was.
    const seriesAt = new Map<string, number>()
    for (const id of Object.keys(watch)) {
      const seriesId = watch[id].seriesId
      if (seriesId) seriesAt.set(seriesId, Math.max(seriesAt.get(seriesId) ?? 0, watch[id].at))
    }
    const started: Started[] = []
    for (const id of ids.movies) {
      const item = library.movie(id)
      if (item) started.push({ kind: 'movie', item, at: watch[id].at, progress: watch[id] })
    }
    for (const id of ids.series) {
      const item = library.series(id)
      if (item) started.push({ kind: 'series', item, at: seriesAt.get(id) ?? 0 })
    }
    const watchlist: Listed[] = []
    for (const id of prefs.watchlist) {
      const movie = library.movie(id)
      const show = movie ? undefined : library.series(id)
      if (movie) watchlist.push({ kind: 'movie', item: movie })
      else if (show) watchlist.push({ kind: 'series', item: show })
    }
    const out = leftOut(prefs, unlocked)
    const byId = (id: string) => library.channel(id)
    return {
      started: started.filter((s) => !out(s.item.categoryId)).sort((a, b) => b.at - a.at),
      watchlist: watchlist.filter((l) => !out(l.item.categoryId)),
      favorites: channelsForGroup(FAVORITES, channels, byId, NO_CATEGORIES, prefs, unlocked),
      recent: channelsForGroup(RECENT, channels, byId, NO_CATEGORIES, prefs, unlocked),
    }
  }, [channels, movies, series, watch, prefs.favorites, prefs.recents, prefs.watchlist, prefs.pin, prefs.lockedCategories, prefs.hiddenCategories, unlocked])
}

interface Props {
  overview: Overview
  /** Home's memo: the focused card of each shelf, for coming back. */
  memo: { overview?: Record<string, number> }
  /** The channel played since Home was last shown: its card is focused in Favorites and Recent. */
  played?: string
  width: number
  height: number
}

/** Home's first group: movies and series to continue and on the user's list, then favorite and recent channels, a shelf each. */
export function HomeOverview({ overview, memo, played, width, height }: Props) {
  const [indexes, setIndexes] = useState<Record<string, number>>(() => {
    const saved = { ...memo.overview }
    for (const [key, channels] of [['favorites', overview.favorites], ['recent', overview.recent]] as const) {
      const index = played ? channels.findIndex((c) => c.id === played) : -1
      if (index >= 0) saved[key] = index
    }
    return saved
  })
  memo.overview = indexes
  const [active, setActive] = useState(0)
  const offset = useRef(0)

  const shelves: { key: string; title: string; height: number; node: ReactNode }[] = []
  const shelfProps = (key: string, count: number) => {
    const position = shelves.length
    return {
      focusKey: `overview-${key}`,
      width,
      index: clampIndex(indexes[key] ?? 0, count),
      onIndexChange: (index: number) => setIndexes((all) => ({ ...all, [key]: index })),
      onFocus: () => setActive(position),
    }
  }

  if (overview.started.length) {
    shelves.push({
      key: 'started',
      title: t('vod.continue'),
      height: POSTER_CELL_HEIGHT,
      node: (
        <Shelf
          {...shelfProps('started', overview.started.length)}
          items={overview.started}
          itemKey={(s) => s.item.id}
          cellWidth={POSTER_CELL_WIDTH}
          height={POSTER_CELL_HEIGHT}
          onSelect={(s) => navigate(s.kind === 'movie' ? { name: 'movie', movieId: s.item.id } : { name: 'series', seriesId: s.item.id })}
          renderCell={(s, _, focused) => <PosterCell item={s.item} focused={focused} progress={s.progress} />}
        />
      ),
    })
  }
  if (overview.watchlist.length) {
    shelves.push({
      key: 'watchlist',
      title: t('vod.myList'),
      height: POSTER_CELL_HEIGHT,
      node: (
        <Shelf
          {...shelfProps('watchlist', overview.watchlist.length)}
          items={overview.watchlist}
          itemKey={(l) => l.item.id}
          cellWidth={POSTER_CELL_WIDTH}
          height={POSTER_CELL_HEIGHT}
          onSelect={(l) => navigate(l.kind === 'movie' ? { name: 'movie', movieId: l.item.id } : { name: 'series', seriesId: l.item.id })}
          renderCell={(l, _, focused) => <PosterCell item={l.item} focused={focused} />}
        />
      ),
    })
  }
  for (const [key, title, channels, listId] of [
    ['favorites', t('home.favorites'), overview.favorites, FAVORITES],
    ['recent', t('home.recent'), overview.recent, RECENT],
  ] as const) {
    if (!channels.length) continue
    shelves.push({
      key,
      title,
      height: TILE_HEIGHT,
      node: (
        <Shelf
          {...shelfProps(key, channels.length)}
          items={channels}
          itemKey={(c) => c.id}
          cellWidth={TILE_WIDTH}
          height={TILE_HEIGHT}
          onSelect={(c) => playChannel(c, listId)}
          renderCell={(c, _, focused) => <ChannelTile channel={c} focused={focused} />}
        />
      ),
    })
  }

  // Scroll as little as possible to show the whole focused shelf; the pointer stays on what it hovers.
  let total = 0
  const tops = shelves.map((s) => {
    const top = total
    total += TITLE + s.height
    return top
  })
  const shelf = Math.min(active, shelves.length - 1)
  if (shelf >= 0) {
    const top = tops[shelf]
    const bottom = top + TITLE + shelves[shelf].height
    if (top < offset.current) offset.current = top
    if (bottom > offset.current + height) offset.current = bottom - height
  }
  offset.current = Math.max(0, Math.min(offset.current, total - height))

  return (
    <div className="overview" style={{ height }}>
      <div className="overview-inner" style={{ transform: `translate3d(0, ${-offset.current}px, 0)` }}>
        {shelves.map((s) => (
          <div key={s.key}>
            <h3 className="shelf-title">{s.title}</h3>
            {s.node}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A channel in a shelf: its logo large, then number, name and the programme on now. */
function ChannelTile({ channel, focused }: { channel: Channel; focused: boolean }) {
  return (
    <div className={`tile${focused ? ' focused' : ''}`}>
      <Logo url={channel.logo} name={channel.name} />
      <div className="tile-name">
        <span className="tile-number">{channel.number}</span>
        {channel.name}
      </div>
      <NowPlaying channel={channel} />
    </div>
  )
}
